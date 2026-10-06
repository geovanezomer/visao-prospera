/**
 * Análise Estratégica — scoring qualitativo
 *
 * Cinco dimensões:
 *  - Concentração de clientes (HHI proxy)
 *  - Concentração de fornecedores / canais
 *  - Governança e dependência de pessoas-chave (bus factor)
 *  - Posição competitiva (5 forças simplificadas)
 *  - Exposição regulatória/cambial
 *
 * Cada dimensão produz um sub-score 0–100 (100 = robusto, 0 = crítico).
 * O índice geral é a média ponderada das dimensões PREENCHIDAS — seções
 * vazias são ignoradas (não puxam pra cima nem pra baixo).
 *
 * O índice é convertido em "haircut" sobre o health financeiro:
 *  - Risco baixo  (≥75): haircut 0%
 *  - Risco médio  (50–75): haircut 0–15%
 *  - Risco alto   (25–50): haircut 15–30%
 *  - Risco crítico (<25): haircut 30–40%
 */

import type {
  AppState,
  StrategicAnswers,
  ConcentrationAnswers,
  GovernanceAnswers,
  CompetitiveAnswers,
  RegulatoryAnswers,
} from "./types";

export type SubScore = {
  key: "concentration" | "suppliers" | "governance" | "competitive" | "regulatory";
  label: string;
  score: number; // 0–100 (100 = melhor)
  filled: boolean;
  status: "ok" | "warn" | "danger" | "unknown";
  highlights: string[]; // bullets curtos pra mostrar no card
};

export type StrategicResult = {
  hasAnyAnswer: boolean;
  /** Índice 0–100 (100 = sem risco estratégico). */
  index: number;
  /** Haircut multiplicador 0–0.4 a aplicar sobre o health financeiro. */
  haircut: number;
  /** Classificação textual. */
  level: "robusto" | "adequado" | "frágil" | "crítico" | "indefinido";
  subscores: SubScore[];
  /** HHI calculado (0–10000) — só quando há dados suficientes. */
  hhi?: number;
  headline: string;
};

// ----------------- helpers -----------------

function clamp(x: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

function statusFromScore(s: number): "ok" | "warn" | "danger" {
  if (s >= 70) return "ok";
  if (s >= 45) return "warn";
  return "danger";
}

// ----------------- Concentração de clientes (HHI) -----------------

/**
 * HHI aproximado a partir de:
 *  - share do maior cliente (s1)
 *  - clientes que respondem por 80% da receita
 *
 * Aproximação: assume que os "n" clientes do top-80% têm shares
 * decrescentes geometricamente partindo de s1, e o tail (20%) está
 * pulverizado (HHI ≈ 0 do tail). HHI em pontos (0–10000).
 *
 * Parâmetros CADE: >2500 = concentração alta, 1500–2500 = moderada,
 * <1500 = baixa.
 */
function estimateHHI(a: ConcentrationAnswers): number | undefined {
  const s1 = a.pctMaiorCliente;
  if (s1 == null || !Number.isFinite(s1)) return undefined;
  const top80Map: Record<string, number> = { "1-2": 2, "3-5": 4, "6-15": 10, "16+": 20 };
  const n = a.clientesPara80Pct ? top80Map[a.clientesPara80Pct] : 5;

  // Distribui 80% da receita entre n clientes em PG decrescente começando em s1.
  // Se s1 sozinho já passa de 80%, usa só s1.
  const target = Math.min(80, 100);
  if (s1 >= target) return Math.round(s1 * s1);

  // Razão da PG tal que sum_{i=0..n-1} s1 * r^i = target
  // Resolve numericamente (Newton em poucos passos).
  let r = 0.7;
  for (let i = 0; i < 20; i++) {
    const dr = Math.max(1e-6, Math.abs(1 - r));
    const den = r > 1 ? r - 1 : 1 - r;
    const f = (s1 * (1 - Math.pow(r, n))) / Math.max(1e-6, 1 - r) - target;
    const dfdr =
      (s1 * (-n * Math.pow(r, n - 1) * (1 - r) + (1 - Math.pow(r, n)))) /
      Math.max(1e-9, Math.pow(1 - r, 2));
    if (Math.abs(f) < 1e-4 || Math.abs(dfdr) < 1e-12) break;
    r = clamp(r - f / dfdr, 0.01, 0.999);
  }
  let hhi = 0;
  for (let i = 0; i < n; i++) {
    const si = s1 * Math.pow(r, i);
    hhi += si * si;
  }
  return Math.round(hhi);
}

function scoreConcentration(a: ConcentrationAnswers): SubScore {
  const filled =
    a.pctMaiorCliente != null || a.clientesPara80Pct != null || a.tempoMaiorCliente != null;

  if (!filled) {
    return {
      key: "concentration",
      label: "Concentração de clientes",
      score: 0,
      filled: false,
      status: "unknown",
      highlights: ["Seção não preenchida"],
    };
  }

  const hhi = estimateHHI(a);
  // HHI 0 → score 100, HHI 5000+ → score 0
  let score = hhi != null ? clamp(100 - (hhi / 5000) * 100) : 60;

  // Penalidade adicional pela idade do maior cliente
  if (a.tempoMaiorCliente === "lt1" && (a.pctMaiorCliente ?? 0) >= 25) score -= 15;
  if (a.tempoMaiorCliente === "1-3" && (a.pctMaiorCliente ?? 0) >= 40) score -= 8;
  score = clamp(score);

  const highlights: string[] = [];
  if (a.pctMaiorCliente != null) {
    const s1 = a.pctMaiorCliente;
    if (s1 >= 50) highlights.push(`Maior cliente = ${s1.toFixed(0)}% da receita (crítico)`);
    else if (s1 >= 30) highlights.push(`Maior cliente = ${s1.toFixed(0)}% da receita (alto)`);
    else highlights.push(`Maior cliente = ${s1.toFixed(0)}% da receita`);
  }
  if (hhi != null) {
    const cls = hhi > 2500 ? "alta" : hhi > 1500 ? "moderada" : "baixa";
    highlights.push(`HHI estimado ${hhi.toLocaleString("pt-BR")} (${cls} — parâmetro CADE)`);
  }
  if (a.tempoMaiorCliente === "lt1")
    highlights.push("Maior cliente < 1 ano: relação ainda não testada");

  return {
    key: "concentration",
    label: "Concentração de clientes",
    score,
    filled: true,
    status: statusFromScore(score),
    highlights,
  };
}

// ----------------- Concentração de fornecedores / canais -----------------

function scoreSuppliers(a: ConcentrationAnswers): SubScore {
  const filled = a.pctMaiorFornecedor != null || a.dependeCanal != null;
  if (!filled) {
    return {
      key: "suppliers",
      label: "Fornecedores & canais",
      score: 0,
      filled: false,
      status: "unknown",
      highlights: ["Seção não preenchida"],
    };
  }
  let score = 80;
  const highlights: string[] = [];

  if (a.pctMaiorFornecedor != null) {
    const f = a.pctMaiorFornecedor;
    // Parte de 80 e desconta 0,8 ponto por p.p.: 0% → 80, 50% → 40, 100% → 0
    score -= f * 0.8;
    if (f >= 50)
      highlights.push(`Maior fornecedor = ${f.toFixed(0)}% do CPV (alto risco de ruptura)`);
    else if (f >= 30) highlights.push(`Maior fornecedor = ${f.toFixed(0)}% do CPV`);
    else highlights.push(`Maior fornecedor = ${f.toFixed(0)}% do CPV (diversificado)`);
  }
  if (a.dependeCanal === "sim") {
    score -= 25;
    highlights.push(
      "Dependência de um único canal de aquisição (Google Ads, marketplace, parceiro único)",
    );
  } else if (a.dependeCanal === "parcial") {
    score -= 10;
    highlights.push("Dependência parcial de um canal de aquisição");
  } else if (a.dependeCanal === "nao") {
    highlights.push("Aquisição diversificada entre canais");
  }

  return {
    key: "suppliers",
    label: "Fornecedores & canais",
    score: clamp(score),
    filled: true,
    status: statusFromScore(clamp(score)),
    highlights,
  };
}

// ----------------- Governança / bus factor -----------------

function scoreGovernance(a: GovernanceAnswers): SubScore {
  const filled =
    a.socioAfastado60d != null ||
    a.quemFechaContrato != null ||
    a.processosDocumentados != null ||
    a.planoSucessao != null;

  if (!filled) {
    return {
      key: "governance",
      label: "Governança & pessoas-chave",
      score: 0,
      filled: false,
      status: "unknown",
      highlights: ["Seção não preenchida"],
    };
  }

  const map = {
    socioAfastado60d: { normal: 100, perde_eficiencia: 55, para: 10 },
    quemFechaContrato: { ninguem: 5, socios: 35, gerentes: 75, equipe: 100 },
    processosDocumentados: { nenhum: 10, financeiros: 40, operacionais: 65, maioria: 95 },
    planoSucessao: { nunca: 5, nao: 25, parcial: 65, sim: 100 },
  } as const;

  const parts: number[] = [];
  const highlights: string[] = [];

  if (a.socioAfastado60d) {
    parts.push(map.socioAfastado60d[a.socioAfastado60d]);
    if (a.socioAfastado60d === "para")
      highlights.push("Operação para se o sócio se afastar (bus factor = 1)");
    else if (a.socioAfastado60d === "perde_eficiencia")
      highlights.push("Operação sobrevive ao afastamento do sócio, mas com perdas");
  }
  if (a.quemFechaContrato) {
    parts.push(map.quemFechaContrato[a.quemFechaContrato]);
    if (a.quemFechaContrato === "ninguem" || a.quemFechaContrato === "socios")
      highlights.push("Vendas dependentes dos sócios — gargalo de crescimento");
  }
  if (a.processosDocumentados) {
    parts.push(map.processosDocumentados[a.processosDocumentados]);
    if (a.processosDocumentados === "nenhum")
      highlights.push("Processos não documentados: alto custo de substituição de pessoas");
  }
  if (a.planoSucessao) {
    parts.push(map.planoSucessao[a.planoSucessao]);
    if (a.planoSucessao === "nunca" || a.planoSucessao === "nao")
      highlights.push("Sem plano de sucessão para posições-chave");
  }

  const score = clamp(parts.reduce((s, x) => s + x, 0) / parts.length);
  return {
    key: "governance",
    label: "Governança & pessoas-chave",
    score,
    filled: true,
    status: statusFromScore(score),
    highlights,
  };
}

// ----------------- Posição competitiva (Porter simplificado) -----------------

function scoreCompetitive(a: CompetitiveAnswers): SubScore {
  const filled =
    a.reajustePrecos != null ||
    a.elasticidade10pct != null ||
    a.razaoContratacao != null ||
    a.concorrentes != null ||
    a.switchingCost != null;

  if (!filled) {
    return {
      key: "competitive",
      label: "Posição competitiva",
      score: 0,
      filled: false,
      status: "unknown",
      highlights: ["Seção não preenchida"],
    };
  }

  const map = {
    reajustePrecos: { sem_resistencia: 100, com_resistencia: 65, nao_repassou: 25, reduziu: 5 },
    elasticidade10pct: { menos_5: 100, "5_20": 60, mais_20: 15, nao_sei: 40 },
    razaoContratacao: {
      marca: 95,
      qualidade: 85,
      unica_opcao: 80,
      relacionamento: 60,
      prazo: 55,
      preco: 20,
    },
    concorrentes: { nenhum: 100, "1-3": 80, "4-10": 55, "10+": 25, nao_sei: 40 },
    switchingCost: { alto: 100, medio: 65, baixo: 30, commodity: 10 },
  } as const;

  const parts: number[] = [];
  const highlights: string[] = [];

  if (a.reajustePrecos) {
    parts.push(map.reajustePrecos[a.reajustePrecos]);
    if (a.reajustePrecos === "reduziu" || a.reajustePrecos === "nao_repassou")
      highlights.push("Sem poder de precificação — guerra de preço corrói margem");
    if (a.reajustePrecos === "sem_resistencia")
      highlights.push("Forte poder de precificação (preço sobe sem resistência)");
  }
  if (a.elasticidade10pct) {
    parts.push(map.elasticidade10pct[a.elasticidade10pct]);
    if (a.elasticidade10pct === "mais_20")
      highlights.push("Demanda muito elástica: 10% no preço derruba 20%+ dos clientes");
  }
  if (a.razaoContratacao) {
    parts.push(map.razaoContratacao[a.razaoContratacao]);
    if (a.razaoContratacao === "preco")
      highlights.push("Cliente compra por preço — sem moat competitivo");
    if (a.razaoContratacao === "marca" || a.razaoContratacao === "qualidade")
      highlights.push("Diferencial percebido além de preço");
  }
  if (a.concorrentes) {
    parts.push(map.concorrentes[a.concorrentes]);
    if (a.concorrentes === "10+") highlights.push("Mercado fragmentado e concorrido");
  }
  if (a.switchingCost) {
    parts.push(map.switchingCost[a.switchingCost]);
    if (a.switchingCost === "commodity")
      highlights.push("Produto commodity — sem barreira de troca");
    if (a.switchingCost === "alto")
      highlights.push("Alto switching cost: cliente preso por integração/contrato");
  }

  const score = clamp(parts.reduce((s, x) => s + x, 0) / parts.length);
  return {
    key: "competitive",
    label: "Posição competitiva",
    score,
    filled: true,
    status: statusFromScore(score),
    highlights,
  };
}

// ----------------- Exposição regulatória / cambial -----------------

function scoreRegulatory(a: RegulatoryAnswers): SubScore {
  if (!a.exposicaoRegulatoria) {
    return {
      key: "regulatory",
      label: "Exposição regulatória",
      score: 0,
      filled: false,
      status: "unknown",
      highlights: ["Seção não preenchida"],
    };
  }
  const map = { sim: 25, parcial: 60, nao: 95 } as const;
  const score = map[a.exposicaoRegulatoria];
  const highlights: string[] = [];
  if (a.exposicaoRegulatoria === "sim")
    highlights.push(
      "Dependência de licença/certificação/contrato público/câmbio — risco binário fora do controle",
    );
  else if (a.exposicaoRegulatoria === "parcial")
    highlights.push("Exposição parcial a fatores regulatórios ou cambiais");
  else highlights.push("Sem dependência regulatória ou cambial relevante");
  return {
    key: "regulatory",
    label: "Exposição regulatória",
    score,
    filled: true,
    status: statusFromScore(score),
    highlights,
  };
}

// ----------------- Agregação -----------------

const WEIGHTS: Record<SubScore["key"], number> = {
  concentration: 0.3,
  suppliers: 0.15,
  governance: 0.25,
  competitive: 0.25,
  regulatory: 0.05,
};

export function computeStrategic(state: AppState): StrategicResult {
  const s: StrategicAnswers = state.strategic ?? {
    concentration: {},
    governance: {},
    competitive: {},
    regulatory: {},
  };

  const subs: SubScore[] = [
    scoreConcentration(s.concentration),
    scoreSuppliers(s.concentration),
    scoreGovernance(s.governance),
    scoreCompetitive(s.competitive),
    scoreRegulatory(s.regulatory),
  ];

  const filled = subs.filter((x) => x.filled);
  const hasAnyAnswer = filled.length > 0;

  if (!hasAnyAnswer) {
    return {
      hasAnyAnswer: false,
      index: 0,
      haircut: 0,
      level: "indefinido",
      subscores: subs,
      headline:
        "Análise estratégica não preenchida — health score reflete apenas o lado financeiro.",
    };
  }

  // Média ponderada com renormalização das dimensões preenchidas
  const totalWeight = filled.reduce((acc, x) => acc + WEIGHTS[x.key], 0);
  const index = filled.reduce((acc, x) => acc + x.score * (WEIGHTS[x.key] / totalWeight), 0);

  // Haircut: 0 a 0.40, ativando abaixo de 75
  let haircut = 0;
  if (index < 75) haircut = ((75 - index) / 75) * 0.4;
  haircut = Math.max(0, Math.min(0.4, haircut));

  const level: StrategicResult["level"] =
    index >= 75 ? "robusto" : index >= 55 ? "adequado" : index >= 35 ? "frágil" : "crítico";

  const hhi = estimateHHI(s.concentration);

  const headline = buildHeadline(level, subs, filled.length);

  return {
    hasAnyAnswer: true,
    index: Math.round(index),
    haircut,
    level,
    subscores: subs,
    hhi,
    headline,
  };
}

function buildHeadline(
  level: StrategicResult["level"],
  subs: SubScore[],
  filledCount: number,
): string {
  const worst = [...subs].filter((s) => s.filled).sort((a, b) => a.score - b.score)[0];
  const base =
    level === "robusto"
      ? "Risco estratégico baixo — empresa diversificada e com governança sólida"
      : level === "adequado"
        ? "Risco estratégico moderado — pontos de atenção mapeados"
        : level === "frágil"
          ? "Risco estratégico elevado — exposições relevantes além do balanço"
          : "Risco estratégico crítico — vulnerabilidades fora do controle imediato";
  const suf = worst ? `. Maior fragilidade: ${worst.label.toLowerCase()}.` : ".";
  return `${base}${suf} (${filledCount}/5 dimensões respondidas)`;
}

/** Quadrante 2x2 financeiro × estratégico. */
export type Quadrant = "robusta" | "fragil_rica" | "vulneravel" | "critica" | "indefinida";

export function quadrant(
  financialScore: number,
  strategic: StrategicResult,
): {
  q: Quadrant;
  label: string;
  description: string;
} {
  if (!strategic.hasAnyAnswer) {
    return {
      q: "indefinida",
      label: "Estratégico não avaliado",
      description:
        "Preencha o módulo de Análise Estratégica para posicionar a empresa no quadrante.",
    };
  }
  const finStrong = financialScore >= 60;
  const stratLow = strategic.index >= 55;
  if (finStrong && stratLow)
    return {
      q: "robusta",
      label: "Robusta",
      description: "Saúde financeira forte e risco estratégico baixo. Posição defensável.",
    };
  if (finStrong && !stratLow)
    return {
      q: "fragil_rica",
      label: "Frágil-rica",
      description:
        "Números bons sustentados por estrutura vulnerável. Resultado pode ruir num único evento.",
    };
  if (!finStrong && stratLow)
    return {
      q: "vulneravel",
      label: "Vulnerável",
      description:
        "Estratégia sólida, mas finanças apertadas. Atuar antes que o caixa estrangule a operação.",
    };
  return {
    q: "critica",
    label: "Crítica",
    description: "Finanças e estratégia comprometidas. Reestruturação ampla é necessária.",
  };
}
