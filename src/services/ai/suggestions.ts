// Sugestões dinâmicas baseadas no diagnóstico calculado.
// Em vez de perguntas estáticas, surfa os 3-4 alertas mais relevantes
// como perguntas prontas que a IA pode responder com dados reais.

import type { AppState } from "@/lib/finance/types";
import { buildDRE, calcIndicators, diagnose, resolveEffectiveRegime } from "@/lib/finance/calculations";
import { buildCashFlow } from "@/lib/finance/cashflow";

const STATIC_FALLBACK = [
  "Qual o VPL do meu negócio e o que ele significa na prática?",
  "Por que o caixa fica negativo? Em que mês? Quanto preciso aportar?",
  "Meu DSCR e cobertura de juros são saudáveis?",
  "Onde estão meus maiores custos fixos e o que cortar primeiro?",
  "E se eu cortar 15% dos custos fixos? Qual o impacto?",
  "Que ações me dariam o maior impacto no valuation?",
];

/**
 * Converte um título de diagnóstico em pergunta executiva para o consultor.
 * Mantém o título original como contexto e força a IA a explicar/quantificar.
 */
function diagnosticToQuestion(title: string, message: string): string {
  const t = title.toLowerCase();
  if (t.includes("caixa") || t.includes("liquidez")) {
    return `Diagnóstico apontou "${title}" — em quais meses o caixa fica crítico e qual aporte mínimo resolve?`;
  }
  if (t.includes("dscr") || t.includes("cobertura de juros") || t.includes("alavancagem") || t.includes("dívida")) {
    return `"${title}": qual o DSCR atual, quanto de EBIT precisaria para chegar a 1,5× e que alavancas movem isso?`;
  }
  if (t.includes("margem")) {
    return `"${title}" — quebra a margem por componente (preço, custo variável, fixo) e mostra onde está o vazamento.`;
  }
  if (t.includes("folha") || t.includes("mão de obra") || t.includes("pessoal")) {
    return `"${title}": simule corte de 10% e 20% na folha e mostre impacto em EBITDA, caixa e valuation.`;
  }
  if (t.includes("custo")) {
    return `"${title}" — liste as 5 maiores rubricas e simule corte de 15% nas duas primeiras.`;
  }
  if (t.includes("inadimplência")) {
    return `"${title}" — quanto de receita líquida e EBITDA recupero se reduzir inadimplência pela metade?`;
  }
  if (t.includes("ebitda") && t.includes("caixa")) {
    return `"${title}": diagnostique se é NCG (prazos), CAPEX ou serviço de dívida que está consumindo o caixa.`;
  }
  if (t.includes("conversão")) {
    return `"${title}": onde o lucro está ficando preso — capital de giro, dívidas ou CAPEX?`;
  }
  if (t.includes("receita")) {
    return `"${title}" — diagnostique a causa e proponha cenário mínimo para viabilidade.`;
  }
  // genérico: usa o próprio título
  return `"${title}" — explique a causa raiz com números e proponha 2 ações para resolver.`;
}

/**
 * Gera sugestões dinâmicas: prioriza danger > warn do diagnose(), adiciona
 * alerta de caixa negativo (mês específico) se houver, completa com fallback.
 */
export function buildDynamicSuggestions(state: AppState, max = 6): string[] {
  try {
    const regime = resolveEffectiveRegime(state);
    const { dre } = buildDRE(state, regime);
    const ind = calcIndicators(state, dre);
    const diag = diagnose(state, dre, ind);
    const cf = buildCashFlow(state, regime);

    const out: string[] = [];

    // 1) Caixa negativo — usa o pior mês, pergunta específica.
    const pior = cf.totais.pioresMes;
    const mesesNeg = cf.alertas.filter(a => a.tipo === "negativo");
    if (pior && pior.saldo < 0) {
      const brl = pior.saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
      const qtd = mesesNeg.length;
      out.push(`Caixa fica negativo em ${qtd} mês(es) — pior é ${pior.mes} (${brl}). Qual aporte mínimo e em que mês resolve?`);
    }

    // 2) Diagnósticos: dangers primeiro, depois warns.
    const sorted = [...diag].sort((a, b) => {
      const order = { danger: 0, warn: 1, ok: 2 } as const;
      return order[a.level] - order[b.level];
    });
    const seen = new Set<string>();
    for (const d of sorted) {
      if (out.length >= max) break;
      const q = diagnosticToQuestion(d.title, d.message);
      if (seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }

    // 3) Completa com estáticas se sobrar espaço.
    for (const s of STATIC_FALLBACK) {
      if (out.length >= max) break;
      if (!out.some(o => o === s)) out.push(s);
    }

    return out.slice(0, max);
  } catch {
    return STATIC_FALLBACK.slice(0, max);
  }
}
