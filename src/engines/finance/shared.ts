// =====================================================================
// SHARED — helpers puros usados por DRE, regimes tributários e indicadores.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// Mantido em arquivo neutro para evitar ciclos: tax/* importam daqui.
// =====================================================================

import { totalDividaOnerosa } from "./debtContracts";
import { AppState } from "./types";
import { zeros12 } from "./format";

/**
 * SSOT-1 — Dívida Líquida canônica usada por Valuation e Indicadores.
 * Prefere caixa ocioso (excedente não-operacional). Fallback para
 * disponibilidades totais para compatibilidade com balanços antigos.
 * Retorna valor RAW (pode ser negativo quando caixa > dívida).
 */
export function computeNetDebt(state: AppState): number {
  const D = Math.max(0, totalDividaOnerosa(state));
  // [Auditoria Bloco 4] Dívida Líquida (Damodaran/CVM/IFRS) = Dívida Onerosa − Caixa e Equivalentes TOTAL.
  // O conceito de "caixa ocioso" pertence ao ROIC (subtrair do Capital Investido), NÃO à Dívida Líquida.
  // Antes: usava `caixaOcioso ?? disponibilidades` — inconsistente e subestimava o caixa abatedor.
  const cash = Math.max(0, state.capital.disponibilidades ?? 0);
  return D - cash;
}


/**
 * SSOT — CAPEX MENSAL UNIFICADO.
 * Fonte única: `capital.capexAtivacao[]` (card "Investimentos em equipamentos
 * e ativo" da aba Capital), lançada no mês `ca.mes`. Não existe mais entrada
 * avulsa no Fluxo de Caixa — todo CAPEX deve passar pela ativação de
 * imobilizado para gerar depreciação e refletir no Balanço.
 * Usado por:
 *   - `buildCashFlow` (saída de caixa em FCI no mês correto)
 *   - `calcIndicators` (CAPEX anual para `fcfAposCapex` e `paybackCapex`)
 */
export function computeCapexMensal(state: AppState): number[] {
  const out = zeros12();
  for (const ca of state.capital?.capexAtivacao ?? []) {
    if (!ca || !(ca.valor > 0)) continue;
    const idx = Math.max(0, Math.min(11, (ca.mes || 1) - 1));
    out[idx] += ca.valor;
  }
  return out;
}


/**
 * Soma mensal das linhas livres de dedução da Receita
 * (devoluções, perdas, descontos, etc.).
 * @formula Σ (Revenue.deducoes.valores)
 */
export function outrasDeducoesMensal(state: AppState): number[] {
  const out = zeros12();
  const deds = state.revenue.deducoes ?? [];
  for (const d of deds) {
    if (!Array.isArray(d.valores)) continue;
    for (let i = 0; i < 12; i++) out[i] += Math.max(0, d.valores[i] || 0);
  }
  return out;
}

/**
 * Receita Bruta menos outras deduções — base usada para impostos sobre venda.
 * @formula Receita Bruta − Outras Deduções
 */
export function receitaTributavel(state: AppState): number[] {
  const out = outrasDeducoesMensal(state);
  return state.revenue.bruta.map((b, i) => Math.max(0, (b || 0) - out[i]));
}

/**
 * Separa receitas financeiras em três séries:
 * - financeiras: total bruto (entra na DRE como resultado financeiro positivo).
 * - operacionais: aluguéis e venda de ativos (somam no EBITDA).
 * - financeirasIrpjBase: financeiras tributáveis por IRPJ/CSLL
 *   (exclui rendimentos com tributação EXCLUSIVA na fonte / IRRF definitivo).
 */
export function splitReceitasFinanceiras(state: AppState): {
  financeiras: number[];
  operacionais: number[];
  financeirasIrpjBase: number[];
} {
  const financeiras = zeros12();
  const operacionais = zeros12();
  const financeirasIrpjBase = zeros12();
  const OPERACIONAIS_IDS = new Set(["alugueis", "venda_ativos"]);
  for (const rf of state.revenue.receitasFinanceiras ?? []) {
    const vals = rf.valores ?? [];
    // Classificação: `tipo` explícito quando presente; fallback p/ id (compat).
    const isOperacional =
      rf.tipo === "operacional" ||
      (rf.tipo === undefined && OPERACIONAIS_IDS.has(rf.id));
    const exclusivaFonte = !!rf.tributacaoExclusivaFonte;
    for (let i = 0; i < 12; i++) {
      const v = Number(vals[i]) || 0;
      if (isOperacional) operacionais[i] += v;
      else {
        financeiras[i] += v;
        if (!exclusivaFonte) financeirasIrpjBase[i] += v;
      }
    }
  }
  return { financeiras, operacionais, financeirasIrpjBase };
}

/**
 * CAGR (Taxa de Crescimento Anual Composta) sobre uma série mensal.
 * Usa o 1º e o último mês com valor > 0, preservando a distância real em meses
 * (evita inflar o expoente quando há meses zerados no meio da série).
 * Retorna NaN quando indeterminado.
 */
export function cagr12m(serie: number[]): number {
  if (!serie || serie.length < 2) return NaN;
  const firstIdx = serie.findIndex((v) => v > 0);
  let lastIdx = -1;
  for (let i = serie.length - 1; i >= 0; i--) {
    if (serie[i] > 0) {
      lastIdx = i;
      break;
    }
  }
  if (firstIdx < 0 || lastIdx <= firstIdx) return NaN;
  // Auditoria #14: exige pelo menos 3 meses positivos no intervalo — evita
  // calcular CAGR sobre série com gaps grandes (dados faltantes vs zeros reais
  // tornam-se indistinguíveis e produzem taxa irreal).
  const positivosNoIntervalo = serie.slice(firstIdx, lastIdx + 1).filter((v) => v > 0).length;
  if (positivosNoIntervalo < 3) return NaN;
  const periodos = lastIdx - firstIdx; // distância real (meses)
  return Math.pow(serie[lastIdx] / serie[firstIdx], 12 / periodos) - 1;
}
