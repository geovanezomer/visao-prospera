// =====================================================================
// DRE — montagem da Demonstração de Resultado do Exercício (mensal × 12).
//
// `buildDRE` é a função pública. Internamente, é composta por quatro
// sub-funções puras com responsabilidades claras:
//
//   1. computeImpostosVendas — 1ª passagem de tributos (independem do LAIR)
//   2. classifyCosts         — distribui custos em CPV / OpEx / Fixo / Variável
//                              e aplica PDD líquida de recuperação
//   3. computeDepreciacao    — depreciação base + ativações + capex
//   4. computeImpostosLucro  — 2ª passagem (IRPJ/CSLL no Real usa LAIR já líquido)
//
// Estas funções não são exportadas: são detalhes de implementação. A API
// pública continua sendo `buildDRE` + tipo `DRE`. Quebrar a função monolítica
// reduz o blast radius de mudanças (ex.: ajuste em IRPJ não toca classificação
// de custos) e facilita raciocínio sobre cada etapa isoladamente.
// =====================================================================

import { AppState, TaxRegime } from "./types";
import { zeros12, fill12 } from "./format";
import { outrasDeducoesMensal, splitReceitasFinanceiras } from "./shared";
import { effectiveMonthValues } from "./costs";
import { DEBT_CONTRACTS_COST_ID } from "./debtContracts";
import { folhaAnual } from "./regime";
import { calcSimples } from "./tax/simples";
import { calcPresumido } from "./tax/presumido";
import { calcReal } from "./tax/real";
import type { MonthlyTax } from "./tax/shared";
import { aggregateMutuos } from "./mutuosSocios";

// Regex compilada uma única vez (era recriada a cada chamada de classifyCosts).
const LOAN_INTEREST_RE =
  /juros[^a-z]*(sobre)?[^a-z]*(empr[eé]stimo|contrato|m[uú]tuo|afac|s[oó]cio)/i;

export interface DRE {
  receitaBruta: number[];
  deducoesInadimplencia: number[]; // 0 se inadimplenciaComoPDD
  /** Outras deduções de receita (devoluções, perdas, descontos comerciais, etc.) — linhas livres definidas pelo usuário. */
  outrasDeducoes: number[];
  /** Tributos sobre venda (PIS/COFINS/ICMS/ISS/CBS/IBS, ou DAS no Simples) — deduzidos antes da Receita Líquida (CPC/IFRS 15). */
  impostosVendas: number[];
  pdd: number[]; // 0 se !inadimplenciaComoPDD
  receitaLiquida: number[];
  cpv: number[];
  lucroBruto: number[];
  despesasOperacionais: number[];
  /** Outras receitas operacionais (aluguéis recebidos, venda de ativos etc.) — somadas no EBITDA. */
  outrasReceitasOperacionais: number[];
  ebitda: number[];
  depreciacao: number[];
  ebit: number[];
  resultadoFinanceiro: number[];
  /** Outras receitas e despesas não operacionais (abaixo do EBIT). */
  resultadoNaoOperacional: number[];
  lair: number[];
  /** Impostos sobre lucro (IRPJ + Adicional + CSLL). Zero no Simples. */
  impostos: number[];
  /**
   * Base efetivamente usada para calcular `impostos` (IRPJ/CSLL).
   * - "lair": Lucro Real — base é o LAIR (Lucro Antes do IR).
   * - "receita_presumida": Presumido — base é receita × % de presunção (não o LAIR exibido).
   * - "nao_aplica": Simples Nacional — IRPJ/CSLL já estão dentro do DAS (impostosVendas).
   * Usado pela UI para sinalizar ao consultor a origem do valor deduzido do LAIR.
   */
  impostosLucroBase: "lair" | "receita_presumida" | "nao_aplica";
  /** Total = impostosVendas + impostos (sobre lucro). Para cards de carga total. */
  impostosTotal: number[];
  lucroLiquido: number[];
  despesasPorCategoria: Record<string, number[]>;
  custosFinanceirosTotal: number[];
  custosOperacionaisTotal: number[];
  custosFixos: number[];
  custosVariaveis: number[];
  folhaCltAnual: number;
}

// ---------------------------------------------------------------------
// (1) Primeira passagem tributária — extrai impostos sobre venda.
// Para Simples/Presumido o `tax` calculado já é o definitivo (não dependem
// de LAIR). Para Real, calculamos com LAIR=0 e refazemos a passagem de
// IRPJ/CSLL em `computeImpostosLucro` com o LAIR já apurado.
// ---------------------------------------------------------------------
function computeImpostosVendas(state: AppState, regime: TaxRegime): MonthlyTax {
  if (regime === "simples") return calcSimples(state);
  if (regime === "presumido") return calcPresumido(state);
  return calcReal(state, zeros12());
}

interface CostBuckets {
  cpv: number[];
  despOp: number[];
  custosFixos: number[];
  custosVariaveis: number[];
  custosFinanceirosTotal: number[];
  despesasPorCategoria: Record<string, number[]>;
  pddFinal: number[]; // PDD líquida de recuperação aplicada às despesas
}

// ---------------------------------------------------------------------
// (2) Classificação de custos.
// Distribui cada linha em CPV vs Despesa Operacional (natureza contábil)
// e em Fixo vs Variável (comportamento — driver da Margem de Contribuição
// e do Ponto de Equilíbrio). Aplica também a PDD líquida quando inadimplência
// é contabilizada como provisão.
// ---------------------------------------------------------------------
function classifyCosts(
  state: AppState,
  regime: TaxRegime,
  usaPDD: boolean,
  pddBruta: number[],
): CostBuckets {
  const { costs, revenue } = state;
  const cpv = zeros12();
  const despOp = zeros12();
  const custosFixos = zeros12();
  const custosVariaveis = zeros12();
  const custosFinanceirosTotal = zeros12();
  const despesasPorCategoria: Record<string, number[]> = {};
  const pddFinal = pddBruta.slice();

  // Anti-duplicação: quando há a linha sintética de juros dos Contratos de Dívida
  // (gerada a partir do módulo Capital), ignoramos quaisquer outras linhas
  // financeiras cujo rótulo indique "juros sobre empréstimos/contratos", para que
  // o usuário não some manualmente um custo que já vem do Capital.
  const hasSyntheticDebt = costs.some((c) => c.id === DEBT_CONTRACTS_COST_ID);
  const isManualLoanInterest = (label: string) => LOAN_INTEREST_RE.test(label);

  const encargosOpts = { simplesAnexo: state.tax?.simplesAnexo };
  for (const c of costs) {
    const v = effectiveMonthValues(c, regime, encargosOpts);
    if (c.category === "financeiro") {
      if (hasSyntheticDebt && c.id !== DEBT_CONTRACTS_COST_ID && isManualLoanInterest(c.label)) {
        continue; // já contabilizado pela linha sintética dos contratos
      }
      for (let i = 0; i < 12; i++) custosFinanceirosTotal[i] += v[i];
      continue;
    }
    despesasPorCategoria[c.label] = v;
    const isCpv = c.category === "custo_vendas" || c.category === "direto_venda";
    // Default de COMPORTAMENTO (variável vs fixo) por categoria. Despesa Comercial
    // escala com vendas (comissões, marketing, frete s/ vendas) → default variável.
    const isOpVar = c.category === "variavel" || c.category === "despesa_comercial";
    // Comportamento (fixo/variável) para MC/PE. Default deriva da category;
    // override manual via `comportamento` cobre casos como folha CLT no CPV
    // (variável contábil, mas fixo no curto prazo — distorce MC/PE se não for sinalizado).
    const comportamento: "fixo" | "variavel" =
      c.comportamento ?? (isCpv || isOpVar ? "variavel" : "fixo");
    for (let i = 0; i < 12; i++) {
      if (isCpv)
        cpv[i] += v[i]; // CPV contábil preserva a natureza (não muda com override).
      else despOp[i] += v[i];
      if (comportamento === "variavel") custosVariaveis[i] += v[i];
      else custosFixos[i] += v[i];
    }
  }

  if (usaPDD) {
    const revArray = revenue.pddReversaoMensal || zeros12();
    for (let i = 0; i < 12; i++) {
      const pddLiq = Math.max(0, pddBruta[i] - (revArray[i] || 0));
      pddFinal[i] = pddLiq;
      despOp[i] += pddLiq;
      // PDD escala com a receita (% da inadimplência sobre a receita bruta) — é custo VARIÁVEL,
      // não fixo. Classificar como fixo superestima o Ponto de Equilíbrio e distorce a Margem
      // de Contribuição.
      custosVariaveis[i] += pddLiq;
    }
    despesasPorCategoria["PDD — Perdas por inadimplência (líq. recup.)"] = pddFinal.slice();
  }

  return {
    cpv,
    despOp,
    custosFixos,
    custosVariaveis,
    custosFinanceirosTotal,
    despesasPorCategoria,
    pddFinal,
  };
}

// ---------------------------------------------------------------------
// (3) Depreciação — base mensal + ativações em custos + capex programado.
// Cada ativação começa no mês informado e distribui linearmente sobre a
// vida útil declarada (sem valor residual).
// ---------------------------------------------------------------------
function computeDepreciacao(state: AppState): number[] {
  const { capital, costs } = state;
  const serie = capital.depreciacaoMensalSerie;
  const depreciacao =
    serie && serie.length === 12
      ? serie.map((v) => Number(v) || 0)
      : fill12(capital.depreciacaoMensal);
  for (const c of costs) {
    if (!c.ativacao || c.ativacao.vidaUtilMeses <= 0 || c.ativacao.valor <= 0) continue;
    const startIdx = Math.max(0, Math.min(11, (c.ativacao.mes || 1) - 1));
    const depAdd = c.ativacao.valor / c.ativacao.vidaUtilMeses;
    for (let i = startIdx; i < 12; i++) depreciacao[i] += depAdd;
  }
  for (const ca of capital.capexAtivacao ?? []) {
    if (!ca || ca.vidaUtilMeses <= 0 || ca.valor <= 0) continue;
    const startIdx = Math.max(0, Math.min(11, (ca.mes || 1) - 1));
    const depAdd = ca.valor / ca.vidaUtilMeses;
    for (let i = startIdx; i < 12; i++) depreciacao[i] += depAdd;
  }
  return depreciacao;
}

// ---------------------------------------------------------------------
// (4) Segunda passagem tributária — IRPJ/CSLL sobre o LAIR já apurado.
// Apenas o Lucro Real reprocessa aqui (depende do LAIR). Simples reutiliza
// o `taxPre` (DAS já contém IRPJ/CSLL). Presumido reutiliza também — sua
// base IRPJ/CSLL é receita × % de presunção, não o LAIR contábil.
// ---------------------------------------------------------------------
function computeImpostosLucro(
  state: AppState,
  regime: TaxRegime,
  lair: number[],
  taxPre: MonthlyTax,
): { tax: MonthlyTax; impostosLucroBase: DRE["impostosLucroBase"] } {
  if (regime === "simples") return { tax: taxPre, impostosLucroBase: "nao_aplica" };
  if (regime === "presumido") return { tax: taxPre, impostosLucroBase: "receita_presumida" };
  return { tax: calcReal(state, lair), impostosLucroBase: "lair" };
}

// ---------------------------------------------------------------------
// API pública — orquestra as sub-funções acima na ordem correta.
// ---------------------------------------------------------------------
/** Soma a âncora do razão às séries de tributos (ver AppState.realizado). */
function anchorTax(
  t: MonthlyTax,
  ajV: number[] | undefined,
  ajL: number[] | undefined,
): MonthlyTax {
  if (!ajV && !ajL) return t;
  const monthlyVendas = t.monthlyVendas.map((v, i) => v + (ajV?.[i] ?? 0));
  const monthlyLucro = t.monthlyLucro.map((v, i) => v + (ajL?.[i] ?? 0));
  const monthly = monthlyVendas.map((v, i) => v + monthlyLucro[i]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const annual = sum(monthly);
  const receitaBase = t.effective > 0 ? t.annual / t.effective : 0;
  return {
    ...t,
    monthlyVendas,
    monthlyLucro,
    monthly,
    annual,
    annualVendas: sum(monthlyVendas),
    annualLucro: sum(monthlyLucro),
    effective: receitaBase > 0 ? annual / receitaBase : t.effective,
  };
}

export function buildDRE(state: AppState, regime: TaxRegime): { dre: DRE; tax: MonthlyTax } {
  const { revenue } = state;
  const usaPDD = !!revenue.inadimplenciaComoPDD;

  // Receita bruta e separação inadimplência ↔ PDD
  const receitaBruta = revenue.bruta.slice();
  const inadimp = revenue.bruta.map((r, i) => r * (revenue.inadimplencia[i] / 100));
  const deducoesInadimplencia = usaPDD ? zeros12() : inadimp.slice();
  const pddSeed = usaPDD ? inadimp.slice() : zeros12();

  // (1) Impostos sobre venda + Receita Líquida (CPC/IFRS 15)
  const taxPre = computeImpostosVendas(state, regime);
  // Modo Odoo: âncora no contabilizado (razão − motor-base); 0 fora dele.
  const ajV = state.realizado?.ajusteImpostosVendas;
  const impostosVendas = taxPre.monthlyVendas.map((v, i) => v + (ajV?.[i] ?? 0));
  const outrasDeducoes = outrasDeducoesMensal(state);
  const receitaLiquida = receitaBruta.map(
    (r, i) => r - deducoesInadimplencia[i] - outrasDeducoes[i] - impostosVendas[i],
  );

  // (2) Classificação de custos (CPV/OpEx, Fixo/Variável, PDD líquida)
  const buckets = classifyCosts(state, regime, usaPDD, pddSeed);

  // Lucro Bruto → EBITDA → EBIT
  const lucroBruto = receitaLiquida.map((r, i) => r - buckets.cpv[i]);
  // Aluguéis e venda de ativos: operacionais (entram no EBITDA).
  // Rendimentos financeiros: vão para o Resultado Financeiro (abaixo do EBIT).
  const {
    financeiras: rendimentosFinanceiros,
    operacionais: outrasReceitasOperacionais,
    naoOperacionais: resultadoNaoOperacional,
  } = splitReceitasFinanceiras(state);
  const ebitda = lucroBruto.map((g, i) => g - buckets.despOp[i] + outrasReceitasOperacionais[i]);

  // (3) Depreciação
  const depreciacao = computeDepreciacao(state);
  const ebit = ebitda.map((e, i) => e - depreciacao[i]);

  // M4: juros de mútuos PJ→PF entram no Resultado Financeiro (Receita Financeira).
  // SSOT: aggregateMutuos — mesma série que já flui pela DFC.
  const mutuosAgg = aggregateMutuos(state.mutuosSocios);
  // Resultado Financeiro = rendimentos aplicações + juros mútuos − custos financeiros
  const resultadoFinanceiro = ebit.map(
    (_, i) =>
      rendimentosFinanceiros[i] + (mutuosAgg.juros[i] || 0) - buckets.custosFinanceirosTotal[i],
  );
  const lair = ebit.map((e, i) => e + resultadoFinanceiro[i] + resultadoNaoOperacional[i]);

  // (4) Impostos sobre lucro (com LAIR já correto no Real)
  const { tax: taxCalc, impostosLucroBase } = computeImpostosLucro(state, regime, lair, taxPre);
  const tax = anchorTax(taxCalc, ajV, state.realizado?.ajusteImpostosLucro);
  const impostosLucro = tax.monthlyLucro;
  const impostosTotal = impostosVendas.map((v, i) => v + impostosLucro[i]);
  const lucroLiquido = lair.map((l, i) => l - impostosLucro[i]);
  const custosOperacionaisTotal = buckets.cpv.map((c, i) => c + buckets.despOp[i]);

  return {
    dre: {
      receitaBruta,
      deducoesInadimplencia,
      outrasDeducoes,
      impostosVendas,
      pdd: buckets.pddFinal,
      receitaLiquida,
      cpv: buckets.cpv,
      lucroBruto,
      despesasOperacionais: buckets.despOp,
      outrasReceitasOperacionais,
      ebitda,
      depreciacao,
      ebit,
      resultadoFinanceiro,
      resultadoNaoOperacional,
      lair,
      impostos: impostosLucro,
      impostosLucroBase,
      impostosTotal,
      lucroLiquido,
      despesasPorCategoria: buckets.despesasPorCategoria,
      custosFinanceirosTotal: buckets.custosFinanceirosTotal,
      custosOperacionaisTotal,
      custosFixos: buckets.custosFixos,
      custosVariaveis: buckets.custosVariaveis,
      folhaCltAnual: folhaAnual(state),
    },
    tax,
  };
}
