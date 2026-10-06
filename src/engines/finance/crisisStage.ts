// =====================================================================
// TERMÔMETRO DE CRISE — Estágios operacionais de insolvência
// Complementa o Kanitz com leitura PRÁTICA da fase de crise e a
// rota recomendada (Lei 11.101/2005, atualizada pela Lei 14.112/2020).
//
//   Estágio 0 — Saudável
//   Estágio 1 — DECLÍNIO         (margens caindo, ainda gera FCO)
//   Estágio 2 — ILIQUIDEZ        (FCO ≤ 0 ou Liq. Corrente < 1)
//   Estágio 3 — INSOLVÊNCIA TÉCNICA  (PL ≤ 0 OU Dívida Líq/EBITDA > 7)
//   Estágio 4 — INSOLVÊNCIA JURÍDICA (PL ≤ 0 + EBITDA ≤ 0, default iminente)
//
// Recomendação por estágio:
//   0 → Disciplina e monitoramento
//   1 → Plano de eficiência (corte OPEX, revisão pricing)
//   2 → Renegociação extrajudicial direta com credores
//   3 → Recuperação Extrajudicial (Lei 11.101 art. 161)
//   4 → Recuperação Judicial (Lei 11.101 art. 47) — stay de 180 dias
//
// Função pura. Não muta nada. Lê só state + indicators (SSOT).
// =====================================================================
import type { AppState } from "./types";
import type { Indicators } from "./indicators";

export type CrisisStage = 0 | 1 | 2 | 3 | 4;
export type CrisisTone = "pos" | "warn" | "neg" | "crit" | "muted";

export interface CrisisAssessment {
  stage: CrisisStage;
  label: string;
  tone: CrisisTone;
  /** Descrição curta da fase em pt-BR. */
  description: string;
  /** Rota recomendada (renegociação → extrajudicial → RJ). */
  recommendation: string;
  /** Base legal/operacional resumida. */
  legalBasis: string;
  /** Sinais que dispararam o estágio (gatilhos atendidos). */
  triggers: string[];
}

const DEFS: Record<CrisisStage, Omit<CrisisAssessment, "triggers">> = {
  0: {
    stage: 0,
    label: "Saudável",
    tone: "pos",
    description:
      "Margens positivas, caixa operacional gerando e estrutura de capital sob controle.",
    recommendation: "Manter disciplina de caixa e revisar covenants trimestralmente.",
    legalBasis: "Operação normal — sem necessidade de medidas de reorganização.",
  },
  1: {
    stage: 1,
    label: "Declínio",
    tone: "warn",
    description:
      "Rentabilidade comprimida, mas a operação ainda gera caixa. Janela para ajustes preventivos.",
    recommendation:
      "Plano de eficiência em 90 dias: corte de OPEX, revisão de pricing e mix de produto.",
    legalBasis: "Fase pré-crise — sem instrumentos judiciais; atuação 100% gerencial.",
  },
  2: {
    stage: 2,
    label: "Iliquidez",
    tone: "neg",
    description:
      "FCO negativo ou liquidez corrente abaixo de 1 — a empresa começa a queimar caixa.",
    recommendation:
      "Renegociação extrajudicial direta com bancos e fornecedores; alongar prazos e suspender CAPEX não essencial.",
    legalBasis:
      "Acordo bilateral com credores (sem homologação judicial). Preserva o nome e o crédito.",
  },
  3: {
    stage: 3,
    label: "Insolvência Técnica",
    tone: "neg",
    description:
      "Patrimônio Líquido negativo OU Dívida Líquida/EBITDA acima de 7×. Estrutura financeira insustentável.",
    recommendation:
      "Recuperação Extrajudicial: negociar plano com classes de credores e homologar em juízo.",
    legalBasis: "Lei 11.101/2005, art. 161 — adesão de ½ + 1 por classe vincula os dissidentes.",
  },
  4: {
    stage: 4,
    label: "Insolvência Jurídica",
    tone: "crit",
    description:
      "PL negativo combinado com EBITDA negativo. Default iminente — falência se nada for feito.",
    recommendation:
      "Pedido de Recuperação Judicial — stay period de 180 dias suspende execuções e protestos.",
    legalBasis:
      "Lei 11.101/2005, art. 47 e 6º. Plano em 60 dias após deferimento; assembleia em até 150 dias.",
  },
};

export function assessCrisisStage(state: AppState, ind: Indicators): CrisisAssessment {
  const PL = state.capital?.patrimonioLiquido ?? 0;
  const ebitda = ind.ebitdaAnual;
  const fco = ind.fcoAnual;
  const liqCorr = ind.liquidezCorrente;
  const dle = ind.dividaLiqEbitda;
  const margemLiq = ind.margemLiquida;
  const margemEbitda = ind.margemEbitda;

  const triggers: string[] = [];

  // Estágio 4 — Insolvência Jurídica
  if (PL <= 0 && ebitda <= 0) {
    triggers.push(`PL ${fmtBRL(PL)} ≤ 0`);
    triggers.push(`EBITDA ${fmtBRL(ebitda)} ≤ 0`);
    return { ...DEFS[4], triggers };
  }

  // Estágio 3 — Insolvência Técnica
  if (PL <= 0) {
    triggers.push(`Patrimônio Líquido negativo (${fmtBRL(PL)})`);
    return { ...DEFS[3], triggers };
  }
  if (ebitda > 0 && dle > 7) {
    triggers.push(`Dívida Líquida/EBITDA = ${dle.toFixed(1)}× (> 7×)`);
    return { ...DEFS[3], triggers };
  }

  // Estágio 2 — Iliquidez
  if (fco < 0) triggers.push(`FCO anual ${fmtBRL(fco)} < 0`);
  if (liqCorr > 0 && liqCorr < 1) triggers.push(`Liquidez Corrente ${liqCorr.toFixed(2)}× < 1,00×`);
  if (triggers.length > 0) return { ...DEFS[2], triggers };

  // Estágio 1 — Declínio
  if (margemLiq <= 0) triggers.push(`Margem Líquida ${margemLiq.toFixed(1)}% ≤ 0`);
  if (margemEbitda <= 5) triggers.push(`Margem EBITDA ${margemEbitda.toFixed(1)}% ≤ 5%`);
  if (triggers.length > 0) return { ...DEFS[1], triggers };

  // Estágio 0 — Saudável
  triggers.push("Margens positivas, FCO positivo, liquidez e alavancagem sob controle.");
  return { ...DEFS[0], triggers };
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}
