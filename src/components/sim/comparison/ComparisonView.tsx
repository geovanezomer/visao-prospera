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
import { buildFinancialModel } from "@/engines/finance/financialModel";
import type { buildDRE } from "@/engines/finance/dre";
import type { buildCashFlow } from "@/engines/finance/cashflow";
import { fmtBRL, fmtPct, sum, fmtNum } from "@/engines/finance/format";
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
  /**
   * Distingue cenários arquivados como "realizado" (ano fechado/em curso) de
   * "previsao" (orçamento/budget). Quando o usuário seleciona Atual + previsao,
   * o ComparisonView ativa o modo "Orçado × Realizado" (FP&A):
   *   - Δ R$ exibido junto do Δ %
   *   - Semáforo INVERTE em linhas de custo/despesa (gastar mais = vermelho)
   *   - Cabeçalho da coluna previsão recebe sufixo "(orçado)"
   */
  subKind?: "realizado" | "previsao";
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
  /**
   * Marca a linha como CUSTO/DESPESA (ou saída de caixa). Usado só no modo
   * "Orçado × Realizado" para INVERTER a cor do semáforo: realizar mais que
   * o orçado em despesa é RUIM (vermelho), embora o Δ seja positivo.
   * Para Receita/EBITDA/Lucro (padrão), Δ positivo = bom (verde).
   */
  isCost?: boolean;
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

/**
 * Badge de variação. `invert=true` troca a polaridade do semáforo:
 * Δ positivo passa a ser vermelho (usado em linhas de custo/despesa no
 * modo Orçado × Realizado — estourar o orçado é ruim).
 */
function VariationBadge({ pct, invert = false }: { pct: number; invert?: boolean }) {
  if (!Number.isFinite(pct)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const abs = Math.abs(pct);
  const Icon = pct > 0.1 ? TrendingUp : pct < -0.1 ? TrendingDown : Minus;
  const isGood = invert ? pct < 0 : pct > 0;
  const color =
    abs < ALERT_THRESHOLD
      ? "text-muted-foreground"
      : isGood
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", color)}>
      <Icon className="h-3 w-3" />
      {pct > 0 ? "+" : ""}
      {fmtNum(pct, 1)}%
    </span>
  );
}

/** Δ R$ formatado curto (k/M) com sinal — usado no modo Orçado × Realizado. */
function fmtDeltaBRL(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "R$ 0";
  const sign = v > 0 ? "+" : "−";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}R$ ${fmtNum(abs / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${sign}R$ ${fmtNum(abs / 1_000, 1)}k`;
  return `${sign}R$ ${fmtNum(abs, 0)}`;
}

// ─── Tabela genérica ──────────────────────────────────────────────────

function ComparisonTable({ rows, snapshots }: { rows: Row[]; snapshots: Snapshot[] }) {
  // Identifica o snapshot "Atual" (referência para Δ%).
  const atualIdx = snapshots.findIndex((s) => s.isCurrent);
  const atual = atualIdx >= 0 ? snapshots[atualIdx] : null;
  const hasDelta = snapshots.length >= 2;

  // Modo "Orçado × Realizado" (FP&A): ativo quando há Atual (realizado) +
  // pelo menos um snapshot com subKind === "previsao". Nesse modo a coluna
  // delta exibe Δ R$ + Δ %, e o semáforo INVERTE em linhas de custo.
  const isBudgetMode = !!atual && snapshots.some((s) => s.subKind === "previsao");

  // Monta colunas: para cada histórico (não-atual), injeta uma coluna Δ% logo após
  // o valor, comparando aquele ano vs "Atual". Se não houver Atual, mostra um
  // único Δ% no fim (primeiro vs último), comportamento legado.
  type Col =
    | { kind: "value"; snap: Snapshot; idx: number }
    | { kind: "delta"; from: Snapshot; to: Snapshot; label: string; budget: boolean };
  const columns: Col[] = [];
  snapshots.forEach((s, i) => {
    columns.push({ kind: "value", snap: s, idx: i });
    if (atual && !s.isCurrent) {
      const budget = (s.subKind ?? "realizado") === "previsao";
      columns.push({
        kind: "delta",
        from: s,
        to: atual,
        // Convenção FP&A: from=Orçado, to=Realizado → Δ = Realizado − Orçado.
        label: budget ? `Δ Realizado − Orçado (${s.label})` : `Δ% ${s.label}→Atual`,
        budget,
      });
    }
  });
  if (!atual && hasDelta) {
    columns.push({
      kind: "delta",
      from: snapshots[0],
      to: snapshots[snapshots.length - 1],
      label: `Δ% ${snapshots[0].label}→${snapshots[snapshots.length - 1].label}`,
      budget: false,
    });
  }

  /** Δ % (ou pontos percentuais quando a linha já é percentual). */
  const computeDeltaPct = (row: Row, from: Snapshot, to: Snapshot) => {
    const a = row.get(from);
    const b = row.get(to);
    return row.asPercent ? b - a : safePct(b - a, Math.abs(a), NaN);
  };
  /** Δ R$ absoluto (Realizado − Orçado). */
  const computeDeltaAbs = (row: Row, from: Snapshot, to: Snapshot) => {
    return row.get(to) - row.get(from);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card/40">
      {isBudgetMode && (
        <div className="border-b border-border/40 bg-primary/5 px-3 py-1.5 text-[11px] font-medium text-primary">
          Modo Orçado × Realizado — semáforo invertido em custos/despesas (gastar mais que o orçado
          = vermelho).
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Linha</th>
            {columns.map((c, j) =>
              c.kind === "value" ? (
                <th key={j} className="px-3 py-2 text-right font-medium">
                  {c.snap.label}
                  {c.snap.subKind === "previsao" && (
                    <span className="ml-1 text-[9px] font-normal text-primary/80">(orçado)</span>
                  )}
                  {c.snap.isCurrent && (
                    <span className="ml-1 text-[9px] font-normal text-muted-foreground">
                      (realizado)
                    </span>
                  )}
                </th>
              ) : (
                <th
                  key={j}
                  className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground"
                  title={c.label}
                >
                  {c.budget ? "Real − Orçado" : "Δ% vs Atual"}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Linha de destaque se QUALQUER Δ% (histórico→atual) ultrapassar o limiar.
            const rowDeltas = columns
              .filter((c): c is Extract<Col, { kind: "delta" }> => c.kind === "delta")
              .map((c) => computeDeltaPct(row, c.from, c.to));
            const isAlert =
              !row.bold &&
              rowDeltas.some((d) => Number.isFinite(d) && Math.abs(d) >= ALERT_THRESHOLD);
            return (
              <tr
                key={row.label}
                className={cn(
                  "border-t border-border/40",
                  row.bold && "bg-muted/20 font-semibold",
                  isAlert && "bg-amber-500/5",
                )}
              >
                <td className={cn("px-3 py-1.5", row.indent && "pl-7 text-muted-foreground")}>
                  {row.label}
                </td>
                {columns.map((c, j) => {
                  if (c.kind === "value") {
                    const v = row.get(c.snap);
                    return (
                      <td key={j} className="px-3 py-1.5 text-right tabular-nums">
                        {row.asPercent ? fmtPct(v) : fmtBRL(v)}
                      </td>
                    );
                  }
                  const dPct = computeDeltaPct(row, c.from, c.to);
                  // Em modo orçado, INVERTE semáforo para linhas de custo
                  // (Δ positivo em despesa = ruim). Quando `asPercent` (margem),
                  // não invertemos — margem maior é sempre melhor.
                  const invert = c.budget && !!row.isCost && !row.asPercent;
                  if (c.budget) {
                    const dAbs = computeDeltaAbs(row, c.from, c.to);
                    return (
                      <td key={j} className="px-3 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-0.5 leading-tight">
                          {!row.asPercent && (
                            <span
                              className={cn(
                                "text-[11px] tabular-nums",
                                Math.abs(dAbs) < 1
                                  ? "text-muted-foreground"
                                  : (invert ? dAbs < 0 : dAbs > 0)
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400",
                              )}
                            >
                              {fmtDeltaBRL(dAbs)}
                            </span>
                          )}
                          <VariationBadge pct={dPct} invert={invert} />
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={j} className="px-3 py-1.5 text-right">
                      <VariationBadge pct={dPct} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasDelta && (
        <p className="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
          {isBudgetMode
            ? `Modo Orçado × Realizado: coluna mostra Δ = Realizado − Orçado (R$ e %). Em custos/despesas o semáforo é invertido (estourar o orçado = vermelho). `
            : atual
              ? `Δ% compara cada ano histórico vs Atual. `
              : `Δ% compara o primeiro vs o último período selecionado. `}
          Variações ≥ {ALERT_THRESHOLD}% destacam a linha. Ano corrente exibido com totais
          anualizados (extrapolados pelos meses preenchidos).
        </p>
      )}
    </div>
  );
}

// ─── DRE ──────────────────────────────────────────────────────────────

export function DREComparison({ snapshots }: { snapshots: Snapshot[] }) {
  // SSOT: cada snapshot passa pelo MESMO pipeline (regime efetivo + DRE + ind + CF).
  const dres = useMemo(
    () => new Map(snapshots.map((s) => [s.label, buildFinancialModel(s.state).dre])),
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
    {
      label: "(−) Inadimplência/PDD",
      get: (s) => -(get("deducoesInadimplencia")(s) + get("pdd")(s)),
      indent: true,
    },
    { label: "Receita Líquida", get: get("receitaLiquida"), bold: true },
    { label: "(−) CPV/CMV/CSP", get: (s) => -get("cpv")(s), indent: true },
    { label: "Lucro Bruto", get: get("lucroBruto"), bold: true },
    {
      label: "(−) Despesas Operacionais",
      get: (s) => -get("despesasOperacionais")(s),
      indent: true,
    },
    { label: "(+) Outras receitas op.", get: get("outrasReceitasOperacionais"), indent: true },
    { label: "EBITDA", get: get("ebitda"), bold: true },
    {
      label: "Margem EBITDA",
      asPercent: true,
      get: (s) => safePct(get("ebitda")(s), get("receitaLiquida")(s)),
      indent: true,
    },
    { label: "(−) Depreciação", get: (s) => -get("depreciacao")(s), indent: true },
    { label: "EBIT", get: get("ebit"), bold: true },
    { label: "Resultado Financeiro", get: get("resultadoFinanceiro"), indent: true },
    { label: "LAIR", get: get("lair"), bold: true },
    { label: "(−) IRPJ/CSLL", get: (s) => -get("impostos")(s), indent: true },
    { label: "Lucro Líquido", get: get("lucroLiquido"), bold: true },
    {
      label: "Margem Líquida",
      asPercent: true,
      get: (s) => safePct(get("lucroLiquido")(s), get("receitaLiquida")(s)),
      indent: true,
    },
  ];

  return <ComparisonTable rows={rows} snapshots={snapshots} />;
}

// ─── Fluxo de Caixa ───────────────────────────────────────────────────

export function CashFlowComparison({ snapshots }: { snapshots: Snapshot[] }) {
  const cfs = useMemo(
    () => new Map(snapshots.map((s) => [s.label, buildFinancialModel(s.state).cf])),
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
