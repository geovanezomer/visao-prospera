import { useMemo, useState } from "react";
import { AppState, Scenario } from "@/lib/finance/types";
import { computeHealth, HealthDimension } from "@/lib/finance/health";
import { runSensitivity, OUTPUT_OPTIONS, OutputKey } from "@/lib/finance/sensitivity";
import { buildForecast } from "@/lib/finance/forecast";
import { runMonteCarlo, DEFAULT_MC, MCConfig, histogram } from "@/lib/finance/montecarlo";
import { snapshot } from "@/lib/finance/prescriptive";
import { fmtBRL } from "@/lib/finance/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Activity, GitCompare, LineChart as LineIcon, Play, Sliders, TrendingUp, Trash2 } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function AnalysisTab({
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
  return (
    <div className="space-y-6">
      <HealthScoreCard state={state} />
      <SensitivityCard state={state} />
      <ForecastCard state={state} />
      <MonteCarloCard state={state} />
      <ScenarioCompareCard state={state} scenarios={scenarios} loadScenario={loadScenario} removeScenario={removeScenario} />
    </div>
  );
}

// ============== Health Score ==============
function HealthScoreCard({ state }: { state: AppState }) {
  const h = useMemo(() => computeHealth(state), [state]);
  const ringColor = h.status === "ok" ? "var(--success)" : h.status === "warn" ? "var(--warning)" : "var(--destructive)";
  const circ = 2 * Math.PI * 52;
  const offset = circ * (1 - h.total / 100);

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <header className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Score de Saúde Financeira</h3>
      </header>
      <div className="grid gap-6 md:grid-cols-[180px_1fr]">
        <div className="flex flex-col items-center justify-center">
          <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
            <circle cx="70" cy="70" r="52" stroke="hsl(var(--border))" strokeWidth="10" fill="none" opacity="0.4" />
            <circle
              cx="70" cy="70" r="52"
              stroke={ringColor} strokeWidth="10" fill="none"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset .6s ease" }}
            />
          </svg>
          <div className="-mt-[100px] flex flex-col items-center">
            <div className="text-3xl font-bold" style={{ color: ringColor }}>{h.total.toFixed(0)}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">/ 100</div>
          </div>
          <div className="mt-12 text-center">
            <div className="text-2xl font-bold" style={{ color: ringColor }}>Nota {h.grade}</div>
            <div className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">{h.headline}</div>
          </div>
        </div>

        <div className="space-y-2">
          {h.dimensions.map((d) => <DimRow key={d.key} d={d} />)}
        </div>
      </div>
    </section>
  );
}

function DimRow({ d }: { d: HealthDimension }) {
  const color = d.status === "ok" ? "var(--success)" : d.status === "warn" ? "var(--warning)" : "var(--destructive)";
  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{d.label}</span>
          <span className="text-[10px] text-muted-foreground">peso {Math.round(d.weight * 100)}%</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-xs text-muted-foreground">{d.value}</span>
          <span className="mono text-xs font-semibold" style={{ color }}>{d.score.toFixed(0)}</span>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/50">
        <div className="h-full transition-all" style={{ width: `${d.score}%`, background: color }} />
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{d.comment}</p>
    </div>
  );
}

// ============== Sensitivity ==============
function SensitivityCard({ state }: { state: AppState }) {
  const [output, setOutput] = useState<OutputKey>("ebitda");
  const result = useMemo(() => runSensitivity(state, output), [state, output]);
  const fmt = (n: number) => output === "roic" ? `${n.toFixed(1)}%` : fmtBRL(n);

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Análise de Sensibilidade</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Output:</span>
          <Select value={output} onValueChange={(v) => setOutput(v as OutputKey)}>
            <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OUTPUT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Variação simulada de cada driver entre −15% e +15% sobre o output. Drivers ordenados pelo poder de impacto (elasticidade).
        Baseline: <span className="mono font-semibold text-foreground">{fmt(result.baseline)}</span>.
      </p>

      <div className="scrollbar-thin overflow-x-auto rounded-md border border-border/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-card/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Driver</th>
              {result.deltas.map((d) => (
                <th key={d} className="px-2 py-2 text-right">{d > 0 ? `+${d}%` : `${d}%`}</th>
              ))}
              <th className="px-3 py-2 text-right">Elasticidade</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.driver} className="border-t border-border/30">
                <td className="px-3 py-1.5 font-medium">{row.label}</td>
                {row.cells.map((c) => {
                  const pos = c.pctChange > 0;
                  const intensity = Math.min(1, Math.abs(c.pctChange) / 30);
                  const bg = pos
                    ? `color-mix(in oklab, var(--success) ${intensity * 35}%, transparent)`
                    : c.pctChange < 0
                      ? `color-mix(in oklab, var(--destructive) ${intensity * 35}%, transparent)`
                      : "transparent";
                  return (
                    <td key={c.deltaPct} className="num px-2 py-1.5 text-right" style={{ background: bg }}>
                      <div className="text-[11px] font-semibold">{c.pctChange > 0 ? "+" : ""}{c.pctChange.toFixed(1)}%</div>
                      <div className="text-[9.5px] text-muted-foreground">{fmt(c.value)}</div>
                    </td>
                  );
                })}
                <td className="num px-3 py-1.5 text-right font-semibold mono">
                  {row.elasticity > 0 ? "+" : ""}{row.elasticity.toFixed(2)}×
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">
        Elasticidade = % de variação do output por 1% de variação do driver. Quanto maior em módulo, mais sensível seu resultado é àquela alavanca — priorize ações sobre os drivers do topo.
      </p>
    </section>
  );
}

// ============== Scenario Compare ==============
function ScenarioCompareCard({
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
  const base = useMemo(() => snapshot(state), [state]);
  const rows = useMemo(() => scenarios.map((sc) => ({ sc, snap: snapshot(sc.state) })), [scenarios]);

  const metrics: { key: keyof typeof base; label: string; fmt: (n: number) => string; higherBetter: boolean }[] = [
    { key: "receitaBruta", label: "Receita Bruta", fmt: fmtBRL, higherBetter: true },
    { key: "ebitda", label: "EBITDA", fmt: fmtBRL, higherBetter: true },
    { key: "margemEbitda", label: "Margem EBITDA", fmt: (n) => `${n.toFixed(1)}%`, higherBetter: true },
    { key: "lucroLiquido", label: "Lucro Líquido", fmt: fmtBRL, higherBetter: true },
    { key: "margemLiquida", label: "Margem Líquida", fmt: (n) => `${n.toFixed(1)}%`, higherBetter: true },
    { key: "roic", label: "ROIC", fmt: (n) => `${n.toFixed(1)}%`, higherBetter: true },
    { key: "dividaLiqEbitda", label: "D.Líq/EBITDA", fmt: (n) => Number.isFinite(n) ? `${n.toFixed(1)}×` : "∞", higherBetter: false },
    { key: "saldoCaixaFinal", label: "Saldo Caixa (Dez)", fmt: fmtBRL, higherBetter: true },
    { key: "piorMesCaixa", label: "Pior mês caixa", fmt: fmtBRL, higherBetter: true },
    { key: "impostosAno", label: "Impostos/ano", fmt: fmtBRL, higherBetter: false },
  ];

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <header className="mb-4 flex items-center gap-2">
        <GitCompare className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Comparação de Cenários</h3>
      </header>
      {scenarios.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum cenário salvo ainda. Use a barra inferior ou a aba "Diagnóstico & Decisões" para simular ações e salvar variações. Você poderá compará-las lado a lado aqui.
        </p>
      ) : (
        <div className="scrollbar-thin overflow-x-auto rounded-md border border-border/40">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-card/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Métrica</th>
                <th className="px-3 py-2 text-right">Plano Atual</th>
                {rows.map(({ sc }) => (
                  <th key={sc.id} className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span>{sc.name}</span>
                      <button onClick={() => loadScenario(sc.state)} className="text-[9px] text-primary hover:underline">carregar</button>
                      <button onClick={() => { if (confirm(`Remover cenário "${sc.name}"?`)) removeScenario(sc.id); }} className="text-muted-foreground hover:text-neg">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const baseVal = base[m.key] as number;
                return (
                  <tr key={m.key as string} className="border-t border-border/30">
                    <td className="px-3 py-1.5 font-medium">{m.label}</td>
                    <td className="num px-3 py-1.5 text-right mono">{m.fmt(baseVal)}</td>
                    {rows.map(({ sc, snap }) => {
                      const v = snap[m.key] as number;
                      const delta = v - baseVal;
                      const same = Math.abs(delta) < 1e-6;
                      const improved = m.higherBetter ? delta > 0 : delta < 0;
                      const cls = same ? "text-muted-foreground" : improved ? "text-pos" : "text-neg";
                      return (
                        <td key={sc.id} className={`num px-3 py-1.5 text-right mono ${cls}`}>
                          <div>{m.fmt(v)}</div>
                          {!same && (
                            <div className="text-[9.5px] opacity-80">
                              {m.label.includes("%") ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp` : `${delta > 0 ? "+" : ""}${fmtBRL(delta)}`}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
