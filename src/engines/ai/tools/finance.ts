// Tools de leitura/diagnóstico financeiro: premissas, DRE, indicadores,
// WACC, valuation, saúde, governança, prescritivo, resumo executivo, etc.

import {
  resolveEffectiveRegime,
  diagnose,
} from "@/engines/finance";
import { sumContractSaldos } from "@/engines/finance/debtContracts";
import { getFinancialModelCached } from "@/engines/finance/financialModel";
import { brl, pct, sum, type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const defs: ToolDef[] = [
  {
    name: "get_premissas",
    description: "Premissas da empresa (regime, capital, prazos, caixa mínimo).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_receitas",
    description:
      "Configuração de receitas: bruta mensal, deduções customizadas, inadimplência, PMR/PMP mensais e receitas financeiras.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_despesas",
    description:
      "Lista completa de linhas de despesa (CPV/CMV, fixos, variáveis, folha CLT com encargos) com totais e categoria.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_capital",
    description:
      "Estrutura de capital detalhada: PL, dívida onerosa, ativo/passivo circulante, contas a receber, fornecedores, estoques, Ke/Kd, capex ativado.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_balanco_abertura",
    description:
      "Saldos de ABERTURA do exercício (SSOT) com a FONTE de cada rubrica: caixa, contas a receber, estoques, fornecedores, empréstimos CP/LP (split automático ≤12m / >12m), impostos e salários a pagar, créditos tributários, depreciação acumulada e o plug de Lucros Acumulados. Mostra também os totais Ativo/Passivo/PL e se o balanço de abertura está fechado.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_balanco_fechamento",
    description:
      "Balanço Patrimonial de FECHAMENTO derivado por construção (Ativo ≡ Passivo + PL). Inclui Ativo Circulante (caixa, CR, estoques, impostos a recuperar), Ativo Não Circulante (imobilizado por tipo, depreciação acumulada, intangíveis, amortização), Passivo Circulante (fornecedores, empréstimos CP, impostos/salários a pagar), Passivo Não Circulante (empréstimos LP) e PL completo (Capital Social, Reservas, Lucros Acumulados, Resultado do Exercício = DRE − Dividendos). Use quando o consultor perguntar sobre composição patrimonial, estrutura de ativos/passivos, comparativo N×N-1, ou auditoria do balanço.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_contratos_divida",
    description:
      "Detalhe COMPLETO dos contratos de empréstimos/financiamentos: credor, tipo (banco/fomento/fornecedor/sócio/outro), descrição, saldo devedor, taxa nominal a.a., sistema (PRICE/SAC), frequência de amortização (mensal/trimestral/semestral/anual/bullet), prazo remanescente, classificação CP/LP, garantia, covenants (ex.: 'DSCR ≥ 1.25x') e observações. Agregados: saldo total, CP, LP, Kd médio ponderado. Use SEMPRE que o consultor perguntar sobre estrutura de dívida, renegociação, refinanciamento, impacto de covenant, ou comparação entre credores.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_pagina_capital",
    description:
      "Retorna TODO o conteúdo da página Capital: estrutura de capital (PL, dívida onerosa, Ke/Kd, ativo/passivo, capex ativado), saldos de ABERTURA do exercício com a fonte de cada rubrica, E os contratos de dívida detalhados (credor, taxa, sistema, prazo, covenants, garantia). Use quando o consultor perguntar de forma ampla sobre 'estrutura de capital', 'dívida', 'alavancagem', 'capacidade de endividamento', 'renegociação', ou quiser uma visão consolidada antes de aprofundar.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_regime_tributario",
    description:
      "Configuração tributária (regime nominal vs efetivo, anexo Simples, Fator R, alíquotas ISS/ICMS/PIS/COFINS/CBS/IBS, era ativa, carga apurada). NÃO inclui comparativo de eras — use 'get_eras_reforma' para o resumo 3-eras ou 'simular_transicao_reforma' para o detalhe ano-a-ano.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_eras_reforma",
    description:
      "Tabela compacta com a carga tributária nas 3 eras da Reforma (atual até 2026 · transição 2027–2032 · pleno 2033+) e Δ vs. atual. Mesmos números que o consultor vê na TaxTab. Use quando o usuário pedir um overview rápido por era; para granularidade ano-a-ano use 'simular_transicao_reforma'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_wacc",
    description:
      "Drill-down do WACC: pesos (wE/wD), Ke, Kd, alíquota efetiva, shield tributário (zero em Simples/Presumido), contribuições parciais ao WACC final e comparação com ROIC (cria/destrói valor).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_dre",
    description: "DRE completa anual e mensal.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_indicadores",
    description: "Indicadores financeiros (margens, ROE/ROIC, liquidez, endividamento, ciclo).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_fluxo_caixa",
    description: "Fluxo de caixa mensal, pior mês e alertas.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_valuation",
    description: "Valuation: EV, equity, múltiplos, DCF, confiança.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_diagnostico",
    description: "Diagnóstico automático e alertas de risco.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_saude_financeira",
    description: "Score de saúde (financeiro + total).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_governanca",
    description:
      "Governança e estrutura societária: número de sócios/acionistas, número de colaboradores, respostas qualitativas (sócio afastado 60d, quem fecha contrato, processos documentados, plano de sucessão). Use para diagnosticar concentração societária, risco-chave, sucessão e profissionalização.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_estrategico",
    description:
      "Análise estratégica qualitativa completa (concentração de clientes/fornecedores, competitivo, regulatório, governança) em JSON.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_prescritivo",
    description: "Recomendações prescritivas.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_comparativo_simulado",
    description: "Compara base × cenário simulado ativo.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_resumo_executivo",
    description:
      "Retorna os 8 KPIs mais importantes da empresa em menos de 500 tokens. Use SEMPRE como primeiro passo antes de qualquer análise. Só chame tools específicas se precisar aprofundar um tema. Nunca chame get_tudo como primeiro passo.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_tudo",
    description:
      "Snapshot COMPLETO da empresa: premissas, receitas, despesas, capital, regime, DRE, indicadores, caixa, valuation, diagnóstico, saúde, governança, estratégico e prescritivo. Use quando precisar de visão 360° para uma decisão.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_alertas_criticos",
    description:
      "Retorna apenas os alertas críticos e de atenção do diagnóstico automático com número exato e fonte. Use como segundo passo após get_resumo_executivo para identificar onde aprofundar a análise. Mais eficiente que get_diagnostico quando só precisa saber 'o que está errado'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

const handlers: Record<string, ToolHandler> = {
  get_premissas: (_a, { sec }) => sec.premissas,
  get_receitas: (_a, { sec }) => sec.receitas,
  get_despesas: (_a, { sec }) => sec.despesas,
  get_capital: (_a, { sec }) => sec.capital,
  get_balanco_abertura: (_a, { sec }) =>
    sec.balancoAbertura ||
    "_Saldos de abertura indisponíveis (verifique os inputs em Capital · Outras informações de abertura)._",
  get_balanco_fechamento: (_a, { sec }) =>
    sec.balanco ||
    "_Balanço de fechamento indisponível (DRE/DFC ainda não calculados — preencha Receitas e Despesas)._",
  get_contratos_divida: (_a, { sec }) =>
    sec.dividas || "_Nenhum contrato de dívida cadastrado e Dívida Onerosa agregada é zero._",
  get_pagina_capital: (_a, { sec }) =>
    [
      sec.capital,
      sec.balancoAbertura,
      sec.dividas ||
        "_Sem contratos de dívida detalhados — verifique Capital · Contratos de Empréstimos e Financiamentos._",
    ]
      .filter(Boolean)
      .join("\n\n"),
  get_regime_tributario: (_a, { sec }) => sec.regime,
  get_eras_reforma: (_a, { sec }) => {
    const body = sec.eras || "_Comparativo de eras indisponível (verifique a configuração tributária)._";
    return (
      body +
      "\n\n> ℹ️ Valores da transição representam o **PONTO MÉDIO** do cronograma (IBS ~50%, ICMS/ISS ~50%). Para um ano específico (ex: 2029), use a ferramenta `simular_transicao_reforma`."
    );
  },

  get_wacc: (_a, { state, sec }) => {
    // Drill-down do WACC. Unidades: ke/kd/wacc/roic já em PERCENT.
    const ind = sec.data?.ind;
    const cap = state.capital;
    const PL = Math.max(0, cap.patrimonioLiquido);
    const D = Math.max(0, sumContractSaldos(cap.debtContracts));
    const V = PL + D;
    const wE = V > 0 ? PL / V : (cap.proprio ?? 0) / 100;
    const wD = V > 0 ? D / V : 1 - (cap.proprio ?? 0) / 100;
    const ke = cap.ke > 0 ? cap.ke : 8;
    const kd = cap.kd ?? 0;
    const effRegime = resolveEffectiveRegime(state);
    const waccPct = ind?.wacc ?? 0;
    const roicPct = ind?.roic ?? 0;
    // Shield implícito: wacc = wE·Ke + wD·Kd·(1 − t)  ⇒  t = 1 − (wacc − wE·Ke)/(wD·Kd).
    const tShield =
      wD > 0 && kd > 0 ? Math.max(0, Math.min(0.5, 1 - (waccPct - wE * ke) / (wD * kd))) : 0;
    const contribE = wE * ke;
    const contribD = wD * kd * (1 - tShield);
    const spread = roicPct - waccPct;
    const veredito =
      roicPct >= waccPct
        ? `✅ **Cria valor**: ROIC ${roicPct.toFixed(2)}% ≥ WACC ${waccPct.toFixed(2)}% (spread +${spread.toFixed(2)} pp).`
        : `🚨 **Destrói valor**: ROIC ${roicPct.toFixed(2)}% < WACC ${waccPct.toFixed(2)}% (spread ${spread.toFixed(2)} pp).`;
    return [
      `## WACC — drill-down (regime efetivo: ${effRegime})`,
      ``,
      `**Fórmula:** wE·Ke + wD·Kd·(1 − t)`,
      ``,
      `| Componente | Valor |`,
      `|---|---:|`,
      `| Patrimônio Líquido (PL) | ${brl(PL)} |`,
      `| Dívida onerosa (D) | ${brl(D)} |`,
      `| Peso equity (wE) | ${(wE * 100).toFixed(1)}% |`,
      `| Peso dívida (wD) | ${(wD * 100).toFixed(1)}% |`,
      `| Custo do equity (Ke) | ${ke.toFixed(2)}% |`,
      `| Custo da dívida (Kd) | ${kd.toFixed(2)}% |`,
      `| Shield tributário (t) | ${(tShield * 100).toFixed(1)}% ${tShield === 0 ? "_(Simples/Presumido: sem dedução de juros)_" : ""} |`,
      `| Contribuição do equity (wE·Ke) | ${contribE.toFixed(2)} pp |`,
      `| Contribuição da dívida (wD·Kd·(1−t)) | ${contribD.toFixed(2)} pp |`,
      `| **WACC final** | **${waccPct.toFixed(2)}%** |`,
      ``,
      veredito,
    ].join("\n");
  },

  get_dre: (_a, { sec }) => {
    // Guardrail de tokens: DRE pode passar de 4k tokens; sugere resumo se a pergunta for pontual.
    const tok = Math.ceil((sec.dre?.length || 0) / 4);
    const header =
      tok > 3000
        ? `> ⚠️ Payload grande (~${tok} tokens). Para KPIs pontuais use \`get_resumo_executivo\`; só consuma a DRE completa quando precisar do detalhe mensal.\n\n`
        : "";
    return header + sec.dre;
  },
  get_indicadores: (_a, { sec }) => sec.indicadores,
  get_fluxo_caixa: (_a, { sec }) => sec.caixa,
  get_valuation: (_a, { sec }) => sec.valuation,
  get_diagnostico: (_a, { sec }) => sec.diagnostico,
  get_saude_financeira: (_a, { sec }) => sec.saude,
  get_governanca: (_a, { sec }) =>
    sec.governanca || "_Módulo de Governança não preenchido pelo consultor._",
  get_estrategico: (_a, { sec }) =>
    sec.estrategico || "_Análise estratégica não preenchida pelo consultor._",
  get_prescritivo: (_a, { sec }) => sec.prescritivo,
  get_comparativo_simulado: (_a, { sec }) =>
    sec.comparativo ?? "Nenhum cenário simulado ativo — todas as alavancas estão em 0.",

  get_resumo_executivo: (_a, { state, sec }) => {
    // Reusa cache numérico (sec.data) quando disponível; caso contrário deriva
    // do modelo financeiro memoizado (WeakMap por ref do state — SSOT).
    const d = sec.data;
    const model = getFinancialModelCached(state);
    const dre = d?.dre ?? model.dre;
    const ind = d?.ind ?? model.ind;
    const val = d?.val ?? model.val;
    const health = d?.health ?? model.health;
    return [
      "## Resumo Executivo",
      `- Receita Bruta Anual: ${brl(sum(dre.receitaBruta))}`,
      `- EBITDA: ${brl(sum(dre.ebitda))} (${pct(ind.margemEbitda)})`,
      `- Lucro Líquido: ${brl(sum(dre.lucroLiquido))} (${pct(ind.margemLiquida)})`,
      `- DSCR: ${ind.dscr == null ? "N/A (sem dívida a servir)" : `${ind.dscr.toFixed(2)}x ${ind.dscr < 1.5 ? "⚠️ abaixo de 1,5x" : "✅"}`}`,
      `- NCG: ${brl(ind.ncg)} | Gap Capital de Giro: ${brl(ind.gapCapitalGiro)}`,
      `- EV (base): ${brl(val.enterpriseValue.base)}`,
      `- Score de Saúde: ${health.total.toFixed(0)}/100 — ${health.grade} (${health.status})`,
      `- Pior mês de caixa: chame get_fluxo_caixa para detalhar`,
    ].join("\n");
  },

  get_tudo: (_a, { sec }) =>
    [
      sec.premissas,
      sec.receitas,
      sec.despesas,
      sec.capital,
      sec.balancoAbertura,
      sec.balanco,
      sec.dividas,
      sec.regime,
      sec.dre,
      sec.indicadores,
      sec.caixa,
      sec.valuation,
      sec.diagnostico,
      sec.saude,
      sec.governanca,
      sec.estrategico,
      sec.prescritivo,
      sec.comparativo,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n"),

  get_alertas_criticos: (_a, { state, sec }) => {
    // Reusa cache numérico — diagnose() é caro e idempotente para o mesmo state.
    let alerts = sec.data?.alerts;
    if (!alerts) {
      const model = getFinancialModelCached(state);
      alerts = diagnose(state, model.dre, model.ind);
    }
    const critical = alerts.filter((a) => a.level === "danger");
    const warning = alerts.filter((a) => a.level === "warn");
    if (!alerts.length) return "✅ Nenhum alerta crítico ou de atenção identificado.";
    const lines = ["## Alertas do Diagnóstico"];
    if (critical.length) {
      lines.push("\n### 🔴 Críticos");
      critical.forEach((a) => lines.push(`- **${a.title}** — ${a.message}`));
    }
    if (warning.length) {
      lines.push("\n### 🟡 Atenção");
      warning.forEach((a) => lines.push(`- **${a.title}** — ${a.message}`));
    }
    lines.push(
      `\nTotal: ${critical.length} crítico(s), ${warning.length} atenção. ` +
        `Chame as tools específicas para aprofundar cada tema.`,
    );
    return lines.join("\n");
  },
};

export const financeTools: ToolModule = {
  category: "finance",
  description: "Indicadores e leitura da engine financeira (DRE, FCF, WACC...)",
  defs,
  handlers,
};
