// =====================================================================
// REFORMA TRIBUTÁRIA — CBS/IBS (EC 132/2023 + LC 214/2025)
// =====================================================================
// Módulo puro: parâmetros e cronograma ano-a-ano da reforma.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.

import { TaxEra, TaxConfig } from "../types";
import {
  getReformaTransicaoIbsMult,
  getReformaTransicaoIcmsIssMult,
} from "../taxDefaults";

/** Parâmetros vigentes da reforma para uma dada era.
 *  - cbsPct, ibsPct: alíquotas de débito sobre a receita bruta (%).
 *  - pisCofinsMult, icmsIssMult: multiplicador (0..1) sobre o que seria devido no sistema antigo.
 *  Cronograma oficial: 2026 teste (CBS 0.9% compensável c/ PIS/COFINS, IBS 0.1%);
 *  2027 CBS pleno e PIS/COFINS extintos; IBS faseado 20/40/60/80% em 2029–2032;
 *  ICMS/ISS reduzido 10pp/ano de 2029 a 2032 até extinção em 2033. */
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
}

export function getReformaRates(era: TaxEra | undefined, cfg: TaxConfig): ReformaRates {
  const cbsFull = cfg.cbsAliquota ?? 8.8;
  const ibsFull = cfg.ibsAliquotaRef ?? 17.7;
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
  if (year === 2029) return 0.10;
  if (year === 2030) return 0.20;
  if (year === 2031) return 0.30;
  if (year === 2032) return 0.40;
  return 1;
}

/** Fração de ICMS/ISS antigos ainda cobrada no ano:
 *  2026–2028=100%; 2029=90%; 2030=80%; 2031=70%; 2032=60%; 2033+=0%. */
export function getIcmsIssFractionForYear(year: number): number {
  if (year < 2026) return 1;
  if (year <= 2028) return 1;
  if (year === 2029) return 0.90;
  if (year === 2030) return 0.80;
  if (year === 2031) return 0.70;
  if (year === 2032) return 0.60;
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
  if (year === 2026) return 0.9;
  return cbsFull;
}

/** Versão ano-a-ano de `getReformaRates`, honrando o cronograma da LC 214/2025.
 *  Use para simulações longitudinais 2026–2033 em vez do agrupamento triplo. */
export function getReformaRatesForYear(year: number, cfg: TaxConfig): ReformaRates {
  const cbsFull = cfg.cbsAliquota ?? 8.8;
  const ibsFull = cfg.ibsAliquotaRef ?? 17.7;
  if (year < 2026) return { cbsPct: 0, ibsPct: 0, pisCofinsMult: 1, icmsIssMult: 1 };
  return {
    cbsPct: getCbsPctForYear(year, cbsFull),
    ibsPct: ibsFull * getIbsFractionForYear(year, ibsFull),
    pisCofinsMult: getPisCofinsFractionForYear(year),
    icmsIssMult: getIcmsIssFractionForYear(year),
  };
}

/** Mapeia o ano para a `TaxEra` discreta correspondente — usado para reaproveitar
 *  o engine atual sem reescrever buildDRE/calcReal. */
export function eraForYear(year: number): TaxEra {
  if (year < 2026) return "atual";
  if (year >= 2033) return "pleno";
  return "transicao";
}
