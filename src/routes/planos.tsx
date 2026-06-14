// ============================================================================
// Página de seleção de plano (pós-cadastro ou pré-cadastro).
// Inicia o checkout Stripe via server function `createCheckoutSession`.
// ============================================================================

import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ArrowRight, Check, Crown, Loader2, LogOut, Zap } from "lucide-react";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLANS_CATALOG, type PlanId } from "@/lib/plans";
import { createCheckoutSession } from "@/lib/checkout.functions";

const searchSchema = z.object({
  plan: z.enum(["mensal", "anual", "vitalicio"]).optional(),
  canceled: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/planos")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Escolha seu plano — FinnancePRO" },
      { name: "description", content: "Mensal, Anual ou Vitalício. Escolha o plano FinnancePRO ideal para você." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlansPage,
});

type PlanDisplay = {
  id: PlanId;
  tagline: string;
  highlight: boolean;
  badge?: string;
  perks: string[];
};

const PLAN_DISPLAY: Record<PlanId, PlanDisplay> = {
  mensal: {
    id: "mensal",
    tagline: "Para testar o poder da plataforma",
    highlight: false,
    perks: [
      "Acesso completo a todos os módulos",
      "Diagnóstico, DRE, Fluxo de Caixa e Valuation",
      "Reforma Tributária CBS/IBS",
      "Cancelamento a qualquer momento",
    ],
  },
  anual: {
    id: "anual",
    tagline: "O escolhido por 8 em cada 10 consultores",
    highlight: true,
    badge: "Mais Popular · 37% OFF",
    perks: [
      "Tudo do plano Mensal",
      "Economia equivalente a 4 meses grátis",
      "Consultor IA com contexto da empresa",
      "Cenários ilimitados e Monte Carlo",
      "Suporte prioritário em 24h",
    ],
  },
  vitalicio: {
    id: "vitalicio",
    tagline: "Pague uma vez. Use para sempre.",
    highlight: false,
    badge: "Edição Fundadores",
    perks: [
      "Acesso vitalício a todas as atualizações",
      "Sem mensalidades. Sem renovação.",
      "Selo de Membro Fundador",
      "Acesso antecipado a novos módulos",
      "Suporte VIP com Geovane Zomer",
    ],
  },
};

type PaymentsEnvironment = "sandbox" | "live";

function getPaymentsEnvironment(): PaymentsEnvironment {
  const token = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
  if (token?.startsWith("pk_test_")) return "sandbox";
  if (token?.startsWith("pk_live_")) return "live";
  throw new Error("Pagamentos não configurados para este ambiente. Finalize o Go Live antes de abrir o checkout em produção.");
}

function PlansPage() {
  const { user, hydrated, logout } = useAuth();
  const navigate = useNavigate();
  const { canceled } = useSearch({ from: "/planos" });
  const checkoutFn = useServerFn(createCheckoutSession);

  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Redireciona usuário não autenticado para o cadastro
  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/signup" });
  }, [hydrated, user, navigate]);

  const handleSelectPlan = async (planId: PlanId) => {
    setError(null);
    setLoadingPlan(planId);
    try {
      const plan = PLANS_CATALOG[planId];
      const result = await checkoutFn({
        data: { priceId: plan.priceId, origin: window.location.origin, environment: getPaymentsEnvironment() },
      });
      if ("error" in result) throw new Error(result.error);
      // Redireciona para checkout hospedado pelo Stripe
      window.location.href = result.url;
    } catch (e) {
      console.error("Erro ao iniciar checkout:", e);
      setError(e instanceof Error ? e.message : "Não foi possível abrir o checkout. Tente novamente em alguns segundos.");
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/40">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logoAsset.url} alt="FinnancePRO" className="h-8 w-8 rounded-md object-contain" />
            <span className="text-sm font-semibold tracking-tight">
              Finnance<span className="text-primary">PRO</span>
            </span>
          </Link>
          {user && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="hidden sm:inline">{user.email}</span>
              <Button size="sm" variant="ghost" onClick={() => void logout()}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Sair
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Escolha seu plano</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Você está a um passo do acesso completo.
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Sua conta foi criada com sucesso. Escolha o plano para liberar a plataforma.
          </p>
        </div>

        {canceled && (
          <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-700 dark:text-amber-300">
            Pagamento cancelado. Você pode tentar de novo quando quiser.
          </div>
        )}

        {error && (
          <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {(Object.keys(PLAN_DISPLAY) as PlanId[]).map((id) => {
            const plan = PLANS_CATALOG[id];
            const display = PLAN_DISPLAY[id];
            const isLoading = loadingPlan === id;
            return (
              <div
                key={id}
                className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
                  display.highlight
                    ? "border-primary bg-gradient-to-b from-primary/10 to-card shadow-xl shadow-primary/10 lg:scale-105"
                    : "border-border/60 bg-card hover:border-primary/40"
                }`}
              >
                {display.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className={display.highlight ? "bg-primary text-primary-foreground" : "bg-foreground text-background"}>
                      {id === "vitalicio" && <Crown className="mr-1 h-3 w-3" />}
                      {id === "anual" && <Zap className="mr-1 h-3 w-3" />}
                      {display.badge}
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{display.tagline}</p>
                </div>

                <div className="mb-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>

                <ul className="mb-8 flex-1 space-y-3">
                  {display.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-3 text-sm">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${display.highlight ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-foreground/90">{perk}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="lg"
                  variant={display.highlight ? "default" : "outline"}
                  className="h-11 w-full"
                  onClick={() => void handleSelectPlan(id)}
                  disabled={loadingPlan !== null}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Abrindo checkout...
                    </>
                  ) : (
                    <>
                      Assinar {plan.name}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          🔒 Pagamento seguro processado pelo Stripe · 7 dias de garantia · Nota fiscal automática
        </p>
      </main>
    </div>
  );
}
