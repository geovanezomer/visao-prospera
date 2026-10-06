// ============================================================================
// PaywallScreen — tela de bloqueio dentro do /app.
//
// Não redireciona para /landing para preservar o contexto de login. Os dados
// locais (IndexedDB / .finnance) permanecem intactos — o botão "Exportar"
// permite que o usuário leve seus dados mesmo sem assinar.
// ============================================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Clock, CreditCard, Download, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { AccessStatus } from "@/hooks/useAccessStatus";

type Plan = {
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  features: string[];
};

export interface PaywallScreenProps {
  status: Extract<AccessStatus, { kind: "trial_expired" | "past_due" | "canceled" | "none" }>;
  /** Callback opcional para exportar o .finnance atual (chamado pelo botão discreto). */
  onExportFinnance?: () => void | Promise<void>;
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(cents / 100);
}

export function PaywallScreen({ status, onExportFinnance }: PaywallScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { listPlansPublic } = await import("@/lib/admin/plans.functions");
        const { plans } = await listPlansPublic();
        setPlans(plans);
      } catch (e) {
        console.warn("[PaywallScreen] falha ao carregar planos", e);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, []);

  const startCheckout = async (planSlug: string) => {
    if (checkoutBusy) return;
    setCheckoutBusy(planSlug);
    try {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const name = (meta.display_name as string) || email.split("@")[0] || "Usuário";
      const res = await fetch("/api/public/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planSlug, email, name, withUpsell: false }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        toast.error(json.error || "Não foi possível iniciar o checkout.");
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar checkout.");
    } finally {
      setCheckoutBusy(null);
    }
  };

  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    try {
      const { createPortalSession } = await import("@/lib/payments/portal.functions");
      const result = await createPortalSession({ data: {} });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o portal.");
    } finally {
      setPortalBusy(false);
    }
  };

  const doExport = async () => {
    if (!onExportFinnance) return;
    try {
      await onExportFinnance();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.");
    }
  };

  const isPastDue = status.kind === "past_due";
  const isTrialExpired = status.kind === "trial_expired";

  return (
    <div className="flex min-h-screen w-full items-start justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {isPastDue ? (
              <AlertTriangle className="h-6 w-6" />
            ) : isTrialExpired ? (
              <Clock className="h-6 w-6" />
            ) : (
              <Lock className="h-6 w-6" />
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isPastDue && "Pagamento pendente"}
            {isTrialExpired && "Seu período de teste terminou"}
            {status.kind === "canceled" && "Assinatura cancelada"}
            {status.kind === "none" && "Escolha um plano para continuar"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPastDue
              ? "Atualize a forma de pagamento para manter o acesso ao FinnancePRO."
              : "Seus dados estão salvos no seu dispositivo e voltam a aparecer assim que a assinatura for reativada."}
          </p>
        </div>

        {isPastDue && (
          <Card className="mb-6 border-amber-500/40 bg-amber-500/5 p-5">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 text-amber-500" />
              <div className="flex-1">
                <p className="text-sm font-medium">Última cobrança recusada</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Você tem alguns dias de tolerância antes do bloqueio total. Atualize seu cartão ou
                  pague a fatura em aberto.
                </p>
                <Button size="sm" className="mt-3" onClick={openPortal} disabled={portalBusy}>
                  {portalBusy ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="mr-2 h-3.5 w-3.5" />
                  )}
                  Atualizar forma de pagamento
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {loadingPlans && (
            <div className="col-span-full flex items-center justify-center py-10 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando planos…
            </div>
          )}
          {!loadingPlans &&
            plans.map((p) => (
              <Card key={p.slug} className="flex flex-col p-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">{p.name}</h3>
                </div>
                {p.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                )}
                <p className="mt-3 text-2xl font-bold tabular-nums">
                  {formatPrice(p.priceCents, p.currency)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">/mês</span>
                </p>
                {p.features.length > 0 && (
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
                    {p.features.slice(0, 6).map((f, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-primary">•</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  className="mt-4"
                  onClick={() => startCheckout(p.slug)}
                  disabled={checkoutBusy === p.slug}
                >
                  {checkoutBusy === p.slug ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Assinar {p.name}
                </Button>
              </Card>
            ))}
        </div>

        <div className="mt-8 flex flex-col items-center gap-2 border-t border-border/40 pt-6 text-center text-xs text-muted-foreground">
          <p>Seus dados permanecem salvos localmente e serão restaurados ao reativar.</p>
          {onExportFinnance && (
            <Button variant="ghost" size="sm" onClick={doExport} className="text-xs">
              <Download className="mr-2 h-3.5 w-3.5" />
              Exportar meus dados (.finnance)
            </Button>
          )}
          <button
            className="mt-2 text-[11px] underline-offset-2 hover:underline"
            onClick={() => supabase.auth.signOut()}
          >
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}
