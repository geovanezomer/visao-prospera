// ============================================================================
// ComparisonView.tsx — Tabelas lado a lado para DRE e Fluxo de Caixa.
//
// Recebe uma lista de "snapshots" (label + AppState) selecionados via pills
// no cabeçalho. Computa engine financeira (buildDRE / buildCashFlow) para
// cada um e renderiza tabela com:
//   - 1 coluna por snapshot (totais anuais)
//   - 1 coluna Δ% comparando o primeiro vs o último snapshot
//   - destaque visual em variações relevantes (|Δ| ≥ 10%)
// ============================================================================

import { useMemo } from "react";
import type { AppState } from "@/engines/finance/types";
import { buildDRE } from "@/engines/finance/dre";
import { buildCashFlow } from "@/engines/finance/cashflow";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { fmtBRL, fmtPct, sum } from "@/engines/finance/format";
import { mesesPreenchidos, anualizar } from "@/engines/finance/periodUtils";
import { safePct } from "@/engines/finance/safeMath";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface Snapshot {
  /** "Atual" para o ano corrente, "2024" para histórico, etc. */
  label: string;
  state: AppState;
  /** True quando é o ano vivo — usado para badge "parcial X/12". */
  isCurrent?: boolean;
}

interface Row {
  label: string;
  /** Acessor que retorna o valor anual. Usa anualização proporcional para
   *  o ano corrente quando `meses < 12`. */
  get: (s: Snapshot) => number;
  /** Indenta linha (sub-item). */
  indent?: boolean;
  /** Destaca como linha-totalizadora. */
  bold?: boolean;
  /** Quando true, exibe percentual em vez de R$. */
  asPercent?: boolean;
}

const ALERT_THRESHOLD = 10; // %

// ─── Helpers ──────────────────────────────────────────────────────────

/** Anualiza um total caso o snapshot seja "atual" e o ano esteja parcial. */
function annualizedSum(arr: number[], snap: Snapshot): number {
  const total = sum(arr);
  if (!snap.isCurrent) return total;
  const meses = mesesPreenchidos(arr);
  return meses < 12 ? anualizar(total, meses) : total;
}

function VariationBadge({ pct }: { pct: number }) {
  if (!Number.isFinite(pct)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const abs = Math.abs(pct);
  const Icon = pct > 0.1 ? TrendingUp : pct < -0.1 ? TrendingDown : Minus;
  const color =
    abs < ALERT_THRESHOLD
      ? "text-muted-foreground"
      : pct > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", color)}>
      <Icon className="h-3 w-3" />
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

// ─── Tabela genérica ──────────────────────────────────────────────────

function ComparisonTable({ rows, snapshots }: { rows: Row[]; snapshots: Snapshot[] }) {
  const hasDelta = snapshots.length >= 2;
  // Δ% sempre do PRIMEIRO snapshot (mais antigo) vs ÚLTIMO (mais recente).
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card/40">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Linha</th>
            {snapshots.map((s) => (
              <th key={s.label} className="px-3 py-2 text-right font-medium">
                {s.label}
                {s.isCurrent && (
                  <span className="ml-1 text-[9px] font-normal text-muted-foreground">
                    (anualizado)
                  </span>
                )}
              </th>
            ))}
            {hasDelta && (
              <th className="px-3 py-2 text-right font-medium" title={`${first.label} → ${last.label}`}>
                Δ%
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const values = snapshots.map(row.get);
            const v0 = values[0];
            const vN = values[values.length - 1];
            const deltaPct = row.asPercent ? vN - v0 : safePct(vN - v0, Math.abs(v0), NaN);
            const isAlert =
              hasDelta && Number.isFinite(deltaPct) && Math.abs(deltaPct) >= ALERT_THRESHOLD;
            return (
              <tr
                key={row.label}
                className={cn(
                  "border-t border-border/40",
                  row.bold && "bg-muted/20 font-semibold",
                  isAlert && !row.bold && "bg-amber-500/5",
                )}
              >
                <td className={cn("px-3 py-1.5", row.indent && "pl-7 text-muted-foreground")}>
                  {row.label}
                </td>
                {values.map((v, j) => (
                  <td key={j} className="px-3 py-1.5 text-right tabular-nums">
                    {row.asPercent ? fmtPct(v) : fmtBRL(v)}
                  </td>
                ))}
                {hasDelta && (
                  <td className="px-3 py-1.5 text-right">
                    <VariationBadge pct={deltaPct} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasDelta && (
        <p className="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
          Δ% compara o primeiro vs o último período selecionado. Linhas com variação ≥{" "}
          {ALERT_THRESHOLD}% são destacadas. Ano corrente exibido com totais anualizados (extrapolados
          pelos meses preenchidos).
        </p>
      )}
    </div>
  );
}

// ─── DRE ──────────────────────────────────────────────────────────────

export function DREComparison({ snapshots }: { snapshots: Snapshot[] }) {
  const dres = useMemo(
    () => new Map(snapshots.map((s) => [s.label, buildDRE(s.state).dre])),
    [snapshots],
  );

  const get = (key: keyof ReturnType<typeof buildDRE>["dre"]) => (s: Snapshot) => {
    const dre = dres.get(s.label);
    if (!dre) return 0;
    const arr = (dre as unknown as Record<string, number[]>)[key as string];
    return Array.isArray(arr) ? annualizedSum(arr, s) : 0;
  };

  const rows: Row[] = [
    { label: "Receita Bruta", get: get("receitaBruta"), bold: true },
    { label: "(−) Impostos sobre vendas", get: (s) => -get("impostosVendas")(s), indent: true },
    { label: "(−) Outras deduções", get: (s) => -get("outrasDeducoes")(s), indent: true },
    { label: "(−) Inadimplência/PDD", get: (s) => -(get("deducoesInadimplencia")(s) + get("pdd")(s)), indent: true },
    { label: "Receita Líquida", get: get("receitaLiquida"), bold: true },
    { label: "(−) CPV/CMV/CSP", get: (s) => -get("cpv")(s), indent: true },
    { label: "Lucro Bruto", get: get("lucroBruto"), bold: true },
    { label: "(−) Despesas Operacionais", get: (s) => -get("despesasOperacionais")(s), indent: true },
    { label: "(+) Outras receitas op.", get: get("outrasReceitasOperacionais"), indent: true },
    { label: "EBITDA", get: get("ebitda"), bold: true },
    { label: "Margem EBITDA", asPercent: true, get: (s) => safePct(get("ebitda")(s), get("receitaLiquida")(s)), indent: true },
    { label: "(−) Depreciação", get: (s) => -get("depreciacao")(s), indent: true },
    { label: "EBIT", get: get("ebit"), bold: true },
    { label: "Resultado Financeiro", get: get("resultadoFinanceiro"), indent: true },
    { label: "LAIR", get: get("lair"), bold: true },
    { label: "(−) IRPJ/CSLL", get: (s) => -get("impostos")(s), indent: true },
    { label: "Lucro Líquido", get: get("lucroLiquido"), bold: true },
    { label: "Margem Líquida", asPercent: true, get: (s) => safePct(get("lucroLiquido")(s), get("receitaLiquida")(s)), indent: true },
  ];

  return <ComparisonTable rows={rows} snapshots={snapshots} />;
}

// ─── Fluxo de Caixa ───────────────────────────────────────────────────

export function CashFlowComparison({ snapshots }: { snapshots: Snapshot[] }) {
  const cfs = useMemo(
    () => new Map(snapshots.map((s) => [s.label, buildCashFlow(s.state)])),
    [snapshots],
  );

  const get = (key: keyof ReturnType<typeof buildCashFlow>) => (s: Snapshot) => {
    const cf = cfs.get(s.label);
    if (!cf) return 0;
    const arr = (cf as unknown as Record<string, number[]>)[key as string];
    return Array.isArray(arr) ? annualizedSum(arr, s) : 0;
  };

  const rows: Row[] = [
    { label: "Recebimentos de clientes", get: get("recebimentos") },
    { label: "Receitas financeiras", get: get("receitasFinanceiras") },
    { label: "(−) Pagamentos a fornecedores", get: (s) => -get("pagamentosFornecedores")(s) },
    { label: "(−) Pagamentos fixos", get: (s) => -get("pagamentosFixos")(s) },
    { label: "(−) Pagamentos variáveis", get: (s) => -get("pagamentosVariaveis")(s) },
    { label: "(−) Pagamentos financeiros", get: (s) => -get("pagamentosFinanceiros")(s) },
    { label: "(−) Pagamentos de impostos", get: (s) => -get("pagamentosImpostos")(s) },
    { label: "Fluxo Operacional", get: get("fluxoOperacional"), bold: true },
    { label: "Aportes de sócios", get: get("aportes") },
    { label: "Empréstimos captados", get: get("emprestimosCaptados") },
    { label: "(−) Amortizações", get: (s) => -get("amortizacoes")(s) },
    { label: "(−) Dividendos", get: (s) => -get("dividendos")(s) },
    { label: "Fluxo de Financiamento", get: get("fluxoFinanciamento"), bold: true },
    { label: "(−) CAPEX", get: (s) => -get("capex")(s) },
    { label: "Fluxo de Investimento", get: get("fluxoInvestimento"), bold: true },
    { label: "Variação de Caixa", get: get("variacaoCaixa"), bold: true },
  ];

  return <ComparisonTable rows={rows} snapshots={snapshots} />;
}
