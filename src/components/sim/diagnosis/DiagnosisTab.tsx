import { useMemo } from "react";
import { sum } from "@/engines/finance/format";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { AppState } from "@/engines/finance/types";
import { buildPrescriptiveCards, PrescriptiveCard } from "@/engines/finance/prescriptive";
import { diagnose } from "@/engines/finance";
import { buildBriefing } from "@/engines/finance/briefing";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { StrategicSummary } from "@/components/sim/strategic/StrategicSummary";
import { SectionTitle } from "@/components/sim/shared/primitives";
import { HealthScoreCard, SensitivityCard } from "@/components/sim/analysis/AnalysisTab";

import { NCGExplanationCard } from "@/components/sim/capital/NCGExplanationCard";
import { DiagnosticoExecutivoCard } from "@/components/sim/strategic/DiagnosticoExecutivoCard";

export function DiagnosisTab() {
  const state = useFinanceState();
  // Modelo central: 1 buildDRE + 1 calcIndicators + 1 buildCashFlow para a aba inteira,
  // reusados pelos filhos (HealthScoreCard). Antes: 3–4× recálculos por render.
  const model = useFinanceModel(state);
  // Passa o modelo precomputado para evitar 3 passagens redundantes pela engine.
  const cards = useMemo(
    () =>
      buildPrescriptiveCards(state, {
        dre: model.dre,
        tax: model.model.tax,
        ind: model.ind,
        cf: model.cf,
      }),
    [state, model.dre, model.ind, model.cf, model.model.tax],
  );
  const diagnostics = useMemo(
    () => diagnose(state, model.dre, model.ind),
    [state, model.dre, model.ind],
  );
  // Briefing estruturado — input determinístico para o card de IA.
  const briefing = useMemo(
    () => buildBriefing(state, model.dre, model.ind),
    [state, model.dre, model.ind],
  );

  const diagIcon = (l: string) =>
    l === "ok" ? (
      <CheckCircle2 className="h-4 w-4 text-pos" />
    ) : l === "warn" ? (
      <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-neg" />
    );

  return (
    <div className="space-y-6">
      {/* Diagnóstico Executivo gerado pela IA — só renderiza se IA configurada */}
      <DiagnosticoExecutivoCard briefing={briefing} />

      {/* Capital de Giro — explica NCG e ciclo financeiro */}
      <NCGExplanationCard
        ncg={model.ind.ncg}
        pmr={state.revenue.pmr}
        pmp={state.revenue.pmp}
        receitaDia={sum(model.dre.receitaBruta) / 360}
        cpvDia={sum(model.dre.cpv) / 360}
      />

      {/* Análises avançadas (reusa o model central) */}
      <HealthScoreCard
        state={state}
        precomputed={{ dre: model.dre, ind: model.ind, cf: model.cf }}
      />
      <SensitivityCard state={state} />

      {/* Diagnóstico financeiro */}
      <section className="space-y-3">
        <SectionTitle>Diagnóstico financeiro</SectionTitle>

        {/* Diagnóstico CFO */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-5">
          <SectionTitle hint="Diagnóstico automático baseado nos indicadores do plano atual.">
            Diagnóstico CFO
          </SectionTitle>
          <div className="mt-4 flex flex-col gap-3 md:grid md:grid-cols-2">
            {diagnostics.map((d, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-md border p-3 text-xs leading-relaxed ${
                  d.level === "ok"
                    ? "border-[var(--success)]/40 bg-[var(--success)]/5"
                    : d.level === "warn"
                      ? "border-[var(--warning)]/40 bg-[var(--warning)]/5"
                      : "border-[var(--destructive)]/40 bg-[var(--destructive)]/5"
                }`}
              >
                <div className="mt-0.5">{diagIcon(d.level)}</div>
                <div>
                  <div className="font-semibold text-foreground">{d.title}</div>
                  <div className="text-muted-foreground">{d.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
          {cards.map((c) => (
            <CardView key={c.id} card={c} />
          ))}
          {cards.length === 0 && (
            <div className="rounded-lg border border-pos/40 bg-pos/5 p-4 text-sm text-foreground">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-5 w-5 text-pos" /> Nenhum problema crítico detectado
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Indicadores financeiros dentro de faixas saudáveis para o setor.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Síntese estratégica */}
      <section className="space-y-3">
        <SectionTitle>Síntese estratégica</SectionTitle>
        <StrategicSummary state={state} />
      </section>
    </div>
  );
}

function severityStyle(s: PrescriptiveCard["severity"]) {
  switch (s) {
    case "danger":
      return {
        ring: "border-[var(--destructive)]/60",
        chip: "bg-[var(--destructive)]/15 text-neg",
        icon: <AlertTriangle className="h-4 w-4 text-neg" />,
        label: "Crítico",
      };
    case "warn":
      return {
        ring: "border-[var(--warning)]/60",
        chip: "bg-[var(--warning)]/15 text-[var(--warning)]",
        icon: <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />,
        label: "Atenção",
      };
    case "info":
      return {
        ring: "border-primary/40",
        chip: "bg-primary/15 text-primary",
        icon: <Info className="h-4 w-4 text-primary" />,
        label: "Oportunidade",
      };
    default:
      return {
        ring: "border-[var(--success)]/40",
        chip: "bg-[var(--success)]/15 text-pos",
        icon: <CheckCircle2 className="h-4 w-4 text-pos" />,
        label: "OK",
      };
  }
}

function CardView({ card }: { card: PrescriptiveCard }) {
  const st = severityStyle(card.severity);
  return (
    <div className={`rounded-lg border ${st.ring} bg-card/40`}>
      <div className="flex items-start justify-between border-b border-border/40 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{st.icon}</div>
          <div>
            <div
              className={`mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${st.chip}`}
            >
              {st.label}
            </div>
            <h4 className="text-sm font-semibold leading-tight">{card.problem}</h4>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <span className="text-foreground">{card.metricLabel}:</span>{" "}
              <span className="mono font-semibold">{card.metricValue}</span>
              {card.benchmark && (
                <span className="ml-2 text-muted-foreground">· {card.benchmark}</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-md border border-border/40 bg-background/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-foreground">
            Causa provável:
          </span>
          <p className="mt-1">{card.cause}</p>
        </div>
        {card.actions.length > 0 && (
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ações sugeridas
            </div>
            <ul className="space-y-1.5">
              {card.actions.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-2 rounded-md border border-border/40 bg-background/40 p-2.5 text-xs"
                >
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{a.title}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{a.detail}</div>
                    {a.asSimulatorParams && (
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("gz-apply-simulator-params", {
                              detail: a.asSimulatorParams,
                            }),
                          )
                        }
                        className="mt-2 inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary transition hover:bg-primary/20"
                      >
                        <SlidersHorizontal className="h-3 w-3" />
                        Abrir no Simulador
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] italic text-muted-foreground">
              Ações com botão <strong>Abrir no Simulador</strong> abrem a aba com os sliders já
              pré-configurados — você pode então combinar com outras alavancas antes de aplicar ao
              plano-base.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
