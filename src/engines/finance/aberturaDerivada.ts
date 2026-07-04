// SSOT — Derivação dos saldos de ABERTURA do exercício.
//
// Antes existiam ~8 campos manuais em `capital.abertura` que duplicavam
// informações já presentes em outros lugares (Card 1 do Balanço,
// Contratos de Dívida, DRE, Despesas). Esta função centraliza a
// derivação para que NÃO haja preenchimento redundante.
//
// Regras (cada rubrica = UMA fonte):
//   caixa            ← capital.balanco.ativoCirculante.caixaEquivalentes
//                       (fallback: capital.disponibilidades)
//   contasReceber    ← capital.balanco.ativoCirculante.contasReceberClientes
//                       (fallback: capital.contasReceber)
//   estoques         ← capital.balanco.ativoCirculante.estoques
//                       (fallback: capital.estoques)
//   fornecedores     ← capital.balanco.passivoCirculante.fornecedores
//                       (fallback: capital.fornecedores)
//   emprestimosCP    ← Σ saldoDevedor de contratos com prazoMeses ≤ 12
//   emprestimosLP    ← Σ saldoDevedor de contratos com prazoMeses > 12
//                       (fallback p/ ambos: dividaOnerosa × dividaCurtoPrazoPct)
//   impostosPagar    ← dre.impostos[0]      (~1 mês de DARF em aberto)
//   salariosEncargos ← folha[0]             (~1 mês de folha em aberto)
//   depreciacaoAcum  ← (override manual em abertura, default 0)
//   amortizacaoAcum  ← (override manual em abertura, default 0)
//   impostosRecuperar← capital.abertura.impostosRecuperar (editável)
//   lucrosAcumulados ← capital.abertura.lucrosAcumulados (plug histórico)
import type { AppState, DebtContract } from "./types";
import { safeNumber as n } from "./safeMath";
import { isFolhaCost } from "./costs";


const firstMonth = (a: number[] | undefined): number => n(a?.[0]);

/** Split de contratos de dívida em CP (≤12m) e LP (>12m) pelo prazo restante. */
export function splitDebtByMaturity(contracts: DebtContract[] | undefined): {
  cp: number;
  lp: number;
} {
  let cp = 0;
  let lp = 0;
  for (const c of contracts ?? []) {
    const saldo = Math.max(0, c.saldoDevedor || 0);
    if (saldo <= 0) continue;
    const prazo = Math.max(0, Math.floor(c.prazoMeses || 0));
    if (prazo <= 12) cp += saldo;
    else lp += saldo;
  }
  return { cp, lp };
}

export interface AberturaDerivadaSource {
  label: string;
  /** Curto rótulo: de onde o valor foi obtido. */
  origem: string;
  value: number;
  /** True quando o valor é EDITÁVEL pelo usuário (override manual). */
  editavel?: boolean;
}

export interface AberturaDerivada {
  caixa: AberturaDerivadaSource;
  contasReceber: AberturaDerivadaSource;
  estoques: AberturaDerivadaSource;
  impostosRecuperar: AberturaDerivadaSource;
  depreciacaoAcumulada: AberturaDerivadaSource;
  amortizacaoAcumulada: AberturaDerivadaSource;
  fornecedores: AberturaDerivadaSource;
  emprestimosCP: AberturaDerivadaSource;
  emprestimosLP: AberturaDerivadaSource;
  impostosPagar: AberturaDerivadaSource;
  salariosEncargos: AberturaDerivadaSource;
  lucrosAcumulados: AberturaDerivadaSource;
  /** Totais para validação Ativo = Passivo + PL na abertura. */
  totals: {
    ativo: number;
    passivo: number;
    pl: number;
    diferenca: number;
    fechado: boolean;
  };
}

export interface DeriveAberturaOpts {
  state: AppState;
  /** Impostos mensais da DRE (já calculados). */
  impostosMensais?: number[];
}

/** Deriva todos os saldos de abertura a partir das fontes únicas. */
export function deriveAbertura({
  state,
  impostosMensais,
}: DeriveAberturaOpts): AberturaDerivada {
  const cap = state.capital;
  const ab = cap.abertura ?? {};
  const bal = cap.balanco ?? {};
  const ac = bal.ativoCirculante ?? {};
  const pc = bal.passivoCirculante ?? {};
  const imo = bal.ativoNaoCirculante?.imobilizado ?? {};
  const pl = bal.patrimonioLiquido ?? {};

  // ── Ativos: fontes em Card 1 (BalanceSheetCard) ──
  const caixaVal = n(ac.caixaEquivalentes) || n(cap.disponibilidades);
  const crVal = n(ac.contasReceberClientes) || n(cap.contasReceber);
  const estoqueVal = n(ac.estoques) || n(cap.estoques);

  // ── Passivos derivados ──
  const fornVal = n(pc.fornecedores) || n(cap.fornecedores);

  // Empréstimos por maturidade (fallback p/ split por % se sem contratos).
  const split = splitDebtByMaturity(cap.debtContracts);
  let cpVal = split.cp;
  let lpVal = split.lp;
  if (cpVal + lpVal === 0 && (cap.dividaOnerosa || 0) > 0) {
    const cpPct =
      typeof cap.dividaCurtoPrazoPct === "number"
        ? cap.dividaCurtoPrazoPct
        : 0.3;
    cpVal = cap.dividaOnerosa * cpPct;
    lpVal = cap.dividaOnerosa * (1 - cpPct);
  }

  // Impostos a pagar: 1º mês da DRE (proxy de competência → caixa).
  const impostosPagarVal = firstMonth(impostosMensais);

  // Salários a pagar: folha do mês 1 (SSOT `isFolhaCost` — mesma regra usada
  // pelo Fator R e por balancoFechamento). Usa `values[0]` cru: encargos
  // reais são aplicados na DFC (via effectiveMonthValues) — aqui é apenas
  // provisão de abertura no valor bruto de folha.
  const folhaMes1 = (state.costs ?? [])
    .filter(isFolhaCost)
    .reduce((s, l) => s + firstMonth(l.values), 0);

  // Overrides manuais (raros).
  const impostosRecVal = n(ab.impostosRecuperar);
  const depAcumVal = n(ab.depreciacaoAcumulada);
  const amortAcumVal = n(ab.amortizacaoAcumulada);
  const lucrosAcumVal = n(ab.lucrosAcumulados);

  // ── Totais ──
  const imobBruto =
    n(imo.terrenos) +
    n(imo.edificacoes) +
    n(imo.maquinasEquipamentos) +
    n(imo.veiculos) +
    n(imo.moveisUtensilios) +
    n(imo.outrosImobilizados);

  const ativo =
    caixaVal +
    crVal +
    estoqueVal +
    impostosRecVal +
    imobBruto -
    depAcumVal -
    amortAcumVal;

  const passivo =
    fornVal + cpVal + lpVal + impostosPagarVal + folhaMes1;

  // BUG-FIX: `reservasLucros` também compõe o PL de abertura (o fechamento
  // já inclui). Sem isso, ao preencher reservas de lucros no Card do Balanço,
  // a diferença abertura vs fechamento quebrava exatamente por esse valor.
  const plTotal =
    n(pl.capitalSocial) +
    n(pl.reservasCapital) +
    n(pl.reservasLucros) +
    lucrosAcumVal;

  const diferenca = ativo - (passivo + plTotal);
  const tol = Math.max(100, ativo * 0.001);
  const fechado = Math.abs(diferenca) < tol;

  return {
    caixa: {
      label: "Caixa + bancos",
      origem: "Balanço · Caixa & equivalentes",
      value: caixaVal,
    },
    contasReceber: {
      label: "Contas a receber",
      origem: "Balanço · CR de clientes",
      value: crVal,
    },
    estoques: {
      label: "Estoques",
      origem: "Balanço · Estoques",
      value: estoqueVal,
    },
    impostosRecuperar: {
      label: "Impostos a recuperar",
      origem: "Abertura (editável)",
      value: impostosRecVal,
      editavel: true,
    },
    depreciacaoAcumulada: {
      label: "(−) Depreciação acumulada",
      origem: "Abertura (override, default 0)",
      value: depAcumVal,
      editavel: true,
    },
    amortizacaoAcumulada: {
      label: "(−) Amortização acumulada",
      origem: "Abertura (override, default 0)",
      value: amortAcumVal,
      editavel: true,
    },
    fornecedores: {
      label: "Fornecedores",
      origem: "Balanço · Fornecedores",
      value: fornVal,
    },
    emprestimosCP: {
      label: "Empréstimos CP",
      origem:
        split.cp + split.lp > 0
          ? "Contratos · prazo ≤ 12 meses"
          : "Dívida onerosa × % CP (fallback)",
      value: cpVal,
    },
    emprestimosLP: {
      label: "Empréstimos LP",
      origem:
        split.cp + split.lp > 0
          ? "Contratos · prazo > 12 meses"
          : "Dívida onerosa × (1 − % CP)",
      value: lpVal,
    },
    impostosPagar: {
      label: "Impostos a pagar",
      origem: "DRE · impostos do mês 1",
      value: impostosPagarVal,
    },
    salariosEncargos: {
      label: "Salários e encargos a pagar",
      origem: "Despesas · folha do mês 1",
      value: folhaMes1,
    },
    lucrosAcumulados: {
      label: "Lucros/prejuízos acumulados",
      origem: "Abertura (plug histórico — editável)",
      value: lucrosAcumVal,
      editavel: true,
    },
    totals: { ativo, passivo, pl: plTotal, diferenca, fechado },
  };
}
