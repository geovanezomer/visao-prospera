// ============================================================================
// cancelCore — cancelamento IMEDIATO da assinatura no provedor, agnóstico.
//
// Extraído para ser reusado tanto pelo fluxo self-service (cancel.functions —
// quando existir) quanto pelo refundAndRevoke (estorno + revogar acesso).
//
// - Stripe : DELETE /v1/subscriptions/{id}   → cancela imediatamente
//            (não usar cancel_at_period_end; queremos revogar acesso já)
// - Asaas  : DELETE /v3/subscriptions/{id}   → cancela imediatamente
// ============================================================================
import type { ProviderName } from "./types";

export type CancelCoreInput = {
  provider: ProviderName | string;
  subscriptionId: string;
};

export type CancelCoreResult = {
  ok: true;
  provider: string;
  subscriptionId: string;
  providerStatus: string;
};

export async function cancelSubscriptionNow(input: CancelCoreInput): Promise<CancelCoreResult> {
  const { loadProviderConfig } = await import("./index");
  if (input.provider === "stripe") {
    const cfg = await loadProviderConfig("stripe");
    const apiKey = cfg?.apiKey ?? process.env.STRIPE_SECRET_KEY ?? "";
    if (!apiKey) throw new Error("STRIPE_SECRET_KEY ausente.");
    const r = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const j = (await r.json()) as { status?: string; error?: { message?: string } };
    if (!r.ok) throw new Error(`Stripe cancel: ${j.error?.message ?? r.statusText}`);
    return {
      ok: true,
      provider: "stripe",
      subscriptionId: input.subscriptionId,
      providerStatus: String(j.status ?? "canceled"),
    };
  }
  if (input.provider === "asaas") {
    const cfg = await loadProviderConfig("asaas");
    const apiKey = cfg?.apiKey ?? process.env.ASAAS_API_KEY ?? "";
    const mode = cfg?.mode ?? (process.env.ASAAS_ENV === "sandbox" ? "sandbox" : "live");
    if (!apiKey) throw new Error("ASAAS_API_KEY ausente.");
    const base =
      mode === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://api.asaas.com/v3";
    const r = await fetch(`${base}/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
      method: "DELETE",
      headers: { access_token: apiKey },
    });
    const j = (await r.json().catch(() => ({}))) as { deleted?: boolean; errors?: unknown };
    if (!r.ok) throw new Error(`Asaas cancel: ${JSON.stringify(j)}`);
    return {
      ok: true,
      provider: "asaas",
      subscriptionId: input.subscriptionId,
      providerStatus: j.deleted ? "canceled" : "canceled",
    };
  }
  throw new Error(`Provedor não suportado para cancelamento: ${input.provider}`);
}
