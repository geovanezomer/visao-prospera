// ============================================================================
// PlansSection — seção "Planos" da landing, extraída de LandingPage.tsx.
//
// Aceita `initialPlans` (SSR loader) + `initialSource` ("db" | "fallback").
// Se o cliente precisar refetch (SPA nav / hidratação sem SSR) e o DB
// falhar, cai para PLANS_FALLBACK — mesmo comportamento do loader, para
// nunca renderizar a seção sem preços.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Lock, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PLANS_FALLBACK } from "@/components/landing/plansFallback";

export type RawPlan = {
  slug: string;
  name: string;
  description: string | null;
  price_cents?: number;
  priceCents?: number;
  interval: string;
  features?: string[];
  upsell_enabled?: boolean;
  upsellEnabled?: boolean;
  upsell_name?: string | null;
  upsellName?: string | null;
  upsell_description?: string | null;
  upsellDescription?: string | null;
  upsell_price_cents?: number;
  upsellPriceCents?: number;
};

function mapPlan(p: RawPlan) {
  const priceCents = p.price_cents ?? p.priceCents ?? 0;
  const upsellEnabled = p.upsell_enabled ?? p.upsellEnabled ?? false;
  const upsellPriceCents = p.upsell_price_cents ?? p.upsellPriceCents ?? 0;
  return {
    nome: p.name,
    descricao: p.description ?? "",
    preco: (priceCents / 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }),
    periodo:
      p.interval === "year"
        ? "/ano"
        : p.interval === "one_time" || p.interval === "lifetime"
          ? ""
          : "/mês",
    badge: p.slug === "pro" ? { texto: "Mais Popular", icone: Zap } : null,
    destaque: p.slug === "pro",
    recursos: Array.isArray(p.features) ? (p.features as string[]) : [],
    cta: `Assinar ${p.name}`,
    planId: p.slug as string,
    upsell:
      upsellEnabled && upsellPriceCents > 0
        ? {
            name: p.upsell_name ?? p.upsellName ?? "Adicional",
            description: p.upsell_description ?? p.upsellDescription ?? "",
            priceCents: upsellPriceCents,
          }
        : null,
  };
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
      {children}
    </span>
  );
}

// Converte PlanRow (camelCase) → RawPlan (snake_case) que mapPlan consome.
function planRowToRaw(p: {
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  interval: string;
  features: string[];
  upsellEnabled: boolean;
  upsellName: string | null;
  upsellDescription: string | null;
  upsellPriceCents: number;
}): RawPlan {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    price_cents: p.priceCents,
    interval: p.interval,
    features: p.features,
    upsell_enabled: p.upsellEnabled,
    upsell_name: p.upsellName,
    upsell_description: p.upsellDescription,
    upsell_price_cents: p.upsellPriceCents,
  };
}

export function PlansSection({
  initialPlans,
  initialSource,
}: {
  initialPlans: RawPlan[] | null;
  initialSource?: "db" | "fallback";
}) {
  type Plano = ReturnType<typeof mapPlan>;
  const initialMapped: Plano[] | null = initialPlans ? initialPlans.map((p) => mapPlan(p)) : null;
  const [planos, setPlanos] = useState<Plano[] | null>(initialMapped);
  const [upsellSel, setUpsellSel] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (initialMapped) {
      // Se o SSR já entregou fallback, deixa o log no cliente também para o
      // suporte identificar via console remoto/Sentry.
      if (initialSource === "fallback") {
        console.error("[landing] planos servidos do fallback estático");
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { listPlansPublic } = await import("@/lib/admin/plans.functions");
        const { plans } = await listPlansPublic();
        if (cancelled) return;
        if (!plans || plans.length === 0) {
          console.error("[landing] planos servidos do fallback estático (lista vazia no DB)");
          setPlanos(PLANS_FALLBACK.map((p) => mapPlan(planRowToRaw(p))));
          return;
        }
        setPlanos(plans.map((p) => mapPlan(planRowToRaw(p))));
      } catch (e) {
        if (cancelled) return;
        console.error(
          "[landing] planos servidos do fallback estático (erro no DB):",
          e instanceof Error ? e.message : e,
        );
        // notifyAdmin NÃO é chamado no client — só no loader (servidor).
        setPlanos(PLANS_FALLBACK.map((p) => mapPlan(planRowToRaw(p))));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string; field?: string } | null>(
    null,
  );

  const ERROR_LABELS: Record<string, string> = {
    plan_not_found: "Este plano não está mais ativo. Recarregue a página e tente outro.",
    upsell_disabled: "O adicional foi desativado para este plano.",
    upsell_invalid_price:
      "O preço do adicional está mal configurado. Tente novamente sem o adicional.",
    upsell_currency_mismatch: "A moeda do adicional não confere com a do plano.",
    upsell_below_min: "O adicional está abaixo do valor mínimo permitido (R$ 0,50).",
    upsell_above_max: "O adicional está com valor desproporcional ao plano.",
    rate_limited: "Muitas tentativas seguidas. Aguarde 1 minuto e tente novamente.",
    invalid_payload: "Verifique os dados informados e tente de novo.",
    config_missing: "Pagamentos indisponíveis no momento. Tente novamente em instantes.",
    provider_error: "O provedor de pagamento recusou a operação. Tente novamente.",
  };

  const planoConfirm = useMemo(
    () => planos?.find((p) => p.planId === confirmFor) ?? null,
    [confirmFor, planos],
  );
  const upsellLigado = !!(planoConfirm && upsellSel[planoConfirm.planId] && planoConfirm.upsell);
  const totalReais = useMemo(() => {
    if (!planoConfirm) return 0;
    const base = Number(planoConfirm.preco.replace(/\./g, "").replace(",", ".")) || 0;
    const add = upsellLigado ? planoConfirm.upsell!.priceCents / 100 : 0;
    return base + add;
  }, [planoConfirm, upsellLigado]);

  function openConfirm(planId: string) {
    setError(null);
    setEmail("");
    setFullName("");
    setConfirmFor(planId);
  }

  async function handleSubscribe() {
    if (!planoConfirm) return;
    if (fullName.trim().length < 3) {
      setError({ message: "Informe seu nome completo.", field: "name" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError({ message: "E-mail inválido.", field: "email" });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planoConfirm.planId,
          email,
          name: fullName.trim(),
          withUpsell: !!upsellSel[planoConfirm.planId],
        }),
      });
      const json = (await res.json()) as {
        url?: string;
        error?: string;
        code?: string;
        field?: string;
      };
      if (!res.ok || !json.url) {
        const code = json.code;
        const friendly =
          (code && ERROR_LABELS[code]) || json.error || "Falha ao iniciar o checkout.";
        setError({ message: friendly, code, field: json.field });
        if (code?.startsWith("upsell_")) {
          setUpsellSel((s) => ({ ...s, [planoConfirm.planId]: false }));
        }
        setSubmitting(false);
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Erro ao iniciar checkout" });
      setSubmitting(false);
    }
  }

  return (
    <section id="planos" className="scroll-mt-20 border-b border-border/50 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <SectionEyebrow>Planos</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Dois caminhos.
            <span className="text-primary"> O mesmo destino.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            <strong className="text-foreground">Controle absoluto</strong> sobre os resultados.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {planos === null
            ? Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={`sk-${i}`}
                  className="relative flex min-h-[640px] flex-col rounded-2xl border border-border bg-card/60 p-7"
                  aria-hidden="true"
                >
                  <div className="h-5 w-24 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-4 w-56 animate-pulse rounded bg-muted" />
                  <div className="mt-6 h-10 w-40 animate-pulse rounded bg-muted" />
                  <div className="mt-6 space-y-3">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="h-4 w-full animate-pulse rounded bg-muted" />
                    ))}
                  </div>
                  <div className="mt-8 h-11 w-full animate-pulse rounded bg-muted" />
                </div>
              ))
            : planos.map((plano) => (
                <div
                  key={plano.nome}
                  className={`relative flex flex-col rounded-2xl border p-7 transition ${
                    plano.destaque
                      ? "border-primary/40 bg-card shadow-2xl shadow-primary/10"
                      : "border-border bg-card/60"
                  }`}
                >
                  {plano.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          plano.destaque
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-background text-foreground"
                        }`}
                      >
                        <plano.badge.icone className="h-3.5 w-3.5" />
                        {plano.badge.texto}
                      </span>
                    </div>
                  )}

                  <div className="mt-2">
                    <h3 className="text-lg font-semibold text-foreground">{plano.nome}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{plano.descricao}</p>
                  </div>

                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                      R$ {plano.preco}
                    </span>
                    <span className="text-sm text-muted-foreground">{plano.periodo}</span>
                  </div>

                  <ul className="mt-6 flex-1 space-y-3">
                    {plano.recursos.map((r) => (
                      <li key={r} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>

                  {plano.upsell && (
                    <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-background/40 p-3 text-sm transition hover:border-primary/40">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        checked={!!upsellSel[plano.planId]}
                        onChange={(e) =>
                          setUpsellSel((s) => ({ ...s, [plano.planId]: e.target.checked }))
                        }
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            + {plano.upsell.name}
                          </span>
                          <span className="text-sm font-semibold text-primary">
                            + R${" "}
                            {(plano.upsell.priceCents / 100).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        {plano.upsell.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {plano.upsell.description}
                          </p>
                        )}
                      </div>
                    </label>
                  )}

                  <div className="mt-8">
                    <button
                      type="button"
                      onClick={() => openConfirm(plano.planId)}
                      className={`group flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition ${
                        plano.destaque
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40"
                          : "border border-border bg-background/60 text-foreground hover:bg-card"
                      }`}
                    >
                      {plano.cta}
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </div>
              ))}
        </div>

        <div className="mt-10 text-center text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Pagamento 100% seguro | 7 dias de garantia incondicional
          </span>
        </div>
      </div>

      <Dialog
        open={!!confirmFor}
        onOpenChange={(o) => {
          if (!o && !submitting) setConfirmFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar assinatura</DialogTitle>
            <DialogDescription>
              Revise os itens abaixo antes de seguir para o pagamento.
            </DialogDescription>
          </DialogHeader>

          {planoConfirm && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card/60 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">Plano {planoConfirm.nome}</div>
                    <div className="text-xs text-muted-foreground">
                      Cobrança {planoConfirm.periodo || "única"}
                    </div>
                  </div>
                  <div className="text-right font-semibold text-foreground">
                    R$ {planoConfirm.preco}
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {planoConfirm.periodo}
                    </div>
                  </div>
                </div>

                {upsellLigado && planoConfirm.upsell && (
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                    <div>
                      <div className="text-foreground">+ {planoConfirm.upsell.name}</div>
                      <div className="text-xs text-muted-foreground">Adicional único</div>
                    </div>
                    <div className="text-right font-semibold text-primary">
                      + R${" "}
                      {(planoConfirm.upsell.priceCents / 100).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="text-sm font-semibold text-foreground">Total hoje</span>
                  <span className="text-base font-bold text-foreground">
                    R${" "}
                    {totalReais.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="checkout-name" className="text-xs font-medium text-foreground">
                    Nome completo
                  </label>
                  <input
                    id="checkout-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Maria da Silva"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="checkout-email" className="text-xs font-medium text-foreground">
                    E-mail para receber o acesso
                  </label>
                  <input
                    id="checkout-email"
                    type="email"
                    autoComplete="email"
                    placeholder="voce@empresa.com.br"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-primary/40 focus:ring-2"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Demais dados serão solicitados na próxima etapa, diretamente no checkout seguro do
                provedor de pagamento.
              </p>

              {error && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <div className="flex items-start gap-2">
                    {error.field && (
                      <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                        {(
                          {
                            upsell: "Adicional",
                            email: "E-mail",
                            name: "Nome",
                            cpf: "CPF",
                            phone: "Telefone",
                          } as Record<string, string>
                        )[error.field] ?? error.field}
                      </span>
                    )}
                    <span className="flex-1">{error.message}</span>
                  </div>
                  {error.code && <div className="text-[10px] opacity-70">cód.: {error.code}</div>}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setConfirmFor(null)}
              disabled={submitting}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-card disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:shadow-primary/40 disabled:opacity-60"
            >
              {submitting ? "Redirecionando…" : "Ir para o pagamento"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
