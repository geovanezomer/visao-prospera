// ============================================================================
// BillingButton — abre o Portal do Cliente do provedor ativo em nova aba.
// Aparece apenas quando o usuário tem assinatura ativa.
// ============================================================================

import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/useSubscription";
import { isPaymentsEnabled } from "@/lib/payments/featureFlag";

export function BillingButton() {
  const { isActive } = useSubscription();
  if (!isPaymentsEnabled() || !isActive) return null;

  const handle = async () => {
    try {
      const { createPortalSession } = await import("@/lib/payments/portal.functions");
      const result = await createPortalSession({ data: {} });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível abrir o portal.";
      toast.error(msg);
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 w-8 p-0"
      onClick={handle}
      title="Gerenciar assinatura (cartão, faturas, cancelamento)"
      aria-label="Gerenciar assinatura"
    >
      <CreditCard className="h-3.5 w-3.5" />
    </Button>
  );
}
