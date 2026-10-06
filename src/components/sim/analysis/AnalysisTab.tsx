import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Scenario } from "@/engines/finance/types";
import { computeHealth, HealthDimension, type HealthPrecomputed } from "@/engines/finance/health";
import { runSensitivity, OUTPUT_OPTIONS, OutputKey } from "@/engines/finance/sensitivity";
import { buildForecast, DEFAULT_FORECAST_CFG, ForecastConfig } from "@/engines/finance/forecast";
import { DEFAULT_MC, MCConfig, MCResult, histogram } from "@/engines/finance/montecarlo";
import { snapshot } from "@/engines/finance/prescriptive";
import { fmtBRL } from "@/engines/finance/format";
import { crescimentoObservado } from "@/engines/odoo/growth";
import { useOdooCockpitContext } from "@/components/odoo/cockpit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Activity,
  GitCompare,
  LineChart as LineIcon,
  Play,
  Sliders,
  TrendingUp,
  Trash2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ConfirmDialog } from "@/components/sim/shared/ConfirmDialog";
import {
  chartTooltipStyle,
  chartTooltipItemStyle,
  chartTooltipLabelStyle,
} from "@/components/sim/shared/chartStyles";
import { NumInput } from "@/components/sim/shared/primitives";

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
      <ScenarioCompareCard
        state={state}
        scenarios={scenarios}
        loadScenario={loadScenario}
        removeScenario={removeScenario}
      />
    </div>
  );
}

// ============== Health Score ==============
export function HealthScoreCard({
  state,
  precomputed,
}: {
  state: AppState;
  precomputed?: HealthPrecomputed;
}) {
  const h = useMemo(() => computeHealth(state, precomputed), [state, precomputed]);
  const ringColor =
    h.status === "ok"
      ? "var(--success)"
      : h.status === "warn"
        ? "var(--warning)"
        : "var(--destructive)";
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
            <circle
              cx="70"
              cy="70"
              r="52"
              stroke="var(--border)"
              strokeWidth="10"
              fill="none"
              opacity="0.4"
            />
            <circle
              cx="70"
              cy="70"
              r="52"
              stroke={ringColor}
              strokeWidth="10"
              fill="none"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset .6s ease" }}
            />
          </svg>
          <div className="-mt-[100px] flex flex-col items-center">
            <div className="text-3xl font-bold" style={{ color: ringColor }}>
              {h.total.toFixed(0)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">/ 100</div>
          </div>
          <div className="mt-12 text-center">
            <div className="text-2xl font-bold" style={{ color: ringColor }}>
              Nota {h.grade}
            </div>
            <div className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">{h.headline}</div>
          </div>
        </div>

        <div className="space-y-2">
          {h.dimensions.map((d) => (
            <DimRow key={d.key} d={d} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DimRow({ d }: { d: HealthDimension }) {
  const color =
    d.status === "ok"
      ? "var(--success)"
      : d.status === "warn"
        ? "var(--warning)"
        : "var(--destructive)";
  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{d.label}</span>
          <span className="text-[10px] text-muted-foreground">
            peso {Math.round(d.weight * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-xs text-muted-foreground">{d.value}</span>
          <span className="mono text-xs font-semibold" style={{ color }}>
            {d.score.toFixed(0)}
          </span>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/50">
        <div
          className="h-full transition-all"
          style={{ width: `${d.score}%`, background: color }}
        />
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{d.comment}</p>
    </div>
  );
}

// ============== Sensitivity ==============
export function SensitivityCard({ state }: { state: AppState }) {
  const [output, setOutput] = useState<OutputKey>("ebitda");
  // Difere o estado pesado para não bloquear teclado/sliders durante 36× buildDRE
  const deferredState = useDeferredValue(state);
  const result = useMemo(() => runSensitivity(deferredState, output), [deferredState, output]);
  const fmt = (n: number) => (output === "roic" ? `${n.toFixed(1)}%` : fmtBRL(n));

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
            <SelectTrigger className="h-8 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Variação simulada de cada driver entre −15% e +15% sobre o output. Drivers ordenados pelo
        poder de impacto (elasticidade). Baseline:{" "}
        <span className="mono font-semibold text-foreground">{fmt(result.baseline)}</span>.
      </p>

      <div className="scrollbar-thin overflow-x-auto rounded-md border border-border/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-card/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Driver</th>
              {result.deltas.map((d) => (
                <th key={d} className="px-2 py-2 text-right">
                  {d > 0 ? `+${d}%` : `${d}%`}
                </th>
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
                    <td
                      key={c.deltaPct}
                      className="num px-2 py-1.5 text-right"
                      style={{ background: bg }}
                    >
                      <div className="text-[11px] font-semibold">
                        {c.pctChange > 0 ? "+" : ""}
                        {c.pctChange.toFixed(1)}%
                      </div>
                      <div className="text-[9.5px] text-muted-foreground">{fmt(c.value)}</div>
                    </td>
                  );
                })}
                <td className="num px-3 py-1.5 text-right font-semibold mono">
                  {row.elasticity > 0 ? "+" : ""}
                  {row.elasticity.toFixed(2)}×
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">
        Elasticidade = % de variação do output por 1% de variação do driver. Quanto maior em módulo,
        mais sensível seu resultado é àquela alavanca — priorize ações sobre os drivers do topo.
      </p>
    </section>
  );
}

// ============== Scenario Compare ==============
export function ScenarioCompareCard({
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
  const rows = useMemo(
    () => scenarios.map((sc) => ({ sc, snap: snapshot(sc.state) })),
    [scenarios],
  );

  const metrics: {
    key: keyof typeof base;
    label: string;
    fmt: (n: number) => string;
    higherBetter: boolean;
    unit?: "pct" | "x";
  }[] = [
    { key: "receitaBruta", label: "Receita Bruta", fmt: fmtBRL, higherBetter: true },
    { key: "ebitda", label: "EBITDA", fmt: fmtBRL, higherBetter: true },
    {
      key: "margemEbitda",
      label: "Margem EBITDA",
      fmt: (n) => `${n.toFixed(1)}%`,
      higherBetter: true,
      unit: "pct",
    },
    { key: "lucroLiquido", label: "Lucro Líquido", fmt: fmtBRL, higherBetter: true },
    {
      key: "margemLiquida",
      label: "Margem Líquida",
      fmt: (n) => `${n.toFixed(1)}%`,
      higherBetter: true,
      unit: "pct",
    },
    { key: "roic", label: "ROIC", fmt: (n) => `${n.toFixed(1)}%`, higherBetter: true, unit: "pct" },
    {
      key: "dividaLiqEbitda",
      label: "D.Líq/EBITDA",
      fmt: (n) => (Number.isFinite(n) ? `${n.toFixed(1)}×` : "∞"),
      higherBetter: false,
      unit: "x",
    },
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
          Nenhum cenário salvo ainda. Use a barra inferior ou a aba "Diagnóstico & Decisões" para
          simular ações e salvar variações. Você poderá compará-las lado a lado aqui.
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
                      <button
                        onClick={() => loadScenario(sc.state)}
                        className="text-[9px] text-primary hover:underline"
                      >
                        carregar
                      </button>
                      <ConfirmDialog
                        title={`Remover cenário "${sc.name}"?`}
                        description="O cenário salvo será apagado e não poderá ser recuperado. O plano atual não é afetado."
                        confirmLabel="Remover"
                        destructive
                        onConfirm={() => removeScenario(sc.id)}
                        trigger={
                          <button
                            className="text-muted-foreground hover:text-neg"
                            title="Remover cenário"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        }
                      />
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
                      const cls = same
                        ? "text-muted-foreground"
                        : improved
                          ? "text-pos"
                          : "text-neg";
                      return (
                        <td key={sc.id} className={`num px-3 py-1.5 text-right mono ${cls}`}>
                          <div>{m.fmt(v)}</div>
                          {!same && (
                            <div className="text-[9.5px] opacity-80">
                              {m.unit === "pct"
                                ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp`
                                : m.unit === "x"
                                  ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)}×`
                                  : `${delta > 0 ? "+" : ""}${fmtBRL(delta)}`}
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

// ============== Forecast 36 meses + VPL/TIR ==============
export function ForecastCard({ state }: { state: AppState }) {
  const cockpit = useOdooCockpitContext();
  const modoOdoo = !!state.realizado;
  // Modo Odoo: a premissa nasce do crescimento observado (12m vs 12m anteriores);
  // sem 24 meses de histórico, 0%. Vale até o usuário editar o campo.
  const sugestao = useMemo(() => {
    if (!modoOdoo || !cockpit?.snapshot || !cockpit.entity || !cockpit.entityReady) return null;
    try {
      return crescimentoObservado(cockpit.snapshot, cockpit.entity, cockpit.endMonth);
    } catch {
      return null;
    }
  }, [modoOdoo, cockpit?.snapshot, cockpit?.entity, cockpit?.entityReady, cockpit?.endMonth]);
  const crescAuto = modoOdoo
    ? sugestao?.disponivel
      ? sugestao.pctMensal
      : 0
    : DEFAULT_FORECAST_CFG.crescimentoMensalPct;
  const [crescEditado, setCrescEditado] = useState<number | null>(null);
  const [cfgBase, setCfg] = useState<ForecastConfig>(DEFAULT_FORECAST_CFG);
  const anoBase = useMemo(() => new Date().getFullYear(), []);
  const cfg = useMemo<ForecastConfig>(
    () => ({
      ...cfgBase,
      crescimentoMensalPct: crescEditado ?? crescAuto,
      anoBase: modoOdoo ? undefined : anoBase,
    }),
    [cfgBase, crescEditado, crescAuto, modoOdoo, anoBase],
  );
  const result = useMemo(() => buildForecast(state, cfg), [state, cfg]);
  const set = (patch: Partial<ForecastConfig>) => setCfg((c) => ({ ...c, ...patch }));

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <header className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">
          Projeção {cfg.horizonteMeses} meses · VPL · TIR · Payback
        </h3>
      </header>

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <NumberInput
          label="Cresc. receita (% a.m.)"
          value={cfg.crescimentoMensalPct}
          step={0.1}
          onChange={(v) => setCrescEditado(v)}
        />
        <NumberInput
          label="Inflação fixos (% a.a.)"
          value={cfg.inflacaoFixosAA}
          step={0.5}
          onChange={(v) => set({ inflacaoFixosAA: v })}
        />
        <NumberInput
          label="Ganho escala CPV (% a.a.)"
          value={cfg.ganhoEscalaCpvAA}
          step={0.5}
          onChange={(v) => set({ ganhoEscalaCpvAA: v })}
        />
        <NumberInput
          label="Horizonte (meses)"
          value={cfg.horizonteMeses}
          step={6}
          onChange={(v) => set({ horizonteMeses: Math.max(6, Math.min(120, Math.round(v))) })}
        />
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground" data-testid="forecast-premissas">
        {modoOdoo ? (
          sugestao?.disponivel ? (
            <>
              Crescimento observado no Odoo: receita dos últimos 12 meses{" "}
              {sugestao.variacaoAnualPct >= 0 ? "+" : ""}
              {sugestao.variacaoAnualPct.toFixed(1).replace(".", ",")}% sobre os 12 anteriores ≈{" "}
              {sugestao.pctMensal.toFixed(2).replace(".", ",")}% a.m.
              {crescEditado != null && crescEditado !== sugestao.pctMensal && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setCrescEditado(null)}
                  >
                    Usar sugestão
                  </button>
                </>
              )}
            </>
          ) : (
            "Menos de 24 meses de histórico no Odoo: a premissa de crescimento começa em 0%."
          )
        ) : null}{" "}
        {modoOdoo
          ? "Cada mês projetado parte do mesmo mês do ano realizado (preserva a sazonalidade)."
          : `Ano-base ${anoBase}.`}{" "}
        {(state.tax.era ?? "atual") === "atual" &&
          "Tributos sobre vendas seguem o cronograma da Reforma (CBS/IBS) ano a ano."}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <NumberInput
          label="Step receita p/ folha (%)"
          value={cfg.stepReceitaPct}
          step={5}
          onChange={(v) => set({ stepReceitaPct: Math.max(10, v) })}
        />
        <NumberInput
          label="Salto de folha por step (%)"
          value={cfg.stepFolhaPct}
          step={5}
          onChange={(v) => set({ stepFolhaPct: v })}
        />
        <NumberInput
          label="Investimento inicial (R$)"
          value={cfg.capexInicial}
          step={10000}
          onChange={(v) => set({ capexInicial: v })}
        />
        <div className="flex flex-col justify-end">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Taxa de desconto (WACC)
          </span>
          <span className="mono text-sm font-semibold">
            {result.taxaDescontoMensal.toFixed(2)}% a.m.
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <KPI
          label="VPL"
          value={fmtBRL(result.vpl)}
          status={result.vpl > 0 ? "ok" : "danger"}
          sub={result.vpl > 0 ? "Projeto cria valor" : "Projeto destrói valor"}
        />
        <KPI
          label="TIR (a.m.)"
          value={result.tir == null ? "—" : `${result.tir.toFixed(2)}%`}
          status={result.tir != null && result.tir > result.taxaDescontoMensal ? "ok" : "warn"}
          sub={
            result.tir == null
              ? (result.tirError ?? "Sem inversão de sinal")
              : `vs custo ${result.taxaDescontoMensal.toFixed(2)}%`
          }
        />
        <KPI
          label="Payback"
          value={result.paybackMeses == null ? "—" : `${result.paybackMeses} meses`}
          status={
            result.paybackMeses != null && result.paybackMeses <= cfg.horizonteMeses / 2
              ? "ok"
              : "warn"
          }
          sub="Mês em que o caixa zera"
        />
        <KPI
          label="ΔNCG acumulada"
          value={fmtBRL(result.totalDeltaNcg)}
          status={result.totalDeltaNcg < result.totalEbitda * 0.3 ? "ok" : "warn"}
          sub={`Consumo de caixa pelo giro`}
        />
      </div>

      <div className="h-72 rounded-md border border-border/40 bg-background/30 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={result.meses}>
            <defs>
              <linearGradient id="fclGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
              stroke="var(--muted-foreground)"
              interval={Math.floor(result.meses.length / 12)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              stroke="var(--muted-foreground)"
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              itemStyle={chartTooltipItemStyle}
              labelStyle={chartTooltipLabelStyle}
              formatter={(v: number) => fmtBRL(v)}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
            <Area
              type="monotone"
              dataKey="fcl"
              name="FCL mensal"
              stroke="var(--primary)"
              fill="url(#fclGrad)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="saldoCaixa"
              name="Saldo acumulado"
              stroke="var(--success)"
              fill="url(#saldoGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">
        Modelo estruturado: receita cresce composta; custos fixos seguem inflação (não escalam com
        receita); folha tem saltos discretos por step de receita; CPV escala com volume e ganha
        eficiência via curva de escala. FCL/FCFF = NOPAT + D&A − CAPEX − ΔNCG (variação de capital
        de giro recalculada mês a mês), sem juros para não duplicar dívida no DCF. Impostos
        projetados pela base efetiva do ano-base. Aproximação consultiva — para análise formal use 3
        cenários (otimista/base/pessimista).
      </p>
    </section>
  );
}

// ============== Monte Carlo (Web Worker) ==============
export function MonteCarloCard({ state }: { state: AppState }) {
  const [cfg, setCfg] = useState<MCConfig>(DEFAULT_MC);
  const [result, setResult] = useState<MCResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      const McWorker = (await import("@/workers/montecarlo.worker.ts?worker")).default;
      if (cancelled) return;
      const w = new McWorker();
      w.onmessage = (e: MessageEvent<{ ok: boolean; result?: MCResult; error?: string }>) => {
        if (e.data.ok && e.data.result) {
          setResult(e.data.result);
          setError(null);
        } else {
          setError(e.data.error ?? "Falha na simulação");
        }
        setRunning(false);
      };
      workerRef.current = w;
    })();
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const run = () => {
    if (!workerRef.current) {
      // fallback síncrono se worker indisponível
      setRunning(true);
      import("@/engines/finance/montecarlo").then(({ runMonteCarlo }) => {
        setResult(runMonteCarlo(state, cfg));
        setRunning(false);
      });
      return;
    }
    setRunning(true);
    setError(null);
    workerRef.current.postMessage({ state, cfg });
  };

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LineIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Simulação Monte Carlo</h3>
        </div>
        <Button size="sm" onClick={run} disabled={running}>
          <Play className="mr-2 h-3.5 w-3.5" />
          {running ? "Rodando..." : `Rodar ${cfg.iterations} cenários`}
        </Button>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <NumberInput
          label="Iterações"
          value={cfg.iterations}
          step={500}
          onChange={(v) =>
            setCfg({ ...cfg, iterations: Math.max(100, Math.min(10000, Math.round(v))) })
          }
        />
        <NumberInput
          label="σ Preço (%)"
          value={cfg.precoSigmaPct}
          step={1}
          onChange={(v) => setCfg({ ...cfg, precoSigmaPct: v })}
        />
        <NumberInput
          label="σ Volume (%)"
          value={cfg.volumeSigmaPct}
          step={1}
          onChange={(v) => setCfg({ ...cfg, volumeSigmaPct: v })}
        />
        <NumberInput
          label="σ CPV (%)"
          value={cfg.cpvSigmaPct}
          step={1}
          onChange={(v) => setCfg({ ...cfg, cpvSigmaPct: v })}
        />
        <NumberInput
          label="σ Folha (%)"
          value={cfg.folhaSigmaPct}
          step={1}
          onChange={(v) => setCfg({ ...cfg, folhaSigmaPct: v })}
        />
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {!result ? (
        <p className="text-xs text-muted-foreground">
          Clique em "Rodar" para simular variações aleatórias (distribuição normal) em preço,
          volume, CPV e folha. As <b>{cfg.iterations} iterações</b> rodam em <b>Web Worker</b> para
          não travar a UI. P5–P95 = intervalo de confiança; também mostra probabilidade de prejuízo
          / caixa &lt; mínimo.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KPI
              label="Prob. de Prejuízo"
              value={`${(result.probPrejuizo * 100).toFixed(1)}%`}
              status={
                result.probPrejuizo > 0.25 ? "danger" : result.probPrejuizo > 0.1 ? "warn" : "ok"
              }
              sub={`${result.iterations} cenários simulados`}
            />
            <KPI
              label="Prob. Caixa < mínimo"
              value={`${(result.probCaixaNegativo * 100).toFixed(1)}%`}
              status={
                result.probCaixaNegativo > 0.25
                  ? "danger"
                  : result.probCaixaNegativo > 0.1
                    ? "warn"
                    : "ok"
              }
              sub="Em algum mês do período (não só no fim)"
            />
            {result.probCaixaNegativoAlgumMes !== undefined && (
              <KPI
                label="Prob. de caixa negativo"
                value={`${(result.probCaixaNegativoAlgumMes * 100).toFixed(1)}%`}
                status={
                  result.probCaixaNegativoAlgumMes > 0.1
                    ? "danger"
                    : result.probCaixaNegativoAlgumMes > 0.02
                      ? "warn"
                      : "ok"
                }
                sub={
                  result.piorSaldoMensal
                    ? `Pior mês, cenário pessimista (P5): ${fmtBRL(result.piorSaldoMensal.p5)}`
                    : "Em algum mês do período"
                }
              />
            )}
            {result.cvar5Lucro !== undefined && (
              <KPI
                label="Lucro nos 5% piores cenários"
                value={fmtBRL(result.cvar5Lucro)}
                status={result.cvar5Lucro < 0 ? "danger" : "ok"}
                sub="Média da cauda (CVaR 95%) — quanto se perde quando dá errado"
              />
            )}
          </div>

          {[result.ebitda, result.lucroLiquido, result.saldoCaixaFinal].map((dist) => {
            // Probabilidade de resultado negativo (barras à esquerda do zero)
            const probNeg =
              dist.values.filter((v) => v < 0).length / Math.max(1, dist.values.length);
            // Amplitude entre cenários pessimista (P5) e otimista (P95)
            const amplitude = dist.p95 - dist.p5;
            // Explicação contextualizada por métrica (linguagem para leigos)
            const explicacoes: Record<string, { oQueE: string; comoLer: string; alerta?: string }> =
              {
                EBITDA: {
                  oQueE:
                    "EBITDA é o lucro operacional da empresa antes de juros, impostos e depreciação — quanto o negócio gera só com a operação.",
                  comoLer: `Em metade dos cenários simulados o EBITDA fica próximo de ${fmtBRL(dist.median)}. Em 90% dos casos cai entre ${fmtBRL(dist.p5)} (pessimista) e ${fmtBRL(dist.p95)} (otimista).`,
                  alerta:
                    probNeg > 0.1
                      ? `Atenção: em ${(probNeg * 100).toFixed(1)}% dos cenários o EBITDA fica negativo — operação não se paga.`
                      : undefined,
                },
                "Lucro Líquido": {
                  oQueE:
                    "Lucro Líquido é o que sobra de verdade após pagar impostos, juros e todas as despesas — o resultado final do exercício.",
                  comoLer: `O resultado mais provável gira em torno de ${fmtBRL(dist.median)}. Em 90% das simulações o lucro fica entre ${fmtBRL(dist.p5)} e ${fmtBRL(dist.p95)}.`,
                  alerta:
                    probNeg > 0.1
                      ? `Risco relevante: ${(probNeg * 100).toFixed(1)}% dos cenários terminam em prejuízo.`
                      : undefined,
                },
                "Saldo de Caixa (Dez)": {
                  oQueE:
                    "Saldo de Caixa em dezembro é quanto dinheiro deve sobrar no banco no fim do horizonte simulado, depois de todas as entradas e saídas.",
                  comoLer: `O saldo mediano projetado é ${fmtBRL(dist.median)}. Em 90% dos cenários o caixa final fica entre ${fmtBRL(dist.p5)} e ${fmtBRL(dist.p95)}.`,
                  alerta:
                    probNeg > 0.1
                      ? `Alerta de liquidez: em ${(probNeg * 100).toFixed(1)}% dos cenários a empresa termina com caixa negativo (precisaria de empréstimo).`
                      : undefined,
                },
              };
            const exp = explicacoes[dist.label] ?? {
              oQueE: "Distribuição de resultados possíveis simulados.",
              comoLer: `Mediana ${fmtBRL(dist.median)}; 90% dos casos entre ${fmtBRL(dist.p5)} e ${fmtBRL(dist.p95)}.`,
            };
            return (
              <div
                key={dist.label}
                className="rounded-md border border-border/40 bg-background/30 p-3"
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-xs font-semibold">{dist.label}</h4>
                  <div className="flex gap-4 text-[10.5px] text-muted-foreground mono">
                    <span>P5: {fmtBRL(dist.p5)}</span>
                    <span>P25: {fmtBRL(dist.p25)}</span>
                    <span className="text-foreground">Mediana: {fmtBRL(dist.median)}</span>
                    <span>P75: {fmtBRL(dist.p75)}</span>
                    <span>P95: {fmtBRL(dist.p95)}</span>
                  </div>
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogram(dist.values, 30)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="x"
                        tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                        stroke="var(--muted-foreground)"
                        tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                        stroke="var(--muted-foreground)"
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        itemStyle={chartTooltipItemStyle}
                        labelStyle={chartTooltipLabelStyle}
                        formatter={(v: number) => `${v} cenários`}
                        labelFormatter={(v: number) => fmtBRL(v)}
                      />
                      <ReferenceLine
                        x={dist.median}
                        stroke="var(--primary)"
                        strokeDasharray="4 2"
                      />
                      <ReferenceLine x={0} stroke="var(--destructive)" />
                      <Bar dataKey="count">
                        {histogram(dist.values, 30).map((b, i) => (
                          <Cell
                            key={i}
                            fill={b.x < 0 ? "var(--destructive)" : "var(--primary)"}
                            fillOpacity={0.7}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Explicação em linguagem simples para o leigo */}
                <div className="mt-2 space-y-1.5 rounded-sm bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <p>
                    <span className="font-semibold text-foreground">O que é: </span>
                    {exp.oQueE}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Como ler o gráfico: </span>
                    cada barra é um grupo de cenários simulados. Quanto mais alta, mais cenários
                    caíram naquela faixa. A linha tracejada marca a <b>mediana</b> (resultado mais
                    provável); a linha vermelha marca o <b>zero</b> (barras à esquerda = resultado
                    negativo).
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">No seu caso: </span>
                    {exp.comoLer} A amplitude total entre pessimista e otimista é de{" "}
                    <b>{fmtBRL(amplitude)}</b> — quanto maior, mais incerto o resultado.
                  </p>
                  {exp.alerta && (
                    <p className="text-destructive">
                      <span className="font-semibold">⚠ </span>
                      {exp.alerta}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <NumInput value={value} onChange={onChange} integer={step >= 1 && Number.isInteger(step)} />
    </label>
  );
}

function KPI({
  label,
  value,
  status,
  sub,
}: {
  label: string;
  value: string;
  status: "ok" | "warn" | "danger";
  sub?: string;
}) {
  const color =
    status === "ok"
      ? "var(--success)"
      : status === "warn"
        ? "var(--warning)"
        : "var(--destructive)";
  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mono mt-1 text-lg font-bold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
