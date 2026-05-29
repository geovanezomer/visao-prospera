import { useMemo } from "react";
import { AppState, Scenario } from "@/lib/finance/types";
import { buildPrescriptiveCards, PrescriptiveCard } from "@/lib/finance/prescriptive";
import { AlertTriangle, CheckCircle2, ChevronRight, Info, TriangleAlert } from "lucide-react";
import { StrategicSummary } from "./StrategicSummary";
import { SectionTitle } from "./primitives";
import { HealthScoreCard, SensitivityCard, ScenarioCompareCard } from "./AnalysisTab";


export function DiagnosisTab({
  state,
  scenarios,
  loadScenario,
  removeScenario,
}: {
  state: AppState;
  scenarios: Scenario[];
  loadScenario: (s: AppState) => void;
  removeScenario: (id: string) => void;
}) {
  const cards = useMemo(() => buildPrescriptiveCards(state), [state]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold text-foreground">Resultados — diagnóstico consolidado</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Indicadores financeiros, análises avançadas (sensibilidade, projeção 36 meses, Monte Carlo) e, ao final,
              o diagnóstico financeiro com causas/ações e a síntese estratégica. Para testar combinações de ajustes,
              vá para a aba <strong>Simulador</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Análises avançadas */}
      <HealthScoreCard state={state} />
      <SensitivityCard state={state} />

      {/* Diagnóstico financeiro (após a projeção) */}
      <section className="space-y-3">
        <SectionTitle>Diagnóstico financeiro</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map((c) => <CardView key={c.id} card={c} />)}
          {cards.length === 0 && (
            <div className="rounded-lg border border-pos/40 bg-pos/5 p-4 text-sm text-foreground">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-pos" /> Nenhum problema crítico detectado</div>
              <p className="mt-1 text-xs text-muted-foreground">Indicadores financeiros dentro de faixas saudáveis para o setor.</p>
            </div>
          )}
        </div>
      </section>

      {/* Síntese estratégica */}
      <section className="space-y-3">
        <SectionTitle>Síntese estratégica</SectionTitle>
        <StrategicSummary state={state} />
      </section>

      {/* Comparação de cenários salvos */}
      <ScenarioCompareCard state={state} scenarios={scenarios} loadScenario={loadScenario} removeScenario={removeScenario} />
    </div>
  );
}

function severityStyle(s: PrescriptiveCard["severity"]) {
  switch (s) {
    case "danger":
      return { ring: "border-[var(--destructive)]/60", chip: "bg-[var(--destructive)]/15 text-neg", icon: <AlertTriangle className="h-4 w-4 text-neg" />, label: "Crítico" };
    case "warn":
      return { ring: "border-[var(--warning)]/60", chip: "bg-[var(--warning)]/15 text-[var(--warning)]", icon: <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />, label: "Atenção" };
    case "info":
      return { ring: "border-primary/40", chip: "bg-primary/15 text-primary", icon: <Info className="h-4 w-4 text-primary" />, label: "Oportunidade" };
    default:
      return { ring: "border-[var(--success)]/40", chip: "bg-[var(--success)]/15 text-pos", icon: <CheckCircle2 className="h-4 w-4 text-pos" />, label: "OK" };
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
            <div className={`mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${st.chip}`}>{st.label}</div>
            <h4 className="text-sm font-semibold leading-tight">{card.problem}</h4>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <span className="text-foreground">{card.metricLabel}:</span>{" "}
              <span className="mono font-semibold">{card.metricValue}</span>
              {card.benchmark && <span className="ml-2 text-muted-foreground">· {card.benchmark}</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-md border border-border/40 bg-background/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-foreground">Causa provável:</span>
          <p className="mt-1">{card.cause}</p>
        </div>
        {card.actions.length > 0 && (
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ações sugeridas</div>
            <ul className="space-y-1.5">
              {card.actions.map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-md border border-border/40 bg-background/40 p-2.5 text-xs">
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <div>
                    <div className="font-medium text-foreground">{a.title}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{a.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] italic text-muted-foreground">
              Para testar essas e outras alavancas com sliders e ver o DRE simulado, use a aba <strong>Simulador</strong>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
