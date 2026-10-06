// =====================================================================
// BRIEFING — camada intermediária entre engine e narrativa.
//
// Recebe AppState/DRE/Indicators (números puros) e produz um objeto
// estruturado (Briefing) com:
//   1. Contexto qualitativo da empresa (setor, regime, porte)
//   2. Classificação determinística de cada indicador relevante
//   3. Padrões cruzados detectados (combinações de indicadores)
//   4. Alavancas sugeridas (do catálogo, pré-condicionadas)
//
// REGRA DE OURO: este módulo é 100% determinístico e testável.
// Toda decisão "bom/ruim" mora aqui ou em `thresholds.ts`.
// A LLM (PR2) recebe o Briefing pronto e SÓ escreve texto.
// =====================================================================

import type { AppState } from "./types";
import type { DRE } from "./dre";
import type { Indicators } from "./indicators";
import { sum } from "./format";
import {
  getThreshold,
  type IndicadorKey,
  type Setor,
  type ThresholdRange,
} from "@/data/thresholds";

/** Nível qualitativo — 4 faixas dão narrativa mais rica que ok/warn/danger. */
export type Nivel = "critico" | "atencao" | "ok" | "excelente";

/** Classificação de UM indicador. Tudo serializável (vai pra LLM/log). */
export interface ClassificacaoIndicador {
  indicador: IndicadorKey;
  /** Valor numérico CRU — formatação é responsabilidade da camada de apresentação. */
  valor: number;
  nivel: Nivel;
  /** Cópia do range usado — auditável ("por que foi classificado assim?"). */
  faixa: ThresholdRange;
}

/** Padrão cruzado entre indicadores — identifica "histórias" recorrentes. */
export interface PadraoDetectado {
  /** Identificador estável — serve como chave para alavancas e templates. */
  codigo: string;
  /** Label humano curto. NUNCA usar como texto final ao usuário — LLM/template renderiza. */
  titulo: string;
  /** Severidade — afeta priorização do briefing. */
  severidade: "critico" | "atencao" | "informativo";
  /** Indicadores que dispararam o padrão (para auditoria). */
  indicadoresEnvolvidos: IndicadorKey[];
}

/** Alavanca operacional — recomendação pré-aprovada do catálogo. */
export interface AlavancaSugerida {
  codigo: string;
  titulo: string;
  /** Padrões que disparam essa alavanca. */
  disparadaPor: string[];
}

/** Contexto da empresa — usado pela LLM para adaptar tom e exemplos. */
export interface ContextoEmpresa {
  setor: Setor;
  regimeTributario: string;
  receitaLiquidaAnual: number;
  porte: "micro" | "pequena" | "media" | "grande";
  numColaboradores: number;
}

/** Snapshot completo — input da LLM (PR2) e da camada de fallback template. */
export interface Briefing {
  /** Versão do schema — incrementar quando mudar formato. Permite cache invalidation. */
  schemaVersion: 1;
  /** ISO timestamp da geração. */
  geradoEm: string;
  contexto: ContextoEmpresa;
  classificacoes: ClassificacaoIndicador[];
  padroes: PadraoDetectado[];
  alavancas: AlavancaSugerida[];
  /** Resumo executivo determinístico (não vem da LLM). */
  resumo: {
    nivelGeral: Nivel;
    quantidadeCriticos: number;
    quantidadeAtencao: number;
    indicadoresExcelentes: IndicadorKey[];
  };
}

// =====================================================================
// CLASSIFICAÇÃO — pura, determinística, testável.
// =====================================================================

/**
 * Classifica um valor de indicador em um dos 4 níveis usando os thresholds.
 *
 * Regra para `maior_melhor`:
 *   valor < critico            → "critico"
 *   critico ≤ valor < atencao  → "atencao"
 *   atencao ≤ valor < excelente→ "ok"
 *   valor ≥ excelente          → "excelente"
 *
 * Regra para `menor_melhor` é simétrica.
 */
export function classify(
  indicador: IndicadorKey,
  valor: number,
  setor: Setor = "default",
): ClassificacaoIndicador {
  const faixa = getThreshold(indicador, setor);

  // NaN/Infinity → tratamos como "atencao" (dado faltante, não crítico em si).
  if (!Number.isFinite(valor)) {
    return { indicador, valor: 0, nivel: "atencao", faixa };
  }

  let nivel: Nivel;
  if (faixa.direcao === "maior_melhor") {
    if (valor < faixa.critico) nivel = "critico";
    else if (valor < faixa.atencao) nivel = "atencao";
    else if (valor < faixa.excelente) nivel = "ok";
    else nivel = "excelente";
  } else {
    // menor_melhor: cortes decrescentes (critico > atencao > ok > excelente).
    // A faixa "ok" cobre (excelente, atencao] — não usa o campo `ok` como corte
    // duro porque seria redundante com `atencao` na ordenação invertida.
    if (valor > faixa.critico) nivel = "critico";
    else if (valor > faixa.atencao) nivel = "atencao";
    else if (valor > faixa.excelente) nivel = "ok";
    else nivel = "excelente";
  }

  return { indicador, valor, nivel, faixa };
}

// =====================================================================
// PADRÕES — combinações de indicadores que contam uma "história".
// Cada padrão é uma função pura sobre o conjunto de classificações.
// =====================================================================

type ClassMap = Partial<Record<IndicadorKey, ClassificacaoIndicador>>;

function map(classes: ClassificacaoIndicador[]): ClassMap {
  return classes.reduce<ClassMap>((acc, c) => {
    acc[c.indicador] = c;
    return acc;
  }, {});
}

function nivelDe(c: ClassificacaoIndicador | undefined): Nivel | null {
  return c?.nivel ?? null;
}

const ehRuim = (n: Nivel | null) => n === "critico" || n === "atencao";

/**
 * Catálogo de padrões. Cada um é um detector puro que retorna 0 ou 1 padrão.
 * Manter por aqui (não em JSON): a lógica é declarativa-mas-condicional, código
 * tipado é melhor que dados.
 */
function detectarPadroes(classes: ClassificacaoIndicador[], ind: Indicators): PadraoDetectado[] {
  const c = map(classes);
  const padroes: PadraoDetectado[] = [];

  // P1: Destruição de valor econômico (ROIC < WACC)
  if (ind.roic < ind.wacc - 0.5) {
    padroes.push({
      codigo: "destruicao_valor",
      titulo: "Capital investido rende abaixo do seu custo",
      severidade: "critico",
      indicadoresEnvolvidos: ["roic", "roicVsWacc"],
    });
  }

  // P2: Margem operacional OK mas caixa sofrendo
  if (!ehRuim(nivelDe(c.margemEbitda)) && ehRuim(nivelDe(c.conversaoEbitdaCaixa))) {
    padroes.push({
      codigo: "ebitda_nao_vira_caixa",
      titulo: "EBITDA saudável que não está virando caixa",
      severidade: "atencao",
      indicadoresEnvolvidos: ["margemEbitda", "conversaoEbitdaCaixa"],
    });
  }

  // P3: Alavancagem alta + cobertura fraca = risco bancário
  if (ehRuim(nivelDe(c.dividaLiqEbitda)) && ehRuim(nivelDe(c.coberturaJuros))) {
    padroes.push({
      codigo: "risco_bancario_alto",
      titulo: "Estrutura de dívida pressiona resultado",
      severidade: "critico",
      indicadoresEnvolvidos: ["dividaLiqEbitda", "coberturaJuros", "dscr"],
    });
  }

  // P4: Ciclo financeiro longo amplificando NCG
  if (ehRuim(nivelDe(c.cicloFinanceiro)) && ind.gapCapitalGiro > 0) {
    padroes.push({
      codigo: "ncg_pressionada",
      titulo: "Capital de giro insuficiente para o ciclo operacional",
      severidade: "atencao",
      indicadoresEnvolvidos: ["cicloFinanceiro"],
    });
  }

  // P5: Pouca folga até o ponto de equilíbrio
  if (nivelDe(c.margemSeguranca) === "critico") {
    padroes.push({
      codigo: "margem_seguranca_apertada",
      titulo: "Pouca folga antes de entrar no prejuízo",
      severidade: "critico",
      indicadoresEnvolvidos: ["margemSeguranca"],
    });
  }

  // P6: Folha de pagamento pesa demais
  if (ehRuim(nivelDe(c.custoPessoalSobreReceita))) {
    padroes.push({
      codigo: "folha_pesada",
      titulo: "Custo de pessoal acima do benchmark",
      severidade: "atencao",
      indicadoresEnvolvidos: ["custoPessoalSobreReceita"],
    });
  }

  // P7: Tudo verde
  if (classes.length > 0 && classes.every((cl) => cl.nivel === "ok" || cl.nivel === "excelente")) {
    padroes.push({
      codigo: "saude_solida",
      titulo: "Indicadores saudáveis em toda a estrutura",
      severidade: "informativo",
      indicadoresEnvolvidos: classes.map((cl) => cl.indicador),
    });
  }

  return padroes;
}

// =====================================================================
// ALAVANCAS — catálogo fixo, ativado por código de padrão.
// =====================================================================

const CATALOGO_ALAVANCAS: Record<string, AlavancaSugerida[]> = {
  destruicao_valor: [
    {
      codigo: "revisar_estrutura_capital",
      titulo: "Revisar mix dívida/capital próprio para reduzir WACC",
      disparadaPor: ["destruicao_valor"],
    },
    {
      codigo: "desinvestir_ativos_baixo_retorno",
      titulo: "Identificar e desinvestir ativos com retorno abaixo do WACC",
      disparadaPor: ["destruicao_valor"],
    },
  ],
  ebitda_nao_vira_caixa: [
    {
      codigo: "renegociar_prazo_clientes",
      titulo: "Renegociar PMR — reduzir prazo médio de recebimento",
      disparadaPor: ["ebitda_nao_vira_caixa", "ncg_pressionada"],
    },
    {
      codigo: "otimizar_estoques",
      titulo: "Reduzir cobertura de estoques (PME)",
      disparadaPor: ["ebitda_nao_vira_caixa", "ncg_pressionada"],
    },
  ],
  risco_bancario_alto: [
    {
      codigo: "alongar_perfil_divida",
      titulo: "Alongar perfil da dívida para aliviar serviço",
      disparadaPor: ["risco_bancario_alto"],
    },
    {
      codigo: "buscar_funding_alternativo",
      titulo: "Buscar funding alternativo (equity, FIDC, debênture)",
      disparadaPor: ["risco_bancario_alto"],
    },
  ],
  ncg_pressionada: [
    {
      codigo: "negociar_prazo_fornecedores",
      titulo: "Ampliar PMP — negociar prazo de pagamento a fornecedores",
      disparadaPor: ["ncg_pressionada"],
    },
  ],
  margem_seguranca_apertada: [
    {
      codigo: "revisar_estrutura_custos_fixos",
      titulo: "Revisar custos fixos — reduzir ponto de equilíbrio",
      disparadaPor: ["margem_seguranca_apertada"],
    },
    {
      codigo: "mix_mais_rentavel",
      titulo: "Direcionar mix comercial para produtos de maior margem",
      disparadaPor: ["margem_seguranca_apertada"],
    },
  ],
  folha_pesada: [
    {
      codigo: "produtividade_pessoal",
      titulo: "Avaliar produtividade por colaborador vs receita gerada",
      disparadaPor: ["folha_pesada"],
    },
  ],
};

function selecionarAlavancas(padroes: PadraoDetectado[]): AlavancaSugerida[] {
  const vistas = new Set<string>();
  const out: AlavancaSugerida[] = [];
  for (const p of padroes) {
    const candidatas = CATALOGO_ALAVANCAS[p.codigo] ?? [];
    for (const a of candidatas) {
      if (!vistas.has(a.codigo)) {
        vistas.add(a.codigo);
        out.push(a);
      }
    }
  }
  return out;
}

// =====================================================================
// CONTEXTO — quem é a empresa?
// =====================================================================

function classificarPorte(receitaLiquidaAnual: number): ContextoEmpresa["porte"] {
  // Cortes BNDES — Receita Operacional Bruta. Usamos RL como proxy aceitável.
  if (receitaLiquidaAnual <= 360_000) return "micro";
  if (receitaLiquidaAnual <= 4_800_000) return "pequena";
  if (receitaLiquidaAnual <= 300_000_000) return "media";
  return "grande";
}

function contextoDe(state: AppState, dre: DRE): ContextoEmpresa {
  const receitaLiquidaAnual = sum(dre.receitaLiquida);
  return {
    // Setor virá do state quando tivermos o campo (PR2). Hoje: default.
    setor: "default",
    regimeTributario: state.tax?.regime ?? "real",
    receitaLiquidaAnual,
    porte: classificarPorte(receitaLiquidaAnual),
    numColaboradores: Math.max(0, state.numColaboradores ?? 0),
  };
}

// =====================================================================
// BUILD — entrypoint principal.
// =====================================================================

/** Indicadores que sempre entram no briefing — não inclui todos para não poluir. */
const INDICADORES_PRINCIPAIS: IndicadorKey[] = [
  "margemBruta",
  "margemEbitda",
  "margemLiquida",
  "margemContribuicao",
  "roic",
  "roicVsWacc",
  "liquidezCorrente",
  "dividaLiqEbitda",
  "coberturaJuros",
  "dscr",
  "cicloFinanceiro",
  "margemSeguranca",
  "conversaoEbitdaCaixa",
  "custoPessoalSobreReceita",
];

/**
 * Constrói o briefing completo. PURA: mesmo input → mesmo output, sempre.
 * Não chama LLM, não faz I/O. Idempotente — pode rodar a cada recálculo.
 */
export function buildBriefing(state: AppState, dre: DRE, ind: Indicators): Briefing {
  const setor: Setor = "default";

  // Classifica indicadores. `roicVsWacc` é derivado.
  const classificacoes: ClassificacaoIndicador[] = INDICADORES_PRINCIPAIS.map((key) => {
    let valor: number;
    if (key === "roicVsWacc") valor = ind.roic - ind.wacc;
    else {
      const raw = ind[key as keyof Indicators];
      // dscr/coberturaJuros null (sem dívida) → não é "atencao"; substitui por sentinela
      // ampla que cai em "excelente" (maior_melhor: valor >> excelente).
      if (raw == null && (key === "dscr" || key === "coberturaJuros")) valor = 999;
      else valor = raw as number;
    }
    return classify(key, valor, setor);
  });

  const padroes = detectarPadroes(classificacoes, ind);
  const alavancas = selecionarAlavancas(padroes);

  const quantidadeCriticos = classificacoes.filter((c) => c.nivel === "critico").length;
  const quantidadeAtencao = classificacoes.filter((c) => c.nivel === "atencao").length;
  const indicadoresExcelentes = classificacoes
    .filter((c) => c.nivel === "excelente")
    .map((c) => c.indicador);

  // Nível geral: pior critério vence (regra prudente de CFO).
  let nivelGeral: Nivel = "excelente";
  if (quantidadeCriticos > 0) nivelGeral = "critico";
  else if (quantidadeAtencao >= 3) nivelGeral = "atencao";
  else if (quantidadeAtencao > 0) nivelGeral = "ok";
  else if (indicadoresExcelentes.length < classificacoes.length / 2) nivelGeral = "ok";

  return {
    schemaVersion: 1,
    geradoEm: new Date().toISOString(),
    contexto: contextoDe(state, dre),
    classificacoes,
    padroes,
    alavancas,
    resumo: {
      nivelGeral,
      quantidadeCriticos,
      quantidadeAtencao,
      indicadoresExcelentes,
    },
  };
}

/**
 * Hash estável do briefing (sem timestamp) — chave de cache para PR3.
 * Mesmo cenário financeiro → mesmo hash → reuso de texto da LLM.
 */
export function briefingCacheKey(b: Briefing): string {
  const semTimestamp = {
    v: b.schemaVersion,
    ctx: b.contexto,
    cls: b.classificacoes.map((c) => [c.indicador, Math.round(c.valor * 100) / 100, c.nivel]),
    pad: b.padroes.map((p) => p.codigo).sort(),
  };
  return JSON.stringify(semTimestamp);
}
