// ============================================================================
// Âncora no razão (modo Odoo) — ver AppState.realizado.
//
//   exibido = razão + (motor(estado) − motor(estado-base))
//
// No estado-base o termo entre parênteses é zero e o número exibido é o do
// Odoo. Numa simulação (alavancas, troca de regime, novo empréstimo...) soma-se
// apenas o EFEITO calculado pelo motor — o ponto de partida continua sendo o
// realizado, não uma reconstrução por premissas (PMR/PMP padrão etc.).
// ============================================================================
import type { BalancoDetalhado, RealizadoLedger } from "./types";
import type { CashFlow } from "./cashflow";
import { MESES } from "./format";

type Tree = number | number[] | { [k: string]: Tree } | string | undefined | null;

/** ledger + eng − base, recursivo (números, vetores e objetos aninhados). */
export function anchorDeep<T>(ledger: T, eng: T, base: T): T {
  const L = ledger as unknown as Tree;
  const E = eng as unknown as Tree;
  const B = base as unknown as Tree;
  const num = (v: Tree) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (Array.isArray(L) || Array.isArray(E) || Array.isArray(B)) {
    const la = (Array.isArray(L) ? L : []) as number[];
    const ea = (Array.isArray(E) ? E : []) as number[];
    const ba = (Array.isArray(B) ? B : []) as number[];
    const n = Math.max(la.length, ea.length, ba.length);
    return Array.from({ length: n }, (_, i) => num(la[i]) + num(ea[i]) - num(ba[i])) as T;
  }
  const isObj = (v: Tree) => typeof v === "object" && v !== null;
  if (isObj(L) || isObj(E) || isObj(B)) {
    const lo = (isObj(L) ? L : {}) as Record<string, Tree>;
    const eo = (isObj(E) ? E : {}) as Record<string, Tree>;
    const bo = (isObj(B) ? B : {}) as Record<string, Tree>;
    const out: Record<string, Tree> = {};
    for (const k of new Set([...Object.keys(lo), ...Object.keys(eo), ...Object.keys(bo)])) {
      const sample = lo[k] ?? eo[k] ?? bo[k];
      // Texto (ex.: dataBase) vem do razão.
      out[k] = typeof sample === "string" ? (lo[k] ?? eo[k]) : anchorDeep(lo[k], eo[k], bo[k]);
    }
    return out as T;
  }
  if (typeof L === "string") return L as T;
  return (num(L) + num(E) - num(B)) as T;
}

const MES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Rótulos dos 12 meses da análise: "out/25"… no modo Odoo, Jan…Dez fora dele. */
export function periodLabels(realizado?: Pick<RealizadoLedger, "meses"> | null): string[] {
  const meses = realizado?.meses;
  if (!meses || meses.length !== 12) return [...MESES];
  return meses.map((ym) => {
    const [y, m] = ym.split("-").map(Number);
    return `${MES_PT[(m || 1) - 1]}/${String(y).slice(2)}`;
  });
}

const sum = (a: number[]) => a.reduce((x, y) => x + (y || 0), 0);

/** Recalcula alertas, pior mês e totais de um fluxo já ancorado. */
export function finalizeCashFlow(cf: CashFlow, caixaMinimo: number, labels: string[]): CashFlow {
  const alertas: CashFlow["alertas"] = [];
  let pior: { mes: string; saldo: number } | null = null;
  for (let i = 0; i < 12; i++) {
    const s = cf.saldoFinal[i] ?? 0;
    if (s < 0) alertas.push({ mes: labels[i], saldo: s, tipo: "negativo" });
    else if (s < caixaMinimo) alertas.push({ mes: labels[i], saldo: s, tipo: "abaixoMinimo" });
    if (!pior || s < pior.saldo) pior = { mes: labels[i], saldo: s };
  }
  return {
    ...cf,
    alertas,
    totais: {
      recebimentos: sum(cf.recebimentos),
      receitasFinanceiras: sum(cf.receitasFinanceiras),
      outrasReceitasOperacionais: sum(cf.outrasReceitasOperacionais),
      pagamentosTotais:
        sum(cf.pagamentosFornecedores) +
        sum(cf.pagamentosFixos) +
        sum(cf.pagamentosVariaveis) +
        sum(cf.pagamentosFolha) +
        sum(cf.pagamentosFinanceiros) +
        sum(cf.pagamentosImpostos),
      fluxoOperacional: sum(cf.fluxoOperacional),
      fluxoInvestimento: sum(cf.fluxoInvestimento),
      fluxoFinanciamento: sum(cf.fluxoFinanciamento),
      variacao: sum(cf.variacaoCaixa),
      saldoFinal: cf.saldoFinal[11] ?? 0,
      pioresMes: pior,
    },
  };
}

export function anchorCashFlow(r: RealizadoLedger, eng: CashFlow, caixaMinimo: number): CashFlow {
  if (!r.cfBase) return eng;
  const { alertas: _a, totais: _t, ...l } = r.cf;
  const { alertas: _b, totais: _u, ...e } = eng;
  const { alertas: _c, totais: _v, ...b } = r.cfBase;
  const merged = anchorDeep(l, e, b) as Omit<CashFlow, "alertas" | "totais">;
  return finalizeCashFlow(
    { ...merged, alertas: [], totais: r.cf.totais },
    caixaMinimo,
    periodLabels(r),
  );
}

export function anchorBalanco(r: RealizadoLedger, eng: BalancoDetalhado): BalancoDetalhado {
  if (!r.fechamentoBase) return eng;
  const { anterior: _x, ...l } = r.balancoFechamento;
  const { anterior: _y, ...e } = eng;
  const { anterior: _z, ...b } = r.fechamentoBase;
  return anchorDeep(l, e, b) as BalancoDetalhado;
}
