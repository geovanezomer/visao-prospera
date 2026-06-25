// Flag de pagamentos no front-end (controla exibição de botões de assinatura).
// Server-side, getProvider() decide pelo PAYMENT_PROVIDER.
export function isPaymentsEnabled(): boolean {
  const v = import.meta.env.VITE_PAYMENTS_ENABLED;
  if (typeof v !== "string") return false;
  return v.trim().toUpperCase() === "ON";
}
