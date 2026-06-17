/**
 * Valores oficiais "fonte da verdade" para alíquotas e tabelas tributárias
 * brasileiras + resolvers que aplicam overrides do usuário (TaxConfig.ratesOverride).
 *
 * Toda constante mágica que antes vivia em `calculations.ts` foi movida para cá.
 * O `calculations.ts` agora consulta este módulo via funções `getX(tax)`.
 *
 * Política: undefined em ratesOverride → retorna o padrão oficial. Permite
 * "esvaziar um campo no painel = voltar ao oficial" sem precisar limpar nada.
 */
import type { BusinessType, SimplesAnexo, TaxConfig } from "./types";

// =====================================================================
// IMPOSTOS SOBRE LUCRO — IRPJ + Adicional + CSLL
// =====================================================================
/** IRPJ — alíquota base sobre lucro tributável (%). */
export const IRPJ_PCT = 15;
/** Adicional IRPJ — alíquota incremental sobre o excedente trimestral (%). */
export const IRPJ_ADICIONAL_PCT = 10;
/** Adicional IRPJ — gatilho trimestral acima do qual incide o adicional (R$). */
export const IRPJ_ADICIONAL_GATILHO_TRI = 60_000;
/** CSLL — alíquota sobre o lucro (%). */
export const CSLL_PCT = 9;

// =====================================================================
// IMPOSTOS SOBRE VENDA — PIS/COFINS (sistema atual)
// =====================================================================
/** PIS cumulativo — incidente no Lucro Presumido (%). */
export const PIS_CUM_PCT = 0.65;
/** COFINS cumulativo — incidente no Lucro Presumido (%). */
export const COFINS_CUM_PCT = 3.0;
/** PIS não-cumulativo — incidente no Lucro Real (%). */
export const PIS_NAO_CUM_PCT = 1.65;
/** COFINS não-cumulativo — incidente no Lucro Real (%). */
export const COFINS_NAO_CUM_PCT = 7.6;

// =====================================================================
// SIMPLES NACIONAL
// =====================================================================
/** Limite anual de receita bruta para permanência no Simples Nacional (LC 123/06). */
export const SIMPLES_LIMITE = 4_800_000;
/** Sublimite estadual (LC 123/06 art. 13-A): acima deste valor ICMS/ISS saem do DAS
 *  e passam a ser recolhidos pelo regime normal estadual. SSOT-11. */
export const SIMPLES_SUBLIMITE_ESTADUAL = 3_600_000;
/** Fator R — relação folha/RBT12 mínima para migrar Anexo V → III (%). */
export const FATOR_R_MINIMO_PCT = 28;
/** Encargos patronais padrão (CLT) para folha geral (%). */
export const DEFAULT_ENCARGOS_PCT_GERAL = 75;
/** Encargos patronais reduzidos para Simples Nacional — CPP já no DAS,
 *  resta FGTS + Férias + 13º (~30%). SSOT-12. */
export const DEFAULT_ENCARGOS_PCT_SIMPLES = 30;

/** Faixa do Simples Nacional: [teto da faixa em R$, alíquota nominal (%), parcela a deduzir (R$)]. */
export type SimplesFaixa = [number, number, number];

/** Tabelas oficiais do Simples Nacional (2024) — Anexos I a V, 6 faixas cada. */
export const SIMPLES_TABLES_DEFAULT: Record<SimplesAnexo, SimplesFaixa[]> = {
  I: [
    [180000, 4.0, 0],
    [360000, 7.3, 5940],
    [720000, 9.5, 13860],
    [1800000, 10.7, 22500],
    [3600000, 14.3, 87300],
    [4800000, 19.0, 378000],
  ],
  II: [
    [180000, 4.5, 0],
    [360000, 7.8, 5940],
    [720000, 10.0, 13860],
    [1800000, 11.2, 22500],
    [3600000, 14.7, 85500],
    [4800000, 30.0, 720000],
  ],
  III: [
    [180000, 6.0, 0],
    [360000, 11.2, 9360],
    [720000, 13.5, 17640],
    [1800000, 16.0, 35640],
    [3600000, 21.0, 125640],
    [4800000, 33.0, 648000],
  ],
  IV: [
    [180000, 4.5, 0],
    [360000, 9.0, 8100],
    [720000, 10.2, 12420],
    [1800000, 14.0, 39780],
    [3600000, 22.0, 183780],
    [4800000, 33.0, 828000],
  ],
  V: [
    [180000, 15.5, 0],
    [360000, 18.0, 4500],
    [720000, 19.5, 9900],
    [1800000, 20.5, 17100],
    [3600000, 23.0, 62100],
    [4800000, 30.5, 540000],
  ],
};

// =====================================================================
// LUCRO PRESUMIDO — bases de presunção por tipo de negócio
// =====================================================================
export interface PresumidoBases {
  irpj: number;
  csll: number;
}

/** Bases de presunção oficiais (Lei 9.249/95 art. 15 e art. 20). */
export const PRESUMIDO_BASES_DEFAULT: Record<BusinessType, PresumidoBases> = {
  industria: { irpj: 8, csll: 12 },
  comercio: { irpj: 8, csll: 12 },
  servicos: { irpj: 32, csll: 32 },
};

// =====================================================================
// REFORMA TRIBUTÁRIA — multiplicadores da fase de transição (2027–2032)
// [CBS/IBS] LC 214/2025 + EC 132/2023
// Cronograma oficial faseamento IBS: 2027=10%, 2028=20%, 2029=30%,
// 2030=40%, 2031=60%, 2032=80%, 2033+=100% (pleno).
// Reciprocamente ICMS/ISS são reduzidos no mesmo ritmo.
// O ponto médio (~50%) é a aproximação default; o usuário pode sobrepor
// via ratesOverride para simular um ano específico da transição.
// =====================================================================
/** [CBS/IBS] Multiplicador médio de IBS durante a transição. */
export const REFORMA_TRANSICAO_IBS_MULT = 0.5;
/** [CBS/IBS] Multiplicador médio de ICMS/ISS durante a transição (redução simétrica). */
export const REFORMA_TRANSICAO_ICMS_ISS_MULT = 0.5;

// =====================================================================
// Tipo dos overrides — espelha exatamente as constantes acima
// =====================================================================
export interface TaxRatesOverride {
  irpj?: number;
  irpjAdicional?: number;
  irpjAdicionalGatilhoTri?: number;
  csll?: number;
  pisCum?: number;
  cofinsCum?: number;
  pisNaoCum?: number;
  cofinsNaoCum?: number;
  simplesLimite?: number;
  fatorRMinimo?: number;
  /** Override por anexo. Anexo ausente = usa SIMPLES_TABLES_DEFAULT. */
  simplesTables?: Partial<Record<SimplesAnexo, SimplesFaixa[]>>;
  /** Override por tipo de negócio. Tipo ausente = usa PRESUMIDO_BASES_DEFAULT. */
  presumidoBases?: Partial<Record<BusinessType, PresumidoBases>>;
  reformaTransicaoIbsMult?: number;
  reformaTransicaoIcmsIssMult?: number;
}

// =====================================================================
// RESOLVERS — leem override ?? default. Sem `??` espalhado pelo cálculo.
// =====================================================================
const ov = (tax: TaxConfig) => tax.ratesOverride;
const pick = <T>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);

export const getIrpjPct = (tax: TaxConfig): number => pick(ov(tax)?.irpj, IRPJ_PCT);
export const getIrpjAdicionalPct = (tax: TaxConfig): number =>
  pick(ov(tax)?.irpjAdicional, IRPJ_ADICIONAL_PCT);
export const getIrpjAdicionalGatilhoTri = (tax: TaxConfig): number =>
  pick(ov(tax)?.irpjAdicionalGatilhoTri, IRPJ_ADICIONAL_GATILHO_TRI);
export const getCsllPct = (tax: TaxConfig): number => pick(ov(tax)?.csll, CSLL_PCT);
export const getPisCumPct = (tax: TaxConfig): number => pick(ov(tax)?.pisCum, PIS_CUM_PCT);
export const getCofinsCumPct = (tax: TaxConfig): number => pick(ov(tax)?.cofinsCum, COFINS_CUM_PCT);
export const getPisNaoCumPct = (tax: TaxConfig): number =>
  pick(ov(tax)?.pisNaoCum, PIS_NAO_CUM_PCT);
export const getCofinsNaoCumPct = (tax: TaxConfig): number =>
  pick(ov(tax)?.cofinsNaoCum, COFINS_NAO_CUM_PCT);
export const getSimplesLimite = (tax: TaxConfig): number =>
  pick(ov(tax)?.simplesLimite, SIMPLES_LIMITE);
export const getFatorRMinimoPct = (tax: TaxConfig): number =>
  pick(ov(tax)?.fatorRMinimo, FATOR_R_MINIMO_PCT);
export const getReformaTransicaoIbsMult = (tax: TaxConfig): number =>
  pick(ov(tax)?.reformaTransicaoIbsMult, REFORMA_TRANSICAO_IBS_MULT);
export const getReformaTransicaoIcmsIssMult = (tax: TaxConfig): number =>
  pick(ov(tax)?.reformaTransicaoIcmsIssMult, REFORMA_TRANSICAO_ICMS_ISS_MULT);

export function getSimplesTable(tax: TaxConfig, anexo: SimplesAnexo): SimplesFaixa[] {
  return ov(tax)?.simplesTables?.[anexo] ?? SIMPLES_TABLES_DEFAULT[anexo];
}

export function getPresumidoBases(tax: TaxConfig, business: BusinessType): PresumidoBases {
  return ov(tax)?.presumidoBases?.[business] ?? PRESUMIDO_BASES_DEFAULT[business];
}
