// =====================================================================
// REFORMA TRIBUTÁRIA — CBS/IBS (EC 132/2023 + LC 214/2025)
// =====================================================================
// Módulo puro: parâmetros e cronograma ano-a-ano da reforma.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.

import { TaxEra, TaxConfig } from "../types";
import {
  getReformaTransicaoIbsMult,
  getReformaTransicaoIcmsIssMult,
  getCbsAliquota,
  getIbsAliquotaRef,
  ALIQ_PRESUMIDA_CBS_SN,
  ALIQ_PRESUMIDA_IBS_SN,
  CBS_ALIQUOTA_2026_TESTE,
} from "../taxDefaults";

// [CBS/IBS] Re-export para retro-compat dos consumidores diretos.
export { ALIQ_PRESUMIDA_CBS_SN, ALIQ_PRESUMIDA_IBS_SN };

/** [CBS/IBS] Retorna a alíquota EFETIVA de crédito CBS sobre o CPV (em %),
 *  ponderando a parcela de fornecedores SN (crédito presumido) e a parcela
 *  do regime regular (crédito = alíquota cheia). Capeada na alíquota cheia
 *  para o caso de fases de teste (ex: CBS 0,9% em 2026, onde 3% > cheia). */
export function getCbsCredCpvPct(cbsPct: number, snFornecedorPct: number): number {
  if (cbsPct <= 0) return 0;
  const snFrac = Math.max(0, Math.min(100, snFornecedorPct ?? 0)) / 100;
  const presumida = Math.min(ALIQ_PRESUMIDA_CBS_SN, cbsPct);
  return (1 - snFrac) * cbsPct + snFrac * presumida;
}

/** [CBS/IBS] Idem para IBS — ver `getCbsCredCpvPct`. */
export function getIbsCredCpvPct(ibsPct: number, snFornecedorPct: number): number {
  if (ibsPct <= 0) return 0;
  const snFrac = Math.max(0, Math.min(100, snFornecedorPct ?? 0)) / 100;
  const presumida = Math.min(ALIQ_PRESUMIDA_IBS_SN, ibsPct);
  return (1 - snFrac) * ibsPct + snFrac * presumida;
}

/** Parâmetros vigentes da reforma para uma dada era.
 *  - cbsPct, ibsPct: alíquotas de débito sobre a receita bruta (%).
 *  - pisCofinsMult, icmsIssMult: multiplicador (0..1) sobre o que seria devido no sistema antigo.
 *  Cronograma oficial LC 214/2025:
 *  • 2026 — fase de teste: CBS 0,9% e IBS 0,1% (DEVIDOS, porém COMPENSÁVEIS com PIS/COFINS — art. 343).
 *  • 2027 — CBS pleno; PIS/COFINS extintos; IBS segue em fase de teste (0,1%).
 *  • 2029–2032 — IBS faseado 10/20/30/40%; ICMS/ISS reduzidos 10pp/ano.
 *  • 2033 — IBS pleno; ICMS/ISS extintos.
export interface ReformaRates {
  cbsPct: number;
  ibsPct: number;
  pisCofinsMult: number;
  icmsIssMult: number;
  /** Auditoria #11: carga IVA combinada estimada no ano (CBS + IBS + ICMS·mult), em %.
   *  Permite à UI sinalizar overshoot tributário durante a transição. */
  cargaCombinadaPct?: number;
  /** Auditoria #11: true quando a carga combinada supera a carga atual (default ICMS 18%). */
  alertaTransicao?: boolean;
  /** Auditoria A2: parcela (em %) de CBS+IBS compensável com PIS/COFINS no ano
   *  (LC 214/2025 art. 343 — fase de teste 2026). Já é descontada de `cargaCombinadaPct`. */
  compensavelComPisCofinsPct?: number;
}

export function getReformaRates(era: TaxEra | undefined, cfg: TaxConfig): ReformaRates {
  const cbsFull = getCbsAliquota(cfg);
  const ibsFull = getIbsAliquotaRef(cfg);
  const ibsMult = getReformaTransicaoIbsMult(cfg);
  const icmsIssMult = getReformaTransicaoIcmsIssMult(cfg);
  switch (era ?? "atual") {
    case "atual":
      return { cbsPct: 0, ibsPct: 0, pisCofinsMult: 1, icmsIssMult: 1 };
    // Transição 2027–2032 (ponto médio): CBS pleno, PIS/COFINS extintos,
    // IBS na fração configurada (default 50%), ICMS/ISS na fração configurada (default 50%).
    case "transicao":
      return { cbsPct: cbsFull, ibsPct: ibsFull * ibsMult, pisCofinsMult: 0, icmsIssMult };
    case "pleno":
      return { cbsPct: cbsFull, ibsPct: ibsFull, pisCofinsMult: 0, icmsIssMult: 0 };
  }
}

// ---------------------------------------------------------------------
// Cronograma ano-a-ano da Reforma — LC 214/2025 + EC 132/2023
// ---------------------------------------------------------------------
/** Fração do IBS pleno cobrada no ano (0..1). Cronograma oficial:
 *  - 2026–2028: 0,1% absoluto (fase de teste) → fração ≈ 0,1/ibsPleno.
 *  - 2029=10%, 2030=20%, 2031=30%, 2032=40%, 2033+=100%. */
export function getIbsFractionForYear(year: number, ibsFull: number): number {
  if (year < 2026) return 0;
  if (year <= 2028) return ibsFull > 0 ? 0.1 / ibsFull : 0;
  if (year === 2029) return 0.1;
  if (year === 2030) return 0.2;
  if (year === 2031) return 0.3;
  if (year === 2032) return 0.4;
  return 1;
}

/** Fração de ICMS/ISS antigos ainda cobrada no ano:
 *  2026–2028=100%; 2029=90%; 2030=80%; 2031=70%; 2032=60%; 2033+=0%. */
export function getIcmsIssFractionForYear(year: number): number {
  if (year < 2026) return 1;
  if (year <= 2028) return 1;
  if (year === 2029) return 0.9;
  if (year === 2030) return 0.8;
  if (year === 2031) return 0.7;
  if (year === 2032) return 0.6;
  return 0;
}

/** Fração de PIS/COFINS antigos: 2026=100% (CBS 0,9% compensável); 2027+=0%. */
export function getPisCofinsFractionForYear(year: number): number {
  if (year < 2026) return 1;
  if (year === 2026) return 1;
  return 0;
}

/** CBS absoluta (%) no ano: 2026=0,9% (teste); 2027+ = alíquota plena configurada. */
export function getCbsPctForYear(year: number, cbsFull: number): number {
  if (year < 2026) return 0;
  if (year === 2026) return CBS_ALIQUOTA_2026_TESTE;
  return cbsFull;
}

/** Versão ano-a-ano de `getReformaRates`, honrando o cronograma da LC 214/2025.
 *  Use para simulações longitudinais 2026–2033 em vez do agrupamento triplo. */
export function getReformaRatesForYear(year: number, cfg: TaxConfig): ReformaRates {
  const cbsFull = getCbsAliquota(cfg);
  const ibsFull = getIbsAliquotaRef(cfg);
  if (year < 2026)
    return {
      cbsPct: 0,
      ibsPct: 0,
      pisCofinsMult: 1,
      icmsIssMult: 1,
      cargaCombinadaPct: 0,
      alertaTransicao: false,
    };
  const cbsPct = getCbsPctForYear(year, cbsFull);
  const ibsPct = ibsFull * getIbsFractionForYear(year, ibsFull);
  const icmsIssMult = getIcmsIssFractionForYear(year);
  // Carga IVA combinada (estimada) = CBS + IBS + ICMS legado (~18%) × mult
  const icmsLegado = (cfg.issIcms ?? 18) * icmsIssMult;
  // Auditoria A2 — LC 214/2025 art. 343: em 2026 (fase de teste), CBS 0,9% e IBS 0,1%
  // são DEVIDOS mas integralmente COMPENSÁVEIS com PIS/COFINS apurados no mesmo período.
  // Resultado prático: carga adicional líquida ≈ 0%. Antes, somávamos CBS+IBS sobre PIS/COFINS
  // cheio (pisCofinsMult=1), resultando em bitributação irreal no 1º ano da reforma.
  const compensavelComPisCofinsPct = year === 2026 ? cbsPct + ibsPct : 0;
  const cargaCombinadaPct = cbsPct + ibsPct + icmsLegado - compensavelComPisCofinsPct;
  const cargaAtual = cfg.issIcms ?? 18;
  return {
    cbsPct,
    ibsPct,
    pisCofinsMult: getPisCofinsFractionForYear(year),
    icmsIssMult,
    cargaCombinadaPct,
    alertaTransicao: cargaCombinadaPct > cargaAtual + 0.01,
    compensavelComPisCofinsPct,
  };
}

/** Mapeia o ano para a `TaxEra` discreta correspondente — usado para reaproveitar
 *  o engine atual sem reescrever buildDRE/calcReal. */
export function eraForYear(year: number): TaxEra {
  if (year < 2026) return "atual";
  if (year >= 2033) return "pleno";
  return "transicao";
}
