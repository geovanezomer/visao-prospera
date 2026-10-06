// =====================================================================
// REGIME TRIBUTÁRIO — resolução do regime efetivo, Fator R, folha anual
// =====================================================================
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// `folhaAnual` mora aqui (e não em costs.ts) para evitar ciclo de
// imports com `resolveEffectiveRegime`.

import { AppState, SimplesAnexo, TaxRegime } from "./types";
import { sum } from "./format";
import { getSimplesLimite, getFatorRMinimoPct } from "./taxDefaults";
import { effectiveMonthValues, isFatorRFolha, isLaborLine } from "./costs";

// =====================================================================
// Fator R automático: Anexo V vira III se folha/RBT12 ≥ 28%
// =====================================================================
// FOLHA TOTAL DE PESSOAS — definição usada por Fator R e pelo indicador
// Folha/Receita. Inclui:
//   - Pró-labore
//   - Salários CLT (com encargos embutidos via `encargosAuto`)
//   - Benefícios (VR/VT/plano de saúde/etc.)
//   - PLR (participação nos lucros)
//   - Mão de obra terceirizada (mesmo sendo PJ — é dispêndio com pessoas)
// EXCLUI:
//   - Comissões (custo COMERCIAL atrelado à venda, não folha)
//   - Despesas financeiras
// ATENÇÃO — ambiguidade histórica de "participação nos lucros":
//   - PLR de empregado CLT → ENTRA na folha (Fator R, Folha/Receita).
//   - Distribuição/dividendos a SÓCIO → NÃO entra (é remuneração de capital,
//     não folha de pessoal; em geral isenta de IR, sem encargos previdenciários).
// Por isso o include cobre PLR genérico, e o exclude derruba qualquer linha
// que mencione sócio/dividendo/distribuição (mesmo que case com o include).
// Regexes canônicos moram em ./costs.ts (SSOT). isLaborLine encapsula
// include/exclude e o flag encargosAuto.

export function folhaAnual(state: AppState): number {
  // SSOT: regime EFETIVO. Encargos do Simples são reduzidos automaticamente
  // dentro de effectiveMonthValues quando aplicável.
  const regime = resolveEffectiveRegime(state);
  const laborCosts = state.costs.filter((c) => {
    if (c.category === "financeiro") return false;
    return isLaborLine(c);
  });
  return laborCosts.reduce((acc, c) => acc + sum(effectiveMonthValues(c, regime)), 0);
}

/** Folha de salários para o Fator R (ver `isFatorRFolha`). */
export function folhaFatorR(state: AppState): number {
  const regime = resolveEffectiveRegime(state);
  return state.costs
    .filter(isFatorRFolha)
    .reduce((acc, c) => acc + sum(effectiveMonthValues(c, regime)), 0);
}

// SSOT-10: LIMITE_SIMPLES removido — use SIMPLES_LIMITE / getSimplesLimite(tax) de taxDefaults.ts.

export function resolveSimplesAnexo(state: AppState): SimplesAnexo {
  const anexo = state.tax.simplesAnexo;
  if (!state.tax.fatorRAuto || anexo !== "V") return anexo;
  const rbt12 = sum(state.revenue.bruta);
  if (rbt12 <= 0 || rbt12 > getSimplesLimite(state.tax)) return anexo;
  const fatorR = folhaFatorR(state) / rbt12;
  const minPct = getFatorRMinimoPct(state.tax);
  return fatorR >= minPct / 100 ? "III" : "V";
}

/** Retorna true se RBT12 ultrapassa o limite do Simples Nacional (desenquadramento obrigatório). */
export function simplesExcedeLimite(state: AppState): boolean {
  return sum(state.revenue.bruta) > getSimplesLimite(state.tax);
}

/**
 * Resolve o regime tributário EFETIVO considerando desenquadramento do Simples.
 * Se o usuário escolheu Simples mas a RBT12 estourou o limite, força Presumido.
 * Esta é a VERDADE ABSOLUTA usada por todas as abas (Indicadores, Saúde, Forecast, etc.).
 */
export function resolveEffectiveRegime(state: AppState): TaxRegime {
  if (state.tax.regime === "simples" && simplesExcedeLimite(state)) {
    return "presumido";
  }
  return state.tax.regime;
}
