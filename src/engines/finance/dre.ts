// =====================================================================
// DRE — montagem da Demonstração de Resultado do Exercício (mensal × 12).
// Extraído de calculations.ts (Fase 3) — comportamento idêntico.
// Mantida como uma função única `buildDRE`; quebrar em sub-funções é
// Fase 5 (fora deste escopo) para evitar regressão no comportamento.
// =====================================================================

import { AppState, TaxRegime } from "./types";
import { sum, zeros12, fill12 } from "./format";
import { outrasDeducoesMensal, splitReceitasFinanceiras } from "./shared";
import { effectiveMonthValues } from "./costs";
import { folhaAnual } from "./regime";
import { calcSimples } from "./tax/simples";
import { calcPresumido } from "./tax/presumido";
import { calcReal } from "./tax/real";
import type { MonthlyTax } from "./tax/shared";

export interface DRE {
  receitaBruta: number[];
  deducoesInadimplencia: number[]; // 0 se inadimplenciaComoPDD
  /** Outras deduções de receita (devoluções, perdas, descontos comerciais, etc.) — linhas livres definidas pelo usuário. */
  outrasDeducoes: number[];
  /** Tributos sobre venda (PIS/COFINS/ICMS/ISS/CBS/IBS, ou DAS no Simples) — deduzidos antes da Receita Líquida (CPC/IFRS 15). */
  impostosVendas: number[];
  pdd: number[];                    // 0 se !inadimplenciaComoPDD
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

export function buildDRE(state: AppState, regime: TaxRegime): { dre: DRE; tax: MonthlyTax } {
  const { revenue, costs, capital } = state;
  const usaPDD = !!revenue.inadimplenciaComoPDD;

  const receitaBruta = revenue.bruta.slice();
  const inadimp = revenue.bruta.map((r, i) => r * (revenue.inadimplencia[i] / 100));
  const deducoesInadimplencia = usaPDD ? zeros12() : inadimp.slice();
  const pdd = usaPDD ? inadimp.slice() : zeros12();

  // ---- Primeira passagem: descobrir impostos sobre venda (independem do LAIR) ----
  // Simples/Presumido: dependem só de receita; Real: PIS/COFINS/ICMS/CBS/IBS também
  // só dependem de receita+CPV, não de LAIR. Calculamos com LAIR=0 só para extrair vendas.
  let taxPre: MonthlyTax;
  if (regime === "simples") taxPre = calcSimples(state);
  else if (regime === "presumido") taxPre = calcPresumido(state);
  else taxPre = calcReal(state, zeros12());
  const impostosVendas = taxPre.monthlyVendas.slice();

  const outrasDeducoes = outrasDeducoesMensal(state);

  // Receita Líquida = Bruta − Inadimplência (se não-PDD) − Outras Deduções − Impostos sobre Venda (CPC/IFRS 15)
  const receitaLiquida = receitaBruta.map((r, i) => r - deducoesInadimplencia[i] - outrasDeducoes[i] - impostosVendas[i]);

  const cpv = zeros12();
  const despOp = zeros12();
  const custosFixos = zeros12();
  const custosVariaveis = zeros12();
  const despesasPorCategoria: Record<string, number[]> = {};

  for (const c of costs) {
    if (c.category === "financeiro") continue;
    const v = effectiveMonthValues(c, regime);
    despesasPorCategoria[c.label] = v;
    const isCpv = c.category === "custo_vendas" || c.category === "direto_venda";
    const isOpVar = c.category === "variavel";
    // Comportamento (fixo/variável) para MC/PE. Default deriva da category;
    // override manual via `comportamento` cobre casos como folha CLT no CPV (variável
    // contábil, mas fixo no curto prazo — distorce MC/PE se não for sinalizado).
    const comportamento: "fixo" | "variavel" =
      c.comportamento ?? ((isCpv || isOpVar) ? "variavel" : "fixo");
    for (let i = 0; i < 12; i++) {
      if (isCpv) cpv[i] += v[i];          // CPV contábil preserva a natureza (não muda com override).
      else despOp[i] += v[i];
      if (comportamento === "variavel") custosVariaveis[i] += v[i];
      else custosFixos[i] += v[i];
    }
  }

  if (usaPDD) {
    const revArray = revenue.pddReversaoMensal || zeros12();
    for (let i = 0; i < 12; i++) {
      const pddLiq = Math.max(0, pdd[i] - (revArray[i] || 0));
      pdd[i] = pddLiq;
      despOp[i] += pddLiq;
      // PDD escala com a receita (% da inadimplência sobre a receita bruta) — é custo VARIÁVEL,
      // não fixo. Classificar como fixo superestima o Ponto de Equilíbrio e distorce a Margem
      // de Contribuição.
      custosVariaveis[i] += pddLiq;
    }
    despesasPorCategoria["PDD — Perdas por inadimplência (líq. recup.)"] = pdd.slice();
  }

  const custosFinanceirosTotal = zeros12();
  for (const c of costs.filter((x) => x.category === "financeiro")) {
    const v = effectiveMonthValues(c, regime);
    for (let i = 0; i < 12; i++) custosFinanceirosTotal[i] += v[i];
  }

  const lucroBruto = receitaLiquida.map((r, i) => r - cpv[i]);
  // Outras Receitas Operacionais (aluguéis, venda de ativos) — entram acima do EBITDA.
  const { financeiras: rendimentosFinanceiros, operacionais: outrasReceitasOperacionais } = splitReceitasFinanceiras(state);
  const ebitda = lucroBruto.map((g, i) => g - despOp[i] + outrasReceitasOperacionais[i]);

  const depreciacao = fill12(capital.depreciacaoMensal);
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
  const ebit = ebitda.map((e, i) => e - depreciacao[i]);
  // Resultado Financeiro = Rendimentos Financeiros (rend_aplic etc.) − Custos Financeiros.
  // Aluguéis e venda de ativos NÃO entram aqui (são operacionais, já no EBITDA).
  const resultadoFinanceiro = ebit.map((_, i) => rendimentosFinanceiros[i] - custosFinanceirosTotal[i]);
  const lair = ebit.map((e, i) => e + resultadoFinanceiro[i]);

  // ---- Segunda passagem: impostos sobre LUCRO usando o LAIR já líquido de impostos sobre venda ----
  let tax: MonthlyTax;
  if (regime === "simples") tax = taxPre;                  // sem IRPJ/CSLL separados
  else if (regime === "presumido") tax = taxPre;           // IRPJ/CSLL com base presumida sobre receita (não muda)
  else tax = calcReal(state, lair);                        // recalcula com LAIR correto

  const impostosLucro = tax.monthlyLucro;
  const impostosTotal = impostosVendas.map((v, i) => v + impostosLucro[i]);
  const lucroLiquido = lair.map((l, i) => l - impostosLucro[i]);
  const custosOperacionaisTotal = cpv.map((c, i) => c + despOp[i]);

  // Base contábil dos impostos sobre lucro — informativo para a UI.
  // No Presumido a base é receita × % de presunção (não o LAIR exibido na DRE);
  // sinalizamos isso para que o consultor saiba que IRPJ/CSLL na linha abaixo do LAIR
  // não foi calculado sobre o LAIR real, evitando leitura distorcida.
  const impostosLucroBase: DRE["impostosLucroBase"] =
    regime === "simples" ? "nao_aplica" : regime === "presumido" ? "receita_presumida" : "lair";

  return {
    dre: {
      receitaBruta, deducoesInadimplencia, outrasDeducoes, impostosVendas, pdd, receitaLiquida,
      cpv, lucroBruto, despesasOperacionais: despOp,
      outrasReceitasOperacionais,
      ebitda, depreciacao, ebit, resultadoFinanceiro, lair,
      impostos: impostosLucro, impostosLucroBase, impostosTotal, lucroLiquido,
      despesasPorCategoria, custosFinanceirosTotal, custosOperacionaisTotal,
      custosFixos, custosVariaveis,
      folhaCltAnual: folhaAnual(state),
    },
    tax,
  };
}
