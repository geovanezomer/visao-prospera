// Tools de compliance/tributário: comparativo de regimes, diagnóstico,
// checklist, transição ano-a-ano LC 214/2025 e impacto do Split Payment.

import { regimeComparisonToMarkdown, taxAuditToMarkdown } from "@/engines/compliance/tax";
import { checklistToMarkdown } from "@/engines/compliance/checklist";
import { compareYearsForRegime, resolveEffectiveRegime } from "@/engines/finance";
import { getFinancialModelCached } from "@/engines/finance/financialModel";
import {
  analyzeCovenants,
  covenantsToMarkdown,
  type CovenantSpec,
} from "@/engines/finance/covenants";
import { brl, type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const defs: ToolDef[] = [
  {
    name: "simular_regime_tributario",
    description: "Compara Simples × Presumido × Real e indica o de menor carga (heurístico).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "diagnostico_tributario",
    description:
      "Gera um diagnóstico detalhado da situação fiscal atual, detectando economias potenciais (ex: migração para Real).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "checklist_compliance",
    description: "Lista obrigações fiscais/trabalhistas aplicáveis ao regime atual.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "simular_transicao_reforma",
    description:
      "Simula a carga tributária ano-a-ano no cronograma oficial da LC 214/2025 (2026–2033), considerando a cobrança híbrida (CBS+IBS parcial × PIS/COFINS+ICMS/ISS em redução gradual). Use quando o usuário perguntar sobre impacto da Reforma em anos específicos ('quanto vou pagar em 2030?', 'em que ano fica mais caro?'). Por padrão simula o regime atual da empresa nos anos 2026–2033.",
    parameters: {
      type: "object",
      properties: {
        regime: {
          type: "string",
          enum: ["simples", "presumido", "real"],
          description: "Regime a simular. Default: regime efetivo atual.",
        },
        anos: {
          type: "array",
          items: { type: "number" },
          description: "Anos a comparar. Default: [2026,2027,2028,2029,2030,2031,2032,2033].",
        },
      },
      required: [],
    },
  },
  {
    name: "simular_split_payment",
    description:
      "Mede o impacto do Split Payment (LC 214/2025) no caixa, NCG, DSCR e timeline de default. O Split retém CBS/IBS no momento da liquidação eliminando o float tributário (~25–40 dias). Retorna: (1) float perdido por rubrica, (2) impacto permanente em NCG e custo de carregamento (× Kd), (3) DSCR pós-Split e re-avaliação de covenants, (4) mês em que o caixa cruza zero descontando o float. Use sempre que o consultor perguntar 'qual o impacto do Split Payment?' ou 'como me preparar para 2027?'.",
    parameters: {
      type: "object",
      properties: {
        ano_inicio: {
          type: "number",
          description:
            "Ano em que o Split começa a valer (default 2027 — CBS pleno). Apenas informativo no relatório.",
        },
        prazos_override: {
          type: "object",
          description:
            "Sobrescreve prazos de recolhimento (em dias) por rubrica. Ex.: { CBS: 30, IBS: 15 }. Use quando o consultor souber o calendário real da empresa.",
          additionalProperties: { type: "number" },
        },
        incluir_covenants: {
          type: "boolean",
          description:
            "Se true (default), re-avalia DSCR/Liquidez/D-EBITDA assumindo perda permanente do float.",
        },
      },
      required: [],
    },
  },
  {
    name: "analisar_covenants",
    description:
      "Avalia covenants contratuais (DSCR, Dívida/EBITDA, Liquidez Corrente, D/PL) com semáforo verde/amarelo/vermelho, score de risco 0–10 (BAIXO→CRÍTICO) e timeline estimada de default (mês em que o caixa cruza zero). Use quando o consultor perguntar sobre risco de quebra de covenant, urgência de ação ou avaliação de risco de crédito. Aceita covenants customizados via 'contratos' ou usa padrões bancários PME se omitido. Cenário 'simulado' considera as alavancas ativas.",
    parameters: {
      type: "object",
      properties: {
        contratos: {
          type: "object",
          description:
            "Limites contratuais. Omita campos para usar defaults (dscrMin=1.25, dEbitdaMax=3.0, liqCorrMin=1.5, dPlMax=2.0).",
          properties: {
            dscrMin: { type: "number" },
            dEbitdaMax: { type: "number" },
            liqCorrMin: { type: "number" },
            dPlMax: { type: "number" },
          },
        },
        cenario: {
          type: "string",
          enum: ["base", "simulado"],
          description: "Default 'base'. 'simulado' aplica as alavancas ativas.",
        },
      },
      required: [],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  simular_regime_tributario: (_a, { state }) => regimeComparisonToMarkdown(state),
  diagnostico_tributario: (_a, { state }) => taxAuditToMarkdown(state),
  checklist_compliance: (_a, { state }) => checklistToMarkdown(state),

  simular_transicao_reforma: (args, { state }) => {
    const regime =
      (args?.regime as "simples" | "presumido" | "real") || resolveEffectiveRegime(state);
    const years: number[] =
      Array.isArray(args?.anos) && args.anos.length
        ? (args.anos as unknown[]).map((y) => Number(y)).filter((y) => Number.isFinite(y))
        : [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
    const rows = compareYearsForRegime(state, regime, years);
    const lines = [
      `## Transição Tributária ano-a-ano — regime **${regime}**`,
      ``,
      `Cronograma oficial LC 214/2025 (cobrança híbrida CBS+IBS × PIS/COFINS+ICMS/ISS):`,
      ``,
      `| Ano | CBS | IBS | PIS/COFINS | ICMS/ISS | Carga efetiva | Anual |`,
      `|---|---:|---:|---:|---:|---:|---:|`,
    ];
    rows.forEach((r) => {
      lines.push(
        `| ${r.year} | ${r.rates.cbsPct.toFixed(2)}% | ${r.rates.ibsPct.toFixed(2)}% | ${(r.rates.pisCofinsMult * 100).toFixed(0)}% | ${(r.rates.icmsIssMult * 100).toFixed(0)}% | ${r.effective.toFixed(2)}% | ${brl(r.annual)} |`,
      );
    });
    const sorted = [...rows].sort((a, b) => a.annual - b.annual);
    const min = sorted[0],
      max = sorted[sorted.length - 1];
    const delta = max.annual - min.annual;
    lines.push(
      ``,
      `**Pico:** ${max.year} (${brl(max.annual)} · ${max.effective.toFixed(2)}%) · **Vale:** ${min.year} (${brl(min.annual)}) · **Δ:** ${brl(delta)} entre extremos.`,
    );
    lines.push(
      `\n_Mantém preços e custos constantes; isola o efeito da Reforma. Para o resumo agregado em 3 eras, use \`get_eras_reforma\`._`,
    );
    return lines.join("\n");
  },

  simular_split_payment: (args, { state }) => {
    const anoInicio = Number(args?.ano_inicio) || state.tax.splitPaymentAnoInicio || 2027;
    const incluirCovenants = args?.incluir_covenants !== false;
    const splitJaAtivo = state.tax.splitPaymentAtivo !== false; // default true
    const override =
      args?.prazos_override && typeof args.prazos_override === "object"
        ? (args.prazos_override as Record<string, number>)
        : {};

    // Prazos médios de recolhimento (dias após o mês de competência).
    const PRAZOS: { match: RegExp; dias: number; key: string }[] = [
      { match: /^DAS Simples/i, dias: 20, key: "DAS" },
      { match: /^PIS/i, dias: 25, key: "PIS" },
      { match: /^COFINS/i, dias: 25, key: "COFINS" },
      { match: /^CBS/i, dias: 25, key: "CBS" },
      { match: /^IBS/i, dias: 10, key: "IBS" },
      { match: /^ISS/i, dias: 10, key: "ISS" },
      { match: /^ICMS/i, dias: 10, key: "ICMS" },
      { match: /^IRPJ|^Adicional IRPJ|^CSLL/i, dias: 45, key: "IRPJ_CSLL" },
    ];
    const model = getFinancialModelCached(state);
    const regime = model.regime;
    const { tax } = model;
    const detail = tax.detail || {};

    // Float = Σ (carga_anual / 12) × (prazo_dias / 30)
    let floatTotal = 0;
    const linhas: { label: string; mensal: number; dias: number; float: number }[] = [];
    for (const [chave, valorAnual] of Object.entries(detail)) {
      if (!Number.isFinite(valorAnual) || valorAnual <= 0) continue;
      const cfg = PRAZOS.find((p) => p.match.test(chave));
      if (!cfg) continue;
      const dias = override[cfg.key] ?? override[chave] ?? cfg.dias;
      const mensal = valorAnual / 12;
      const flt = mensal * (dias / 30);
      floatTotal += flt;
      linhas.push({ label: chave, mensal, dias, float: flt });
    }

    const cargaMensalTotal = tax.annual / 12;
    const kdRaw = state.capital.kd ?? 0;
    const kd = kdRaw > 1 ? kdRaw / 100 : kdRaw;
    const custoAnual = floatTotal * kd;

    if (linhas.length === 0) {
      return [
        `## Impacto do Split Payment — regime **${regime}** (a partir de ${anoInicio})`,
        ``,
        `⚠️ **Detalhamento tributário indisponível.** O cálculo do float exige a quebra da carga por rubrica (PIS, COFINS, ICMS, ISS, CBS, IBS, DAS, IRPJ, CSLL), e \`tax.detail\` está vazio para este estado.`,
        ``,
        `**Carga tributária total (referência):** ${brl(tax.annual)} ao ano · ${brl(cargaMensalTotal)} ao mês.`,
        ``,
        `**Como destravar:** confirme que a aba Tributos foi calculada (clique em "Recalcular" na TaxTab) ou utilize \`simular_transicao_reforma\` para o cronograma ano-a-ano da Reforma.`,
      ].join("\n");
    }

    const out: string[] = [];
    out.push(`## Impacto do Split Payment — regime **${regime}** (a partir de ${anoInicio})`);
    out.push(
      splitJaAtivo
        ? `> ✅ **Split Payment já está ATIVO neste cenário** (TaxConfig.splitPaymentAtivo=true). Os números de caixa/DSCR/NCG abaixo já refletem o lag 0 de CBS+IBS — o "float perdido" é a diferença vs. o mundo antigo, útil para comparação.`
        : `> ⚠️ **Split Payment está DESLIGADO neste cenário** (TaxConfig.splitPaymentAtivo=false). O relatório abaixo dimensiona quanto caixa será permanentemente drenado quando o toggle for ativado.`,
    );
    out.push(``);
    out.push(`### 1. Float tributário por rubrica`);
    out.push(`| Tributo | Carga mensal | Prazo atual | Float (R$) |`);
    out.push(`|---|---:|---:|---:|`);
    linhas.forEach((l) =>
      out.push(`| ${l.label} | ${brl(l.mensal)} | ${l.dias}d | ${brl(l.float)} |`),
    );
    out.push(`| **Total** | **${brl(cargaMensalTotal)}** | — | **${brl(floatTotal)}** |`);

    // ===== 2. Impacto permanente em capital de giro =====
    const { cf, ind } = model;
    const ncgAtual = ind.ncg ?? 0;
    const ncgPos = ncgAtual + floatTotal; // PC tributário some → NCG sobe
    out.push(``, `### 2. Capital de giro & custo de carregamento`);
    out.push(
      `- **NCG atual:** ${brl(ncgAtual)} → **pós-Split:** ${brl(ncgPos)} (Δ ${brl(floatTotal)}, +${ncgAtual > 0 ? ((floatTotal / ncgAtual) * 100).toFixed(1) : "∞"}%).`,
      `- **Caixa operacional permanentemente reduzido em:** ${brl(floatTotal)}.`,
      `- **Custo financeiro anual** (× Kd ${(kd * 100).toFixed(1)}%): **${brl(custoAnual)}**/ano.`,
    );

    // ===== 3. Timeline: quando o caixa cruza zero descontando o float =====
    const meses = [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ];
    let mesZeroSplit: string | null = null;
    let mesZeroBase: string | null = null;
    for (let i = 0; i < 12; i++) {
      if (!mesZeroBase && cf.saldoFinal[i] < 0) mesZeroBase = meses[i];
      if (!mesZeroSplit && cf.saldoFinal[i] - floatTotal < 0) mesZeroSplit = meses[i];
    }
    out.push(``, `### 3. Timeline de caixa (ano-base)`);
    out.push(
      `- **Sem Split:** caixa ${mesZeroBase ? `negativo em **${mesZeroBase}**` : "permanece positivo todo o ano"}.`,
      `- **Com Split (drain de ${brl(floatTotal)}):** caixa ${mesZeroSplit ? `negativo em **${mesZeroSplit}**` : "permanece positivo todo o ano"}.`,
    );

    // ===== 4. Covenants pós-Split =====
    if (incluirCovenants) {
      const cov = analyzeCovenants(state, {} as CovenantSpec, "base");
      out.push(``, `### 4. Covenants pós-Split`);
      out.push(
        `_Avaliação atual (sem Split). Com a perda de ${brl(floatTotal)} em caixa, DSCR e Liquidez Corrente tendem a piorar proporcionalmente:_`,
        ``,
        covenantsToMarkdown(cov),
      );
    }

    out.push(
      ``,
      `> _Estimativa baseada em LC 214/2025. Split Payment entra em vigor com CBS pleno (2027) e se intensifica até 2033. Use \`simular_transicao_reforma\` para o cronograma ano-a-ano._`,
    );
    return out.join("\n");
  },

  analisar_covenants: (args, { state, simulatedState }) => {
    const cenario = (args?.cenario as "base" | "simulado") || "base";
    const target = cenario === "simulado" ? (simulatedState ?? state) : state;
    const spec = (args?.contratos as CovenantSpec | undefined) ?? {};
    const res = analyzeCovenants(target, spec, cenario);
    return covenantsToMarkdown(res);
  },
};

export const complianceTools: ToolModule = {
  category: "compliance",
  description: "Checklist e tributos (CBS/IBS, Simples, Lucro Real/Presumido)",
  defs,
  handlers,
};
