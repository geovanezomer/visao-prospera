// =====================================================================
// THRESHOLDS — fonte única de verdade para classificação de indicadores.
//
// Princípio: a engine calcula os números, esta tabela traduz cada número
// em um nível qualitativo (critico/atencao/ok/excelente). A LLM NÃO faz
// essa classificação — recebe o nível pronto.
//
// Edição manual rara. Quando alterar, documentar fonte (ex.: Damodaran,
// IBGE PIA, Sebrae, Confaz) no comentário ao lado do valor.
//
// Roadmap: a chave `default` cobre 100% dos casos hoje. Quando tivermos
// benchmarks setoriais (Fase 2), criar overrides por `setor` reutilizando
// a mesma estrutura — fallback automático para `default`.
// =====================================================================

/** Códigos de setor suportados. Mapear CNAE→Setor é responsabilidade do app. */
export type Setor =
  | "default"
  | "varejo"
  | "servicos"
  | "industria"
  | "saas"
  | "construcao"
  | "alimentacao";

/** Direção de "melhora" do indicador. */
export type Direcao = "maior_melhor" | "menor_melhor";

/** Faixas em ordem: critico → atencao → ok → excelente. */
export interface ThresholdRange {
  /** Limite acima do qual é "crítico" (menor_melhor) ou abaixo do qual é "crítico" (maior_melhor). */
  critico: number;
  /** Faixa intermediária inferior. */
  atencao: number;
  /** Faixa "ok"/saudável. */
  ok: number;
  /** Acima disso é "excelente" (maior_melhor) ou abaixo disso é "excelente" (menor_melhor). */
  excelente: number;
  /** Direção qualitativa do indicador. */
  direcao: Direcao;
  /** Unidade humana — usada só pra debug/exibição. */
  unidade: "%" | "x" | "dias" | "R$" | "ratio";
  /** Fonte/justificativa da escolha dos cortes. */
  fonte: string;
}

/** Chaves dos indicadores classificáveis — subset de `Indicators` que faz sentido qualificar. */
export type IndicadorKey =
  | "margemBruta"
  | "margemEbitda"
  | "margemLiquida"
  | "margemContribuicao"
  | "roe"
  | "roic"
  | "roicVsWacc"
  | "liquidezCorrente"
  | "liquidezSeca"
  | "dividaLiqEbitda"
  | "coberturaJuros"
  | "dscr"
  | "endividamentoGeral"
  | "cicloFinanceiro"
  | "margemSeguranca"
  | "conversaoEbitdaCaixa"
  | "custoPessoalSobreReceita"
  | "qualidadeLucro";

/** Tabela base — cortes neutros para PMEs brasileiras genéricas. */
const DEFAULT_THRESHOLDS: Record<IndicadorKey, ThresholdRange> = {
  // Rentabilidade
  margemBruta: {
    critico: 15,
    atencao: 25,
    ok: 35,
    excelente: 50,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Mediana PME serviço/varejo (Sebrae Indicadores 2023)",
  },
  margemEbitda: {
    critico: 5,
    atencao: 10,
    ok: 15,
    excelente: 25,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Damodaran emerging markets + Sebrae PME",
  },
  margemLiquida: {
    critico: 0,
    atencao: 3,
    ok: 8,
    excelente: 15,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Mediana PME pós-IRPJ/CSLL (Sebrae 2023)",
  },
  margemContribuicao: {
    critico: 20,
    atencao: 35,
    ok: 50,
    excelente: 65,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Garrison/Horngren — heurística clássica de gestão",
  },

  // Retorno
  roe: {
    critico: 5,
    atencao: 12,
    ok: 18,
    excelente: 25,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Selic neutra + prêmio de risco PME (~6-10pp)",
  },
  roic: {
    critico: 5,
    atencao: 10,
    ok: 15,
    excelente: 20,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Damodaran ROIC by industry, brasil ajustado",
  },
  /** Spread ROIC-WACC: indicador-chave de criação de valor econômico (EVA). */
  roicVsWacc: {
    critico: -2,
    atencao: 0,
    ok: 3,
    excelente: 8,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "EVA clássico (Stern Stewart) — spread positivo = cria valor",
  },

  // Liquidez
  liquidezCorrente: {
    critico: 0.9,
    atencao: 1.2,
    ok: 1.5,
    excelente: 2.0,
    direcao: "maior_melhor",
    unidade: "ratio",
    fonte: "Matarazzo — Análise das Demonstrações Contábeis",
  },
  liquidezSeca: {
    critico: 0.7,
    atencao: 1.0,
    ok: 1.3,
    excelente: 1.6,
    direcao: "maior_melhor",
    unidade: "ratio",
    fonte: "Matarazzo — Análise das Demonstrações Contábeis",
  },

  // Endividamento (menor melhor)
  dividaLiqEbitda: {
    critico: 4,
    atencao: 3,
    ok: 2,
    excelente: 1,
    direcao: "menor_melhor",
    unidade: "x",
    fonte: "Covenant bancário típico (Bacen) — 3x é teto de conforto",
  },
  coberturaJuros: {
    critico: 1.5,
    atencao: 2.5,
    ok: 4,
    excelente: 6,
    direcao: "maior_melhor",
    unidade: "x",
    fonte: "Moody's/S&P bandas de rating — <2x é grau especulativo",
  },
  dscr: {
    critico: 1.0,
    atencao: 1.25,
    ok: 1.5,
    excelente: 2.0,
    direcao: "maior_melhor",
    unidade: "x",
    fonte: "Project finance padrão Bacen — DSCR < 1.25x trava captação",
  },
  endividamentoGeral: {
    critico: 75,
    atencao: 60,
    ok: 50,
    excelente: 35,
    direcao: "menor_melhor",
    unidade: "%",
    fonte: "Mediana PME brasileira (Serasa Experian)",
  },

  // Operacional
  cicloFinanceiro: {
    critico: 90,
    atencao: 60,
    ok: 30,
    excelente: 0,
    direcao: "menor_melhor",
    unidade: "dias",
    fonte: "Ciclo > 60 dias pressiona NCG (heurística CFO PME)",
  },
  margemSeguranca: {
    critico: 5,
    atencao: 15,
    ok: 25,
    excelente: 40,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "Garrison — folga até o ponto de equilíbrio",
  },
  conversaoEbitdaCaixa: {
    critico: 30,
    atencao: 50,
    ok: 70,
    excelente: 85,
    direcao: "maior_melhor",
    unidade: "%",
    fonte: "FCF/EBITDA — heurística de qualidade do EBITDA",
  },
  custoPessoalSobreReceita: {
    critico: 50,
    atencao: 35,
    ok: 25,
    excelente: 15,
    direcao: "menor_melhor",
    unidade: "%",
    fonte: "Mediana PME serviços (Sebrae) — varia muito por setor",
  },
  qualidadeLucro: {
    critico: 0.3,
    atencao: 0.6,
    ok: 0.9,
    excelente: 1.1,
    direcao: "maior_melhor",
    unidade: "ratio",
    fonte: "FCF/LL ~ 1.0 = lucro contábil vira caixa",
  },
};

/**
 * Overrides setoriais — vazio hoje. Estrutura pronta para Fase 2 (benchmarks).
 * Exemplo futuro:
 *   varejo: { margemEbitda: { critico: 3, atencao: 6, ok: 10, excelente: 15, ... } }
 */
const SETOR_OVERRIDES: Partial<Record<Setor, Partial<Record<IndicadorKey, ThresholdRange>>>> = {};

/**
 * Retorna a faixa de thresholds para um indicador, considerando override setorial
 * quando disponível. Fallback determinístico para `default`.
 */
export function getThreshold(indicador: IndicadorKey, setor: Setor = "default"): ThresholdRange {
  const override = SETOR_OVERRIDES[setor]?.[indicador];
  return override ?? DEFAULT_THRESHOLDS[indicador];
}

/** Tabela completa — exposta para inspeção/debug (modo engenheiro). */
export const THRESHOLDS_DEFAULT = DEFAULT_THRESHOLDS;
