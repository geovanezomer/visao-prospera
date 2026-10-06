// ============================================================================
// "O que eu faço agora" — topo do Dashboard. A situação em uma frase (nota de
// saúde) e até três ações prioritárias vindas do diagnóstico prescritivo, cada
// uma com o atalho para testar no Simulador. Pensado para o dono da empresa:
// sem siglas, uma decisão por linha.
// ============================================================================
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, SlidersHorizontal } from "lucide-react";
import type { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { HEALTH_LABEL } from "@/engines/finance/health";
import { acoesPrioritarias, buildPrescriptiveCards } from "@/engines/finance/prescriptive";
import { cn } from "@/lib/utils";

const irPara = (aba: string) =>
  window.dispatchEvent(new CustomEvent("gz-set-tab", { detail: aba }));

export function ProximosPassos({ state }: { state: AppState }) {
  const { dre, ind, cf, model } = useFinanceModel(state);
  const health = model.health;
  const acoes = useMemo(
    () => acoesPrioritarias(buildPrescriptiveCards(state, { dre, tax: model.tax, ind, cf })),
    [state, dre, ind, cf, model.tax],
  );
  const cor =
    health.status === "ok"
      ? "text-pos border-pos/40 bg-pos/10"
      : health.status === "warn"
        ? "text-warning border-warning/40 bg-warning/10"
        : "text-neg border-neg/40 bg-neg/10";

  return (
    <section
      aria-label="O que fazer agora"
      className="rounded-lg border border-primary/30 bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn("rounded-md border px-2.5 py-1 text-sm font-bold", cor)}
          title="Nota de saúde financeira (a mesma do Diagnóstico e do PDF)"
        >
          {Math.round(health.total)} · {HEALTH_LABEL[health.grade]}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{health.headline}</p>
        <button
          type="button"
          onClick={() => irPara("resultados")}
          className="inline-flex w-full items-center gap-1 text-xs font-medium text-primary hover:underline sm:w-auto"
        >
          Diagnóstico completo <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <h2 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        O que fazer agora
      </h2>
      {acoes.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-pos" />
          Nada urgente. Use o Simulador para testar crescimento, preço ou novos custos.
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {acoes.map((c, i) => {
            const acao = c.actions[0];
            return (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3 sm:flex-row sm:items-start"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    c.severity === "danger" ? "bg-neg/15 text-neg" : "bg-warning/15 text-warning",
                  )}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                    {c.severity === "danger" && (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 text-neg" aria-hidden="true" />
                        <span className="sr-only">Urgente:</span>
                      </>
                    )}
                    {c.problem}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({c.metricLabel}: {c.metricValue})
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-foreground/90">
                    <strong>{acao.title}.</strong> {acao.detail}
                  </p>
                </div>
                {acao.asSimulatorParams && (
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("gz-apply-simulator-params", {
                          detail: acao.asSimulatorParams,
                        }),
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                  >
                    <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                    Simular
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
