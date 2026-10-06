/**
 * DashboardExtras — Elementos visuais voltados ao empresário (não-analista):
 * 1. Runway + Saldo de Caixa Projetado (com linha de caixa mínimo)
 * 2. Painel de Semáforos da saúde financeira
 * 3. Cronograma de Vencimentos (juros + amortização, 12 meses)
 * 4. Score de Saúde Financeira (0–100) — gauge composto
 * 5. Top 5 Despesas (barras horizontais ordenadas)
 *
 * Lê do `useFinanceModel` (SSOT) e do `state` para parâmetros do consultor.
 */
import { useMemo } from "react";
import { usePeriodLabels } from "@/components/odoo/usePeriodLabels";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, sum } from "@/engines/finance/format";
import { aggregateContracts } from "@/engines/finance/debtContracts";
import { AlertTriangle, CheckCircle2, AlertCircle, Wallet, TrendingDown } from "lucide-react";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border/40 bg-card p-4 ${className}`}>
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

// ============ 1. RUNWAY + SALDO PROJETADO ============
function RunwayCard({ state }: { state: AppState }) {
  const MESES = usePeriodLabels();
  const { cf } = useFinanceModel(state);
  const caixaAtual = state.capital.disponibilidades ?? 0;
  const caixaMinimo = state.cashflow.caixaMinimo ?? 0;

  // Burn médio dos últimos 3 meses (consumo mensal de caixa pela operação)
  const burnMedio3 = useMemo(() => {
    const ult3 = cf.fluxoOperacional.slice(-3);
    const media = ult3.reduce((a, b) => a + b, 0) / Math.max(1, ult3.length);
    return -media; // positivo = queima
  }, [cf.fluxoOperacional]);

  const queimando = burnMedio3 > 0;
  const runwayMeses = queimando ? caixaAtual / burnMedio3 : Infinity;
  const runwayLabel = !Number.isFinite(runwayMeses)
    ? "∞ (gerando caixa)"
    : `${runwayMeses.toFixed(1)} meses`;

  const tone =
    !Number.isFinite(runwayMeses) || runwayMeses > 12
      ? "text-pos"
      : runwayMeses > 6
        ? "text-amber-400"
        : "text-neg";

  // Barra horizontal de runway (escala até 18 meses)
  const pct = Math.min(100, ((Number.isFinite(runwayMeses) ? runwayMeses : 18) / 18) * 100);

  return (
    <Card title="Pista de Caixa (Runway) & Saldo Projetado">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Caixa atual
            </div>
            <div className="mono text-xl font-bold text-foreground">{fmtBRL(caixaAtual)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Você tem caixa para
            </div>
            <div className={`mono text-3xl font-bold ${tone}`}>{runwayLabel}</div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${tone.replace("text-", "bg-")}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
              <span>0m</span>
              <span>6m</span>
              <span>12m</span>
              <span>18m+</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {queimando ? "Queima mensal (últ. 3m)" : "Geração mensal (últ. 3m)"}
            </div>
            <div className={`mono text-base font-semibold ${queimando ? "text-neg" : "text-pos"}`}>
              {fmtBRL(Math.abs(burnMedio3))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            {state.realizado
              ? "Saldo de caixa realizado (12 meses)"
              : "Saldo de caixa projetado (12 meses)"}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={MESES.map((m, i) => ({ mes: m, Saldo: cf.saldoFinal[i] }))}>
              <defs>
                <linearGradient id="grSaldo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <ReferenceLine
                y={caixaMinimo}
                stroke="var(--destructive)"
                strokeDasharray="4 4"
                label={{
                  value: "Caixa mínimo",
                  fill: "var(--destructive)",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              <Area
                type="monotone"
                dataKey="Saldo"
                stroke="var(--primary)"
                fill="url(#grSaldo)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

// ============ 2. PAINEL DE SEMÁFOROS ============
type Status = "ok" | "warn" | "bad";
function statusIcon(s: Status) {
  if (s === "ok") return <CheckCircle2 className="h-4 w-4 text-pos" />;
  if (s === "warn") return <AlertCircle className="h-4 w-4 text-amber-400" />;
  return <AlertTriangle className="h-4 w-4 text-neg" />;
}
function statusLabel(s: Status) {
  return s === "ok" ? "Saudável" : s === "warn" ? "Atenção" : "Crítico";
}

function SemaforoPanel({ state }: { state: AppState }) {
  const { ind } = useFinanceModel(state);

  const itens: { nome: string; status: Status; descricao: string }[] = [
    {
      nome: "Liquidez Corrente",
      status: ind.liquidezCorrente >= 1.5 ? "ok" : ind.liquidezCorrente >= 1 ? "warn" : "bad",
      descricao: `${ind.liquidezCorrente.toFixed(2)}x — capacidade de honrar dívidas de curto prazo`,
    },
    {
      nome: "Endividamento (Oneroso)",
      // Semáforo usa dívida ONEROSA (bancos/financiamentos). Passivo operacional
      // não deve pintar a empresa de vermelho sozinho — vira sub-alerta de ciclo.
      status:
        ind.endividamentoOneroso <= 40 ? "ok" : ind.endividamentoOneroso <= 60 ? "warn" : "bad",
      descricao: `${ind.endividamentoOneroso.toFixed(1)}% oneroso · ${ind.endividamentoGeral.toFixed(1)}% total (com passivo operacional)`,
    },
    {
      nome: "Margem Líquida",
      status: ind.margemLiquida >= 10 ? "ok" : ind.margemLiquida >= 3 ? "warn" : "bad",
      descricao: `${ind.margemLiquida.toFixed(1)}% — lucro sobrante a cada R$ de receita`,
    },
    {
      nome: "Cobertura de Juros",
      status:
        ind.coberturaJuros == null
          ? "ok"
          : ind.coberturaJuros >= 3
            ? "ok"
            : ind.coberturaJuros >= 1.5
              ? "warn"
              : "bad",
      descricao:
        ind.coberturaJuros == null
          ? "N/A — sem dívida a servir"
          : `${ind.coberturaJuros.toFixed(1)}x — EBIT cobre os juros quantas vezes`,
    },
    {
      nome: "Dívida Líq./EBITDA",
      status: ind.dividaLiqEbitda <= 2 ? "ok" : ind.dividaLiqEbitda <= 3.5 ? "warn" : "bad",
      descricao: `${ind.dividaLiqEbitda.toFixed(2)}x — anos de EBITDA para zerar a dívida`,
    },
    {
      nome: "Conversão de Caixa",
      status:
        ind.conversaoEbitdaCaixa >= 70 ? "ok" : ind.conversaoEbitdaCaixa >= 40 ? "warn" : "bad",
      descricao: `${ind.conversaoEbitdaCaixa.toFixed(0)}% — quanto do EBITDA vira caixa de fato`,
    },
    {
      nome: "ROE (Retorno do Sócio)",
      // ROE pode vir null quando PL médio ≤ 0 (empresa com passivo a descoberto) — semáforo neutro.
      status: ind.roe == null ? "warn" : ind.roe >= 15 ? "ok" : ind.roe >= 8 ? "warn" : "bad",
      descricao:
        ind.roe == null
          ? "N/A — PL médio ≤ 0 (passivo a descoberto). ROE perdeu significado."
          : `${ind.roe.toFixed(1)}% — retorno sobre o capital investido pelos sócios`,
    },
    {
      nome: "Ciclo Financeiro",
      status: ind.cicloFinanceiro <= 30 ? "ok" : ind.cicloFinanceiro <= 60 ? "warn" : "bad",
      descricao: `${ind.cicloFinanceiro.toFixed(0)} dias entre pagar fornecedor e receber do cliente`,
    },
  ];

  const resumo = {
    ok: itens.filter((i) => i.status === "ok").length,
    warn: itens.filter((i) => i.status === "warn").length,
    bad: itens.filter((i) => i.status === "bad").length,
  };

  return (
    <Card title="Painel de Saúde Financeira — Semáforos">
      <div className="mb-3 flex gap-3 text-xs">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4 text-pos" /> {resumo.ok} saudáveis
        </span>
        <span className="flex items-center gap-1">
          <AlertCircle className="h-4 w-4 text-amber-400" /> {resumo.warn} atenção
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="h-4 w-4 text-neg" /> {resumo.bad} críticos
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {itens.map((i) => (
          <div
            key={i.nome}
            className="flex items-start gap-2 rounded-md border border-border/30 bg-card/60 p-2.5"
          >
            <div className="mt-0.5">{statusIcon(i.status)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{i.nome}</span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {statusLabel(i.status)}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">{i.descricao}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============ 3. CRONOGRAMA DE VENCIMENTOS ============
function CronogramaDividas({ state }: { state: AppState }) {
  const MESES = usePeriodLabels();
  const contratosRaw = state.capital.debtContracts;
  const agg = useMemo(() => aggregateContracts(contratosRaw ?? []), [contratosRaw]);
  const data = useMemo(
    () => MESES.map((m, i) => ({ mes: m, Juros: agg.juros[i], Amortização: agg.amort[i] })),
    [agg, MESES],
  );

  if (!contratosRaw?.length) {
    return (
      <Card title="Cronograma de Vencimentos (Dívidas)">
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          Nenhum contrato de dívida cadastrado.
        </div>
      </Card>
    );
  }

  return (
    <Card title="Cronograma de Vencimentos — Próximos 12 meses">
      <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Saldo total</div>
          <div className="mono font-bold text-foreground">{fmtBRL(agg.saldoTotal)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Juros 12m</div>
          <div className="mono font-bold text-neg">{fmtBRL(agg.totalJurosAno)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Amortização 12m</div>
          <div className="mono font-bold text-foreground">{fmtBRL(agg.totalAmortAno)}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={10}
            tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtBRL(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Amortização" stackId="d" fill="var(--primary)" />
          <Bar dataKey="Juros" stackId="d" fill="var(--destructive)" />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ============ 4. SCORE DE SAÚDE 0-100 ============
function ScoreSaude({ state }: { state: AppState }) {
  const { ind } = useFinanceModel(state);

  // Normaliza cada métrica em 0–100 (com tetos pragmáticos para PMEs)
  const score = useMemo(() => {
    const norms = [
      Math.min(100, Math.max(0, (ind.liquidezCorrente / 2) * 100)), // 2x = 100
      Math.min(100, Math.max(0, 100 - ind.endividamentoOneroso * 1.5)), // dívida onerosa: 66% → 0
      Math.min(100, Math.max(0, ind.margemLiquida * 5)), // 20% = 100
      Math.min(100, Math.max(0, (ind.coberturaJuros ?? 5) * 20)), // sem dívida → 100
      Math.min(100, Math.max(0, (ind.roe ?? 0) * 5)), // 20% = 100 (null → neutro 0)
      Math.min(100, Math.max(0, ind.conversaoEbitdaCaixa)), // 100%
      Math.min(100, Math.max(0, 100 - ind.dividaLiqEbitda * 25)), // 4x = 0
    ];
    return norms.reduce((a, b) => a + b, 0) / norms.length;
  }, [ind]);

  const cor = score >= 70 ? "var(--success)" : score >= 40 ? "#F5B85B" : "var(--destructive)";
  const conceito =
    score >= 80
      ? "Excelente"
      : score >= 65
        ? "Boa"
        : score >= 45
          ? "Regular"
          : score >= 30
            ? "Frágil"
            : "Crítica";

  const data = [
    { name: "score", value: score, fill: cor },
    { name: "rest", value: 100 - score, fill: "var(--muted)" },
  ];

  return (
    <Card title="Score de Saúde Financeira">
      <div className="relative h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              innerRadius="65%"
              outerRadius="95%"
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
          <span className="mono text-4xl font-bold" style={{ color: cor }}>
            {score.toFixed(0)}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: cor }}>
            {conceito}
          </span>
        </div>
      </div>
      <div className="mt-2 text-center text-[11px] text-muted-foreground">
        Nota agregada de 7 indicadores: liquidez, endividamento, margem, juros, ROE, conversão de
        caixa e Dív.Líq./EBITDA.
      </div>
    </Card>
  );
}

// ============ 5. TOP 5 DESPESAS ============
export function Top5Despesas({ state }: { state: AppState }) {
  const { dre } = useFinanceModel(state);
  const top = useMemo(
    () =>
      Object.entries(dre.despesasPorCategoria)
        .map(([k, v]) => ({ name: k, value: sum(v) }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    [dre.despesasPorCategoria],
  );
  const total = top.reduce((a, b) => a + b.value, 0);

  if (top.length === 0) {
    return (
      <Card title="Top 5 Despesas — Onde o dinheiro vai">
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          Sem despesas cadastradas.
        </div>
      </Card>
    );
  }

  const cores = ["var(--destructive)", "#F5B85B", "#C77DFF", "var(--primary)", "#7DD3FC"];

  return (
    <Card title="Top 5 Despesas — Onde o dinheiro vai">
      <div className="space-y-3">
        {top.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div key={d.name}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="truncate font-semibold text-foreground">
                  {i + 1}. {d.name}
                </span>
                <span className="mono ml-2 shrink-0 text-muted-foreground">
                  {fmtBRL(d.value)} <span className="text-[10px]">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: cores[i] }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border/30 pt-2 text-[11px] text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" />
        Total das 5 maiores:{" "}
        <span className="mono font-semibold text-foreground">{fmtBRL(total)}</span>
      </div>
    </Card>
  );
}

// ============ EXPORT PRINCIPAL ============
export function DashboardExtras({ state }: { state: AppState }) {
  return (
    <div className="space-y-4">
      <RunwayCard state={state} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SemaforoPanel state={state} />
        </div>
        <ScoreSaude state={state} />
      </div>
    </div>
  );
}
