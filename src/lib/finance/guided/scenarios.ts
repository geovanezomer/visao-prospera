import { AppState, CostLine } from "../types";
import { PrescriptiveAction, PrescriptiveCard } from "../prescriptive";
import { monthValues } from "../calculations";
import { fill12, sum } from "../format";

// ============ Tipos de parâmetros ============

export type ParamType = "percent" | "percent_signed" | "currency" | "integer" | "days";

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  min: number;
  max: number;
  step: number;
  default: number;
  hint?: string;
}

export interface SuggestedScenario {
  id: string;
  title: string;
  description: string;
  category: "receita" | "custo" | "tributario" | "capital" | "operacional";
  params: ParamDef[];
  /** Constrói card + ação dado os parâmetros atuais. */
  build: (state: AppState, p: Record<string, number>) => { card: PrescriptiveCard; action: PrescriptiveAction };
}

// ============ Helpers ============

const cloneCosts = (costs: CostLine[]) => costs.map((c) => ({ ...c, values: c.values.slice() }));

const fmtBRL0 = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function scaleRevenue(state: AppState, factor: number): AppState {
  return { ...state, revenue: { ...state.revenue, bruta: state.revenue.bruta.map((v) => v * factor) } };
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

function annualCPV(state: AppState): number {
  return state.costs.filter((c) => c.category === "custo_vendas").reduce((acc, c) => acc + sum(monthValues(c)), 0);
}

// ============ Definição dos 9 cenários paramétricos ============

export function buildSuggestedScenarios(state: AppState): SuggestedScenario[] {
  const list: SuggestedScenario[] = [];

  // 1. Variar preço/receita
  list.push({
    id: "price_change",
    title: "Variar preço de venda",
    description: "Aplica reajuste percentual em toda a receita bruta. Use para testar elasticidade de preços.",
    category: "receita",
    params: [
      { key: "pct", label: "Variação no preço", type: "percent_signed", min: -30, max: 30, step: 1, default: 10,
        hint: "Negativo = desconto; positivo = aumento. Custos variáveis permanecem inalterados." },
    ],
    build: (s, p) => {
      const f = 1 + p.pct / 100;
      return {
        card: {
          id: "sc_price", severity: "info",
          problem: `Cenário: reajuste de preço de ${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(0)}%`,
          metricLabel: "Receita Bruta", metricValue: `${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(0)}%`,
          cause: "Simula aumento/redução de tabela em todas as receitas.", actions: [],
        },
        action: {
          id: "act_price",
          title: `${p.pct >= 0 ? "Aumentar" : "Reduzir"} preço em ${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(0)}%`,
          detail: `Multiplica receita bruta mensal por ${f.toFixed(3)}. Custos variáveis não são reajustados automaticamente.`,
          apply: (st) => scaleRevenue(st, f),
        },
      };
    },
  });

  // 2. Variar volume (perda/ganho de clientes)
  list.push({
    id: "volume_change",
    title: "Perder ou ganhar receita (volume)",
    description: "Stress test: simula perda de cliente-chave ou conquista de nova carteira. Custos variáveis acompanham o volume.",
    category: "receita",
    params: [
      { key: "pct", label: "Variação no volume de vendas", type: "percent_signed", min: -50, max: 50, step: 1, default: -20,
        hint: "Ex.: −20% representa a perda do maior cliente. CPV variável acompanha proporcionalmente." },
    ],
    build: (s, p) => {
      const f = 1 + p.pct / 100;
      return {
        card: {
          id: "sc_vol", severity: p.pct < 0 ? "warn" : "info",
          problem: `Cenário: ${p.pct >= 0 ? "ganho" : "perda"} de ${Math.abs(p.pct).toFixed(0)}% do volume`,
          metricLabel: "Receita + CPV variável", metricValue: `${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(0)}%`,
          cause: "Mede vulnerabilidade ou alavancagem da operação a mudanças de volume.", actions: [],
        },
        action: {
          id: "act_vol",
          title: `${p.pct >= 0 ? "Ganhar" : "Perder"} ${Math.abs(p.pct).toFixed(0)}% de volume`,
          detail: `Receita bruta × ${f.toFixed(3)} e CPV/custos variáveis × ${f.toFixed(3)}. Custos fixos permanecem (alavancagem operacional).`,
          apply: (st) => {
            const costs = cloneCosts(st.costs).map((c) =>
              c.category === "custo_vendas" || c.category === "variavel"
                ? { ...c, values: c.values.map((v) => v * f) }
                : c,
            );
            return { ...scaleRevenue(st, f), costs };
          },
        },
      };
    },
  });

  // 3. Reajustar CPV/insumos
  list.push({
    id: "cpv_inflation",
    title: "Reajustar CPV / insumos",
    description: "Simula inflação (ou deflação) de matéria-prima, mercadorias e insumos de produção.",
    category: "custo",
    params: [
      { key: "pct", label: "Variação no CPV", type: "percent_signed", min: -20, max: 30, step: 1, default: 10,
        hint: "Aplica reajuste sobre todas as linhas de Custo de Vendas (matéria-prima, mercadorias)." },
    ],
    build: (s, p) => {
      const f = 1 + p.pct / 100;
      return {
        card: {
          id: "sc_cpv", severity: p.pct > 0 ? "warn" : "info",
          problem: `Cenário: ${p.pct >= 0 ? "alta" : "queda"} de ${Math.abs(p.pct).toFixed(0)}% no CPV`,
          metricLabel: "CPV", metricValue: `${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(0)}%`,
          cause: "Avalia sensibilidade da margem a pressões de fornecedores.", actions: [],
        },
        action: {
          id: "act_cpv",
          title: `Reajustar CPV em ${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(0)}%`,
          detail: `Multiplica todas as linhas de Custo de Vendas por ${f.toFixed(3)}.`,
          apply: (st) => ({
            ...st,
            costs: cloneCosts(st.costs).map((c) =>
              c.category === "custo_vendas" ? { ...c, values: c.values.map((v) => v * f) } : c,
            ),
          }),
        },
      };
    },
  });

  // 4. Contratar
  const salPad = Math.round(avgLaborSalary(state)) || 3500;
  list.push({
    id: "hire",
    title: "Contratar pessoas (CLT)",
    description: "Adiciona uma nova linha de folha com N funcionários ao salário definido + encargos automáticos.",
    category: "custo",
    params: [
      { key: "qty", label: "Quantidade", type: "integer", min: 1, max: 30, step: 1, default: 3 },
      { key: "salario", label: "Salário médio (R$)", type: "currency", min: 1412, max: 30000, step: 100, default: salPad,
        hint: "Encargos CLT automáticos (~70% sobre o salário) são adicionados." },
    ],
    build: (s, p) => ({
      card: {
        id: "sc_hire", severity: "info",
        problem: `Cenário: contratar ${p.qty.toFixed(0)} pessoa(s) a ${fmtBRL0(p.salario)}`,
        metricLabel: "Folha mensal adicional",
        metricValue: `+${fmtBRL0(p.qty * p.salario * 1.7)}`,
        cause: "Mede impacto de novas contratações na margem e no caixa.", actions: [],
      },
      action: {
        id: "act_hire",
        title: `Contratar ${p.qty.toFixed(0)} pessoa(s) (${fmtBRL0(p.salario)})`,
        detail: `Cria linha de folha com ${p.qty.toFixed(0)}× ${fmtBRL0(p.salario)} + encargos automáticos (70%).`,
        apply: (st) => ({
          ...st,
          costs: [
            ...cloneCosts(st.costs),
            {
              id: `hire_${Date.now().toString(36)}`,
              label: `Nova equipe (${p.qty.toFixed(0)}× ${fmtBRL0(p.salario)})`,
              category: "fixo",
              values: fill12(p.qty * p.salario),
              fixed: true,
              custom: true,
              encargosAuto: true,
              encargosPct: 70,
            },
          ],
        }),
      },
    }),
  });

  // 5. Demitir
  list.push({
    id: "layoff",
    title: "Demitir pessoas",
    description: "Reduz proporcionalmente as linhas de folha existentes equivalente a N demissões ao salário informado.",
    category: "custo",
    params: [
      { key: "qty", label: "Quantidade a demitir", type: "integer", min: 1, max: 30, step: 1, default: 2 },
      { key: "salario", label: "Salário médio (R$)", type: "currency", min: 1412, max: 30000, step: 100, default: salPad,
        hint: "Reduz a folha em qty × salário × 1.7 (com encargos). Não inclui rescisão." },
    ],
    build: (s, p) => {
      const reducaoMensal = p.qty * p.salario * 1.7;
      return {
        card: {
          id: "sc_layoff", severity: "warn",
          problem: `Cenário: demitir ${p.qty.toFixed(0)} pessoa(s) a ${fmtBRL0(p.salario)}`,
          metricLabel: "Folha mensal economizada",
          metricValue: `−${fmtBRL0(reducaoMensal)}`,
          cause: "Avalia ganho de margem versus capacidade operacional.", actions: [],
        },
        action: {
          id: "act_layoff",
          title: `Demitir ${p.qty.toFixed(0)} pessoa(s) (${fmtBRL0(p.salario)})`,
          detail: `Reduz proporcionalmente as linhas de folha existentes em ${fmtBRL0(reducaoMensal)}/mês.`,
          apply: (st) => {
            const laborLines = st.costs.filter((c) => c.encargosAuto);
            const totalFolhaMes = laborLines.reduce((acc, c) => acc + sum(monthValues(c)) * 1.7 / 12, 0);
            if (totalFolhaMes <= 0) return st;
            const fator = Math.max(0, 1 - reducaoMensal / totalFolhaMes);
            return {
              ...st,
              costs: cloneCosts(st.costs).map((c) =>
                c.encargosAuto ? { ...c, values: c.values.map((v) => v * fator) } : c,
              ),
            };
          },
        },
      };
    },
  });

  // 6. Terceirizar
  const cpvAnual = annualCPV(state);
  list.push({
    id: "outsource",
    title: "Terceirizar parte da operação",
    description: "Substitui % do CPV variável por um custo fixo mensal contratado. Útil para BPO, terceirização de produção, white label.",
    category: "operacional",
    params: [
      { key: "pct_cpv", label: "% do CPV terceirizado", type: "percent", min: 10, max: 100, step: 5, default: 30 },
      { key: "custo_fixo", label: "Custo fixo mensal contratado (R$)", type: "currency", min: 1000, max: 500000, step: 500,
        default: Math.max(5000, Math.round(cpvAnual * 0.30 / 12 * 0.85 / 500) * 500),
        hint: "Valor que o terceirizado cobra. Se menor que o CPV substituído, melhora margem." },
    ],
    build: (s, p) => ({
      card: {
        id: "sc_outsource", severity: "info",
        problem: `Cenário: terceirizar ${p.pct_cpv.toFixed(0)}% do CPV por ${fmtBRL0(p.custo_fixo)}/mês`,
        metricLabel: "CPV substituído",
        metricValue: `${fmtBRL0(annualCPV(s) * p.pct_cpv / 100 / 12)}/mês → ${fmtBRL0(p.custo_fixo)}/mês`,
        cause: "Converte custo variável em fixo. Reduz risco de qualidade mas aumenta alavancagem operacional.", actions: [],
      },
      action: {
        id: "act_outsource",
        title: `Terceirizar ${p.pct_cpv.toFixed(0)}% do CPV (${fmtBRL0(p.custo_fixo)}/mês)`,
        detail: `Remove ${p.pct_cpv.toFixed(0)}% do CPV variável e adiciona linha fixa de ${fmtBRL0(p.custo_fixo)}/mês.`,
        apply: (st) => {
          const f = 1 - p.pct_cpv / 100;
          const costs = cloneCosts(st.costs).map((c) =>
            c.category === "custo_vendas" ? { ...c, values: c.values.map((v) => v * f) } : c,
          );
          costs.push({
            id: `outsource_${Date.now().toString(36)}`,
            label: `Terceirização (${p.pct_cpv.toFixed(0)}% da operação)`,
            category: "fixo",
            values: fill12(p.custo_fixo),
            fixed: true,
            custom: true,
          });
          return { ...st, costs };
        },
      },
    }),
  });

  // 7. Cortar custos fixos
  list.push({
    id: "cut_fixed",
    title: "Cortar custos fixos",
    description: "Reduz X% nos N maiores custos fixos da empresa (aluguel, sistemas, contratos recorrentes).",
    category: "custo",
    params: [
      { key: "pct", label: "% de redução", type: "percent", min: 5, max: 50, step: 1, default: 10 },
      { key: "n", label: "Top N fixos atingidos", type: "integer", min: 1, max: 8, step: 1, default: 3 },
    ],
    build: (s, p) => {
      const tops = topNFixed(s, Math.round(p.n));
      return {
        card: {
          id: "sc_cut", severity: "info",
          problem: `Cenário: cortar ${p.pct.toFixed(0)}% nos ${p.n.toFixed(0)} maiores fixos`,
          metricLabel: "Rubricas atingidas", metricValue: tops.map((l) => l.label).join(" · ") || "—",
          cause: "Renegociação de contratos, downgrade de sistemas, redução de espaço físico.", actions: [],
        },
        action: {
          id: "act_cut",
          title: `Cortar ${p.pct.toFixed(0)}% nos ${p.n.toFixed(0)} maiores fixos`,
          detail: `Aplica fator ${(1 - p.pct / 100).toFixed(2)} nas ${p.n.toFixed(0)} linhas fixas de maior valor anual.`,
          apply: (st) => {
            const ids = new Set(topNFixed(st, Math.round(p.n)).map((l) => l.id));
            const f = 1 - p.pct / 100;
            return {
              ...st,
              costs: cloneCosts(st.costs).map((c) =>
                ids.has(c.id) ? { ...c, values: c.values.map((v) => v * f) } : c,
              ),
            };
          },
        },
      };
    },
  });

  // 8. Selic / kd
  list.push({
    id: "rate_change",
    title: "Selic / custo da dívida oscila",
    description: "Aumenta ou reduz o custo da dívida (kd) em X pontos percentuais ao ano. Use para testar política monetária.",
    category: "capital",
    params: [
      { key: "pp", label: "Variação em p.p. ao ano", type: "percent_signed", min: -5, max: 5, step: 0.25, default: 2,
        hint: "Negativo simula corte de Selic; positivo simula aperto monetário." },
    ],
    build: (s, p) => ({
      card: {
        id: "sc_rate", severity: p.pp > 0 ? "warn" : "info",
        problem: `Cenário: kd ${p.pp >= 0 ? "+" : ""}${p.pp.toFixed(2)} p.p.`,
        metricLabel: "Kd atual", metricValue: `${s.capital.kd.toFixed(1)}% → ${(s.capital.kd + p.pp).toFixed(1)}%`,
        cause: "Afeta WACC e despesa financeira proporcional sobre dívidas pós-fixadas.", actions: [],
      },
      action: {
        id: "act_rate",
        title: `Variar kd em ${p.pp >= 0 ? "+" : ""}${p.pp.toFixed(2)} p.p.`,
        detail: `Soma ${p.pp.toFixed(2)} ao kd e ajusta proporcionalmente linhas de juros existentes.`,
        apply: (st) => {
          const novoKd = Math.max(0.5, st.capital.kd + p.pp);
          const fatorJuros = novoKd / Math.max(st.capital.kd, 0.5);
          return {
            ...st,
            capital: { ...st.capital, kd: novoKd },
            costs: cloneCosts(st.costs).map((c) =>
              c.category === "financeiro" && /juros/i.test(c.label)
                ? { ...c, values: c.values.map((v) => v * fatorJuros) }
                : c,
            ),
          };
        },
      },
    }),
  });

  // 9. Antecipar recebíveis
  list.push({
    id: "antecip",
    title: "Antecipar recebíveis",
    description: "Reduz o PMR em X dias mediante custo financeiro de Y% a.m. sobre 50% da receita mensal.",
    category: "operacional",
    params: [
      { key: "dias", label: "Redução do PMR (dias)", type: "days", min: 5, max: 60, step: 1, default: 15 },
      { key: "custo_am", label: "Custo da antecipação (% a.m.)", type: "percent", min: 0.5, max: 6, step: 0.1, default: 2,
        hint: "Taxa cobrada pela factoring ou banco sobre o valor antecipado." },
    ],
    build: (s, p) => ({
      card: {
        id: "sc_antecip", severity: "info",
        problem: `Cenário: antecipar recebíveis em ${p.dias.toFixed(0)} dias`,
        metricLabel: "PMR", metricValue: `${s.revenue.pmr}d → ${Math.max(0, s.revenue.pmr - p.dias)}d`,
        cause: `Libera caixa do giro adicionando custo de ${p.custo_am.toFixed(2)}% a.m.`, actions: [],
      },
      action: {
        id: "act_antecip",
        title: `Antecipar PMR −${p.dias.toFixed(0)}d (${p.custo_am.toFixed(2)}% a.m.)`,
        detail: `PMR cai ${p.dias.toFixed(0)} dias e adiciona linha financeira de ${p.custo_am.toFixed(2)}% a.m. sobre 50% da receita.`,
        apply: (st) => {
          const novoPmr = Math.max(0, st.revenue.pmr - p.dias);
          const custoMensal = st.revenue.bruta.map((v) => v * 0.5 * (p.custo_am / 100));
          const costs = cloneCosts(st.costs);
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
          return { ...st, revenue: { ...st.revenue, pmr: novoPmr }, costs };
        },
      },
    }),
  });

  return list;
}
