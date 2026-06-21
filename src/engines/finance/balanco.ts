// Agregadores do Balanço Detalhado (Fase 1).
//
// Funções PURAS que percorrem `BalancoDetalhado` e devolvem sub-totais e
// totais. Quando o objeto não está preenchido, retornam 0 (UI/engine usam
// fallback nos campos agregados legados de `CapitalStructure`).
//
// IMPORTANTE: depreciação acumulada, amortização acumulada, PDD e ações em
// tesouraria entram como POSITIVOS no input e são SUBTRAÍDAS aqui.
import type { AppState, BalancoDetalhado, CostLine } from "./types";

const n = (v: number | undefined): number => (typeof v === "number" && isFinite(v) ? v : 0);
const sumObj = (o: Record<string, number | undefined> | undefined): number =>
  o ? Object.values(o).reduce<number>((a, b) => a + n(b), 0) : 0;

export interface BalancoTotals {
  ativoCirculante: number;
  realizavelLP: number;
  investimentos: number;
  imobilizadoLiquido: number;
  intangivelLiquido: number;
  ativoNaoCirculante: number;
  ativoTotal: number;

  passivoCirculante: number;
  passivoNaoCirculante: number;
  passivoTotal: number;

  patrimonioLiquido: number;

  /** Dívida onerosa total = empréstimos CP + empréstimos LP + debêntures. */
  dividaOnerosa: number;
  /** Passivos não-onerosos = PC + PNC − dívida onerosa. */
  passivosNaoOnerosos: number;

  /** Diferença Ativo − (Passivo + PL). Ideal: 0. */
  diferenca: number;
}

export function calcAtivoCirculante(b?: BalancoDetalhado): number {
  const ac = b?.ativoCirculante;
  if (!ac) return 0;
  // PDD subtrai
  return sumObj({ ...ac, pdd: undefined }) - n(ac.pdd);
}

export function calcImobilizadoLiquido(b?: BalancoDetalhado): number {
  const im = b?.ativoNaoCirculante?.imobilizado;
  if (!im) return 0;
  return sumObj({ ...im, depreciacaoAcumulada: undefined }) - n(im.depreciacaoAcumulada);
}

export function calcIntangivelLiquido(b?: BalancoDetalhado): number {
  const it = b?.ativoNaoCirculante?.intangivel;
  if (!it) return 0;
  return sumObj({ ...it, amortizacaoAcumulada: undefined }) - n(it.amortizacaoAcumulada);
}

export function calcRealizavelLP(b?: BalancoDetalhado): number {
  return sumObj(b?.ativoNaoCirculante?.realizavelLP);
}

export function calcAtivoNaoCirculante(b?: BalancoDetalhado): number {
  return (
    calcRealizavelLP(b) +
    n(b?.ativoNaoCirculante?.investimentos) +
    calcImobilizadoLiquido(b) +
    calcIntangivelLiquido(b)
  );
}

export function calcPassivoCirculante(b?: BalancoDetalhado): number {
  return sumObj(b?.passivoCirculante);
}

export function calcPassivoNaoCirculante(b?: BalancoDetalhado): number {
  return sumObj(b?.passivoNaoCirculante);
}

export function calcDividaOnerosa(b?: BalancoDetalhado): number {
  return (
    n(b?.passivoCirculante?.emprestimosFinanciamentosCP) +
    n(b?.passivoNaoCirculante?.emprestimosFinanciamentosLP) +
    n(b?.passivoNaoCirculante?.debentures)
  );
}

export function calcPatrimonioLiquido(b?: BalancoDetalhado): number {
  const pl = b?.patrimonioLiquido;
  if (!pl) return 0;
  return sumObj({ ...pl, acoesEmTesouraria: undefined }) - n(pl.acoesEmTesouraria);
}

/** Calcula todos os totais e checa fechamento Ativo = Passivo + PL. */
export function calcBalancoTotals(b?: BalancoDetalhado): BalancoTotals {
  const ativoCirculante = calcAtivoCirculante(b);
  const realizavelLP = calcRealizavelLP(b);
  const investimentos = n(b?.ativoNaoCirculante?.investimentos);
  const imobilizadoLiquido = calcImobilizadoLiquido(b);
  const intangivelLiquido = calcIntangivelLiquido(b);
  const ativoNaoCirculante = realizavelLP + investimentos + imobilizadoLiquido + intangivelLiquido;
  const ativoTotal = ativoCirculante + ativoNaoCirculante;

  const passivoCirculante = calcPassivoCirculante(b);
  const passivoNaoCirculante = calcPassivoNaoCirculante(b);
  const passivoTotal = passivoCirculante + passivoNaoCirculante;
  const patrimonioLiquido = calcPatrimonioLiquido(b);

  const dividaOnerosa = calcDividaOnerosa(b);
  const passivosNaoOnerosos = Math.max(0, passivoTotal - dividaOnerosa);

  const diferenca = ativoTotal - (passivoTotal + patrimonioLiquido);

  return {
    ativoCirculante,
    realizavelLP,
    investimentos,
    imobilizadoLiquido,
    intangivelLiquido,
    ativoNaoCirculante,
    ativoTotal,
    passivoCirculante,
    passivoNaoCirculante,
    passivoTotal,
    patrimonioLiquido,
    dividaOnerosa,
    passivosNaoOnerosos,
    diferenca,
  };
}

/** True quando o objeto detalhado contém algum valor > 0 (está em uso). */
export function isBalancoPreenchido(b?: BalancoDetalhado): boolean {
  if (!b) return false;
  const t = calcBalancoTotals(b);
  return t.ativoTotal > 0 || t.passivoTotal > 0 || t.patrimonioLiquido !== 0;
}

// =========================================================================
// PROPAGAÇÃO BALANÇO DETALHADO → AGREGADOS DE CAPITAL (SSOT)
// =========================================================================
//
// Quando `state.capital.balanco` está preenchido, ele vira a fonte da verdade
// e SOBRESCREVE os campos agregados legados antes do `buildFinancialModel`
// rodar. Assim, ROE/ROA/ROIC/WACC/liquidez/NCG passam a refletir as rubricas
// detalhadas sem precisar mexer em cada cálculo individualmente.
//
// Quando `balanco` está vazio, devolve o state inalterado (modo legado).

const nn = (v: number | undefined): number => (typeof v === "number" && isFinite(v) ? v : 0);

/** Aplica o balanço detalhado sobre os agregados de `capital`. Pure. */
export function normalizeStateFromBalanco(state: AppState): AppState {
  const b = state.capital.balanco;
  if (!isBalancoPreenchido(b)) return state;

  const t = calcBalancoTotals(b);
  const ac = b!.ativoCirculante ?? {};
  const pc = b!.passivoCirculante ?? {};

  const disponibilidades = nn(ac.caixaEquivalentes) + nn(ac.aplicacoesFinanceirasCP);
  const contasReceber = Math.max(0, nn(ac.contasReceberClientes) - nn(ac.pdd));
  const estoques = nn(ac.estoques);
  const fornecedores = nn(pc.fornecedores);

  return {
    ...state,
    capital: {
      ...state.capital,
      ativoTotal: t.ativoTotal,
      ativoCirculante: t.ativoCirculante,
      passivoCirculante: t.passivoCirculante,
      dividaOnerosa: t.dividaOnerosa,
      patrimonioLiquido: t.patrimonioLiquido,
      passivosNaoOnerosos: t.passivosNaoOnerosos,
      disponibilidades,
      contasReceber,
      estoques,
      fornecedores,
    },
  };
}
