/**
 * Engine de comparação CLT vs PJ.
 *
 * Compara a renda líquida anual de um profissional CLT contra três regimes PJ:
 *  - MEI (DAS fixo, teto R$ 81.000/ano)
 *  - Simples Nacional Anexo III (serviços, alíquota efetiva configurável)
 *  - Lucro Presumido (serviços — base de presunção 32%)
 *
 * Engine pura. Para uso pedagógico/consultivo — não substitui contador.
 *
 * Bases:
 *  - INSS 2025 (faixas progressivas) e IRRF 2025
 *  - INSS Pró-labore: 11% (até o teto INSS)
 *  - MEI: DAS R$ ~76 (comércio/indústria) ou R$ ~80 (serviços) — default serviços
 *  - Lucro Presumido serviços: IRPJ 15% × 32% + CSLL 9% × 32% + PIS 0,65% + COFINS 3% + ISS ~5% ≈ 16,33%
 *  - FGTS 8%, 13º, férias + 1/3 incluídos no pacote CLT
 */
import { z } from "zod";
import { calcularINSS, calcularIRRF } from "./rescisao";

export type RegimePJ = "mei" | "simples" | "presumido";

export const regimePJLabel: Record<RegimePJ, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
};

/** Parâmetros tributários por regime (ajustáveis). */
export const PARAMETROS_PJ = {
  mei: { aliquotaImpostos: 0, dasFixoMensal: 80, tetoFaturamentoAnual: 81000 },
  // Simples: alíquota efetiva é CALCULADA por faixa (Anexo III) — ver aliquotaSimplesAnexoIII().
  // Mantemos um fallback informativo de ~9,3% para fins de tooltip apenas.
  simples: { aliquotaImpostos: 0.093, dasFixoMensal: 0, tetoFaturamentoAnual: 4_800_000 },
  presumido: { aliquotaImpostos: 0.1633, dasFixoMensal: 0, tetoFaturamentoAnual: 78_000_000 },
} as const;

/**
 * Tabela do Simples Nacional — Anexo III (serviços em geral).
 * LC 123/2006 e atualizações. Cada faixa: até (RBT12), alíquota nominal, parcela a deduzir.
 * Alíquota efetiva = (RBT12 × Aliq − PD) ÷ RBT12.
 */
const SIMPLES_ANEXO_III: readonly { ate: number; aliq: number; pd: number }[] = [
  { ate: 180_000,    aliq: 0.0600, pd: 0 },
  { ate: 360_000,    aliq: 0.1120, pd: 9_360 },
  { ate: 720_000,    aliq: 0.1350, pd: 17_640 },
  { ate: 1_800_000,  aliq: 0.1600, pd: 35_640 },
  { ate: 3_600_000,  aliq: 0.2100, pd: 125_640 },
  { ate: 4_800_000,  aliq: 0.3300, pd: 648_000 },
];

/**
 * Alíquota efetiva do Simples Nacional Anexo III dado o faturamento mensal.
 * Usa o próprio faturamento × 12 como proxy de RBT12 (válido para regime estável).
 */
export function aliquotaSimplesAnexoIII(faturamentoMensal: number): number {
  const rbt12 = Math.max(0, faturamentoMensal * 12);
  if (rbt12 === 0) return 0;
  const faixa = SIMPLES_ANEXO_III.find((f) => rbt12 <= f.ate) ?? SIMPLES_ANEXO_III[SIMPLES_ANEXO_III.length - 1];
  const efetiva = (rbt12 * faixa.aliq - faixa.pd) / rbt12;
  return Math.max(0, efetiva);
}

/**
 * Tabela de tributação EXCLUSIVA da PLR (Lei 14.020/2020 art. 11; valores anuais).
 * Vigente desde 2014, atualizada por leis posteriores.
 */
const PLR_FAIXAS: readonly { ate: number; aliq: number; deducao: number }[] = [
  { ate: 7_640.80,  aliq: 0.000, deducao: 0 },
  { ate: 9_922.28,  aliq: 0.075, deducao: 573.06 },
  { ate: 13_167.00, aliq: 0.150, deducao: 1_317.23 },
  { ate: 16_380.38, aliq: 0.225, deducao: 2_304.76 },
  { ate: Infinity,  aliq: 0.275, deducao: 3_123.78 },
];

/** Calcula IR exclusivo de PLR conforme tabela anual. */
export function irrfPlr(plrAnual: number): number {
  if (plrAnual <= 0) return 0;
  const faixa = PLR_FAIXAS.find((f) => plrAnual <= f.ate) ?? PLR_FAIXAS[PLR_FAIXAS.length - 1];
  const imposto = plrAnual * faixa.aliq - faixa.deducao;
  return Math.max(0, Math.round(imposto * 100) / 100);
}

export const TETO_INSS_2025 = 8157.41;
export const SALARIO_MINIMO_2025 = 1518.00;
export const PRO_LABORE_PCT_DEFAULT = 0.28;

// ============================================================================
// Schema
// ============================================================================

export const cltVsPjInputSchema = z.object({
  // CLT
  salarioBrutoCLT: z.number().min(0),
  dependentesIR: z.number().int().min(0).default(0),
  plrAnual: z.number().min(0).default(0),
  beneficiosCLTMensal: z.number().min(0).default(0),
  // PJ
  faturamentoPJMensal: z.number().min(0),
  contabilidadeMensal: z.number().min(0).default(0),
  planoSaudeMensal: z.number().min(0).default(0),
  proLaborePct: z.number().min(0).max(1).default(PRO_LABORE_PCT_DEFAULT),
});

export type CltVsPjInput = z.infer<typeof cltVsPjInputSchema>;

// ============================================================================
// CLT
// ============================================================================

export interface ResultadoCLT {
  salarioBruto: number;
  inssMensal: number;
  irrfMensal: number;
  liquidoMensal: number;
  liquidoAnual: number;          // 12× líquido
  decimoLiquido: number;         // 13º líquido (INSS+IRRF separado)
  feriasLiquidas: number;        // 1 mês + 1/3 líquido
  plrLiquido: number;
  beneficiosAnuais: number;
  fgtsAnual: number;             // depositado pela empresa (não soma no total CLT por padrão)
  multaFGTSPotencial: number;    // 40% do FGTS de 1 ano (referência)
  totalAnualLiquido: number;     // líquido recebido na mão (sem FGTS)
}

function liquidoMensalCLT(salario: number, dependentes: number) {
  const inss = calcularINSS(salario);
  const irrf = calcularIRRF(salario, inss, dependentes);
  return { inss, irrf, liquido: Math.round((salario - inss - irrf) * 100) / 100 };
}

export function calcularCLT(i: CltVsPjInput): ResultadoCLT {
  const { inss, irrf, liquido } = liquidoMensalCLT(i.salarioBrutoCLT, i.dependentesIR);
  const liquidoAnual = liquido * 12;

  // 13º — cálculo separado (INSS+IRRF próprios)
  const decimo = liquidoMensalCLT(i.salarioBrutoCLT, 0).liquido;

  // Férias + 1/3
  const baseFerias = i.salarioBrutoCLT + i.salarioBrutoCLT / 3;
  const inssFerias = calcularINSS(baseFerias);
  const irrfFerias = calcularIRRF(baseFerias, inssFerias, 0);
  const feriasLiquidas = Math.round((baseFerias - inssFerias - irrfFerias) * 100) / 100;

  // PLR — tributação especial (Lei 10.101/00). Simplificação: aplica IRRF exclusivo (~10% efetivo aprox)
  const plrLiquido = Math.round(i.plrAnual * 0.9 * 100) / 100;

  const beneficiosAnuais = i.beneficiosCLTMensal * 12;
  const fgtsAnual = Math.round(i.salarioBrutoCLT * 0.08 * 12 * 100) / 100;
  const multaFGTSPotencial = Math.round(fgtsAnual * 0.40 * 100) / 100;

  const totalAnualLiquido = Math.round((liquidoAnual + decimo + feriasLiquidas + plrLiquido + beneficiosAnuais) * 100) / 100;

  return {
    salarioBruto: i.salarioBrutoCLT,
    inssMensal: inss,
    irrfMensal: irrf,
    liquidoMensal: liquido,
    liquidoAnual: Math.round(liquidoAnual * 100) / 100,
    decimoLiquido: decimo,
    feriasLiquidas,
    plrLiquido,
    beneficiosAnuais,
    fgtsAnual,
    multaFGTSPotencial,
    totalAnualLiquido,
  };
}

// ============================================================================
// PJ
// ============================================================================

export interface ResultadoPJ {
  regime: RegimePJ;
  faturamentoMensal: number;
  aliquotaImpostos: number;       // efetiva sobre faturamento
  impostosMensal: number;
  proLaboreMensal: number;
  inssProLaboreMensal: number;
  irrfProLaboreMensal: number;
  custosFixosMensal: number;
  liquidoMensal: number;
  liquidoAnual: number;
  acimaDoTetoRegime: boolean;
}

export function calcularPJ(regime: RegimePJ, i: CltVsPjInput): ResultadoPJ {
  const params = PARAMETROS_PJ[regime];
  const fat = i.faturamentoPJMensal;

  // Impostos: MEI usa DAS fixo, demais usam alíquota efetiva sobre faturamento
  const impostosMensal = regime === "mei"
    ? params.dasFixoMensal
    : Math.round(fat * params.aliquotaImpostos * 100) / 100;
  const aliquotaEfetiva = fat > 0 ? impostosMensal / fat : params.aliquotaImpostos;

  // Pró-labore: 28% do faturamento, mínimo 1 salário-mínimo (no MEI o pró-labore é opcional —
  // se faturamento ≤ teto, manter mínimo para fins previdenciários é boa prática).
  const proLabore = Math.max(SALARIO_MINIMO_2025, fat * i.proLaborePct);
  // INSS pró-labore: 11% até o teto.
  // ATENÇÃO: o MEI já recolhe a contribuição previdenciária (5% do salário mínimo)
  // embutida no DAS fixo, logo NÃO se aplica 11% adicional sobre o pró-labore.
  const baseInss = Math.min(proLabore, TETO_INSS_2025);
  const inssProLabore = regime === "mei"
    ? 0
    : Math.round(baseInss * 0.11 * 100) / 100;
  // IRRF sobre (pró-labore − INSS) — sem dependentes (apuração simplificada).
  // MEI: como não há pró-labore formal nem retenção de INSS de contribuinte
  // individual, também não há retenção de IRRF típica do pró-labore.
  const irrfProLabore = regime === "mei" ? 0 : calcularIRRF(proLabore, inssProLabore, 0);

  const custosFixos = i.contabilidadeMensal + i.planoSaudeMensal;

  const liquidoMensal = Math.round(
    (fat - impostosMensal - inssProLabore - irrfProLabore - custosFixos) * 100,
  ) / 100;

  return {
    regime,
    faturamentoMensal: fat,
    aliquotaImpostos: aliquotaEfetiva,
    impostosMensal,
    proLaboreMensal: Math.round(proLabore * 100) / 100,
    inssProLaboreMensal: inssProLabore,
    irrfProLaboreMensal: irrfProLabore,
    custosFixosMensal: custosFixos,
    liquidoMensal,
    liquidoAnual: Math.round(liquidoMensal * 12 * 100) / 100,
    acimaDoTetoRegime: fat * 12 > params.tetoFaturamentoAnual,
  };
}

// ============================================================================
// Comparativo
// ============================================================================

export interface ComparativoCltVsPj {
  clt: ResultadoCLT;
  pj: Record<RegimePJ, ResultadoPJ>;
  melhorRegimePJ: RegimePJ;
  diferencaAnual: number;    // melhor PJ − CLT (positivo = PJ ganha)
  diferencaMensal: number;
  vencedor: "clt" | "pj";
  /** Faturamento PJ necessário para igualar líquido CLT, por regime. */
  faturamentoEmpate: Record<RegimePJ, number>;
}

function faturamentoParaIgualar(regime: RegimePJ, alvoMensal: number, i: CltVsPjInput): number {
  // Busca binária (faturamento ≥ alvo). Iterativa, rápida e simples.
  let lo = 0, hi = Math.max(alvoMensal * 5, 100000);
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const liq = calcularPJ(regime, { ...i, faturamentoPJMensal: mid }).liquidoMensal;
    if (liq < alvoMensal) lo = mid; else hi = mid;
  }
  return Math.round(hi * 100) / 100;
}

export function compararCltVsPj(input: CltVsPjInput): ComparativoCltVsPj {
  const i = cltVsPjInputSchema.parse(input);
  const clt = calcularCLT(i);
  const pj: Record<RegimePJ, ResultadoPJ> = {
    mei: calcularPJ("mei", i),
    simples: calcularPJ("simples", i),
    presumido: calcularPJ("presumido", i),
  };

  const ranking: RegimePJ[] = (["mei", "simples", "presumido"] as RegimePJ[])
    .filter((r) => !pj[r].acimaDoTetoRegime || r === "presumido");
  const melhor = ranking.sort((a, b) => pj[b].liquidoAnual - pj[a].liquidoAnual)[0] ?? "presumido";

  const cltLiquidoMensalEquivalente = clt.totalAnualLiquido / 12;
  const diferencaAnual = Math.round((pj[melhor].liquidoAnual - clt.totalAnualLiquido) * 100) / 100;
  const diferencaMensal = Math.round((diferencaAnual / 12) * 100) / 100;

  return {
    clt, pj,
    melhorRegimePJ: melhor,
    diferencaAnual,
    diferencaMensal,
    vencedor: diferencaAnual >= 0 ? "pj" : "clt",
    faturamentoEmpate: {
      mei: faturamentoParaIgualar("mei", cltLiquidoMensalEquivalente, i),
      simples: faturamentoParaIgualar("simples", cltLiquidoMensalEquivalente, i),
      presumido: faturamentoParaIgualar("presumido", cltLiquidoMensalEquivalente, i),
    },
  };
}
