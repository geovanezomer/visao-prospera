// ============================================================================
// POST /api/public/payments/checkout
//
// Cria sessão de checkout no provedor ativo (Stripe ou Asaas) e devolve a
// URL hospedada para redirect. Rota PÚBLICA — não exige login porque é
// usada na landing (#planos). A criação de conta acontece via magic link
// após a confirmação do pagamento (webhook).
//
// Toda a validação de entrada e da coerência do upsell é feita aqui com
// Zod ANTES de chamar o provedor. Erros retornam um shape estável
// `{ error, code, field? }` que a UI usa para mostrar mensagem específica.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveProvider } from "@/lib/payments";
import { signIntentKey } from "@/lib/intentToken.server";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

// ─── Validação da requisição vinda do navegador ──────────────────────────────
import { isValidCPF, isValidPhoneBR, onlyDigits } from "@/lib/validators/cpf";

const Body = z.object({
  plan: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "slug do plano inválido"),
  email: z.string().email("e-mail inválido").max(200),
  name: z.string().trim().min(3, "nome muito curto").max(120),
  // CPF e telefone passaram a ser coletados na página do provedor (Asaas/Stripe).
  // Mantemos aceitos como opcionais para compatibilidade com clientes antigos.
  cpf: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || isValidCPF(v), "CPF inválido")
    .optional(),
  phone: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || isValidPhoneBR(v), "telefone inválido")
    .optional(),
  withUpsell: z.boolean().optional().default(false),
});

// ─── Schemas que validam o que veio do BANCO ─────────────────────────────────
// O banco é confiável, mas pode estar mal configurado (preço negativo,
// currency vazia, etc.). Tratar como entrada externa.
const CURRENCY_ALLOWLIST = ["BRL", "USD", "EUR"] as const;
const IntervalSchema = z.enum(["month", "year", "week", "day", "lifetime", "one_time"]);
const CurrencySchema = z
  .string()
  .trim()
  .min(3)
  .max(3)
  .transform((s) => s.toUpperCase())
  .refine((c) => (CURRENCY_ALLOWLIST as readonly string[]).includes(c), {
    message: "moeda não suportada",
  });

const PlanRowSchema = z.object({
  name: z.string().min(1),
  interval: IntervalSchema,
  price_cents: z.number().int().nonnegative(),
  currency: CurrencySchema,
  stripe_price_id: z.string().nullable().optional(),
  asaas_plan_ref: z.string().nullable().optional(),
  upsell_enabled: z.boolean().nullable().optional(),
  upsell_name: z.string().nullable().optional(),
  upsell_price_cents: z.number().int().nullable().optional(),
  upsell_stripe_price_id: z.string().nullable().optional(),
  upsell_asaas_ref: z.string().nullable().optional(),
});
type PlanRow = z.infer<typeof PlanRowSchema>;

// Rate limiting agora é distribuído via tabela `rate_limit_buckets` (rl_consume).

// ─── Helpers ────────────────────────────────────────────────────────────────
function err(status: number, code: string, message: string, field?: string) {
  return Response.json({ error: message, code, field }, { status });
}

async function loadPlanRow(slug: string): Promise<PlanRow | null> {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb
    .from("plans")
    .select(
      "name,price_cents,currency,interval,stripe_price_id,asaas_plan_ref,active,upsell_enabled,upsell_name,upsell_price_cents,upsell_stripe_price_id,upsell_asaas_ref",
    )
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  const parsed = PlanRowSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[checkout] plano com dados inválidos:", slug, parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

// ─── Handler ────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/api/public/payments/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1) Rate limit por IP — antes de qualquer parsing, para que bursts
        //    de payloads inválidos também sejam contidos no mesmo bucket.
        const ip = clientIp(request);
        const rlIp = await rlConsume(`checkout:ip:${ip}`, 20, 60);
        if (!rlIp.allowed) return tooManyRequests(rlIp.retryAfter);

        // 2) Validação da requisição
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          const issue = e instanceof z.ZodError ? e.issues[0] : null;
          return err(
            400,
            "invalid_payload",
            issue?.message ?? "Payload inválido",
            issue?.path?.[0]?.toString(),
          );
        }

        // 3) Rate limit adicional por email (após termos um email válido)
        const rlEmail = await rlConsume(`checkout:email:${parsed.email.toLowerCase()}`, 5, 60);
        if (!rlEmail.allowed) return tooManyRequests(rlEmail.retryAfter);

        // 3) Config base — usa APP_URL se configurado, senão a origem do request.
        // Nunca X-Forwarded-Host: é controlado pelo cliente e viraria o
        // success_url do provedor (redirecionamento para domínio falso).
        let appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
        if (!appUrl) {
          try {
            appUrl = new URL(request.url).origin;
          } catch {
            return err(
              500,
              "config_missing",
              "APP_URL não configurado e não foi possível derivar do request",
            );
          }
        }

        try {
          const provider = await resolveProvider();

          // 4) Carrega plano + valida shape vindo do banco
          const plan = await loadPlanRow(parsed.plan);
          if (!plan) {
            return err(404, "plan_not_found", "Plano não encontrado ou inativo.", "plan");
          }

          // 5) Validação do upsell — só se o usuário marcou
          let upsellPayload: {
            name: string;
            priceCents: number;
            stripePriceId?: string | null;
            asaasRef?: string | null;
          } | null = null;

          if (parsed.withUpsell) {
            if (!plan.upsell_enabled) {
              return err(
                400,
                "upsell_disabled",
                "Este plano não possui adicional disponível no momento.",
                "upsell",
              );
            }
            const cents = plan.upsell_price_cents ?? 0;
            if (!Number.isInteger(cents) || cents <= 0) {
              return err(
                422,
                "upsell_invalid_price",
                "O preço do adicional está mal configurado. Tente novamente sem o adicional.",
                "upsell",
              );
            }
            // Coerência de moeda: o upsell SEMPRE usa a moeda do plano.
            // Se o plano não tem moeda válida, bloqueia antes do provedor.
            if (!plan.currency) {
              return err(
                422,
                "upsell_currency_mismatch",
                "Moeda do plano não está configurada — adicional bloqueado.",
                "upsell",
              );
            }
            // Faixa de sanidade: 0,50 ≤ upsell ≤ 5× preço do plano
            // (centavos). Evita upsell descomunal por erro de cadastro.
            const planCents = plan.price_cents;
            const MIN_CENTS = 50;
            const MAX_CENTS = planCents > 0 ? planCents * 5 : 100_000_00;
            if (cents < MIN_CENTS) {
              return err(
                422,
                "upsell_below_min",
                "O adicional está abaixo do valor mínimo (R$ 0,50).",
                "upsell",
              );
            }
            if (cents > MAX_CENTS) {
              console.error("[checkout] upsell desproporcional", {
                plan: parsed.plan,
                planCents,
                upsellCents: cents,
              });
              return err(
                422,
                "upsell_above_max",
                "O adicional está desproporcional ao valor do plano.",
                "upsell",
              );
            }

            upsellPayload = {
              name: plan.upsell_name?.trim() || "Adicional",
              priceCents: cents,
              stripePriceId: plan.upsell_stripe_price_id,
              asaasRef: plan.upsell_asaas_ref,
            };
          }

          // 6) Idempotency key — determinística por (email|plan|upsell|preço|janela 30min).
          //    Reenvio do mesmo formulário dentro da janela reutiliza a sessão.
          //    Incluímos o snapshot do preço (plano + upsell) para que mudança
          //    de preço no Admin invalide a sessão antiga e force criar uma nova.
          const window30m = Math.floor(Date.now() / (30 * 60 * 1000));
          const priceSnap = `${plan.price_cents}:${upsellPayload?.priceCents ?? 0}`;
          const idemRaw = `${parsed.email.toLowerCase()}|${parsed.plan}|${parsed.withUpsell ? 1 : 0}|${priceSnap}|${provider.name}|${window30m}`;
          const idemBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idemRaw));
          const idempotencyKey = Array.from(new Uint8Array(idemBuf))
            .slice(0, 16)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          const { createClient } = await import("@supabase/supabase-js");
          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
          );

          // 6a) Se já existe intent com mesma chave e URL viva, reutiliza.
          const { data: existing } = await sb
            .from("checkout_intents")
            .select("id,checkout_url,status")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (
            existing?.checkout_url &&
            existing.status !== "paid" &&
            existing.status !== "failed"
          ) {
            await sb
              .from("checkout_intents")
              .update({ status: "redirected" })
              .eq("id", existing.id);
            return Response.json({
              url: existing.checkout_url,
              provider: provider.name,
              reused: true,
            });
          }

          // Token assinado por HMAC — vai na URL de retorno em vez do raw key.
          // Quem não tiver o segredo do servidor não consegue forjar/alterar.
          const signedToken = await signIntentKey(idempotencyKey);

          // 6b) Cria checkout no provedor (com idempotency key).
          const providerRef =
            provider.name === "stripe" ? plan.stripe_price_id : plan.asaas_plan_ref;

          let providerResult: {
            url: string;
            providerSessionId?: string | null;
            providerCustomerId?: string | null;
          };
          try {
            providerResult = await provider.createCheckout({
              plan: parsed.plan,
              email: parsed.email,
              name: parsed.name,
              cpfCnpj: parsed.cpf,
              phone: parsed.phone,
              successUrl: `${appUrl}/checkout/sucesso?plan=${parsed.plan}&i=${encodeURIComponent(signedToken)}`,
              cancelUrl: `${appUrl}/#planos`,
              interval: plan.interval,
              priceCents: plan.price_cents,
              currency: plan.currency,
              providerRef,
              planName: plan.name,
              upsell: upsellPayload,
              idempotencyKey,
            });
          } catch (provErr) {
            const msg = provErr instanceof Error ? provErr.message : "Erro desconhecido";
            // Registra a falha no intent para auditoria/admin.
            await sb.from("checkout_intents").upsert(
              {
                plan_slug: parsed.plan,
                email: parsed.email.toLowerCase(),
                with_upsell: parsed.withUpsell,
                provider: provider.name,
                plan_amount_cents: plan.price_cents,
                upsell_amount_cents: upsellPayload?.priceCents ?? null,
                currency: plan.currency,
                ip,
                user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
                idempotency_key: idempotencyKey,
                status: "failed",
                last_error: msg.slice(0, 1000),
              },
              { onConflict: "idempotency_key" },
            );
            console.error("[checkout] provedor recusou checkout:", msg);
            return err(
              422,
              "provider_error",
              "O provedor de pagamento recusou os dados do checkout. Confira nome, CPF e telefone e tente novamente.",
            );
          }

          // 7) Persiste intenção (status='redirected') com providerIds para
          //    o webhook conseguir correlacionar de volta.
          try {
            await sb.from("checkout_intents").upsert(
              {
                plan_slug: parsed.plan,
                email: parsed.email.toLowerCase(),
                with_upsell: parsed.withUpsell,
                provider: provider.name,
                plan_amount_cents: plan.price_cents,
                upsell_amount_cents: upsellPayload?.priceCents ?? null,
                currency: plan.currency,
                ip,
                user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
                idempotency_key: idempotencyKey,
                status: "redirected",
                checkout_url: providerResult.url,
                provider_session_id: providerResult.providerSessionId ?? null,
                provider_customer_id: providerResult.providerCustomerId ?? null,
                last_error: null,
              },
              { onConflict: "idempotency_key" },
            );
          } catch (logErr) {
            console.error("[checkout] log de intenção falhou (ignorado):", logErr);
          }

          return Response.json({ url: providerResult.url, provider: provider.name });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro desconhecido";
          console.error("[checkout] falhou:", msg);
          return err(500, "provider_error", msg);
        }
      },
    },
  },
});
