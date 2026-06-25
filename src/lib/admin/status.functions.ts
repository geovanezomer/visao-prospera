// ============================================================================
// Admin · Status Page interno — pinga serviços externos críticos.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";

function assertAdmin(claims: any) {
  if (!isAdminEmail((claims?.email as string) ?? "")) throw new Error("Acesso negado.");
}

export type ServiceStatus = {
  name: string;
  status: "operational" | "degraded" | "down" | "unknown";
  latencyMs: number | null;
  message: string;
};

async function check(name: string, fn: () => Promise<{ status: ServiceStatus["status"]; message: string }>): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 8s")), 8000)),
    ]);
    return { name, status: r.status, message: r.message, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      name,
      status: "down",
      message: e instanceof Error ? e.message : "erro",
      latencyMs: Date.now() - start,
    };
  }
}

export const getSystemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertAdmin(context.claims);

    const checks = await Promise.all([
      check("Supabase", async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);
        const { error } = await sb.from("plans").select("id").limit(1);
        if (error) return { status: "degraded", message: error.message };
        return { status: "operational", message: "DB OK" };
      }),
      check("Stripe", async () => {
        const r = await fetch("https://status.stripe.com/api/v2/status.json");
        if (!r.ok) return { status: "degraded", message: `HTTP ${r.status}` };
        const j = (await r.json()) as any;
        const ind = j?.status?.indicator as string;
        const desc = j?.status?.description as string;
        if (ind === "none") return { status: "operational", message: desc ?? "All systems normal" };
        if (ind === "minor" || ind === "maintenance")
          return { status: "degraded", message: desc ?? "Minor issues" };
        return { status: "down", message: desc ?? "Outage" };
      }),
      check("Resend", async () => {
        const key = process.env.RESEND_API_KEY;
        if (!key) return { status: "unknown", message: "RESEND_API_KEY ausente" };
        const r = await fetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (r.status === 401) return { status: "down", message: "Chave inválida" };
        if (!r.ok) return { status: "degraded", message: `HTTP ${r.status}` };
        return { status: "operational", message: "API respondendo" };
      }),
      check("Asaas", async () => {
        const key = process.env.ASAAS_API_KEY;
        if (!key) return { status: "unknown", message: "ASAAS_API_KEY ausente" };
        const base =
          (process.env.ASAAS_ENV ?? "sandbox") === "production"
            ? "https://api.asaas.com/v3"
            : "https://sandbox.asaas.com/api/v3";
        const r = await fetch(`${base}/myAccount`, { headers: { access_token: key } });
        if (r.status === 401) return { status: "down", message: "Chave inválida" };
        if (!r.ok) return { status: "degraded", message: `HTTP ${r.status}` };
        return { status: "operational", message: "API respondendo" };
      }),
      check("Lovable AI", async () => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return { status: "unknown", message: "LOVABLE_API_KEY ausente" };
        const r = await fetch("https://ai.gateway.lovable.dev/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!r.ok) return { status: "degraded", message: `HTTP ${r.status}` };
        return { status: "operational", message: "Gateway OK" };
      }),
    ]);

    return { checks, checkedAt: new Date().toISOString() };
  });
