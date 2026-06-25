// ============================================================================
// POST /api/public/payments/checkout
//
// Cria sessão de checkout no provedor ativo (Stripe ou Asaas) e devolve a
// URL hospedada para redirect. Rota PÚBLICA — não exige login porque é
// usada na landing/planos. A criação de conta acontece via magic link
// após a confirmação do pagamento (webhook).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveProvider } from "@/lib/payments";

const Body = z.object({
  plan: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
  email: z.string().email().max(200),
  withUpsell: z.boolean().optional().default(false),
});

// Rate limit ad-hoc em memória: 10 req/min por IP+email. O backend não tem
// primitivo de rate limit padrão; isso é o suficiente para barrar spam óbvio
// sem cluster (1 worker por vez). Em escala, mover para Redis/Upstash.
const buckets = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 10;
const WINDOW_MS = 60_000;
function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > LIMIT;
}

type PlanDetails = {
  interval: "month" | "year" | "week" | "day" | "lifetime" | "one_time";
  priceCents?: number;
  currency?: string;
  providerRef?: string | null;
  planName?: string;
  upsell?: {
    enabled: boolean;
    name: string;
    priceCents: number;
    stripePriceId?: string | null;
    asaasRef?: string | null;
  };
};

async function loadPlanDetails(slug: string, providerName: string): Promise<PlanDetails | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb
      .from("plans")
      .select("name,price_cents,currency,interval,stripe_price_id,asaas_plan_ref,active,upsell_enabled,upsell_name,upsell_price_cents,upsell_stripe_price_id,upsell_asaas_ref")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (!data) return null;
    return {
      interval: data.interval as PlanDetails["interval"],
      priceCents: data.price_cents,
      currency: data.currency,
      providerRef: providerName === "stripe" ? data.stripe_price_id : data.asaas_plan_ref,
      planName: data.name,
      upsell: data.upsell_enabled
        ? {
            enabled: true,
            name: data.upsell_name ?? "Adicional",
            priceCents: data.upsell_price_cents ?? 0,
            stripePriceId: data.upsell_stripe_price_id,
            asaasRef: data.upsell_asaas_ref,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/payments/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return Response.json({ error: "Payload inválido" }, { status: 400 });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";
        if (rateLimited(`${ip}:${parsed.email.toLowerCase()}`)) {
          return Response.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
        }

        const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
        if (!appUrl) {
          return Response.json({ error: "APP_URL não configurado" }, { status: 500 });
        }

        try {
          const provider = await resolveProvider();
          const details = await loadPlanDetails(parsed.plan, provider.name);
          if (!details) {
            return Response.json({ error: "Plano não encontrado ou inativo." }, { status: 404 });
          }

          // ─── Validação server-side do upsell ───────────────────────────────
          // Garante coerência com o plano antes de criar cobrança no provedor:
          //  • upsell habilitado no plano
          //  • preço inteiro positivo, em centavos
          //  • teto de sanidade (≤ 5× preço do plano) para evitar
          //    manipulação no front (o front nunca envia o preço,
          //    mas defendemos contra plano mal configurado)
          //  • moeda única: o upsell herda a moeda do plano
          //    (não há campo upsell_currency no schema, logo só validamos
          //     que o plano TEM moeda definida quando há upsell pago)
          let upsellPayload: {
            name: string;
            priceCents: number;
            stripePriceId?: string | null;
            asaasRef?: string | null;
          } | null = null;

          if (parsed.withUpsell) {
            if (!details.upsell?.enabled) {
              return Response.json(
                { error: "Este plano não possui upsell disponível." },
                { status: 400 },
              );
            }
            const cents = details.upsell.priceCents;
            if (!Number.isInteger(cents) || cents <= 0) {
              return Response.json(
                { error: "Configuração de upsell inválida (preço)." },
                { status: 422 },
              );
            }
            if (!details.currency) {
              return Response.json(
                { error: "Moeda do plano não configurada — upsell bloqueado." },
                { status: 422 },
              );
            }
            const planCents = details.priceCents ?? 0;
            if (planCents > 0 && cents > planCents * 5) {
              console.error(
                "[checkout] upsell desproporcional ao plano",
                { plan: parsed.plan, planCents, upsellCents: cents },
              );
              return Response.json(
                { error: "Upsell desproporcional ao valor do plano." },
                { status: 422 },
              );
            }
            upsellPayload = {
              name: details.upsell.name,
              priceCents: cents,
              stripePriceId: details.upsell.stripePriceId,
              asaasRef: details.upsell.asaasRef,
            };
          }

          const { url } = await provider.createCheckout({
            plan: parsed.plan,
            email: parsed.email,
            successUrl: `${appUrl}/checkout/sucesso?plan=${parsed.plan}`,
            cancelUrl: `${appUrl}/planos?canceled=1`,
            interval: details.interval,
            priceCents: details.priceCents,
            currency: details.currency,
            providerRef: details.providerRef,
            planName: details.planName,
            upsell: upsellPayload,
          });
          return Response.json({ url, provider: provider.name });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro desconhecido";
          console.error("[checkout] falhou:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }

      },
    },
  },
});
