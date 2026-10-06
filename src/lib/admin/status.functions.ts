// ============================================================================
// Admin · Status Page interno — pinga serviços externos críticos.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { requireAuth } from "@/lib/requireAuth";

export type ServiceStatus = {
  name: string;
  status: "operational" | "degraded" | "down" | "unknown";
  latencyMs: number | null;
  message: string;
};

async function check(
  name: string,
  fn: () => Promise<{ status: ServiceStatus["status"]; message: string }>,
): Promise<ServiceStatus> {
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
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);

    const checks = await Promise.all([
      check("PostgreSQL", async () => {
        const { queryRows } = await import("@/db/client.server");
        const { sql } = await import("drizzle-orm");
        await queryRows(sql`select 1`);
        return { status: "operational", message: "DB OK" };
      }),
      check("Stripe", async () => {
        const r = await fetch("https://status.stripe.com/api/v2/status.json");
        if (!r.ok) return { status: "degraded", message: `HTTP ${r.status}` };
        const j = (await r.json()) as { status?: { indicator?: string; description?: string } };
        const ind = j?.status?.indicator;
        const desc = j?.status?.description;
        if (ind === "none") return { status: "operational", message: desc ?? "All systems normal" };
        if (ind === "minor" || ind === "maintenance")
          return { status: "degraded", message: desc ?? "Minor issues" };
        return { status: "down", message: desc ?? "Outage" };
      }),
      check("E-mail", async () => {
        if (process.env.SMTP_HOST) {
          return { status: "operational", message: `SMTP ${process.env.SMTP_HOST}` };
        }
        const key = process.env.RESEND_API_KEY;
        if (!key) return { status: "unknown", message: "SMTP_HOST / RESEND_API_KEY ausentes" };
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
