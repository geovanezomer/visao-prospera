import { useEffect, useMemo, useState } from "react";
import { totalDividaOnerosa } from "@/engines/finance/debtContracts";
import { computeNetDebtParts } from "@/engines/finance/shared";
import { AppState } from "@/engines/finance/types";
import {
  buildValuation,
  defaultValuationParams,
  VALUATION_PRESETS,
  ValuationParams,
  traceValuation,
  logValuationTrace,
} from "@/engines/finance/valuation";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRLCompact, sum, fmtNum } from "@/engines/finance/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatCard, SectionTitle } from "@/components/sim/shared/primitives";
import {
  DollarSign,
  BarChart3,
  TrendingUp,
  ShieldAlert,
  Info,
  AlertTriangle,
  Calculator,
  SlidersHorizontal,
} from "lucide-react";

import { MultRow, SliderField, ConfidenceBadge } from "@/components/sim/valuation/parts";
import { SensitivityMatrix } from "@/components/sim/valuation/SensitivityMatrix";
import { RiskPanel } from "@/components/sim/valuation/RiskPanel";
import { AuditPanel } from "@/components/sim/valuation/AuditPanel";

const BUSINESS_LABEL = {
  servicos: "Serviços",
  comercio: "Comércio",
  industria: "Indústria",
} as const;

// Orquestrador da aba Valuation — múltiplos, DCF, risco e auditoria.
// Cada painel pesado vive em src/components/sim/valuation/*.tsx.
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

  // Presets atualizam quando businessType muda.
  const [params, setParams] = useState<ValuationParams>(() =>
    defaultValuationParams(source.businessType),
  );
  useEffect(() => {
    setParams((cur) => ({
      ...defaultValuationParams(source.businessType),
      ...{
        controlPremium: cur.controlPremium,
        liquidityDiscount: cur.liquidityDiscount,
        horizonYears: cur.horizonYears,
        applyStrategicHaircut: cur.applyStrategicHaircut,
        method: cur.method,
      },
    }));
  }, [source.businessType]);
  const set = (p: Partial<ValuationParams>) => setParams((s) => ({ ...s, ...p }));

  const presets = VALUATION_PRESETS[source.businessType];

  // Modelo central injetado em buildValuation/traceValuation — evita
  // chamadas redundantes a buildDRE/calcIndicators e usa regime EFETIVO.
  const { regime, dre, ind } = useFinanceModel(source);
  const precomputed = useMemo(() => ({ regime, dre, ind }), [regime, dre, ind]);
  const valuation = useMemo(
    () => buildValuation(source, params, precomputed),
    [source, params, precomputed],
  );
  const trace = useMemo(
    () => traceValuation(source, params, precomputed),
    [source, params, precomputed],
  );
  const ebitda = sum(dre.ebitda);
  const receita = sum(dre.receitaBruta);
  const ll = sum(dre.lucroLiquido);

  // Log opt-in via botão (evita log a cada slider).
  const onLogTrace = () => logValuationTrace(source, params, useSimulated ? "simulado" : "base");

  const ev = valuation.enterpriseValue;
  const evTone = ev.base > 0 ? "pos" : "neg";

  return (
    <div className="space-y-6">
      {/* Banner fonte de dados — Base × Simulado */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <div>
            <div className="font-semibold text-foreground">
              Fonte dos números:{" "}
              {useSimulated ? "DRE Simulado (aba Simulador)" : "DRE base (sem ajustes)"}
            </div>
            <div className="text-muted-foreground">
              {useSimulated
                ? `${simActive ?? 0} alavanca${(simActive ?? 0) === 1 ? "" : "s"} ativa${(simActive ?? 0) === 1 ? "" : "s"} no Simulador estão sendo aplicadas ao valuation.`
                : "Usando os dados originais antes de qualquer simulação."}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={useSimulated ? "default" : "outline"}
            onClick={() => setUseSimulated(true)}
          >
            DRE Simulado
          </Button>
          <Button
            size="sm"
            variant={!useSimulated ? "default" : "outline"}
            onClick={() => setUseSimulated(false)}
          >
            DRE Base
          </Button>
        </div>
      </div>

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
              {source.companyName} · {BUSINESS_LABEL[source.businessType]} · método{" "}
              {valuation.method === "blended" ? "combinado" : valuation.method}
            </div>
          </div>
          <ConfidenceBadge grade={valuation.confidenceScore} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <StatCard
            label="EV Pessimista"
            value={fmtBRLCompact(ev.low)}
            tone={ev.low > 0 ? "default" : "neg"}
            hint={{
              description: "Faixa pessimista do Enterprise Value (cenário stress).",
              formula: "EV Base × (1 − margem de segurança)",
              calc: `EV Base ${fmtBRLCompact(ev.base)} → Pessimista ${fmtBRLCompact(ev.low)}`,
            }}
          />
          <StatCard
            label="EV Base (provável)"
            value={fmtBRLCompact(ev.base)}
            tone={evTone}
            sub="enterprise value"
            hint={{
              description: "Cenário-base de Enterprise Value combinando DCF + múltiplos setoriais.",
              formula: "Σ FCFF descontados + Valor Terminal − Dívida Líquida",
              calc: `EV Base = ${fmtBRLCompact(ev.base)}`,
            }}
          />
          <StatCard
            label="EV Otimista"
            value={fmtBRLCompact(ev.high)}
            tone={ev.high > 0 ? "pos" : "default"}
            hint={{
              description: "Faixa otimista do Enterprise Value (cenário upside).",
              formula: "EV Base × (1 + prêmio de upside)",
              calc: `EV Base ${fmtBRLCompact(ev.base)} → Otimista ${fmtBRLCompact(ev.high)}`,
            }}
          />
          <StatCard
            label="Múltiplo implícito"
            value={`${fmtNum(valuation.impliedMultiple.evEbitda, 2)}x EBITDA`}
            sub={`${fmtNum(valuation.impliedMultiple.evRevenue, 2)}x receita`}
            hint={{
              description: "Múltiplos derivados do EV Base sobre EBITDA e Receita Líquida.",
              formula: "EV ÷ EBITDA  ·  EV ÷ Receita Líquida",
              calc: `EV/EBITDA = ${fmtNum(valuation.impliedMultiple.evEbitda, 2)}×\nEV/Receita = ${fmtNum(valuation.impliedMultiple.evRevenue, 2)}×`,
            }}
          />
        </div>

        <p className="mt-3 rounded-md border border-border/40 bg-background/40 p-3 text-xs italic text-muted-foreground">
          {valuation.narrative}
        </p>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 text-[var(--warning)]" />
          <div>
            <span className="font-semibold text-foreground">
              Confiança {valuation.confidenceScore}:{" "}
            </span>
            <span className="text-muted-foreground">{valuation.confidenceRationale}</span>
          </div>
        </div>
      </section>

      <Tabs defaultValue="multiples" className="w-full">
        <TabsList className="bg-card/40">
          <TabsTrigger value="multiples">
            <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
            1. Múltiplos
          </TabsTrigger>
          <TabsTrigger value="dcf">
            <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
            2. DCF
          </TabsTrigger>
          <TabsTrigger value="risk">
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            3. Risco & Sensibilidade
          </TabsTrigger>
          <TabsTrigger value="audit">
            <Calculator className="mr-1.5 h-3.5 w-3.5" />
            4. Auditoria
          </TabsTrigger>
        </TabsList>

        {/* MÚLTIPLOS */}
        <TabsContent value="multiples" className="mt-4 space-y-4">
          <section className="rounded-lg border border-border/60 bg-card/40 p-5">
            <SectionTitle hint="Múltiplos de mercado típicos para o setor. Você pode customizar ou selecionar um cenário.">
              Múltiplos Setoriais — {BUSINESS_LABEL[source.businessType]}
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
                min={-20}
                max={50}
                step={1}
                suffix="%"
                onChange={(v) => set({ controlPremium: v / 100 })}
                hint="Acréscimo no valor por posição de controle (típico 20-30% em transações M&A)."
              />
              <SliderField
                label="Desconto de Liquidez"
                value={params.liquidityDiscount * 100}
                min={0}
                max={50}
                step={1}
                suffix="%"
                onChange={(v) => set({ liquidityDiscount: v / 100 })}
                hint="Redução por iliquidez de participação minoritária em empresa fechada (típico 15-30%)."
              />
            </div>

            {/* Equity Value usa Dívida Líquida (Dívida − Caixa), não bruta. */}
            <div className="mt-5 grid grid-cols-3 gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  EV (múltiplos)
                </div>
                <div className="mono mt-1 text-lg font-semibold text-primary">
                  {fmtBRLCompact(valuation.multiplesDetails.blendedEnterpriseValue)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  − Dívida líquida
                </div>
                <div className="mono mt-1 text-lg font-semibold text-foreground">
                  {fmtBRLCompact(valuation.netDebt)}
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">
                  Dív. {fmtBRLCompact(totalDividaOnerosa(source))} − Caixa{" "}
                  {fmtBRLCompact(computeNetDebtParts(source).caixa)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  = Equity Value
                </div>
                <div className="mono mt-1 text-lg font-semibold text-pos">
                  {fmtBRLCompact(
                    Math.max(
                      0,
                      valuation.multiplesDetails.blendedEnterpriseValue - valuation.netDebt,
                    ),
                  )}
                </div>
              </div>
            </div>
          </section>
        </TabsContent>

        {/* DCF */}
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
                min={1}
                max={10}
                step={1}
                suffix=" anos"
                onChange={(v) => set({ horizonYears: v })}
                hint={`${params.horizonYears * 12} meses de projeção via Forecast.`}
              />
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  WACC (custo de capital)
                </div>
                <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 text-center">
                  <div className="mono text-xl font-semibold text-foreground">
                    {fmtNum(ind.wacc, 2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {ind.wacc > 20 ? "⚠ elevado" : ind.wacc > 12 ? "moderado" : "baixo"} · vem da
                    aba Capital
                  </div>
                </div>
              </div>
              <SliderField
                label="Crescimento Terminal (g)"
                value={params.terminalGrowthRate * 100}
                min={0}
                max={5}
                step={0.25}
                suffix="% a.a."
                onChange={(v) => set({ terminalGrowthRate: v / 100 })}
                hint="Crescimento perpétuo pós-projeção (típico 2-3% para PMEs)."
              />
            </div>

            {params.terminalGrowthRate * 100 >= ind.wacc - 0.5 && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-neg/40 bg-neg/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-neg" />
                <span className="text-foreground">
                  Spread WACC − g abaixo de 0,5pp: perpetuidade de Gordon instável. A engine usa
                  fallback conservador (FCL × 5) — reduza g ou aumente WACC.
                </span>
              </div>
            )}

            {valuation.dcfDetails?.warnings && valuation.dcfDetails.warnings.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {valuation.dcfDetails.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3 text-xs"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--warning)]" />
                    <span className="text-foreground">{w}</span>
                  </div>
                ))}
              </div>
            )}

            {valuation.dcfDetails && (
              <div className="mt-5">
                <div className="text-xs font-semibold text-muted-foreground">
                  Detalhes da projeção
                </div>
                <table className="mt-2 w-full text-sm">
                  <tbody className="mono">
                    <tr className="border-b border-border/40">
                      <td className="py-2 text-muted-foreground">
                        VPN dos fluxos ({valuation.dcfDetails.horizonMonths} meses)
                      </td>
                      <td className="py-2 text-right">
                        {fmtBRLCompact(valuation.dcfDetails.npvFlows)}
                      </td>
                    </tr>
                    <tr className="border-b border-border/40">
                      <td className="py-2 text-muted-foreground">Valor terminal (VP)</td>
                      <td className="py-2 text-right">
                        {fmtBRLCompact(valuation.dcfDetails.npvTerminal)}
                      </td>
                    </tr>
                    <tr className="bg-primary/5">
                      <td className="py-2 font-semibold">Enterprise Value (DCF)</td>
                      <td className="py-2 text-right font-semibold text-primary">
                        {fmtBRLCompact(
                          valuation.dcfDetails.npvFlows + valuation.dcfDetails.npvTerminal,
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Método Múltiplos
                </div>
                <div className="mono mt-1 text-lg font-semibold text-primary">
                  {fmtBRLCompact(valuation.multiplesDetails.blendedEnterpriseValue)}
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Método DCF
                </div>
                <div className="mono mt-1 text-lg font-semibold text-pos">
                  {valuation.dcfDetails
                    ? fmtBRLCompact(
                        valuation.dcfDetails.npvFlows + valuation.dcfDetails.npvTerminal,
                      )
                    : "—"}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Se os métodos divergirem mais de 30%, revise premissas: crescimento, WACC ou múltiplos
              podem estar inconsistentes.
            </p>
          </section>

          <SensitivityMatrix
            wacc={ind.wacc}
            g={params.terminalGrowthRate * 100}
            fcfBase={valuation.dcfDetails?.fcfProjected.slice(-12).reduce((a, b) => a + b, 0) || 0}
          />
        </TabsContent>

        {/* RISCO */}
        <TabsContent value="risk" className="mt-4 space-y-4">
          <RiskPanel valuation={valuation} state={source} />
        </TabsContent>

        {/* AUDITORIA */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <AuditPanel trace={trace} onLogTrace={onLogTrace} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
