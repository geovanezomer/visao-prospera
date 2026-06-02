import { AppState } from "@/lib/finance/types";
import { fmtBRL, fmtBRLCompact, MESES, sum } from "@/lib/finance/format";
import { buildCashFlow } from "@/lib/finance/cashflow";
import { MoneyInput, SectionTitle, StatCard } from "./primitives";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, TriangleAlert } from "lucide-react";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;
type NonOpKey = "aportes" | "emprestimosCaptados" | "capex" | "dividendos" | "amortizacoes";

export function CashflowTab({ state, update }: { state: AppState; update: Updater }) {
  const cf = buildCashFlow(state);

  const setNonOp = (key: NonOpKey, monthIdx: number, value: number) =>
    update((s) => ({
      ...s,
      cashflow: {
        ...s.cashflow,
        [key]: s.cashflow[key].map((v, i) => (i === monthIdx ? value : v)),
      },
    }));

  const setCaixaMin = (v: number) =>
    update((s) => ({ ...s, cashflow: { ...s.cashflow, caixaMinimo: v } }));

  // Mapa de meses críticos: para destacar pontos no gráfico.
  const criticalByMes: Record<string, "negativo" | "abaixoMinimo"> = {};
  cf.alertas.forEach((a) => {
    // Em caso de empate, "negativo" prevalece (mais severo).
    if (criticalByMes[a.mes] !== "negativo") criticalByMes[a.mes] = a.tipo;
  });

  const chart = MESES.map((m, i) => ({
    mes: m,
    saldo: cf.saldoFinal[i],
    minimo: state.cashflow.caixaMinimo,
    critical: criticalByMes[m] ?? null,
  }));

  const danger = cf.alertas.some((a) => a.tipo === "negativo");

  // Top 3 meses mais críticos: menores saldos do ano (independente de bater o mínimo).
  const top3Criticos = MESES
    .map((mes, i) => ({
      mes,
      saldo: cf.saldoFinal[i],
      deficitVsMin: state.cashflow.caixaMinimo - cf.saldoFinal[i], // positivo = está abaixo do mínimo
    }))
    .sort((a, b) => a.saldo - b.saldo)
    .slice(0, 3);


  return (
    <div className="space-y-6">
      {/* Sumário */}
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard
          label="Recebimentos no ano"
          value={fmtBRL(cf.totais.recebimentos)}
          tone="pos"
          hint={{ description: "Total efetivamente recebido em caixa no ano, já descontada a inadimplência e respeitando o PMR (prazo médio de recebimento).", formula: "Σ Recebimentos mensais (Receita Líquida defasada pelo PMR)" }}
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
          sub="Operacional + Investimento + Financiamento"
          hint={{ description: "Quanto o caixa cresceu (ou caiu) no ano somando os 3 fluxos: operação, investimentos e financiamentos.", formula: "Fluxo Operacional + Fluxo de Investimento + Fluxo de Financiamento" }}
        />
        <StatCard
          label="Saldo final (Dez)"
          value={fmtBRL(cf.totais.saldoFinal)}
          tone={cf.totais.saldoFinal >= state.cashflow.caixaMinimo ? "pos" : cf.totais.saldoFinal >= 0 ? "warn" : "neg"}
          sub={cf.totais.pioresMes ? `Pior mês: ${cf.totais.pioresMes.mes} = ${fmtBRL(cf.totais.pioresMes.saldo)}` : undefined}
          hint={{ description: "Saldo de caixa projetado para dezembro. Deve ficar acima do caixa mínimo de segurança definido na configuração.", formula: "Saldo Inicial + Σ Variações mensais de caixa" }}
        />
      </div>

      {/* Alertas */}
      {cf.alertas.length > 0 && (
        <div
          className={`flex items-start gap-3 rounded-md border p-4 text-sm ${
            danger
              ? "border-[var(--destructive)]/50 bg-[var(--destructive)]/10 text-foreground"
              : "border-[var(--warning)]/50 bg-[var(--warning)]/10 text-foreground"
          }`}
        >
          {danger ? <AlertTriangle className="mt-0.5 h-5 w-5 text-neg" /> : <TriangleAlert className="mt-0.5 h-5 w-5 text-[var(--warning)]" />}
          <div>
            <div className="font-semibold">
              {danger ? "Atenção: caixa fica NEGATIVO em algum mês" : "Caixa fica abaixo do mínimo de segurança"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Meses críticos:{" "}
              {cf.alertas
                .map((a) => `${a.mes} (${a.saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`)
                .join(" · ")}
            </div>
            <div className="mt-1 text-xs">Vá para a aba <strong>Diagnóstico & Decisões</strong> para simular ações de correção.</div>
          </div>
        </div>
      )}

      {/* Movimentações de caixa não operacionais */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle hint="Edite aqui CapEx, aportes, captações, amortizações e dividendos. Os valores alimentam automaticamente as linhas de investimento e financiamento na DFC abaixo.">
            Movimentações de caixa não operacionais
          </SectionTitle>
        </div>
        <div className="divide-y divide-border/40">
          <NonOpSection
            label="CapEx — investimentos em ativo fixo"
            hint="Saída de caixa para compra de máquinas, equipamentos, obras, software."
            values={state.cashflow.capex}
            onChange={(i, v) => setNonOp("capex", i, v)}
            tone="neg"
          />
          <NonOpSection
            label="Aportes de sócios"
            hint="Entrada de capital próprio dos sócios na empresa."
            values={state.cashflow.aportes}
            onChange={(i, v) => setNonOp("aportes", i, v)}
            tone="pos"
          />
          <NonOpSection
            label="Captação de empréstimos"
            hint="Entrada de caixa por novas linhas de crédito tomadas no período."
            values={state.cashflow.emprestimosCaptados}
            onChange={(i, v) => setNonOp("emprestimosCaptados", i, v)}
            tone="pos"
          />
          <NonOpSection
            label="Amortização de principal"
            hint="Pagamento da parcela de principal de dívidas (não confundir com juros, que já entram em Despesas financeiras)."
            values={state.cashflow.amortizacoes}
            onChange={(i, v) => setNonOp("amortizacoes", i, v)}
            tone="neg"
          />
          <NonOpSection
            label="Distribuição de dividendos"
            hint="Saída de caixa para distribuir lucros aos sócios."
            values={state.cashflow.dividendos}
            onChange={(i, v) => setNonOp("dividendos", i, v)}
            tone="neg"
          />
        </div>
      </div>

      {/* Tabela detalhada */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle hint="Caixa pelo método direto. Receitas e CPV usam PMR/PMP da aba Receitas. Impostos pagos no mês seguinte ao da competência.">
            Demonstração do Fluxo de Caixa — método direto
          </SectionTitle>
        </div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="sticky left-0 z-20 bg-card px-4 py-2 shadow-[1px_0_0_0_var(--border)]">Linha</th>
                {MESES.map((m) => (
                  <th key={m} className="px-1 py-2 text-right">{m}</th>
                ))}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Saldo inicial" values={cf.saldoInicial} muted />
              <SectionRow label="ATIVIDADES OPERACIONAIS" />
              <Row label="(+) Recebimentos de clientes" values={cf.recebimentos} tone="pos" />
              <Row label="(−) Pagamentos a fornecedores (CPV)" values={cf.pagamentosFornecedores.map((v) => -v)} tone="neg" />
              <Row label="(−) Pagamentos de custos fixos" values={cf.pagamentosFixos.map((v) => -v)} tone="neg" />
              <Row label="(−) Pagamentos de custos variáveis" values={cf.pagamentosVariaveis.map((v) => -v)} tone="neg" />
              <Row label="(−) Despesas financeiras" values={cf.pagamentosFinanceiros.map((v) => -v)} tone="neg" />
              <Row label="(−) Impostos pagos" values={cf.pagamentosImpostos.map((v) => -v)} tone="neg" />
              <Row label="(=) Fluxo das Operações" values={cf.fluxoOperacional} strong />

              <SectionRow label="ATIVIDADES DE INVESTIMENTO" />
              <Row label="(−) CapEx — investimentos em ativo fixo" values={state.cashflow.capex.map((v) => -v)} tone="neg" />
              <Row label="(=) Fluxo de Investimento" values={cf.fluxoInvestimento} strong />

              <SectionRow label="ATIVIDADES DE FINANCIAMENTO" />
              <Row label="(+) Aportes de sócios" values={state.cashflow.aportes} tone="pos" />
              <Row label="(+) Captação de empréstimos" values={state.cashflow.emprestimosCaptados} tone="pos" />
              <Row label="(−) Amortização de principal" values={state.cashflow.amortizacoes.map((v) => -v)} tone="neg" />
              <Row label="(−) Distribuição de dividendos" values={state.cashflow.dividendos.map((v) => -v)} tone="neg" />
              <Row label="(=) Fluxo de Financiamento" values={cf.fluxoFinanciamento} strong />

              <Row label="(=) VARIAÇÃO DE CAIXA" values={cf.variacaoCaixa} strong highlight />
              <Row label="(=) SALDO FINAL" values={cf.saldoFinal} strong highlight />
            </tbody>
          </table>
        </div>
        <div className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
          Modelo simplificado: ignora variações de estoque e ajustes de capital de giro contábil mais finos. Para diagnóstico operacional é suficiente.
        </div>
      </div>

      {/* Gráfico de saldo */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Saldo de caixa projetado (12 meses)</h4>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Caixa mínimo:</span>
            <div className="w-32">
              <MoneyInput value={state.cashflow.caixaMinimo} onChange={setCaixaMin} />
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
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
            <ReferenceLine y={state.cashflow.caixaMinimo} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: "mínimo", fill: "var(--warning)", fontSize: 10, position: "right" }} />
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

function Row({ label, values, tone, strong, highlight, muted }: { label: string; values: number[]; tone?: "pos" | "neg"; strong?: boolean; highlight?: boolean; muted?: boolean }) {
  const total = sum(values);
  const toneCls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "";
  const rowBg = highlight ? "bg-primary/10" : strong ? "bg-accent/20" : "bg-card";
  return (
    <tr className={`${highlight ? "bg-primary/10" : strong ? "bg-accent/20" : ""}`}>
      <td className={`sticky left-0 z-10 ${rowBg} border-t border-border/30 px-4 py-1.5 text-xs shadow-[1px_0_0_0_var(--border)] ${strong ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`num border-t border-border/30 px-1 py-1.5 text-right text-[11px] ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-foreground" : "text-muted-foreground"}`}>
          {v === 0 ? "—" : fmtBRLCompact(v)}
        </td>
      ))}
      <td className={`num border-t border-border/30 px-3 py-1.5 text-right text-xs ${strong ? "font-semibold" : ""} ${total < 0 ? "text-neg" : total > 0 ? toneCls || "" : "text-muted-foreground"}`}>
        {fmtBRL(total)}
      </td>
    </tr>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr className="bg-card/60">
      <td className="sticky left-0 z-10 border-t border-border/40 bg-card/80 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary/80 shadow-[1px_0_0_0_var(--border)]">
        {label}
      </td>
      <td colSpan={13} className="border-t border-border/40 px-4 py-1.5" />
    </tr>
  );
}

function NonOpSection({
  label,
  hint,
  values,
  onChange,
  tone,
}: {
  label: string;
  hint?: string;
  values: number[];
  onChange: (i: number, v: number) => void;
  tone: "pos" | "neg";
}) {
  const total = sum(values);
  const dotColor = tone === "pos" ? "var(--success)" : "var(--destructive)";
  const totalCls = total === 0 ? "text-muted-foreground" : tone === "pos" ? "text-pos" : "text-neg";
  return (
    <div className="p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotColor }} />
          <div>
            <div className="text-xs font-semibold">{label}</div>
            {hint && <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{hint}</div>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total ano</div>
          <div className={`num text-sm font-semibold ${totalCls}`}>
            {total === 0 ? "—" : tone === "neg" ? `(${fmtBRL(total)})` : fmtBRL(total)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12">
        {values.map((v, i) => (
          <div key={i} className="flex flex-col">
            <label className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{MESES[i]}</label>
            <MoneyInput value={v} onChange={(n) => onChange(i, n)} />
          </div>
        ))}
      </div>
    </div>
  );
}
