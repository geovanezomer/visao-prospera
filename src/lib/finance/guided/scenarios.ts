import { AppState, CostLine } from "../types";
import { PrescriptiveAction, PrescriptiveCard } from "../prescriptive";
import { compareRegimes, monthValues } from "../calculations";
import { fill12, sum } from "../format";

export interface SuggestedScenario {
  id: string;
  title: string;
  description: string;
  category: "receita" | "custo" | "tributario" | "capital" | "operacional";
  card: PrescriptiveCard;
  action: PrescriptiveAction;
}

// Helpers locais (não usamos os de prescriptive porque são privados ao módulo)
const cloneCosts = (costs: CostLine[]) => costs.map((c) => ({ ...c, values: c.values.slice() }));

function scaleRevenue(state: AppState, factor: number): AppState {
  return {
    ...state,
    revenue: { ...state.revenue, bruta: state.revenue.bruta.map((v) => v * factor) },
  };
}

function topNFixed(state: AppState, n: number): CostLine[] {
  return state.costs
    .filter((c) => c.category === "fixo")
    .map((c) => ({ c, total: sum(monthValues(c)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
    .map((x) => x.c);
}

function avgLaborSalary(state: AppState): number {
  const laborLines = state.costs.filter((c) => c.encargosAuto);
  if (laborLines.length === 0) return 3500;
  const totals = laborLines.map((l) => sum(monthValues(l)) / 12);
  return totals.reduce((s, v) => s + v, 0) / totals.length;
}

export function buildSuggestedScenarios(state: AppState): SuggestedScenario[] {
  const list: SuggestedScenario[] = [];

  // 1. Aumento de preço +10%
  list.push({
    id: "price_up_10",
    title: "Aumentar preço em +10%",
    description: "Multiplica a receita bruta dos 12 meses por 1.10. Use para testar elasticidade.",
    category: "receita",
    card: {
      id: "sc_price_up", severity: "info",
      problem: "Cenário: reajuste de preço de +10%",
      metricLabel: "Receita Bruta", metricValue: "+10%", cause: "Simula aumento de tabela em todas as receitas.", actions: [],
    },
    action: {
      id: "act_price_up", title: "Aumentar preço em +10%",
      detail: "Multiplica receita bruta mensal por 1.10. Não altera custos variáveis automaticamente.",
      apply: (s) => scaleRevenue(s, 1.10),
    },
  });

  // 2. Perda do maior cliente (-20%)
  list.push({
    id: "lose_client_20",
    title: "Perder maior cliente (−20% receita)",
    description: "Stress test: reduz a receita em 20% mantendo a estrutura de custos intacta.",
    category: "receita",
    card: {
      id: "sc_lose", severity: "warn",
      problem: "Cenário: perda de 20% da receita",
      metricLabel: "Receita Bruta", metricValue: "−20%", cause: "Mede vulnerabilidade da operação a perda de cliente-chave.", actions: [],
    },
    action: {
      id: "act_lose", title: "Reduzir receita em 20%",
      detail: "Multiplica receita bruta mensal por 0.80. Custos fixos seguem iguais (alavancagem operacional).",
      apply: (s) => scaleRevenue(s, 0.80),
    },
  });

  // 3. Selic +2 p.p.
  list.push({
    id: "selic_up_2",
    title: "Selic sobe +2 p.p.",
    description: "Aumenta o custo da dívida (kd) em 2 pontos percentuais ao ano.",
    category: "capital",
    card: {
      id: "sc_selic", severity: "info",
      problem: "Cenário: política monetária mais restritiva",
      metricLabel: "Kd atual", metricValue: `${state.capital.kd.toFixed(1)}%`, cause: "Encarece dívidas pós-fixadas e novas captações.", actions: [],
    },
    action: {
      id: "act_selic", title: "Aumentar kd em +2 p.p.",
      detail: "Soma 2 pontos no custo de dívida (capital.kd). Afeta WACC e Cobertura de Juros via despesa financeira proporcional.",
      apply: (s) => ({
        ...s,
        capital: { ...s.capital, kd: s.capital.kd + 2 },
        costs: cloneCosts(s.costs).map((c) =>
          c.category === "financeiro" && /juros/i.test(c.label)
            ? { ...c, values: c.values.map((v) => v * (1 + 2 / Math.max(s.capital.kd, 1))) }
            : c,
        ),
      }),
    },
  });

  // 4. Contratar +3 pessoas
  const sal = avgLaborSalary(state);
  list.push({
    id: "hire_3",
    title: `Contratar +3 pessoas (salário médio ${Math.round(sal).toLocaleString("pt-BR")})`,
    description: "Adiciona 3 funcionários CLT ao salário médio atual, com encargos automáticos.",
    category: "custo",
    card: {
      id: "sc_hire", severity: "info",
      problem: "Cenário: expansão de equipe",
      metricLabel: "Folha mensal adicional", metricValue: `+R$ ${(sal * 3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`,
      cause: "Mede impacto de novas contratações na margem e no caixa.", actions: [],
    },
    action: {
      id: "act_hire", title: "Adicionar 3 colaboradores CLT",
      detail: "Cria nova linha de folha com 3× o salário médio atual + encargos automáticos (~70%).",
      apply: (s) => ({
        ...s,
        costs: [
          ...cloneCosts(s.costs),
          {
            id: `hire_${Date.now().toString(36)}`,
            label: "Nova equipe (cenário guiado)",
            category: "fixo",
            values: fill12(sal * 3),
            fixed: true,
            custom: true,
            encargosAuto: true,
            encargosPct: 70,
          },
        ],
      }),
    },
  });

  // 5. -10% nas 3 maiores rubricas fixas
  const top3 = topNFixed(state, 3);
  list.push({
    id: "cut_top3_10",
    title: "Cortar 10% nos 3 maiores custos fixos",
    description: top3.length > 0 ? `Atinge: ${top3.map((l) => l.label).join(", ")}.` : "Sem rubricas fixas para cortar.",
    category: "custo",
    card: {
      id: "sc_cut", severity: "info",
      problem: "Cenário: enxugar estrutura fixa",
      metricLabel: "Top 3 fixos", metricValue: top3.map((l) => l.label).join(" · ") || "—", cause: "Mede efeito de redução modesta nos maiores fixos.", actions: [],
    },
    action: {
      id: "act_cut", title: "Reduzir 10% nos top 3 fixos",
      detail: "Aplica fator 0.9 nas 3 linhas fixas de maior valor anual.",
      apply: (s) => {
        const ids = new Set(topNFixed(s, 3).map((l) => l.id));
        return {
          ...s,
          costs: cloneCosts(s.costs).map((c) =>
            ids.has(c.id) ? { ...c, values: c.values.map((v) => v * 0.9) } : c,
          ),
        };
      },
    },
  });

  // 6. Migrar para regime ótimo
  try {
    const reg = compareRegimes(state);
    const ranked = (Object.entries(reg) as [keyof typeof reg, { annual: number; effective: number }][])
      .sort((a, b) => a[1].annual - b[1].annual);
    const melhor = ranked[0][0];
    if (melhor !== state.tax.regime) {
      const label = melhor === "simples" ? "Simples Nacional" : melhor === "presumido" ? "Lucro Presumido" : "Lucro Real";
      list.push({
        id: "switch_optimal",
        title: `Migrar para o regime ótimo (${label})`,
        description: "Recalcula impostos como se a empresa estivesse no regime de menor carga anual.",
        category: "tributario",
        card: {
          id: "sc_regime", severity: "info",
          problem: "Cenário: troca de regime tributário",
          metricLabel: "Regime atual × ótimo", metricValue: `${state.tax.regime} → ${melhor}`,
          cause: "Estimativa baseada nos seus números atuais. Valide com contador.", actions: [],
        },
        action: {
          id: "act_switch", title: `Aplicar ${label}`,
          detail: "Apenas troca o regime; demais parâmetros fiscais permanecem.",
          apply: (s) => ({ ...s, tax: { ...s.tax, regime: melhor as AppState["tax"]["regime"] } }),
        },
      });
    }
  } catch {
    // ignora
  }

  // 7. Antecipação de recebíveis (PMR -15, +2% a.m. de custo)
  list.push({
    id: "antecip_15",
    title: "Antecipar recebíveis (PMR −15 dias)",
    description: "Reduz prazo de recebimento em 15 dias e cobra 2% a.m. sobre o valor antecipado.",
    category: "operacional",
    card: {
      id: "sc_antecip", severity: "info",
      problem: "Cenário: factoring / antecipação parcial",
      metricLabel: "PMR", metricValue: `${state.revenue.pmr}d → ${Math.max(0, state.revenue.pmr - 15)}d`,
      cause: "Libera caixa do giro mas adiciona despesa financeira.", actions: [],
    },
    action: {
      id: "act_antecip", title: "Reduzir PMR em 15 dias",
      detail: "Diminui PMR (acelera caixa) e adiciona linha 'Antecipação de recebíveis' com custo de 2% a.m. sobre 50% da receita mensal.",
      apply: (s) => {
        const novoPmr = Math.max(0, s.revenue.pmr - 15);
        const custoMensal = s.revenue.bruta.map((v) => v * 0.5 * 0.02);
        const costs = cloneCosts(s.costs);
        const existing = costs.find((c) => c.id === "antecipacao");
        if (existing) {
          existing.values = existing.values.map((v, i) => v + custoMensal[i]);
          existing.fixed = false;
        } else {
          costs.push({
            id: "antecipacao",
            label: "Antecipação de recebíveis",
            category: "financeiro",
            values: custoMensal,
            fixed: false,
            custom: true,
          });
        }
        return { ...s, revenue: { ...s.revenue, pmr: novoPmr }, costs };
      },
    },
  });

  return list;
}
