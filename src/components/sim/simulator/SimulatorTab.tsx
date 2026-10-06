import { memo, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { AppState, TaxRegime } from "@/engines/finance/types";
import {
  applySimulator,
  computeSimView,
  countActiveLevers,
  DEFAULT_SIM,
  PRESETS,
  SimDREView,
  SimulatorParams,
} from "@/engines/finance/simulator";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, fmtBRLCompact, fmtPct } from "@/engines/finance/format";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SectionTitle, HelpTip } from "@/components/sim/shared/primitives";
import { ForecastCard, MonteCarloCard } from "@/components/sim/analysis/AnalysisTab";
import { IndicatorsCard } from "@/components/sim/indicators/IndicatorsCard";
import { KanitzCard } from "@/components/sim/shared/KanitzCard";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  TriangleAlert,
  Wand2,
  Sparkles,
} from "lucide-react";
import { SIMPLES_LIMITE } from "@/engines/finance/taxDefaults";
import { sum } from "@/engines/finance/format";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

export function SimulatorTab({
  state,
  apply,
  params,
  setParams,
}: {
  state: AppState;
  apply: Updater;
  params?: SimulatorParams;
  setParams?: (p: SimulatorParams) => void;
}) {
  const [localP, setLocalP] = useState<SimulatorParams>(DEFAULT_SIM);
  const p = params ?? localP;
  const setP: (updater: SimulatorParams | ((cur: SimulatorParams) => SimulatorParams)) => void = (
    updater,
  ) => {
    const next =
      typeof updater === "function"
        ? (updater as (c: SimulatorParams) => SimulatorParams)(p)
        : updater;
    if (setParams) setParams(next);
    else setLocalP(next);
  };

  // S6: reaproveita o modelo central (verdade absoluta) — evita 1 rodada extra de buildDRE+ind+cf.
  const baseModel = useFinanceModel(state);
  const baseView = useMemo<SimDREView>(
    () =>
      computeSimView(state, {
        regime: baseModel.regime,
        dre: baseModel.dre,
        ind: baseModel.ind,
        cf: baseModel.cf,
      }),
    [state, baseModel.regime, baseModel.dre, baseModel.ind, baseModel.cf],
  );
  const simState = useMemo(() => applySimulator(state, p), [state, p]);
  const simView = useMemo<SimDREView>(() => computeSimView(simState), [simState]);

  const set = <K extends keyof SimulatorParams>(k: K, v: SimulatorParams[K]) =>
    setP((cur) => ({ ...cur, [k]: v }));
  const reset = () => setP(DEFAULT_SIM);
  const usePreset = (params: Partial<SimulatorParams>) => setP({ ...DEFAULT_SIM, ...params });

  const active = countActiveLevers(p);

  // Desenquadramento do Simples (mesma regra da página Regime Tributário)
  const rbAnual = useMemo(() => sum(state.revenue.bruta), [state.revenue.bruta]);
  const simplesLimite = state.tax.ratesOverride?.simplesLimite ?? SIMPLES_LIMITE;
  const desenquadradoSimples = rbAnual > simplesLimite;

  // Se override é "simples" mas o cenário ultrapassou o teto, força "base" (alinhado à página de Regime).
  useEffect(() => {
    if (desenquadradoSimples && p.regimeOverride === "simples") {
      setP((cur) => ({ ...cur, regimeOverride: "base" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desenquadradoSimples]);

  const inconsistencies: string[] = [];
  if (simView.lucroLiquido < 0) inconsistencies.push("Lucro líquido negativo no cenário simulado");
  if (simView.saldoCaixaFinal < 0)
    inconsistencies.push("Caixa final negativo — operação inviável sem captação");
  // Cobertura de juros null (sem dívida) → não é inconsistência.
  if (simView.coberturaJuros != null && simView.coberturaJuros < 1)
    inconsistencies.push(`Cobertura de juros < 1× (${simView.coberturaJuros.toFixed(1)}×)`);

  const applyToBase = () => {
    apply(() => simState);
  };

  return (
    <div className="space-y-4">
      {/* Barra de status */}
      <StatusBar
        active={active}
        base={baseView}
        sim={simView}
        inconsistencies={inconsistencies}
        onApply={applyToBase}
        onReset={reset}
      />

      {/* KPIs em tempo real — refletem o cenário simulado */}
      <KpiCardsRow base={baseView} sim={simView} />

      {/* Grid 2 colunas — DRE ocupa 1/2 da largura da página */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sliders */}
        <div className="space-y-3">
          <Accordion
            type="multiple"
            defaultValue={["trib", "receita", "custos", "giro", "divida"]}
            className="space-y-2"
          >
            <Group value="trib" title="Tributário">
              <div className="space-y-1">
                <div className="text-xs font-medium text-foreground">Mudar regime tributário</div>
                <Select
                  value={p.regimeOverride}
                  onValueChange={(v) => set("regimeOverride", v as TaxRegime | "base")}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="base">Manter regime atual ({state.tax.regime})</SelectItem>
                    <SelectItem value="simples" disabled={desenquadradoSimples}>
                      Simples Nacional{desenquadradoSimples ? " (desenquadrado)" : ""}
                    </SelectItem>
                    <SelectItem value="presumido">Lucro Presumido</SelectItem>
                    <SelectItem value="real">Lucro Real</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Group>

            <Group value="receita" title="Receita & Preço">
              <SliderRow
                label="Preço de venda"
                hint="Aumenta/reduz tabela. Custos variáveis não acompanham."
                min={-30}
                max={30}
                step={1}
                value={p.priceDeltaPct}
                onChange={(v) => set("priceDeltaPct", v)}
                suffix="%"
                current={`Receita atual: ${fmtBRLCompact(baseView.receitaBruta)}`}
                signed
              />
              <SliderRow
                label="Volume de vendas"
                hint="Receita + CPV variável acompanham. Mede alavancagem operacional."
                min={-50}
                max={50}
                step={1}
                value={p.volumeDeltaPct}
                onChange={(v) => set("volumeDeltaPct", v)}
                suffix="%"
                signed
              />
              <SliderRow
                label="Elasticidade-preço (|E|)"
                hint="Quanto o volume de vendas reage quando você mexe no preço. |E|=1 → cada +1% no preço derruba 1% do volume (neutro na receita). |E|<1 (inelástico, ex.: itens essenciais) → subir preço aumenta receita. |E|>1 (elástico, ex.: supérfluos) → subir preço reduz receita. Use 0 para ignorar o efeito e simular preço e volume de forma independente. Fórmula: Δvolume% = −|E| × Δpreço%. Ex.: |E|=1,2 e +10% no preço → −12% no volume."
                min={0}
                max={3}
                step={0.1}
                value={p.priceElasticity}
                onChange={(v) => set("priceElasticity", v)}
                suffix=""
                current={
                  p.priceDeltaPct !== 0 && p.priceElasticity > 0
                    ? `Volume induzido: ${(-p.priceElasticity * p.priceDeltaPct).toFixed(1)}%`
                    : "Desligada"
                }
              />
            </Group>

            <Group value="custos" title="Custos & Pessoal">
              <SliderRow
                label="CPV / insumos"
                hint="Multiplica todas as linhas de Custo de Vendas."
                min={-20}
                max={30}
                step={1}
                value={p.cpvDeltaPct}
                onChange={(v) => set("cpvDeltaPct", v)}
                suffix="%"
                signed
              />
              <SliderRow
                label="Folha (contratar/demitir equiv.)"
                hint="Multiplica linhas com encargos automáticos. + contrata, − demite."
                min={-30}
                max={30}
                step={1}
                value={p.payrollDeltaPct}
                onChange={(v) => set("payrollDeltaPct", v)}
                suffix="%"
                signed
              />
              <SliderRow
                label="Pró-labore (sócios)"
                hint="Escala apenas as linhas de pró-labore (subset da folha). Afeta DRE: aumenta despesa de pessoal, reduz EBITDA, LAIR e Lucro Líquido. Também altera INSS do sócio e IRPF na ficha tributária. + aumenta retirada via folha, − reduz."
                min={-50}
                max={50}
                step={1}
                value={p.prolaboreDeltaPct}
                onChange={(v) => set("prolaboreDeltaPct", v)}
                suffix="%"
                signed
              />
              <SliderRow
                label="Distribuição de lucros"
                hint="Escala a distribuição realizada aos sócios. NÃO afeta DRE (é destinação do lucro líquido, pós-imposto), mas IMPACTA o CAIXA: + reduz saldo de caixa, − preserva caixa. Lembre-se: distribuição só é isenta de IR até o limite presumido."
                min={-100}
                max={200}
                step={5}
                value={p.distribuicaoDeltaPct}
                onChange={(v) => set("distribuicaoDeltaPct", v)}
                suffix="%"
                signed
              />

              <SliderRow
                label="Cortar custos fixos (top-N)"
                hint="Aplica corte percentual nas N maiores rubricas fixas."
                min={0}
                max={50}
                step={1}
                value={p.fixedCutPct}
                onChange={(v) => set("fixedCutPct", v)}
                suffix="%"
              />
              <div className="flex items-center gap-2 pl-1 text-[11px] text-muted-foreground">
                Top N atingidos:
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={p.fixedCutTopN}
                  onChange={(e) =>
                    set("fixedCutTopN", Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))
                  }
                  className="h-7 w-16"
                />
              </div>
            </Group>

            <Group value="giro" title="Capital de Giro">
              <SliderRow
                label={`Reduzir PMR (atual ${state.revenue.pmr}d)`}
                hint="Acelera entrada de caixa. Negociação ou política comercial."
                min={-60}
                max={0}
                step={1}
                value={p.pmrDeltaDays}
                onChange={(v) => set("pmrDeltaDays", v)}
                suffix="d"
              />
              <SliderRow
                label={`Aumentar PMP (atual ${state.revenue.pmp}d)`}
                hint="Posterga saídas sem mudar custo total."
                min={0}
                max={60}
                step={1}
                value={p.pmpDeltaDays}
                onChange={(v) => set("pmpDeltaDays", v)}
                suffix="d"
              />
              <SliderRow
                label="Antecipação de recebíveis (custo)"
                hint="Adiciona despesa financeira e acelera entrada de caixa (PMR ↓ até 20 dias)."
                min={0}
                max={6}
                step={0.1}
                value={p.antecipPctAm}
                onChange={(v) => set("antecipPctAm", v)}
                suffix="% a.m."
              />
              <SliderRow
                label="Inadimplência (variação)"
                hint="Soma pontos percentuais à inadimplência mensal — reduz receita líquida e caixa."
                min={-5}
                max={10}
                step={0.5}
                value={p.inadimplenciaDeltaPp}
                onChange={(v) => set("inadimplenciaDeltaPp", v)}
                suffix=" p.p."
                signed
              />
            </Group>

            <Group value="divida" title="Dívida & Juros">
              <div className="space-y-2 rounded-md border border-border/40 bg-background/30 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Captar empréstimo
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <NumInput
                    label="Principal (R$)"
                    value={p.loanPrincipal}
                    onChange={(v) => set("loanPrincipal", v)}
                    step={1000}
                    min={0}
                  />
                  <NumInput
                    label="Prazo (meses)"
                    value={p.loanTermMonths}
                    onChange={(v) => set("loanTermMonths", Math.max(1, Math.min(60, v)))}
                    step={1}
                    min={1}
                  />
                  <NumInput
                    label="Taxa (% a.m.)"
                    value={p.loanRatePctAm}
                    onChange={(v) => set("loanRatePctAm", Math.max(0, v))}
                    step={0.1}
                    min={0}
                  />
                </div>
              </div>
              <SliderRow
                label="Quitar dívida (% do principal)"
                hint="Reduz dívida e juros futuros; consome caixa equivalente."
                min={0}
                max={100}
                step={5}
                value={p.debtPaydownPct}
                onChange={(v) => set("debtPaydownPct", v)}
                suffix="%"
              />
              <SliderRow
                label={`Variar kd (atual ${state.capital.kd.toFixed(1)}% a.a.)`}
                hint="Selic sobe/cai: ajusta custo da dívida e proporcionalmente as despesas de juros."
                min={-5}
                max={5}
                step={0.25}
                value={p.kdDeltaPp}
                onChange={(v) => set("kdDeltaPp", v)}
                suffix=" p.p."
                signed
              />
            </Group>
          </Accordion>
        </div>

        {/* DRE + Kanitz (coluna direita) */}
        <div className="lg:sticky lg:top-[72px] lg:h-fit space-y-4">
          <DREPanel base={baseView} sim={simView} inconsistencies={inconsistencies} />
          {/* Termômetro de Insolvência (Kanitz) — reativo às alavancas do simulador */}
          <KanitzCard state={simState} />
        </div>
      </div>

      {/* Projeções refletindo o cenário simulado */}
      <div className="space-y-4 border-t border-border/60 pt-6">
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border-l-4 border-amber-500 bg-amber-500/10 p-4 text-sm text-foreground shadow-sm"
        >
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
          <div>
            <div className="font-semibold text-amber-700 dark:text-amber-400">
              Atenção — Cenário Simulado
            </div>
            <div className="mt-1 text-muted-foreground">
              As análises abaixo refletem o cenário{" "}
              <strong className="text-foreground">simulado</strong> acima. Sem ajustes nos sliders,
              elas representam o cenário base atual do sistema.
            </div>
          </div>
        </div>
        <IndicatorsCard state={simState} />
        <ForecastCard state={simState} />
        <MonteCarloCard state={simState} />
      </div>
    </div>
  );
}

// ============== Status bar ==============

const StatusBar = memo(function StatusBar({
  active,
  base,
  sim,
  inconsistencies,
  onApply,
  onReset,
}: {
  active: number;
  base: SimDREView;
  sim: SimDREView;
  inconsistencies: string[];
  onApply: () => void;
  onReset: () => void;
}) {
  const dEbitda = pctDelta(base.ebitda, sim.ebitda);
  const dLL = pctDelta(base.lucroLiquido, sim.lucroLiquido);
  const dCaixa = sim.saldoCaixaFinal - base.saldoCaixaFinal;
  const dValuation = pctDelta(base.enterpriseValue, sim.enterpriseValue);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 shadow-sm ring-1 ring-primary/20">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2 pr-2 border-r border-border/40">
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
          <span className="font-bold text-primary uppercase tracking-tighter">
            Impacto Estratégico
          </span>
        </div>
        <Delta label="EBITDA" value={dEbitda} suffix="%" />
        <Delta label="Caixa" value={dCaixa} currency />
        <Delta label="Valuation (EV)" value={dValuation} suffix="%" highlight />
        {inconsistencies.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-[var(--destructive)]/15 px-2 py-1 text-neg">
            <TriangleAlert className="h-3 w-3" /> {inconsistencies.length} alerta
            {inconsistencies.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          className="h-8 justify-start sm:justify-center"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Resetar
        </Button>
        <Button
          size="sm"
          onClick={onApply}
          disabled={active === 0}
          className="h-8 justify-start sm:justify-center"
        >
          Aplicar ao cenário base
        </Button>
      </div>
    </div>
  );
});

function Delta({
  label,
  value,
  suffix,
  currency,
  highlight,
}: {
  label: string;
  value: number;
  suffix?: string;
  currency?: boolean;
  highlight?: boolean;
}) {
  const pos = value > 0.01;
  const neg = value < -0.01;
  const tone = highlight
    ? pos
      ? "bg-primary text-primary-foreground px-1.5 py-0.5 rounded shadow-sm"
      : "bg-neg text-white px-1.5 py-0.5 rounded"
    : pos
      ? "text-pos"
      : neg
        ? "text-neg"
        : "text-muted-foreground";
  const Icon = pos ? ArrowUpRight : neg ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground font-medium">{label}:</span>
      <span className={`mono inline-flex items-center font-bold ${tone}`}>
        {!highlight && <Icon className="h-3 w-3" />}
        {currency
          ? fmtBRLCompact(value)
          : `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix ?? ""}`}
      </span>
    </span>
  );
}

// ============== Slider row ==============

const SliderRow = memo(function SliderRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
  current,
  signed,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  current?: string;
  signed?: boolean;
}) {
  const display =
    signed && value > 0 ? `+${value.toFixed(step < 1 ? 2 : 0)}` : value.toFixed(step < 1 ? 2 : 0);
  return (
    <div className="space-y-1.5 rounded-md border border-border/40 bg-background/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {label}
          {hint && <HelpTip text={hint} />}
        </div>
        <div className="mono rounded border border-border/60 bg-input/40 px-2 py-0.5 text-xs">
          {display}
          {suffix ?? ""}
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(a) => onChange(a[0])}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          {min}
          {suffix ?? ""}
        </span>
        {current && <span>{current}</span>}
        <span>
          {max > 0 ? "+" : ""}
          {max}
          {suffix ?? ""}
        </span>
      </div>
    </div>
  );
});

function NumInput({
  label,
  value,
  onChange,
  step,
  min,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  min: number;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <Input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-8"
      />
    </div>
  );
}

function Group({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="rounded-lg border border-border/60 bg-card/30">
      <AccordionTrigger className="px-4 py-2.5 text-sm font-semibold hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent className="space-y-2 px-4 pb-4 pt-1">{children}</AccordionContent>
    </AccordionItem>
  );
}

// ============== DRE Panel ==============

function DREPanel({
  base,
  sim,
  inconsistencies,
}: {
  base: SimDREView;
  sim: SimDREView;
  inconsistencies: string[];
}) {
  const rows: {
    label: string;
    b: number;
    s: number;
    bold?: boolean;
    sign?: -1 | 1;
    hint?: string;
    formula?: string;
  }[] = [
    {
      label: "(+) Receita Operacional Bruta",
      b: base.receitaBruta,
      s: sim.receitaBruta,
      bold: true,
      hint: "Total faturado no período antes de qualquer dedução. Inclui mercadorias, produtos e serviços. Base para o cálculo de tributos sobre vendas.",
      formula: "Σ (Preço × Quantidade vendida) — todas as linhas de receita",
    },
    {
      label: "(−) Devoluções e Cancelamentos",
      b: -base.devolucoesCancelamentos,
      s: -sim.devolucoesCancelamentos,
      sign: -1,
      hint: "Vendas canceladas ou produtos devolvidos pelos clientes. Reduzem a Receita Bruta para apuração da Receita Líquida (CPC 47 / Lei 6.404).",
    },
    {
      label: "(−) Descontos Incondicionais",
      b: -base.descontosIncondicionais,
      s: -sim.descontosIncondicionais,
      sign: -1,
      hint: "Descontos concedidos na nota fiscal, sem condição posterior (ex.: desconto à vista). Diferente do desconto financeiro, que é despesa.",
    },
    {
      label: "(−) Abatimentos",
      b: -base.abatimentos,
      s: -sim.abatimentos,
      sign: -1,
      hint: "Reduções de preço após a venda por defeito, atraso ou avaria. Lançadas como redutoras da Receita Bruta.",
    },
    {
      label: "(−) Tributos sobre Receita",
      b: -base.tributosReceita,
      s: -sim.tributosReceita,
      sign: -1,
      hint: "ICMS, ISS, PIS e COFINS (e, na transição, CBS/IBS — LC 214/2025). Incidem sobre a Receita Bruta e variam conforme o regime tributário.",
      formula: "Receita Bruta × alíquota efetiva do regime",
    },
    {
      label: "(=) Receita Operacional Líquida",
      b: base.receitaLiquida,
      s: sim.receitaLiquida,
      bold: true,
      hint: "Receita efetivamente disponível para cobrir custos e gerar lucro. Base de comparação para margens (bruta, EBITDA, líquida).",
      formula: "Receita Bruta − Devoluções − Descontos − Abatimentos − Tributos",
    },
    {
      label: "(−) CPV / CMV / CSP",
      b: -base.cpv,
      s: -sim.cpv,
      sign: -1,
      hint: "Custo dos Produtos Vendidos (indústria), Mercadorias (comércio) ou Serviços Prestados. Inclui matéria-prima, mão de obra direta e custos diretos de produção/aquisição.",
    },
    {
      label: "(=) LUCRO BRUTO",
      b: base.lucroBruto,
      s: sim.lucroBruto,
      bold: true,
      hint: "Quanto sobra da receita após pagar o custo direto do que foi vendido. Indica a eficiência da operação produtiva/comercial.",
      formula: "Receita Líquida − CPV",
    },
    {
      label: "(−) Despesas Comerciais",
      b: -base.despesasComerciais,
      s: -sim.despesasComerciais,
      sign: -1,
      hint: "Gastos para vender: comissões, marketing, frete de entrega, propaganda, equipe comercial. DRE por Função (CPC 26).",
    },
    {
      label: "(−) Despesas Administrativas",
      b: -base.despesasAdministrativas,
      s: -sim.despesasAdministrativas,
      sign: -1,
      hint: "Gastos para administrar o negócio: aluguel, escritório, contabilidade, salários administrativos, sistemas. DRE por Função (CPC 26).",
    },
    {
      label: "(±) Outras Despesas/Receitas Operacionais",
      b: base.outrasOperacionais,
      s: sim.outrasOperacionais,
      hint: "Inclui Depreciação & Amortização (D&A) como redutor e outras receitas operacionais não recorrentes. D&A é despesa contábil sem saída de caixa.",
    },
    {
      label: "(=) LUCRO OPERACIONAL / EBIT",
      b: base.ebit,
      s: sim.ebit,
      bold: true,
      hint: "Resultado da operação antes de juros e impostos. Mede a capacidade do negócio gerar lucro independentemente da estrutura de capital.",
      formula: "Lucro Bruto − Despesas Comerciais − Administrativas ± Outras Op.",
    },
    {
      label: "(+) Receitas Financeiras",
      b: base.receitasFinanceiras,
      s: sim.receitasFinanceiras,
      hint: "Rendimentos de aplicações, juros recebidos, descontos obtidos em pagamentos. Não fazem parte da operação principal.",
    },
    {
      label: "(±) Ganho/Perda em alienação de ativos",
      b: base.ganhoAlienacao,
      s: sim.ganhoAlienacao,
      hint: "Resultado da venda de imobilizado (máquinas, veículos, imóveis). Evento não recorrente — separado do lucro operacional.",
    },
    {
      label: "(=) LUCRO ANTES DO FINANC. E TRIBUTOS",
      b: base.laft,
      s: sim.laft,
      bold: true,
      hint: "EBIT + Receitas Financeiras + Ganho na alienação. Linha intermediária antes de subtrair as despesas financeiras.",
    },
    {
      label: "(−) Despesas Financeiras",
      b: -base.despesasFinanceiras,
      s: -sim.despesasFinanceiras,
      sign: -1,
      hint: "Juros pagos sobre empréstimos, financiamentos, cheque especial, antecipação de recebíveis e custos bancários.",
    },
    {
      label: "(=) LUCRO ANTES DO IR/CSLL (EBT)",
      b: base.lair,
      s: sim.lair,
      bold: true,
      hint: "Lucro antes do Imposto de Renda (IR) e Contribuição Social sobre o Lucro Líquido (CSLL). Base para apuração no Lucro Real.",
    },
    {
      label: "(−) IR / CSLL",
      b: -base.impostos,
      s: -sim.impostos,
      sign: -1,
      hint: "Imposto de Renda Pessoa Jurídica (IRPJ 15% + adicional 10%) e CSLL (9%). Cálculo depende do regime: Real, Presumido ou Simples.",
    },
    {
      label: "(=) LUCRO LÍQUIDO DO EXERCÍCIO",
      b: base.lucroLiquido,
      s: sim.lucroLiquido,
      bold: true,
      hint: "Resultado final disponível para distribuir aos sócios ou reinvestir. Base para Margem Líquida, ROE e distribuição de dividendos.",
      formula: "EBT − IR/CSLL",
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4">
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <SectionTitle>DRE · Anual</SectionTitle>
        <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
          Base × Simulado
        </span>
      </div>
      <div className="overflow-x-auto scrollbar-none">
        <table className="w-full text-[clamp(0.65rem,1vw+0.35rem,0.75rem)] table-fixed">
          <colgroup>
            <col className="w-[110px] sm:w-auto" />
            <col className="w-[95px] sm:w-[115px]" />
            <col className="w-[95px] sm:w-[115px]" />
            <col className="w-[55px] sm:w-[65px]" />
          </colgroup>

          <thead>
            <tr className="text-[9px] sm:text-[10px] uppercase text-muted-foreground">
              <th className="pb-1 text-left font-medium">Linha</th>
              <th className="pb-1 pl-2 text-right font-medium">Base</th>
              <th className="pb-1 pl-2 text-right font-medium">Simulado</th>
              <th className="pb-1 pl-2 text-right font-medium">Δ%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Para linhas de despesa (sign=-1), `r.b`/`r.s` já vêm negados
              // para exibição contábil. O Δ% dessas linhas DEVE refletir a
              // variação do gasto BRUTO (ex.: CPV subiu de 100 → 150 = +50%,
              // não −50%). Sem isto, a coloração invertia: aumento de despesa
              // aparecia como verde ("melhorou").
              const isExpense = (r.sign ?? 1) < 0;
              const d = isExpense ? pctDelta(Math.abs(r.b), Math.abs(r.s)) : pctDelta(r.b, r.s);
              const goodIsUp = !isExpense; // despesa: cair é bom
              const tone =
                Math.abs(d) < 0.05
                  ? ""
                  : goodIsUp
                    ? d > 0
                      ? "text-pos"
                      : "text-neg"
                    : d < 0
                      ? "text-pos"
                      : "text-neg";
              return (
                <tr
                  key={r.label}
                  className={`border-b border-border/20 last:border-0 ${r.bold ? "font-semibold" : ""}`}
                >
                  <td className="py-1.5 truncate">
                    <span className="inline-flex items-center gap-1">
                      <span className="truncate">{r.label}</span>
                      {r.hint && <HelpTip text={r.hint} formula={r.formula} />}
                    </span>
                  </td>

                  <td className="py-1.5 pl-2 text-right mono text-muted-foreground">
                    {fmtBRLCompact(r.b)}
                  </td>
                  <td className={`py-1.5 pl-2 text-right mono ${r.bold ? "" : ""}`}>
                    {fmtBRLCompact(r.s)}
                  </td>
                  <td className={`py-1.5 pl-2 text-right mono ${tone}`}>
                    {Math.abs(d) < 0.05 ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/40 pt-3 text-xs">
        <Kpi
          label="Margem Líquida"
          base={`${base.margemLiquida.toFixed(1)}%`}
          sim={`${sim.margemLiquida.toFixed(1)}%`}
          better={sim.margemLiquida >= base.margemLiquida}
        />
        <Kpi
          label="Margem EBITDA"
          base={`${base.margemEbitda.toFixed(1)}%`}
          sim={`${sim.margemEbitda.toFixed(1)}%`}
          better={sim.margemEbitda >= base.margemEbitda}
        />
        <Kpi
          label="ROIC"
          base={fmtPct(base.roic / 100)}
          sim={fmtPct(sim.roic / 100)}
          better={sim.roic >= base.roic}
        />
        <Kpi
          label="Saldo Caixa Final"
          base={fmtBRLCompact(base.saldoCaixaFinal)}
          sim={fmtBRLCompact(sim.saldoCaixaFinal)}
          better={sim.saldoCaixaFinal >= base.saldoCaixaFinal}
        />
        <Kpi
          label="Pior mês de caixa"
          base={fmtBRLCompact(base.piorMesCaixa)}
          sim={fmtBRLCompact(sim.piorMesCaixa)}
          better={sim.piorMesCaixa >= base.piorMesCaixa}
        />
        <Kpi
          label="NCG"
          base={fmtBRLCompact(base.ncg)}
          sim={fmtBRLCompact(sim.ncg)}
          better={sim.ncg <= base.ncg}
        />
        <Kpi
          label="Valuation (EV)"
          base={fmtBRLCompact(base.enterpriseValue)}
          sim={fmtBRLCompact(sim.enterpriseValue)}
          better={sim.enterpriseValue >= base.enterpriseValue}
          highlight
        />
      </div>

      {inconsistencies.length > 0 && (
        <div className="rounded-md border border-[var(--destructive)]/60 bg-[var(--destructive)]/10 p-2 text-[11px] text-neg">
          <div className="mb-1 flex items-center gap-1 font-semibold">
            <TriangleAlert className="h-3 w-3" /> Atenção:
          </div>
          <ul className="space-y-0.5">
            {inconsistencies.map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  base,
  sim,
  better,
  highlight,
}: {
  label: string;
  base: string;
  sim: string;
  better: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded border p-2 transition-all",
        highlight
          ? "border-primary/40 bg-primary/5 shadow-sm"
          : "border-border/40 bg-background/30",
      )}
    >
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
        <span className={cn("mono text-sm font-bold", better ? "text-pos" : "text-neg")}>
          {sim}
        </span>
        <span className="mono text-[9px] text-muted-foreground line-through opacity-70">
          {base}
        </span>
      </div>
    </div>
  );
}

function pctDelta(a: number, b: number): number {
  if (Math.abs(a) < 1e-6) return b === 0 ? 0 : b > 0 ? 100 : -100;
  return ((b - a) / Math.abs(a)) * 100;
}

// ============== KPI Cards (tempo real) ==============
// Cards de topo do Simulador: Faturamento, Lucro Líquido, EBITDA (DRE)
// + NCG e Gap de Capital de Giro (Indicadores). Reagem instantaneamente
// às alavancas — mesma dinâmica dos KPIs comparativos já presentes no painel DRE.

const KpiCardsRow = memo(function KpiCardsRow({
  base,
  sim,
}: {
  base: SimDREView;
  sim: SimDREView;
}) {
  const items: {
    label: string;
    baseV: number;
    simV: number;
    /** true: maior é melhor; false: menor é melhor (NCG/Gap). */
    higherIsBetter: boolean;
    hint: string;
    formula?: string;
  }[] = [
    {
      label: "Faturamento",
      baseV: base.receitaBruta,
      simV: sim.receitaBruta,
      higherIsBetter: true,
      hint: "Receita Operacional Bruta anual — total faturado antes de devoluções, descontos e tributos. Reage em tempo real às alavancas de Preço, Volume e Elasticidade.",
      formula: "Σ (Preço × Quantidade) nos 12 meses",
    },
    {
      label: "Lucro Líquido",
      baseV: base.lucroLiquido,
      simV: sim.lucroLiquido,
      higherIsBetter: true,
      hint: "Resultado final após todos os custos, despesas, juros e tributos (IR/CSLL). É o lucro disponível para distribuir aos sócios ou reinvestir.",
      formula: "EBT − IR/CSLL",
    },
    {
      label: "EBITDA",
      baseV: base.ebitda,
      simV: sim.ebitda,
      higherIsBetter: true,
      hint: "Lucro antes de juros, impostos, depreciação e amortização. Proxy de geração de caixa operacional — neutraliza efeitos de estrutura de capital e contabilidade.",
      formula: "EBIT + Depreciação + Amortização",
    },
    {
      label: "NCG",
      baseV: base.ncg,
      simV: sim.ncg,
      higherIsBetter: false,
      hint: "Necessidade de Capital de Giro — quanto de dinheiro a operação precisa para girar (financiar clientes e estoque, descontando o crédito de fornecedores). Quanto menor, melhor.",
      formula: "(Clientes + Estoque) − Fornecedores",
    },
    {
      label: "Gap de Capital de Giro",
      baseV: base.gapCapitalGiro,
      simV: sim.gapCapitalGiro,
      higherIsBetter: false,
      hint: "Diferença entre a NCG e o Capital de Giro disponível. Positivo = a empresa precisa captar para financiar a operação. Negativo = sobra de caixa operacional.",
      formula: "NCG − Capital de Giro Próprio",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => {
        const delta = pctDelta(it.baseV, it.simV);
        const improved = it.higherIsBetter ? it.simV >= it.baseV : it.simV <= it.baseV;
        const flat = Math.abs(delta) < 0.05;
        const tone = flat ? "text-muted-foreground" : improved ? "text-pos" : "text-neg";
        const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
        return (
          <div
            key={it.label}
            className="rounded-lg border border-border/60 bg-card/60 p-3 shadow-sm transition-all"
          >
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              <span>{it.label}</span>
              <HelpTip text={it.hint} formula={it.formula} />
            </div>

            <div className="mt-1 mono text-base sm:text-lg font-bold text-foreground">
              {fmtBRLCompact(it.simV)}
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="mono text-[10px] text-muted-foreground line-through opacity-70">
                {fmtBRLCompact(it.baseV)}
              </span>
              <span
                className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold", tone)}
              >
                <Icon className="h-3 w-3" />
                {flat ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
});
