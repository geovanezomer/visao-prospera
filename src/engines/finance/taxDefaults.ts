/**
 * Valores oficiais "fonte da verdade" para alíquotas e tabelas tributárias
 * brasileiras + resolvers que aplicam overrides do usuário (TaxConfig.ratesOverride).
 *
 * Toda constante mágica que antes vivia em `dre.ts`/`indicators.ts`/`tax/*` foi movida para cá.
 * O `dre.ts`/`indicators.ts`/`tax/*` agora consulta este módulo via funções `getX(tax)`.
 *
 * Política: undefined em ratesOverride → retorna o padrão oficial. Permite
 * "esvaziar um campo no painel = voltar ao oficial" sem precisar limpar nada.
 */
import type { BusinessType, SimplesAnexo, TaxConfig } from "./types";
import { getTabelas } from "@/engines/calculadoras/tabelas";

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
// REFORMA TRIBUTÁRIA — alíquotas plenas de referência (CBS/IBS)
// LC 214/2025 — valores indicativos divulgados pelo Ministério da Fazenda.
// O usuário pode sobrepor pelos campos `tax.cbsAliquota` e `tax.ibsAliquotaRef`.
// =====================================================================
/** [CBS/IBS] CBS plena de referência (%). */
export const CBS_ALIQUOTA_PLENA = 8.8;
/** [CBS/IBS] IBS pleno de referência (%). */
export const IBS_ALIQUOTA_PLENA = 17.7;
/** [CBS/IBS] CBS na fase de TESTE 2026 (compensável com PIS/COFINS). */
export const CBS_ALIQUOTA_2026_TESTE = 0.9;

// =====================================================================
// REFORMA TRIBUTÁRIA — créditos presumidos (fornecedor Simples Nacional)
// Valores provisórios até regulamentação definitiva da LC 214/2025.
// =====================================================================
/** [CBS/IBS] Crédito presumido CBS sobre compras de fornecedor SN (%). */
export const ALIQ_PRESUMIDA_CBS_SN = 3.0;
/** [CBS/IBS] Crédito presumido IBS sobre compras de fornecedor SN (%). */
export const ALIQ_PRESUMIDA_IBS_SN = 1.2;

// =====================================================================
// FOLHA & SÓCIOS — INSS contribuinte individual, IRPF mensal, piso legal
// (Plano v3 — todos editáveis via lightbox "Folha & Sócios")
// =====================================================================
/** Salário mínimo nacional vigente (R$/mês) — piso para pró-labore de sócio operacional. */
export const SALARIO_MINIMO_DEFAULT = getTabelas().salarioMinimo;
/** INSS sócio (contribuinte individual) — plano simplificado, Lei 9.876/99. */
export const INSS_SOCIO_ALIQ_DEFAULT = 11;
/** Teto contributivo do INSS (R$/mês) — Portaria Interministerial MPS/MF nº 13/2026. */
export const INSS_TETO_DEFAULT = getTabelas().inssTeto;
/** Cota patronal de INSS sobre pró-labore (Lucro Presumido/Real). */
export const INSS_PATRONAL_ALIQ_DEFAULT = 20;
/** Faixa do IRPF mensal: [até R$, alíquota %, parcela a deduzir R$]. */
export type IrpfFaixa = [number, number, number];
/**
 * Tabela mensal do IRPF do ano vigente. Fonte única: calculadoras/tabelas.ts
 * (antes havia uma cópia aqui, parada na tabela de maio/2024).
 */
export const IRPF_TABLE_DEFAULT: IrpfFaixa[] = getTabelas().irrfFaixas.map((f) => [
  f.ate === Infinity ? Number.POSITIVE_INFINITY : f.ate,
  Math.round(f.aliquota * 1000) / 10,
  f.deduzir,
]);
/** Dedução por dependente no IRPF mensal (R$). */
export const IRPF_DEPENDENTE_DEDUCAO_DEFAULT = getTabelas().irrfDependente;
/** Desconto simplificado mensal (R$). */
export const IRPF_DESCONTO_SIMPLIFICADO_DEFAULT = getTabelas().irrfDescontoSimplificado;

export interface PayrollOverride {
  salarioMinimo?: number;
  inssSocioAliq?: number;
  inssTeto?: number;
  inssPatronalAliq?: number;
  /** Quando true, Simples Nacional também recolhe patronal (Anexo IV). Default false. */
  inssPatronalSimples?: boolean;
  irpfTable?: IrpfFaixa[];
  irpfDependenteDeducao?: number;
  irpfDescontoSimplificado?: number;
  /** Quando true, sistema escolhe automaticamente entre tradicional × simplificado. Default true. */
  irpfSimplificadoAuto?: boolean;
  /** Quando true E regime=Presumido, distribuição isenta é limitada por (Base presunção − tributos federais).
   *  False = presume escrituração contábil completa, distribuição livre. Default true. */
  distribuicaoLimitePresumidoAuto?: boolean;
}

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
  /** IRRF sobre rendimentos de aplicações financeiras (%) — Presumido. */
  irrfAplicacoesPct?: number;
  /** Parâmetros de folha & sócios (Plano v3). */
  payroll?: PayrollOverride;
}

// =====================================================================
// RESOLVERS — leem override ?? default e CLAMPAM na faixa hard do campo.
// A clampagem é defesa em profundidade: mesmo um snapshot .finnance
// antigo/corrompido com alíquotas absurdas não injeta lixo na engine.
// A validação com aviso/erro para a UI vive em tax/validation.ts.
// =====================================================================
import { clampCampo, type CampoTributario } from "./tax/validation";
const ov = (tax: TaxConfig) => tax.ratesOverride;
const pick = <T>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);
/** Clampa o resultado final na faixa hard do campo tributário. */
const clamped = (campo: CampoTributario, v: number): number => clampCampo(campo, v);

export const getIrpjPct = (tax: TaxConfig): number =>
  clamped("irpj", pick(ov(tax)?.irpj, IRPJ_PCT));
export const getIrpjAdicionalPct = (tax: TaxConfig): number =>
  clamped("irpjAdicional", pick(ov(tax)?.irpjAdicional, IRPJ_ADICIONAL_PCT));
export const getIrpjAdicionalGatilhoTri = (tax: TaxConfig): number =>
  pick(ov(tax)?.irpjAdicionalGatilhoTri, IRPJ_ADICIONAL_GATILHO_TRI);
export const getCsllPct = (tax: TaxConfig): number =>
  clamped("csll", pick(ov(tax)?.csll, CSLL_PCT));
export const getPisCumPct = (tax: TaxConfig): number =>
  clamped("pisCum", pick(ov(tax)?.pisCum, PIS_CUM_PCT));
export const getCofinsCumPct = (tax: TaxConfig): number =>
  clamped("cofinsCum", pick(ov(tax)?.cofinsCum, COFINS_CUM_PCT));
export const getPisNaoCumPct = (tax: TaxConfig): number =>
  clamped("pisNaoCum", pick(ov(tax)?.pisNaoCum, PIS_NAO_CUM_PCT));
export const getCofinsNaoCumPct = (tax: TaxConfig): number =>
  clamped("cofinsNaoCum", pick(ov(tax)?.cofinsNaoCum, COFINS_NAO_CUM_PCT));
export const getSimplesLimite = (tax: TaxConfig): number =>
  pick(ov(tax)?.simplesLimite, SIMPLES_LIMITE);
export const getFatorRMinimoPct = (tax: TaxConfig): number =>
  clamped("fatorRMinimo", pick(ov(tax)?.fatorRMinimo, FATOR_R_MINIMO_PCT));
export const getReformaTransicaoIbsMult = (tax: TaxConfig): number =>
  pick(ov(tax)?.reformaTransicaoIbsMult, REFORMA_TRANSICAO_IBS_MULT);
export const getReformaTransicaoIcmsIssMult = (tax: TaxConfig): number =>
  pick(ov(tax)?.reformaTransicaoIcmsIssMult, REFORMA_TRANSICAO_ICMS_ISS_MULT);

/** IRRF sobre rendimentos de aplicações financeiras (%) — Presumido.
 *  Default 15% (regra geral para aplicações > 720 dias). Override via
 *  `tax.ratesOverride.irrfAplicacoesPct` ou `tax.irrfAplicacoesPct`. */
export const getIrrfAplicacoesPct = (tax: TaxConfig): number =>
  pick(ov(tax)?.irrfAplicacoesPct, pick(tax.irrfAplicacoesPct, 15));

export function getSimplesTable(tax: TaxConfig, anexo: SimplesAnexo): SimplesFaixa[] {
  return ov(tax)?.simplesTables?.[anexo] ?? SIMPLES_TABLES_DEFAULT[anexo];
}

export function getPresumidoBases(tax: TaxConfig, business: BusinessType): PresumidoBases {
  const raw = ov(tax)?.presumidoBases?.[business] ?? PRESUMIDO_BASES_DEFAULT[business];
  return {
    irpj: clamped("presumidoBaseIRPJ", raw.irpj),
    csll: clamped("presumidoBaseCSLL", raw.csll),
  };
}

/** [CBS/IBS] Alíquota CBS plena (%) — lê `tax.cbsAliquota` ou cai no default oficial. */
export const getCbsAliquota = (tax: TaxConfig): number =>
  clamped("cbsAliquota", pick(tax.cbsAliquota, CBS_ALIQUOTA_PLENA));

/** [CBS/IBS] Alíquota IBS plena de referência (%) — lê `tax.ibsAliquotaRef` ou cai no default oficial. */
export const getIbsAliquotaRef = (tax: TaxConfig): number =>
  clamped("ibsAliquotaRef", pick(tax.ibsAliquotaRef, IBS_ALIQUOTA_PLENA));

/** [Split Payment LC 214/2025] Default `true` — projeto Lovable trabalha com Split ativo. */
export const SPLIT_PAYMENT_DEFAULT = true;
export const SPLIT_PAYMENT_ANO_INICIO_DEFAULT = 2027;
export const getSplitPaymentAtivo = (tax: TaxConfig): boolean =>
  pick(tax.splitPaymentAtivo, SPLIT_PAYMENT_DEFAULT);
export const getSplitPaymentAnoInicio = (tax: TaxConfig): number =>
  pick(tax.splitPaymentAnoInicio, SPLIT_PAYMENT_ANO_INICIO_DEFAULT);

// =====================================================================
// FOLHA & SÓCIOS — resolvers (lê override.payroll ?? default oficial)
// =====================================================================
const payroll = (tax: TaxConfig) => ov(tax)?.payroll;
export const getSalarioMinimo = (tax: TaxConfig): number =>
  pick(payroll(tax)?.salarioMinimo, SALARIO_MINIMO_DEFAULT);
export const getInssSocioAliq = (tax: TaxConfig): number =>
  pick(payroll(tax)?.inssSocioAliq, INSS_SOCIO_ALIQ_DEFAULT);
export const getInssTeto = (tax: TaxConfig): number =>
  pick(payroll(tax)?.inssTeto, INSS_TETO_DEFAULT);
export const getInssPatronalAliq = (tax: TaxConfig): number =>
  pick(payroll(tax)?.inssPatronalAliq, INSS_PATRONAL_ALIQ_DEFAULT);
export const getInssPatronalSimples = (tax: TaxConfig): boolean =>
  pick(payroll(tax)?.inssPatronalSimples, false);
export const getIrpfTable = (tax: TaxConfig): IrpfFaixa[] =>
  payroll(tax)?.irpfTable ?? IRPF_TABLE_DEFAULT;
export const getIrpfDependenteDeducao = (tax: TaxConfig): number =>
  pick(payroll(tax)?.irpfDependenteDeducao, IRPF_DEPENDENTE_DEDUCAO_DEFAULT);
export const getIrpfDescontoSimplificado = (tax: TaxConfig): number =>
  pick(payroll(tax)?.irpfDescontoSimplificado, IRPF_DESCONTO_SIMPLIFICADO_DEFAULT);
export const getIrpfSimplificadoAuto = (tax: TaxConfig): boolean =>
  pick(payroll(tax)?.irpfSimplificadoAuto, true);
export const getDistribuicaoLimitePresumidoAuto = (tax: TaxConfig): boolean =>
  pick(payroll(tax)?.distribuicaoLimitePresumidoAuto, true);
