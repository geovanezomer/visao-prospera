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

  const chart = MESES.map((m, i) => ({
    mes: m,
    saldo: cf.saldoFinal[i],
    minimo: state.cashflow.caixaMinimo,
  }));

  const danger = cf.alertas.some((a) => a.tipo === "negativo");
  const warn = !danger && cf.alertas.length > 0;

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
                <stop offset="0%" stopColor="#00E5A0" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#00E5A0" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
            <ReferenceLine y={state.cashflow.caixaMinimo} stroke="#F5B85B" strokeDasharray="4 4" label={{ value: "mínimo", fill: "#F5B85B", fontSize: 10, position: "right" }} />
            <ReferenceLine y={0} stroke="#FF6B6B" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="saldo" stroke="#00E5A0" strokeWidth={2} fill="url(#gSaldo)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela detalhada */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle hint="Caixa pelo método direto. Receitas e CPV usam PMR/PMP da aba Receitas. Impostos pagos no mês seguinte ao da competência.">
            Demonstração do Fluxo de Caixa — método direto
          </SectionTitle>
        </div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Linha</th>
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
              <EditableRow
                label="(−) CapEx — investimentos em ativo fixo"
                values={state.cashflow.capex}
                onChange={(i, v) => setNonOp("capex", i, v)}
                signNegative
              />
              <Row label="(=) Fluxo de Investimento" values={cf.fluxoInvestimento} strong />

              <SectionRow label="ATIVIDADES DE FINANCIAMENTO" />
              <EditableRow
                label="(+) Aportes de sócios"
                values={state.cashflow.aportes}
                onChange={(i, v) => setNonOp("aportes", i, v)}
              />
              <EditableRow
                label="(+) Captação de empréstimos"
                values={state.cashflow.emprestimosCaptados}
                onChange={(i, v) => setNonOp("emprestimosCaptados", i, v)}
              />
              <EditableRow
                label="(−) Amortização de principal"
                values={state.cashflow.amortizacoes}
                onChange={(i, v) => setNonOp("amortizacoes", i, v)}
                signNegative
              />
              <EditableRow
                label="(−) Distribuição de dividendos"
                values={state.cashflow.dividendos}
                onChange={(i, v) => setNonOp("dividendos", i, v)}
                signNegative
              />
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
    </div>
  );
}

function Row({ label, values, tone, strong, highlight, muted }: { label: string; values: number[]; tone?: "pos" | "neg"; strong?: boolean; highlight?: boolean; muted?: boolean }) {
  const total = sum(values);
  const toneCls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "";
  return (
    <tr className={`border-t border-border/30 ${highlight ? "bg-primary/10" : strong ? "bg-accent/20" : ""}`}>
      <td className={`px-4 py-1.5 text-xs ${strong ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`num px-1 py-1.5 text-right text-[11px] ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-foreground" : "text-muted-foreground"}`}>
          {v === 0 ? "—" : fmtBRLCompact(v)}
        </td>
      ))}
      <td className={`num px-3 py-1.5 text-right text-xs ${strong ? "font-semibold" : ""} ${total < 0 ? "text-neg" : total > 0 ? toneCls || "" : "text-muted-foreground"}`}>
        {fmtBRL(total)}
      </td>
    </tr>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr className="border-t border-border/40 bg-card/60">
      <td colSpan={14} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary/80">
        {label}
      </td>
    </tr>
  );
}

function EditableRow({
  label,
  values,
  onChange,
  signNegative,
}: {
  label: string;
  values: number[];
  onChange: (i: number, v: number) => void;
  signNegative?: boolean;
}) {
  const total = sum(values);
  return (
    <tr className="border-t border-border/30">
      <td className="px-4 py-1 text-xs">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-0.5 py-0.5">
          <input
            type="number"
            value={v || 0}
            onChange={(e) => onChange(i, parseFloat(e.target.value) || 0)}
            className="num w-full rounded border border-border/40 bg-input/30 px-1 py-1 text-right text-[10px] outline-none focus:border-primary"
          />
        </td>
      ))}
      <td className={`num px-3 py-1 text-right text-xs ${signNegative && total > 0 ? "text-neg" : ""}`}>
        {total > 0 ? (signNegative ? `(${fmtBRL(total)})` : fmtBRL(total)) : "—"}
      </td>
    </tr>
  );
}
