import { useEffect, useMemo, useState } from "react";
import { AppState } from "@/lib/finance/types";
import {
  buildValuation,
  defaultValuationParams,
  VALUATION_PRESETS,
  ValuationParams,
  traceValuation,
  runValuationSelfTests,
  logValuationTrace,
  ValuationTestCase,
} from "@/lib/finance/valuation";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { fmtBRLCompact, fmtPct, sum } from "@/lib/finance/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { StatCard, SectionTitle, MoneyInput } from "./primitives";
import {
  DollarSign, BarChart3, TrendingUp, ShieldAlert, AlertTriangle, CheckCircle2,
  Info, TrendingDown, FlaskConical, Calculator, SlidersHorizontal,
} from "lucide-react";

const BUSINESS_LABEL = { servicos: "Serviços", comercio: "Comércio", industria: "Indústria" } as const;

export function ValuationTab({
  baseState,
  simulatedState,
  simActive,
  // backward-compat: aceita `state` antigo
  state,
}: {
  baseState?: AppState;
  simulatedState?: AppState;
  simActive?: number;
  state?: AppState;
}) {
  const effectiveBase = baseState ?? state!;
  const effectiveSim = simulatedState ?? state!;
  const [useSimulated, setUseSimulated] = useState(true);
  const source: AppState = useSimulated ? effectiveSim : effectiveBase;

  const [params, setParams] = useState<ValuationParams>(() => defaultValuationParams(source.businessType));
  const set = (p: Partial<ValuationParams>) => setParams((s) => ({ ...s, ...p }));

  const presets = VALUATION_PRESETS[source.businessType];
  const valuation = useMemo(() => buildValuation(source, params), [source, params]);
  const { dre } = useMemo(() => buildDRE(source, source.tax.regime), [source]);
  const ind = useMemo(() => calcIndicators(source, dre), [source, dre]);
  const ebitda = sum(dre.ebitda);
  const receita = sum(dre.receitaBruta);
  const ll = sum(dre.lucroLiquido);
  const trace = useMemo(() => traceValuation(source, params), [source, params]);

  // Loga memória sempre que muda
  useEffect(() => { logValuationTrace(source, params, useSimulated ? "simulado" : "base"); }, [source, params, useSimulated]);

  const ev = valuation.enterpriseValue;
  const eq = valuation.equityValue;
  const strategic = valuation.strategicResult;

  const evTone = ev.base > 0 ? "pos" : "neg";

  return (
    <div className="space-y-6">
      {/* Resumo executivo */}
      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <SectionTitle hint="Valuation consolida múltiplos setoriais, DCF e ajuste de risco estratégico para chegar a uma faixa de valor da empresa.">
                Valuation — Resumo Executivo
              </SectionTitle>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {state.companyName} · {BUSINESS_LABEL[state.businessType]} · método {valuation.method === "blended" ? "combinado" : valuation.method}
            </div>
          </div>
          <ConfidenceBadge grade={valuation.confidenceScore} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <StatCard label="EV Pessimista" value={fmtBRLCompact(ev.low)} tone={ev.low > 0 ? "default" : "neg"} />
          <StatCard label="EV Base (provável)" value={fmtBRLCompact(ev.base)} tone={evTone} sub="enterprise value" />
          <StatCard label="EV Otimista" value={fmtBRLCompact(ev.high)} tone={ev.high > 0 ? "pos" : "default"} />
          <StatCard
            label="Múltiplo implícito"
            value={`${valuation.impliedMultiple.evEbitda.toFixed(2)}x EBITDA`}
            sub={`${valuation.impliedMultiple.evRevenue.toFixed(2)}x receita`}
          />
        </div>

        <p className="mt-3 rounded-md border border-border/40 bg-background/40 p-3 text-xs italic text-muted-foreground">
          {valuation.narrative}
        </p>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 text-[var(--warning)]" />
          <div>
            <span className="font-semibold text-foreground">Confiança {valuation.confidenceScore}: </span>
            <span className="text-muted-foreground">{valuation.confidenceRationale}</span>
          </div>
        </div>
      </section>

      {/* Tabs internas */}
      <Tabs defaultValue="multiples" className="w-full">
        <TabsList className="bg-card/40">
          <TabsTrigger value="multiples"><BarChart3 className="mr-1.5 h-3.5 w-3.5" />1. Múltiplos</TabsTrigger>
          <TabsTrigger value="dcf"><TrendingUp className="mr-1.5 h-3.5 w-3.5" />2. DCF</TabsTrigger>
          <TabsTrigger value="risk"><ShieldAlert className="mr-1.5 h-3.5 w-3.5" />3. Risco & Sensibilidade</TabsTrigger>
        </TabsList>

        {/* ============ MÚLTIPLOS ============ */}
        <TabsContent value="multiples" className="mt-4 space-y-4">
          <section className="rounded-lg border border-border/60 bg-card/40 p-5">
            <SectionTitle hint="Múltiplos de mercado típicos para o setor. Você pode customizar ou selecionar um cenário.">
              Múltiplos Setoriais — {BUSINESS_LABEL[state.businessType]}
            </SectionTitle>

            <div className="mt-3 flex flex-wrap gap-2">
              {(["pessimista", "base", "otimista"] as const).map((scen, i) => {
                const isBase = i === 1;
                return (
                  <Button
                    key={scen}
                    size="sm"
                    variant={isBase ? "default" : "outline"}
                    onClick={() =>
                      set({
                        evEbitdaMultiple: presets.evEbitdaRange[i],
                        evRevenueMultiple: presets.evRevenueRange[i],
                        plMultiple: presets.plRange[i],
                      })
                    }
                    className="capitalize"
                  >
                    {scen}
                  </Button>
                );
              })}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 text-left font-medium">Múltiplo</th>
                    <th className="py-2 text-right font-medium">Setor (base)</th>
                    <th className="py-2 text-right font-medium">Seu valor</th>
                    <th className="py-2 text-right font-medium">Enterprise Value</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  <MultRow
                    label="EV / EBITDA"
                    base={presets.evEbitdaRange[1]}
                    value={params.evEbitdaMultiple}
                    onChange={(n) => set({ evEbitdaMultiple: n })}
                    ev={ebitda * params.evEbitdaMultiple}
                  />
                  <MultRow
                    label="EV / Receita"
                    base={presets.evRevenueRange[1]}
                    value={params.evRevenueMultiple}
                    onChange={(n) => set({ evRevenueMultiple: n })}
                    ev={receita * params.evRevenueMultiple}
                  />
                  <MultRow
                    label="P / L (lucro)"
                    base={presets.plRange[1]}
                    value={params.plMultiple}
                    onChange={(n) => set({ plMultiple: n })}
                    ev={Math.max(0, ll * params.plMultiple)}
                  />
                </tbody>
              </table>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <SliderField
                label="Prêmio de Controle"
                value={params.controlPremium * 100}
                min={-20} max={50} step={1}
                suffix="%"
                onChange={(v) => set({ controlPremium: v / 100 })}
                hint="Acréscimo no valor por posição de controle (típico 20-30% em transações M&A)."
              />
              <SliderField
                label="Desconto de Liquidez"
                value={params.liquidityDiscount * 100}
                min={0} max={50} step={1}
                suffix="%"
                onChange={(v) => set({ liquidityDiscount: v / 100 })}
                hint="Redução por iliquidez de participação minoritária em empresa fechada (típico 15-30%)."
              />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">EV (múltiplos)</div>
                <div className="mono mt-1 text-lg font-semibold text-primary">
                  {fmtBRLCompact(valuation.multiplesDetails.blendedEnterpriseValue)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">− Dívida onerosa</div>
                <div className="mono mt-1 text-lg font-semibold text-foreground">
                  {fmtBRLCompact(state.capital.dividaOnerosa)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">= Equity Value</div>
                <div className="mono mt-1 text-lg font-semibold text-pos">
                  {fmtBRLCompact(Math.max(0, valuation.multiplesDetails.blendedEnterpriseValue - state.capital.dividaOnerosa))}
                </div>
              </div>
            </div>
          </section>
        </TabsContent>

        {/* ============ DCF ============ */}
        <TabsContent value="dcf" className="mt-4 space-y-4">
          <section className="rounded-lg border border-border/60 bg-card/40 p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <SectionTitle hint="Projeta os fluxos de caixa livre via Forecast e desconta à WACC. Soma o valor terminal por perpetuidade de Gordon.">
                Valuation por DCF — Fluxo de Caixa Descontado
              </SectionTitle>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <SliderField
                label="Horizonte"
                value={params.horizonYears}
                min={1} max={10} step={1}
                suffix=" anos"
                onChange={(v) => set({ horizonYears: v })}
                hint={`${params.horizonYears * 12} meses de projeção via Forecast.`}
              />
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">WACC (custo de capital)</div>
                <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 text-center">
                  <div className="mono text-xl font-semibold text-foreground">{ind.wacc.toFixed(2)}%</div>
                  <div className="text-[10px] text-muted-foreground">
                    {ind.wacc > 20 ? "⚠ elevado" : ind.wacc > 12 ? "moderado" : "baixo"} · vem da aba Capital
                  </div>
                </div>
              </div>
              <SliderField
                label="Crescimento Terminal (g)"
                value={params.terminalGrowthRate * 100}
                min={0} max={5} step={0.25}
                suffix="% a.a."
                onChange={(v) => set({ terminalGrowthRate: v / 100 })}
                hint="Crescimento perpétuo pós-projeção (típico 2-3% para PMEs)."
              />
            </div>

            {params.terminalGrowthRate * 100 >= ind.wacc && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-neg/40 bg-neg/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-neg" />
                <span className="text-foreground">g ≥ WACC: perpetuidade de Gordon não converge. Reduza g ou aumente WACC.</span>
              </div>
            )}

            {valuation.dcfDetails && (
              <div className="mt-5">
                <div className="text-xs font-semibold text-muted-foreground">Detalhes da projeção</div>
                <table className="mt-2 w-full text-sm">
                  <tbody className="mono">
                    <tr className="border-b border-border/40">
                      <td className="py-2 text-muted-foreground">VPN dos fluxos ({valuation.dcfDetails.horizonMonths} meses)</td>
                      <td className="py-2 text-right">{fmtBRLCompact(valuation.dcfDetails.npvFlows)}</td>
                    </tr>
                    <tr className="border-b border-border/40">
                      <td className="py-2 text-muted-foreground">Valor terminal (VP)</td>
                      <td className="py-2 text-right">{fmtBRLCompact(valuation.dcfDetails.npvTerminal)}</td>
                    </tr>
                    <tr className="bg-primary/5">
                      <td className="py-2 font-semibold">Enterprise Value (DCF)</td>
                      <td className="py-2 text-right font-semibold text-primary">
                        {fmtBRLCompact(valuation.dcfDetails.npvFlows + valuation.dcfDetails.npvTerminal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Método Múltiplos</div>
                <div className="mono mt-1 text-lg font-semibold text-primary">
                  {fmtBRLCompact(valuation.multiplesDetails.blendedEnterpriseValue)}
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Método DCF</div>
                <div className="mono mt-1 text-lg font-semibold text-pos">
                  {valuation.dcfDetails
                    ? fmtBRLCompact(valuation.dcfDetails.npvFlows + valuation.dcfDetails.npvTerminal)
                    : "—"}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Se os métodos divergirem mais de 30%, revise premissas: crescimento, WACC ou múltiplos podem estar inconsistentes.
            </p>
          </section>

          {/* Matriz de sensibilidade WACC × g */}
          <SensitivityMatrix wacc={ind.wacc} g={params.terminalGrowthRate * 100} fcfBase={valuation.dcfDetails?.fcfProjected.slice(-12).reduce((a, b) => a + b, 0) || 0} />
        </TabsContent>

        {/* ============ RISCO ============ */}
        <TabsContent value="risk" className="mt-4 space-y-4">
          <RiskPanel valuation={valuation} state={state} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =====================================================================
// SUB-COMPONENTES
// =====================================================================

function MultRow({
  label, base, value, onChange, ev,
}: { label: string; base: number; value: number; onChange: (n: number) => void; ev: number }) {
  return (
    <tr className="border-b border-border/40">
      <td className="py-2.5 text-foreground">{label}</td>
      <td className="py-2.5 text-right text-muted-foreground">{base.toFixed(2)}x</td>
      <td className="py-2.5">
        <div className="ml-auto w-24">
          <MoneyInput value={value} onChange={onChange} />
        </div>
      </td>
      <td className="py-2.5 text-right font-semibold text-foreground">{fmtBRLCompact(ev)}</td>
    </tr>
  );
}

function SliderField({
  label, value, min, max, step, suffix, onChange, hint,
}: {
  label: string; value: number; min: number; max: number; step: number;
  suffix?: string; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="mono font-semibold text-foreground">{value.toFixed(step < 1 ? 2 : 0)}{suffix}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="mt-2"
      />
      {hint && <p className="mt-1.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ConfidenceBadge({ grade }: { grade: string }) {
  const tone =
    grade === "A" ? "border-pos/40 bg-pos/10 text-pos" :
    grade === "B" ? "border-primary/40 bg-primary/10 text-primary" :
    grade === "C" ? "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]" :
    "border-neg/40 bg-neg/10 text-neg";
  return (
    <div className={`rounded-md border px-3 py-1 text-xs font-semibold ${tone}`}>
      Confiança: {grade}
    </div>
  );
}

function SensitivityMatrix({ wacc, g, fcfBase }: { wacc: number; g: number; fcfBase: number }) {
  const waccs = [-2, -1, 0, 1, 2].map((d) => Math.max(1, wacc + d));
  const gs = [1.5, 2.0, 2.5, 3.0, 3.5];
  const baseVal = wacc > g && fcfBase !== 0 ? fcfBase / (wacc / 100 - g / 100) : 1;

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <SectionTitle hint="Mostra como o Enterprise Value relativo (base = 100) varia conforme WACC e crescimento terminal mudam.">
        Matriz de Sensibilidade · WACC × g terminal
      </SectionTitle>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="bg-muted/50 px-2 py-1.5 text-left font-semibold text-muted-foreground">WACC ↓ \ g →</th>
              {gs.map((gg) => (
                <th key={gg} className="bg-muted/50 px-2 py-1.5 text-center font-semibold text-muted-foreground">{gg.toFixed(1)}%</th>
              ))}
            </tr>
          </thead>
          <tbody className="mono">
            {waccs.map((w) => (
              <tr key={w} className="border-t border-border/30">
                <td className="bg-muted/30 px-2 py-1.5 font-semibold text-foreground">{w.toFixed(1)}%</td>
                {gs.map((gg) => {
                  const v = w / 100 > gg / 100 ? fcfBase / (w / 100 - gg / 100) : 0;
                  const rel = baseVal !== 0 ? v / baseVal : 0;
                  const tone =
                    rel === 0 ? "bg-neg/20 text-neg" :
                    rel < 0.8 ? "bg-neg/10 text-neg" :
                    rel < 1.0 ? "bg-[var(--warning)]/10 text-[var(--warning)]" :
                    rel < 1.2 ? "bg-pos/10 text-pos" :
                    "bg-primary/15 text-primary";
                  return (
                    <td key={gg} className={`px-2 py-1.5 text-center font-medium ${tone}`}>
                      {v === 0 ? "—" : (rel * 100).toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Valores normalizados: base WACC × g atuais = 100. Verde = valorização · vermelho = desvalorização · "—" quando g ≥ WACC (não converge).
      </p>
    </section>
  );
}

function RiskPanel({ valuation, state }: { valuation: ReturnType<typeof buildValuation>; state: AppState }) {
  const s = valuation.strategicResult;
  const haircut = valuation.haircutApplied;
  const ev = valuation.enterpriseValue;
  const levelTone =
    s.level === "robusto" ? "border-pos/40 bg-pos/5 text-pos" :
    s.level === "adequado" ? "border-primary/40 bg-primary/5 text-primary" :
    s.level === "frágil" ? "border-[var(--warning)]/40 bg-[var(--warning)]/5 text-[var(--warning)]" :
    s.level === "crítico" ? "border-neg/40 bg-neg/5 text-neg" :
    "border-border/60 bg-card/40 text-muted-foreground";

  return (
    <>
      {/* Risco estratégico */}
      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--warning)]" />
            <SectionTitle hint="Vem da aba Governança. Quanto mais alto o índice, menor o haircut aplicado ao valuation.">
              Risco Estratégico (Governança)
            </SectionTitle>
          </div>
          <span className={`rounded-md border px-3 py-1 text-xs font-semibold capitalize ${levelTone}`}>{s.level}</span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Índice de Risco Estratégico</span>
            <span className="mono font-semibold text-foreground">{s.index.toFixed(0)} / 100</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full bg-gradient-to-r from-neg via-[var(--warning)] to-pos"
              style={{ width: `${Math.max(2, s.index)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{s.headline}</p>
        </div>

        {s.subscores.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-border/40 pt-4">
            {s.subscores.map((sub) => (
              <div key={sub.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{sub.label}</span>
                  <span className={`mono font-semibold ${
                    !sub.filled ? "text-muted-foreground" :
                    sub.score >= 70 ? "text-pos" : sub.score >= 50 ? "text-[var(--warning)]" : "text-neg"
                  }`}>
                    {sub.filled ? sub.score.toFixed(0) : "—"}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className={`h-full ${
                      !sub.filled ? "bg-muted-foreground/30" :
                      sub.score >= 70 ? "bg-pos" : sub.score >= 50 ? "bg-[var(--warning)]" : "bg-neg"
                    }`}
                    style={{ width: `${sub.filled ? sub.score : 0}%` }}
                  />
                </div>
                {sub.highlights.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                    {sub.highlights.map((h, i) => <li key={i}>· {h}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {haircut > 0 && (
        <section className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-5">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-[var(--warning)]" />
            <SectionTitle>Haircut Estratégico Aplicado</SectionTitle>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-foreground">Redução de valor por risco estratégico</span>
            <span className="mono text-2xl font-bold text-[var(--warning)]">−{(haircut * 100).toFixed(1)}%</span>
          </div>
          <div className="mt-3 grid gap-3 border-t border-[var(--warning)]/30 pt-3 md:grid-cols-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">EV sem haircut</div>
              <div className="mono mt-1 text-lg font-semibold text-foreground">
                {fmtBRLCompact(ev.base / (1 - haircut))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">EV com haircut</div>
              <div className="mono mt-1 text-lg font-semibold text-[var(--warning)]">{fmtBRLCompact(ev.base)}</div>
            </div>
          </div>
        </section>
      )}

      {/* Sensibilidade ao cenário */}
      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle hint="Range de Enterprise Value combinando incerteza de premissas e haircut estratégico.">
          Faixa de Valuation
        </SectionTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <RangeCard tone="neg" label="Pessimista" desc="WACC +1pp · g −0.5pp · receita −10%" value={ev.low} base={ev.base} />
          <RangeCard tone="primary" label="Base (provável)" desc="Premissas atuais" value={ev.base} base={ev.base} />
          <RangeCard tone="pos" label="Otimista" desc="WACC −1pp · g +0.5pp · receita +15%" value={ev.high} base={ev.base} />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <div className="text-foreground">
            <span className="font-semibold">Faixa de confiança:</span>{" "}
            <span className="mono">{fmtBRLCompact(ev.low)} → {fmtBRLCompact(ev.high)}</span>{" "}
            <span className="text-muted-foreground">· base provável </span>
            <span className="mono">{fmtBRLCompact(ev.base)}</span>
          </div>
        </div>
      </section>

      {/* Recomendações */}
      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle>Recomendações para Aumentar o Valor</SectionTitle>
        <ul className="mt-3 space-y-2 text-sm">
          {s.index < 50 && (
            <Reco icon="🎯" title="Diversifique a base de clientes" text="Reduzir concentração eleva o múltiplo aceitável pelo comprador." />
          )}
          {(s.level === "crítico" || s.level === "frágil") && (
            <Reco icon="🏛️" title="Profissionalize a governança" text="Plano de sucessão, processos documentados e equipe sênior reduzem o bus factor." />
          )}
          {haircut > 0.2 && (
            <Reco
              icon="💰"
              title="Cada melhoria estratégica vira valor"
              text={`No nível atual de haircut (${(haircut * 100).toFixed(0)}%), reduzir 10pp no risco libera ~${fmtBRLCompact(ev.base * (haircut / 4))} de valor.`}
            />
          )}
          <Reco icon="🧪" title="Simule cenários operacionais" text="Use a aba Simulador para testar como mudanças de preço, custo ou volume impactam o EV." />
          <Reco icon="📐" title="Triangule múltiplos vs DCF" text="Métodos próximos = valuation defensável. Métodos divergentes = revisar premissas antes de negociar." />
        </ul>
      </section>
    </>
  );
}

function RangeCard({
  tone, label, desc, value, base,
}: { tone: "neg" | "primary" | "pos"; label: string; desc: string; value: number; base: number }) {
  const toneClasses =
    tone === "neg" ? "border-neg/40 bg-neg/5" :
    tone === "pos" ? "border-pos/40 bg-pos/5" :
    "border-primary/40 bg-primary/5";
  const textTone = tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-primary";
  const delta = base !== 0 ? ((value - base) / Math.abs(base)) * 100 : 0;
  return (
    <div className={`rounded-md border p-3 ${toneClasses}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${textTone}`}>{label}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{desc}</div>
      <div className={`mono mt-2 text-xl font-bold ${textTone}`}>{fmtBRLCompact(value)}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {value === base ? "referência (100%)" : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% vs base`}
      </div>
    </div>
  );
}

function Reco({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border/40 bg-background/40 p-3">
      <span className="text-base leading-none">{icon}</span>
      <div className="text-xs">
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-muted-foreground">{text}</div>
      </div>
    </li>
  );
}
