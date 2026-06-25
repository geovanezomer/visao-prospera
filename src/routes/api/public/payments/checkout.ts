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
};

async function loadPlanDetails(slug: string, providerName: string): Promise<PlanDetails | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb
      .from("plans")
      .select("name,price_cents,currency,interval,stripe_price_id,asaas_plan_ref,active")
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
          const { url } = await provider.createCheckout({
            plan: parsed.plan,
            email: parsed.email,
            successUrl: `${appUrl}/checkout/sucesso?plan=${parsed.plan}`,
            cancelUrl: `${appUrl}/planos?canceled=1`,
            interval: details?.interval,
            priceCents: details?.priceCents,
            currency: details?.currency,
            providerRef: details?.providerRef,
            planName: details?.planName,
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
