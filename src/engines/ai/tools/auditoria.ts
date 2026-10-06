// Tools de AUDITORIA INTEGRADA — modo Contador / Auditor.
// Objetivo: dar à IA um conjunto de ferramentas para responder
//   1) get_completude         → quanto está preenchido em cada módulo
//   2) get_inconsistencias    → conflitos cross-aba (usa crossValidate SSOT)
//   3) get_gaps_residuais     → o que falta para análise 360°
//   4) get_confianca_analise  → nota de 0-100 + breakdown
//   5) get_proximos_passos    → checklist priorizado para o consultor
//
// Engine pura sobre AppState — não muta nada e não depende de UI.

import type { AppState, CostLine } from "@/engines/finance/types";
import { crossValidate, groupBySeverity } from "@/engines/finance/crossValidation";
import { sum as sumArr } from "@/engines/finance/format";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

// ---------------------------------------------------------------------------
// Helpers de completude — pontuação 0..1 por módulo
// ---------------------------------------------------------------------------
type ModuleScore = {
  key: string;
  label: string;
  score: number; // 0..1
  missing: string[];
};

const hasMonths = (m?: number[]) => Array.isArray(m) && sumArr(m) > 0;

function scoreReceitas(s: AppState): ModuleScore {
  const r = s.revenue;
  const missing: string[] = [];
  let pts = 0;
  const max = 4;
  if (r && hasMonths(r.bruta)) pts++;
  else missing.push("Receita bruta mensal");
  if (r && Number.isFinite(r.pmr) && r.pmr > 0) pts++;
  else missing.push("PMR (prazo médio de recebimento)");
  if (r && Number.isFinite(r.pmp) && r.pmp > 0) pts++;
  else missing.push("PMP (prazo médio de pagamento)");
  if (r && hasMonths(r.inadimplencia)) pts++;
  else missing.push("Inadimplência mensal (pode ser 0)");
  return { key: "receitas", label: "Receitas", score: pts / max, missing };
}

function scoreDespesas(s: AppState): ModuleScore {
  const linhas: CostLine[] = s.costs ?? [];
  const missing: string[] = [];
  const temCpv = linhas.some((l) => /cpv|cmv|custo.*vend/i.test(l.category) && hasMonths(l.values));
  const temFixo = linhas.some((l) => l.fixed && hasMonths(l.values));
  const temFolha = linhas.some((l) => /folha|salar|clt/i.test(l.label) && hasMonths(l.values));
  if (!temCpv) missing.push("CPV/CMV mensal");
  if (!temFixo) missing.push("Pelo menos 1 custo fixo");
  if (!temFolha) missing.push("Linha de folha CLT (ou confirmação que não há)");
  const score = (Number(temCpv) + Number(temFixo) + Number(temFolha)) / 3;
  return { key: "despesas", label: "Despesas", score, missing };
}

function scoreCapital(s: AppState): ModuleScore {
  const c = s.capital;
  const missing: string[] = [];
  let pts = 0;
  const max = 5;
  if (c && c.patrimonioLiquido > 0) pts++;
  else missing.push("Patrimônio Líquido");
  if (c) pts++;
  if (c && c.ke > 0) pts++;
  else missing.push("Ke (custo de capital próprio)");
  if (c && c.kd >= 0) pts++;
  else missing.push("Kd (custo da dívida)");
  if (c && c.ativoTotal > 0) pts++;
  else missing.push("Ativo total");
  return { key: "capital", label: "Capital", score: pts / max, missing };
}

function scoreBalanco(s: AppState): ModuleScore {
  const b = s.capital?.balanco;
  const missing: string[] = [];
  let pts = 0;
  const max = 4;
  if (b?.ativoCirculante) pts++;
  else missing.push("Ativo Circulante (caixa, CR, estoques)");
  if (b?.ativoNaoCirculante?.imobilizado) pts++;
  else missing.push("Imobilizado por tipo (vidas úteis)");
  if (b?.passivoCirculante) pts++;
  else missing.push("Passivo Circulante (fornecedores, CP)");
  if (b?.patrimonioLiquido?.capitalSocial != null) pts++;
  else missing.push("PL detalhado (Capital Social, Reservas)");
  return { key: "balanco", label: "Balanço Patrimonial", score: pts / max, missing };
}

function scoreTributos(s: AppState): ModuleScore {
  const t = s.tax;
  const missing: string[] = [];
  let pts = 0;
  const max = 2;
  if (t?.regime) pts++;
  else missing.push("Regime tributário");
  if (t?.regime === "simples" ? !!t.simplesAnexo : true) pts++;
  else missing.push("Anexo do Simples");
  return { key: "tributos", label: "Tributos", score: pts / max, missing };
}

function scoreGovernanca(s: AppState): ModuleScore {
  const g = s.strategic?.governance;
  const missing: string[] = [];
  let pts = 0;
  const max = 6;
  if (s.numSocios != null) pts++;
  else missing.push("Número de sócios");
  if (s.numColaboradores != null || s.headcountRange) pts++;
  else missing.push("Headcount (nº colaboradores ou faixa)");
  if (g?.socioAfastado60d) pts++;
  else missing.push("Diagnóstico: sócio afastado 60 dias");
  if (g?.quemFechaContrato) pts++;
  else missing.push("Quem fecha contratos");
  if (g?.processosDocumentados) pts++;
  else missing.push("Processos documentados");
  if (g?.planoSucessao) pts++;
  else missing.push("Plano de sucessão");
  return { key: "governanca", label: "Governança", score: pts / max, missing };
}

function scoreCaixa(s: AppState): ModuleScore {
  const c = s.cashflow;
  const missing: string[] = [];
  let pts = 0;
  const max = 2;
  if (c && Number.isFinite(c.caixaMinimo) && c.caixaMinimo >= 0) pts++;
  else missing.push("Caixa mínimo desejado");
  if (
    c &&
    (hasMonths(c.capex) ||
      hasMonths(c.aportes) ||
      hasMonths(c.amortizacoes) ||
      hasMonths(c.dividendos) ||
      hasMonths(c.emprestimosCaptados))
  )
    pts++;
  else missing.push("Movimentos não-operacionais (capex/aportes/amortiz./divid.) — pode ser 0");
  return { key: "caixa", label: "Caixa & Movimentos", score: pts / max, missing };
}

function scoreAll(s: AppState): ModuleScore[] {
  return [
    scoreReceitas(s),
    scoreDespesas(s),
    scoreCapital(s),
    scoreBalanco(s),
    scoreTributos(s),
    scoreCaixa(s),
    scoreGovernanca(s),
  ];
}

const emoji = (p: number) => (p >= 0.85 ? "✅" : p >= 0.5 ? "⚠️" : "❌");
const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

// ---------------------------------------------------------------------------
// Defs
// ---------------------------------------------------------------------------
const defs: ToolDef[] = [
  {
    name: "get_completude",
    description:
      "Mede a COMPLETUDE de cada módulo do FinnancePRO (Receitas, Despesas, Capital, Balanço, Tributos, Caixa, Governança) em 0–100%. Lista para cada módulo o que ainda falta preencher. Use SEMPRE antes de prometer análise 360° — se a completude estiver abaixo de 70%, peça os dados antes.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_inconsistencias",
    description:
      "Detecta CONFLITOS estruturais entre módulos via crossValidate (SSOT): margem bruta negativa, dividendos > lucro, DRE × Caixa, Simples acima do limite, alavancagem perigosa, ciclo financeiro fora da faixa, etc. Retorna erros/avisos/infos categorizados (estrutural/fiscal/operacional) com fixHint acionável.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_gaps_residuais",
    description:
      "Lista o que AINDA FALTA para uma análise financeira 360° — combina os `missing` de cada módulo da completude com os warnings críticos do crossValidate. Use após get_completude quando o consultor perguntar 'o que ainda preciso preencher?'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_confianca_analise",
    description:
      "Calcula uma NOTA DE CONFIANÇA 0–100 para análises sobre esta empresa. Combina: completude média ponderada dos módulos (70%) − penalidade por erros estruturais (20pp por error, 5pp por warn, máx. 40). Retorna a nota, o nível (Alta/Média/Baixa) e o breakdown.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_proximos_passos",
    description:
      "Gera um CHECKLIST PRIORIZADO de próximos passos para o consultor: primeiro os erros estruturais (crossValidate severity=error), depois os módulos com completude < 70%, depois warnings. Cada item tem aba de destino para deep-link.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_relatorio_auditoria",
    description:
      "Relatório CONSOLIDADO de auditoria integrada: completude + inconsistências + gaps + nota de confiança + próximos passos, em um único markdown. Use quando o consultor pedir 'audite tudo' ou 'qual o status da base de dados desta empresa'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
function buildCompletudeMd(state: AppState): { md: string; scores: ModuleScore[]; avg: number } {
  const scores = scoreAll(state);
  const avg = scores.reduce((acc, s) => acc + s.score, 0) / scores.length;
  const lines = [
    `## Completude da base (${fmtPct(avg)})`,
    ``,
    `| Módulo | Completude | Status | Faltando |`,
    `|---|---:|:-:|---|`,
    ...scores.map(
      (s) =>
        `| ${s.label} | ${fmtPct(s.score)} | ${emoji(s.score)} | ${s.missing.length ? s.missing.slice(0, 3).join("; ") : "—"} |`,
    ),
  ];
  return { md: lines.join("\n"), scores, avg };
}

function buildInconsistenciasMd(state: AppState): {
  md: string;
  errors: number;
  warns: number;
  infos: number;
} {
  const ws = crossValidate(state);
  const g = groupBySeverity(ws);
  if (!ws.length)
    return {
      md: "## Inconsistências cross-aba\n\n✅ Nenhuma inconsistência detectada.",
      errors: 0,
      warns: 0,
      infos: 0,
    };
  const fmt = (w: (typeof ws)[number]) =>
    `- **[${w.category}/${w.severity.toUpperCase()}]** ${w.title} — ${w.detail}${w.fixHint ? ` _Sugestão: ${w.fixHint}_` : ""}${w.location ? ` (aba: ${w.location})` : ""}`;
  const blocks: string[] = ["## Inconsistências cross-aba"];
  if (g.error.length)
    blocks.push(`\n### ❌ Erros (${g.error.length})\n${g.error.map(fmt).join("\n")}`);
  if (g.warn.length)
    blocks.push(`\n### ⚠️ Avisos (${g.warn.length})\n${g.warn.map(fmt).join("\n")}`);
  if (g.info.length)
    blocks.push(`\n### ℹ️ Infos (${g.info.length})\n${g.info.map(fmt).join("\n")}`);
  return {
    md: blocks.join("\n"),
    errors: g.error.length,
    warns: g.warn.length,
    infos: g.info.length,
  };
}

function buildConfianca(state: AppState): {
  nota: number;
  nivel: "Alta" | "Média" | "Baixa";
  avgCompletude: number;
  errors: number;
  warns: number;
} {
  const { avg } = buildCompletudeMd(state);
  const ws = crossValidate(state);
  const g = groupBySeverity(ws);
  const penalidade = Math.min(40, g.error.length * 20 + g.warn.length * 5);
  const nota = Math.max(0, Math.round(avg * 70 + 30 - penalidade));
  const nivel = nota >= 80 ? "Alta" : nota >= 55 ? "Média" : "Baixa";
  return { nota, nivel, avgCompletude: avg, errors: g.error.length, warns: g.warn.length };
}

const handlers: Record<string, ToolHandler> = {
  get_completude: (_a, { state }) => buildCompletudeMd(state).md,

  get_inconsistencias: (_a, { state }) => buildInconsistenciasMd(state).md,

  get_gaps_residuais: (_a, { state }) => {
    const { scores } = buildCompletudeMd(state);
    const lacunas = scores
      .filter((s) => s.score < 1)
      .flatMap((s) => s.missing.map((m) => ({ modulo: s.label, item: m })));
    const ws = crossValidate(state).filter((w) => w.severity === "error");
    const lines = ["## Gaps residuais para análise 360°"];
    if (lacunas.length) {
      lines.push("\n### Campos não preenchidos");
      lines.push(...lacunas.map((g) => `- **${g.modulo}:** ${g.item}`));
    } else {
      lines.push("\n✅ Todos os campos críticos preenchidos.");
    }
    if (ws.length) {
      lines.push("\n### Erros estruturais a resolver antes de analisar");
      lines.push(...ws.map((w) => `- **${w.title}** — ${w.detail}`));
    }
    return lines.join("\n");
  },

  get_confianca_analise: (_a, { state }) => {
    const c = buildConfianca(state);
    const badge = c.nivel === "Alta" ? "✅" : c.nivel === "Média" ? "⚠️" : "❌";
    return [
      `## Nota de confiança da análise: ${badge} **${c.nota}/100** — ${c.nivel}`,
      ``,
      `**Breakdown:**`,
      `- Completude média dos módulos: ${fmtPct(c.avgCompletude)} (peso 70)`,
      `- Penalidade por inconsistências: −${Math.min(40, c.errors * 20 + c.warns * 5)} pp (${c.errors} erro(s) × 20pp + ${c.warns} aviso(s) × 5pp, capped em 40)`,
      `- Bônus base: +30 pp`,
      ``,
      c.nota < 55
        ? `🛑 **Não recomendo análise 360° ainda.** Rode \`get_gaps_residuais\` e peça os campos faltantes ao consultor.`
        : c.nota < 80
          ? `⚠️ **Análise viável com ressalvas.** Cite explicitamente os gaps no relatório.`
          : `✅ **Base sólida.** Pode emitir parecer com alta confiança.`,
    ].join("\n");
  },

  get_proximos_passos: (_a, { state }) => {
    const { scores } = buildCompletudeMd(state);
    const ws = crossValidate(state);
    const g = groupBySeverity(ws);
    const passos: string[] = [];
    let i = 1;
    for (const e of g.error) {
      passos.push(
        `${i++}. **[ERRO]** ${e.title} — ${e.detail}${e.location ? ` _(aba: ${e.location})_` : ""}${e.fixHint ? ` → ${e.fixHint}` : ""}`,
      );
    }
    for (const s of scores.filter((s) => s.score < 0.7)) {
      passos.push(
        `${i++}. **[PREENCHER ${s.label.toUpperCase()}]** completude ${fmtPct(s.score)} — falta: ${s.missing.join(", ")}`,
      );
    }
    for (const w of g.warn.slice(0, 5)) {
      passos.push(
        `${i++}. **[AVISO]** ${w.title} — ${w.detail}${w.location ? ` _(aba: ${w.location})_` : ""}`,
      );
    }
    if (!passos.length)
      return "## Próximos passos\n\n✅ Base completa e consistente — nada bloqueando análise 360°.";
    return ["## Próximos passos priorizados", "", ...passos].join("\n");
  },

  get_relatorio_auditoria: (_a, { state }) => {
    const c = buildConfianca(state);
    const comp = buildCompletudeMd(state);
    const inc = buildInconsistenciasMd(state);
    const badge = c.nivel === "Alta" ? "✅" : c.nivel === "Média" ? "⚠️" : "❌";
    const gaps = handlers.get_gaps_residuais({}, { state } as never);
    const passos = handlers.get_proximos_passos({}, { state } as never);
    return [
      `# 🔍 Auditoria Integrada — ${state.companyName || "Empresa"}`,
      ``,
      `**Confiança:** ${badge} ${c.nota}/100 (${c.nivel}) · **Completude média:** ${fmtPct(c.avgCompletude)} · **Inconsistências:** ${inc.errors} erro(s) · ${inc.warns} aviso(s)`,
      ``,
      comp.md,
      ``,
      inc.md,
      ``,
      String(gaps),
      ``,
      String(passos),
    ].join("\n");
  },
};

export const auditoriaTools: ToolModule = {
  category: "auditoria",
  description:
    "Auditoria integrada — completude, inconsistências cross-aba, gaps residuais, nota de confiança e próximos passos.",
  defs,
  handlers,
};
