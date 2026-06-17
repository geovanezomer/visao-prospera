import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { toast } from "sonner";
import { AppState } from "@/engines/finance/types";
import { fmtBRL, fmtBRLCompact, MESES, sum } from "@/engines/finance/format";
import { buildCashFlow } from "@/engines/finance/cashflow";
import { MoneyInput, SectionTitle, StatCard, HelpTip } from "./primitives";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Estilo padrão do tooltip dos gráficos (DRY)
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;
const TOOLTIP_ITEM = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--popover-foreground)", fontWeight: 600 } as const;

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;
type NonOpKey = "aportes" | "emprestimosCaptados" | "capex" | "dividendos" | "amortizacoes";

export function CashflowTab() {
  const { state, update } = useFinance();
  // B1/B4: regime efetivo agora é default em buildCashFlow; memoizar o resultado pesado.
  const cf = useMemo(() => buildCashFlow(state), [state]);

  const setCaixaMin = useCallback(
    (v: number) => update((s) => ({ ...s, cashflow: { ...s.cashflow, caixaMinimo: v } })),
    [update],
  );

  const limiar = state.cashflow.limiarAlerta ?? -10000;
  const setLimiar = useCallback(
    (v: number) => update((s) => ({ ...s, cashflow: { ...s.cashflow, limiarAlerta: v } })),
    [update],
  );

  // B4: memos para cálculos derivados que rodavam a cada render
  const mesesCriticos = useMemo(
    () => MESES
      .map((mes, i) => ({ mes, saldo: cf.saldoFinal[i], idx: i }))
      .filter((m) => m.saldo <= limiar),
    [cf.saldoFinal, limiar],
  );

  // B8: chave estável para o useEffect
  const mesesCriticosKey = useMemo(
    () => mesesCriticos.map((m) => `${m.mes}:${m.saldo}`).join("|"),
    [mesesCriticos],
  );

  // Toast discreto quando há novo mês crítico
  const lastNotifiedRef = useRef<string>("");
  useEffect(() => {
    if (mesesCriticos.length === 0) {
      lastNotifiedRef.current = "";
      return;
    }
    const key = mesesCriticos.map((m) => m.mes).join(",");
    if (key !== lastNotifiedRef.current) {
      lastNotifiedRef.current = key;
      const primeiro = mesesCriticos[0];
      toast.warning(`Atenção — saldo projetado cai abaixo do limiar em ${primeiro.mes}`, {
        description: `Saldo previsto: ${fmtBRL(primeiro.saldo)} · Limiar: ${fmtBRL(limiar)}`,
      });
    }
  }, [mesesCriticosKey, limiar, mesesCriticos]);

  const setNonOp = useCallback(
    (key: NonOpKey, monthIdx: number, value: number) =>
      update((s) => ({
        ...s,
        cashflow: {
          ...s.cashflow,
          [key]: s.cashflow[key].map((v, i) => (i === monthIdx ? value : v)),
        },
      })),
    [update],
  );

  const setNonOpAll = useCallback(
    (key: NonOpKey, v: number) =>
      update((s) => ({ ...s, cashflow: { ...s.cashflow, [key]: MESES.map(() => v) } })),
    [update],
  );

  // B3: usar cf.alertas e cf.totais.pioresMes (já calculados pela engine)
  const alertas = cf.alertas;
  const piorMes = cf.totais.pioresMes;

  // Mapa de meses críticos: para destacar pontos no gráfico.
  const criticalByMes = useMemo(() => {
    const map: Record<string, "negativo" | "abaixoMinimo"> = {};
    alertas.forEach((a) => {
      if (map[a.mes] !== "negativo") map[a.mes] = a.tipo;
    });
    return map;
  }, [alertas]);

  const chart = useMemo(
    () => MESES.map((m, i) => ({
      mes: m,
      saldo: cf.saldoFinal[i],
      minimo: state.cashflow.caixaMinimo,
      critical: criticalByMes[m] ?? null,
    })),
    [cf.saldoFinal, state.cashflow.caixaMinimo, criticalByMes],
  );

  const burnRunway = useMemo(
    () => {
      // Inline da lógica para evitar import adicional; mantém engine como fonte
      const burnMensal = cf.fluxoOperacional.map((v) => -v);
      const burnMedio12 = burnMensal.reduce((a, b) => a + b, 0) / 12;
      const burnMedio3 = burnMensal.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const colchao = state.capital.disponibilidades + (state.capital.contasReceber || 0);
      const queimando = burnMedio3 > 0;
      const runwayMeses = queimando ? colchao / burnMedio3 : Infinity;
      return { burnMedio12, burnMedio3, runwayMeses, queimando };
    },
    [cf.fluxoOperacional, state.capital.disponibilidades, state.capital.contasReceber],
  );

  const caixaAtual = state.capital.disponibilidades;
  const recebiveis = state.capital.contasReceber || 0;
  const runwayLabel = !burnRunway.queimando
    ? "∞ (operação gera caixa)"
    : burnRunway.runwayMeses >= 24
    ? "24+ meses"
    : `${burnRunway.runwayMeses.toFixed(1)} meses`;
  const runwayTone: "pos" | "neg" | "warn" =
    !burnRunway.queimando ? "pos" : burnRunway.runwayMeses >= 12 ? "pos" : burnRunway.runwayMeses >= 6 ? "warn" : "neg";

  // Top 3 meses mais críticos: menores saldos do ano (independente de bater o mínimo).
  const top3Criticos = useMemo(
    () => MESES
      .map((mes, i) => ({
        mes,
        saldo: cf.saldoFinal[i],
        deficitVsMin: state.cashflow.caixaMinimo - cf.saldoFinal[i],
      }))
      .sort((a, b) => a.saldo - b.saldo)
      .slice(0, 3),
    [cf.saldoFinal, state.cashflow.caixaMinimo],
  );

  // B5: tone do "Saldo final (Dez)" reflete o PRÓPRIO valor de dez, não outros meses
  const saldoDez = cf.totais.saldoFinal;
  const saldoDezTone: "pos" | "neg" | "warn" =
    saldoDez < 0 ? "neg" : saldoDez < state.cashflow.caixaMinimo ? "warn" : "pos";




  return (
    <div className="space-y-6">
      {mesesCriticos.length > 0 && (
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Saldo ≤ {fmtBRL(limiar)} em {mesesCriticos.map((m) => m.mes).join(", ")}
          </Badge>
        </div>
      )}
      {/* Sumário */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Recebimentos no ano"
          value={fmtBRL(cf.totais.recebimentos)}
          tone="pos"
          hint={{ description: "Total efetivamente recebido em caixa no ano, já descontada a inadimplência e respeitando o PMR (prazo médio de recebimento).", formula: "Σ Recebimentos mensais (Receita Líquida defasada pelo PMR)" }}
        />
        <StatCard
          label="Despesas no ano"
          value={fmtBRL(cf.totais.pagamentosTotais)}
          tone="neg"
          hint={{ description: "Total de saídas operacionais de caixa no ano: fornecedores (PMP), custos fixos e variáveis, despesas financeiras e impostos pagos (defasados em 1 mês).", formula: "Σ (Fornecedores + Fixos + Variáveis + Financeiros + Impostos)" }}
        />
        <StatCard
          label="Fluxo Operacional"
          value={fmtBRL(cf.totais.fluxoOperacional)}
          tone={cf.totais.fluxoOperacional >= 0 ? "pos" : "neg"}
          hint={{ description: "Caixa gerado (ou consumido) pela operação no ano. Já considera PMR/PMP e impostos pagos com 1 mês de defasagem.", formula: "Recebimentos − Pagamentos Operacionais − Impostos pagos" }}
        />
        <StatCard
          label="Variação total de caixa"
          value={fmtBRL(cf.totais.variacao)}
          tone={cf.totais.variacao >= 0 ? "pos" : "neg"}
          
          hint={{ description: "Quanto o caixa cresceu (ou caiu) no ano somando os 3 fluxos: operação, investimentos e financiamentos.", formula: "Fluxo Operacional + Fluxo de Investimento + Fluxo de Financiamento" }}
        />
        <div className="relative">
          {mesesCriticos.length > 0 && (
            <Badge variant="destructive" className="absolute right-2 top-2 z-10 gap-1">
              <AlertTriangle className="h-3 w-3" />
              Crítico
            </Badge>
          )}
          <StatCard
            label="Saldo final (Dez)"
            value={fmtBRL(saldoDez)}
            tone={saldoDezTone}
            sub={piorMes ? `Pior mês: ${piorMes.mes} = ${fmtBRL(piorMes.saldo)}` : undefined}
            hint={{ description: "Saldo de caixa projetado para dezembro. Deve ficar acima do caixa mínimo de segurança definido na configuração.", formula: "Saldo Inicial + Σ Variações mensais de caixa" }}
          />
        </div>
      </div>




      {/* Movimentações de caixa não operacionais — tabela estilo Receitas/Despesas */}
      <div className="rounded-lg border border-border/60 border-l-4 border-l-[color:var(--primary)] bg-card/40">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <SectionTitle hint="Edite aqui CapEx, aportes, captações, amortizações e dividendos. Os valores alimentam automaticamente as linhas de investimento e financiamento na DFC abaixo.">
            Movimentações de caixa não operacionais — 12 meses
          </SectionTitle>
        </div>
        <NonOpTable
          rows={[
            { key: "capex", label: "CapEx — aportes em ativo fixo", hint: "Saída de caixa para compra de máquinas, equipamentos, obras, software.", tone: "neg", values: state.cashflow.capex },
            { key: "aportes", label: "Aportes de sócios", hint: "Entrada de capital próprio dos sócios na empresa.", tone: "pos", values: state.cashflow.aportes },
            { key: "emprestimosCaptados", label: "Captação de empréstimos", hint: "Entrada de caixa por novas linhas de crédito tomadas no período.", tone: "pos", values: state.cashflow.emprestimosCaptados },
            { key: "amortizacoes", label: "Amortização de principal", hint: "Pagamento da parcela de principal de dívidas (não confundir com juros, que já entram em Despesas financeiras).", tone: "neg", values: state.cashflow.amortizacoes },
            { key: "dividendos", label: "Distribuição de dividendos", hint: "Saída de caixa para distribuir lucros aos sócios.", tone: "neg", values: state.cashflow.dividendos },
          ]}
          onMonth={setNonOp}
          onAllMonths={setNonOpAll}
        />
      </div>

      {/* Tabela detalhada */}
      <DFCTable state={state} cf={cf} />

      {/* Resumo: 3 meses mais críticos */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">3 meses mais críticos do ano</h4>
          <span className="text-[10px] text-muted-foreground">menor saldo projetado · déficit vs. caixa mínimo</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {top3Criticos.map((c, idx) => {
            const negativo = c.saldo < 0;
            const abaixoMin = !negativo && c.saldo < state.cashflow.caixaMinimo;
            const tone = negativo ? "var(--destructive)" : abaixoMin ? "var(--warning)" : "var(--success)";
            const status = negativo ? "Caixa negativo" : abaixoMin ? "Abaixo do mínimo" : "Dentro do mínimo";
            return (
              <div
                key={c.mes}
                className="rounded-md border bg-background/40 p-3"
                style={{ borderColor: `color-mix(in oklab, ${tone} 40%, transparent)` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-[10px] font-bold text-muted-foreground">
                      {idx + 1}º
                    </span>
                    <span className="text-sm font-semibold">{c.mes}</span>
                  </div>
                  <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: tone }}>
                    {status}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Saldo</div>
                    <div className="num font-semibold" style={{ color: tone }}>{fmtBRL(c.saldo)}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Déficit vs. mín.</div>
                    <div className={`num font-semibold ${c.deficitVsMin > 0 ? "text-neg" : "text-muted-foreground"}`}>
                      {c.deficitVsMin > 0 ? fmtBRL(c.deficitVsMin) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Burn Rate & Runway */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <SectionTitle hint="Burn rate é o ritmo de consumo de caixa pela operação. Runway estima por quantos meses o caixa atual + recebíveis sustentam a empresa, considerando o burn médio dos últimos 3 meses.">
          Burn Rate & Runway
        </SectionTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <StatCard
            label="Burn rate médio (12m)"
            value={burnRunway.burnMedio12 > 0 ? `${fmtBRL(burnRunway.burnMedio12)}/mês` : `+${fmtBRL(-burnRunway.burnMedio12)}/mês`}
            tone={burnRunway.burnMedio12 > 0 ? "neg" : "pos"}
            sub={burnRunway.burnMedio12 > 0 ? "Caixa consumido por mês" : "Operação gerou caixa"}
            hint={{ description: "Média mensal de consumo (ou geração) operacional de caixa no ano.", formula: "Σ (Pagamentos Operacionais − Recebimentos) ÷ 12" }}
          />
          <StatCard
            label="Burn rate (últimos 3m)"
            value={burnRunway.burnMedio3 > 0 ? `${fmtBRL(burnRunway.burnMedio3)}/mês` : `+${fmtBRL(-burnRunway.burnMedio3)}/mês`}
            tone={burnRunway.burnMedio3 > 0 ? "neg" : "pos"}
            sub="Base de cálculo do runway"
            hint={{ description: "Média de queima de caixa nos últimos 3 meses do horizonte projetado. Mais sensível ao momento atual da operação.", formula: "Σ (−Fluxo Operacional dos últimos 3 meses) ÷ 3" }}
          />
          <StatCard
            label="Runway"
            value={runwayLabel}
            tone={runwayTone}
            sub={`Caixa ${fmtBRL(caixaAtual)} + CR ${fmtBRL(recebiveis)}`}
            hint={{ description: "Quantos meses o colchão de caixa + recebíveis sustenta a empresa, mantido o burn médio dos últimos 3 meses.", formula: "(Disponibilidades + Contas a Receber) ÷ Burn médio 3m" }}
          />
        </div>
        {burnRunway.queimando && burnRunway.runwayMeses < 6 && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-semibold text-destructive">Runway curto: menos de 6 meses</div>
              <div className="mt-0.5 text-muted-foreground">
                Considere reduzir custos, captar capital ou acelerar recebimentos para estender a sobrevida operacional.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Gráfico de saldo */}



      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Saldo de caixa projetado (12 meses)</h4>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Caixa mínimo:</span>
              <div className="w-32">
                <MoneyInput value={state.cashflow.caixaMinimo} onChange={setCaixaMin} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Limiar crítico:</span>
              <div className="w-32">
                <MoneyInput value={limiar} onChange={setLimiar} />
              </div>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chart}>
            <defs>
              <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis stroke="var(--muted-foreground)" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} labelStyle={TOOLTIP_LABEL} formatter={(v: number) => fmtBRL(v)} />
            <ReferenceLine y={state.cashflow.caixaMinimo} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: "mínimo", fill: "var(--warning)", fontSize: 10, position: "right" }} />
            <ReferenceLine y={limiar} stroke="var(--destructive)" strokeDasharray="6 3" label={{ value: "limiar", fill: "var(--destructive)", fontSize: 10, position: "right" }} />
            <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="saldo"
              stroke="var(--success)"
              strokeWidth={2}
              fill="url(#gSaldo)"
              dot={(props: any) => {
                const { cx, cy, payload, index } = props;
                const tipo = payload?.critical as "negativo" | "abaixoMinimo" | null;
                if (!tipo) return <circle key={`dot-${index}`} cx={cx} cy={cy} r={0} />;
                const color = tipo === "negativo" ? "var(--destructive)" : "var(--warning)";
                return (
                  <circle
                    key={`dot-${index}`}
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={color}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 6, stroke: "var(--background)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--destructive)" }} />
            Caixa negativo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--warning)" }} />
            Abaixo do mínimo
          </span>
        </div>
      </div>
    </div>
  );
}

type Period = "mensal" | "trimestral" | "anual";
type Agg = "sum" | "last" | "first";

function bucketIndices(period: Period): number[][] {
  if (period === "mensal") return MESES.map((_, i) => [i]);
  if (period === "trimestral") return [[0,1,2],[3,4,5],[6,7,8],[9,10,11]];
  return [[0,1,2,3,4,5,6,7,8,9,10,11]];
}
function periodLabels(period: Period): string[] {
  if (period === "mensal") return MESES;
  if (period === "trimestral") return ["T1", "T2", "T3", "T4"];
  return ["Ano"];
}
function aggregate(values: number[], period: Period, agg: Agg): number[] {
  return bucketIndices(period).map((idxs) => {
    if (agg === "sum") return idxs.reduce((a, i) => a + (values[i] || 0), 0);
    if (agg === "last") return values[idxs[idxs.length - 1]] || 0;
    return values[idxs[0]] || 0;
  });
}

function DFCTable({ state, cf }: { state: AppState; cf: ReturnType<typeof buildCashFlow> }) {
  const [period, setPeriod] = useState<Period>("trimestral");
  const cols = periodLabels(period);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4">
        <SectionTitle hint="Caixa pelo método direto. Receitas e CPV usam PMR/PMP da aba Receitas. Impostos pagos no mês seguinte ao da competência.">
          Demonstração do Fluxo de Caixa — método direto
        </SectionTitle>
        <div className="inline-flex rounded-md border border-border/60 bg-card p-0.5 text-xs">
          {(["mensal", "trimestral", "anual"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 capitalize transition-colors ${
                period === p ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin relative isolate overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 z-20 w-[320px] min-w-[320px] bg-card px-4 py-2 shadow-[1px_0_0_0_var(--border)]">Linha</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-2 text-right">{c}</th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Saldo inicial" values={aggregate(cf.saldoInicial, period, "first")} muted rawTotal={cf.saldoInicial[0]} />
            <SectionRow label="ATIVIDADES OPERACIONAIS" cols={cols.length} />
            <Row label="(+) Recebimentos de clientes" values={aggregate(cf.recebimentos, period, "sum")} tone="pos" />
            <Row label="(+) Receitas financeiras (aplicações)" values={aggregate(cf.receitasFinanceiras, period, "sum")} tone="pos" rawTotal={sum(cf.receitasFinanceiras)} />
            <Row label="(−) Pagamentos a fornecedores (CPV)" values={aggregate(cf.pagamentosFornecedores.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(cf.pagamentosFornecedores)} />
            <Row label="(−) Pagamentos de custos fixos" values={aggregate(cf.pagamentosFixos.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(cf.pagamentosFixos)} />
            <Row label="(−) Pagamentos de custos variáveis" values={aggregate(cf.pagamentosVariaveis.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(cf.pagamentosVariaveis)} />
            <Row label="(−) Despesas financeiras" values={aggregate(cf.pagamentosFinanceiros.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(cf.pagamentosFinanceiros)} />
            <Row label="(−) Impostos pagos" values={aggregate(cf.pagamentosImpostos.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(cf.pagamentosImpostos)} />
            <Row label="(=) Fluxo das Operações" values={aggregate(cf.fluxoOperacional, period, "sum")} strong rawTotal={sum(cf.fluxoOperacional)} />

            <SectionRow label="ATIVIDADES DE INVESTIMENTO" cols={cols.length} />
            <Row label="(−) CapEx — aportes em ativo fixo" values={aggregate(state.cashflow.capex.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(state.cashflow.capex)} />
            <Row label="(=) Fluxo de Investimento" values={aggregate(cf.fluxoInvestimento, period, "sum")} strong rawTotal={sum(cf.fluxoInvestimento)} />

            <SectionRow label="ATIVIDADES DE FINANCIAMENTO" cols={cols.length} />
            <Row label="(+) Aportes de sócios" values={aggregate(state.cashflow.aportes, period, "sum")} tone="pos" rawTotal={sum(state.cashflow.aportes)} />
            <Row label="(+) Captação de empréstimos" values={aggregate(state.cashflow.emprestimosCaptados, period, "sum")} tone="pos" rawTotal={sum(state.cashflow.emprestimosCaptados)} />
            <Row label="(−) Amortização de principal" values={aggregate(state.cashflow.amortizacoes.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(state.cashflow.amortizacoes)} />
            <Row label="(−) Distribuição de dividendos" values={aggregate(state.cashflow.dividendos.map((v) => -v), period, "sum")} tone="neg" rawTotal={-sum(state.cashflow.dividendos)} />
            <Row label="(=) Fluxo de Financiamento" values={aggregate(cf.fluxoFinanciamento, period, "sum")} strong rawTotal={sum(cf.fluxoFinanciamento)} />

            <Row label="(=) VARIAÇÃO DE CAIXA" values={aggregate(cf.variacaoCaixa, period, "sum")} strong highlight rawTotal={sum(cf.variacaoCaixa)} />
            <Row label="(=) SALDO FINAL" values={aggregate(cf.saldoFinal, period, "last")} strong highlight rawTotal={cf.saldoFinal[11]} />
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
        Modelo simplificado: ignora variações de estoque e ajustes de capital de giro contábil mais finos. Para diagnóstico operacional é suficiente.
      </div>
    </div>
  );
}

function Row({
  label, values, tone, strong, highlight, muted, rawTotal,
}: {
  label: string; values: number[]; tone?: "pos" | "neg";
  strong?: boolean; highlight?: boolean; muted?: boolean;
  /** Total a exibir (sobrepõe a soma de `values`). Útil ao agregar por período. */
  rawTotal?: number;
}) {
  const total = rawTotal ?? sum(values);
  const toneCls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "";
  const rowBg = highlight ? "bg-primary/10" : strong ? "bg-accent/20" : "bg-card";
  return (
    <tr className={`${highlight ? "bg-primary/10" : strong ? "bg-accent/20" : ""}`}>
      <td className={`sticky left-0 z-10 w-[320px] min-w-[320px] ${rowBg} border-t border-border/30 px-4 py-1.5 text-xs shadow-[1px_0_0_0_var(--border)] ${strong ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`num border-t border-border/30 px-2 py-1.5 text-right text-[11px] ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-foreground" : "text-muted-foreground"}`}>
          {v === 0 ? "—" : fmtBRLCompact(v)}
        </td>
      ))}
      <td className={`num border-t border-border/30 px-3 py-1.5 text-right text-xs ${strong ? "font-semibold" : ""} ${total < 0 ? "text-neg" : total > 0 ? toneCls || "" : "text-muted-foreground"}`}>
        {fmtBRL(total)}
      </td>
    </tr>
  );
}

function SectionRow({ label, cols = 12 }: { label: string; cols?: number }) {
  return (
    <tr className="bg-card/60">
      <td className="sticky left-0 z-10 w-[320px] min-w-[320px] border-t border-border/40 bg-card/80 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary/80 shadow-[1px_0_0_0_var(--border)]">
        {label}
      </td>
      <td colSpan={cols + 1} className="border-t border-border/40 px-4 py-1.5" />
    </tr>
  );
}

function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nonZero = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nonZero as number) ? (nonZero as number) : (values[0] || 0);
}

// True quando o array tem variação real entre meses (mais de um valor distinto)
function hasSazonalidade(values: number[]): boolean {
  if (!values?.length) return false;
  const first = values[0];
  return values.some((v) => v !== first);
}

type NonOpRow = {
  key: NonOpKey;
  label: string;
  hint: string;
  tone: "pos" | "neg";
  values: number[];
};

function NonOpTable({
  rows,
  onMonth,
  onAllMonths,
}: {
  rows: NonOpRow[];
  onMonth: (key: NonOpKey, i: number, v: number) => void;
  onAllMonths: (key: NonOpKey, v: number) => void;
}) {
  // Cada linha começa "fechada" (modo Fixo) — toggle local para abrir os 12 meses.
  const [fixedMap, setFixedMap] = useState<Record<string, boolean>>(
    () => Object.fromEntries(rows.map((r) => [r.key, true])),
  );
  const isFixed = (k: string) => fixedMap[k] ?? true;
  const setFixed = (k: string, v: boolean) => setFixedMap((m) => ({ ...m, [k]: v }));

  return (
    <div className="scrollbar-thin w-full overflow-x-auto overflow-y-hidden p-2">
      <table className="w-full min-w-[800px] text-[clamp(0.75rem,1vw+0.5rem,0.875rem)] md:min-w-[1000px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-64 px-3 py-2">Descrição</th>
            <th className="w-24 px-2 py-2 text-center">Modo</th>
            {MESES.map((m) => (
              <th key={m} className="px-1 py-2 text-right">{m}</th>
            ))}
            <th className="px-3 py-2 text-right">Anual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const anual = sum(row.values);
            const fixed = isFixed(row.key);
            const dotColor = row.tone === "pos" ? "var(--success)" : "var(--destructive)";
            const toneClass = anual === 0 ? "text-muted-foreground" : row.tone === "pos" ? "text-pos" : "text-neg";
            const anualDisplay = anual === 0 ? "—" : row.tone === "neg" ? `(${fmtBRL(anual)})` : fmtBRL(anual);
            return (
              <tr key={row.key} className="border-t border-border/40 align-middle">
                <td className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotColor }} />
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">{row.label}</span>
                      <HelpTip text={row.hint} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>Fixo</span>
                    <Switch
                      checked={!fixed}
                      onCheckedChange={(v) => {
                        // B6: ao alternar Mensal → Fixo com sazonalidade real, avisar.
                        if (!v && hasSazonalidade(row.values)) {
                          toast.warning(`Sazonalidade de "${row.label}" será nivelada`, {
                            description: "Alternar para 'Fixo' substitui os 12 meses pelo primeiro valor não-zero.",
                          });
                        }
                        setFixed(row.key, !v);
                      }}
                    />
                    <span>Mensal</span>
                  </div>
                </td>
                {fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                      <div className="w-36">
                        <MoneyInput value={fixedBase(row.values)} onChange={(n) => onAllMonths(row.key, n)} />
                      </div>
                    </div>
                  </td>
                ) : (
                  row.values.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => onMonth(row.key, i, n)} />
                    </td>
                  ))
                )}
                <td className={`num px-3 py-2 text-right font-semibold ${toneClass}`}>{anualDisplay}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
