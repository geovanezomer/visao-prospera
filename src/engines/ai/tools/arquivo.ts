// Tools de acesso ao "arquivo .finnance" (dossiê consolidado da empresa).
// Permite ao LLM ler — sob demanda — o JSON completo da empresa: AppState,
// cenários salvos, plano de ação e cenários do simulador. Útil para análises
// holísticas onde os snapshots/seções individuais não dão a foto inteira.
//
// Três tools complementares, do mais leve ao mais pesado:
//   1) get_arquivo_resumo  — metadados + tamanhos (≈300 tokens)
//   2) get_arquivo_secao   — drill-down por caminho (state.tax, scenarios, …)
//   3) get_arquivo_completo — JSON inteiro (com cap de caracteres + truncagem)

import { serialize, CURRENT_VERSION } from "@/engines/finance/fileFormat";
import { listScenarios } from "@/engines/scenarios/store";
import { collectExtras } from "@/engines/finance/fileExtras";
import type { ToolDef, ToolHandler, ToolModule, ToolContext } from "./shared";

// ───────────────────────── helpers ─────────────────────────

/** Monta o FinnanceFile a partir do estado atual + persistência por empresa. */
function buildArquivo(ctx: ToolContext) {
  const company = ctx.company || ctx.state.companyName || "default";
  // Cenários salvos (exclui soft-deleted, igual ao fluxo de Save).
  const scenarios = listScenarios(company) as unknown as Parameters<typeof serialize>[1];
  const extras = collectExtras(company);
  return serialize(ctx.state, scenarios, extras);
}

/** Resolve um caminho com dot-notation dentro do arquivo (`state.tax.regime`). */
function resolvePath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else if (Array.isArray(cur) && /^\d+$/.test(p)) {
      cur = cur[Number(p)];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Stringify estável + cap em caracteres com marcador de truncagem. */
function jsonCapped(
  value: unknown,
  maxChars: number,
): { body: string; truncated: boolean; total: number } {
  const full = JSON.stringify(value, null, 2) ?? "null";
  if (full.length <= maxChars) return { body: full, truncated: false, total: full.length };
  return {
    body: full.slice(0, maxChars) + `\n…/* truncado em ${maxChars} de ${full.length} chars */`,
    truncated: true,
    total: full.length,
  };
}

/** Tamanhos aproximados (em chars de JSON) de cada chave de 1º nível. */
function sizeMap(obj: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    try {
      out[k] = JSON.stringify(v)?.length ?? 0;
    } catch {
      out[k] = -1;
    }
  }
  return out;
}

// ───────────────────────── handlers ─────────────────────────

const handleResumo: ToolHandler = (_args, ctx) => {
  const file = buildArquivo(ctx);
  const stateSizes = sizeMap(file.state as Record<string, unknown>);
  const topSizes = sizeMap(file as unknown as Record<string, unknown>);
  const meta = file.meta ?? {};
  const totalChars = JSON.stringify(file).length;

  const lines: string[] = [];
  lines.push(`# 📁 Arquivo .finnance — ${meta.companyName || "(sem nome)"}`);
  lines.push("");
  lines.push(`- **Versão do schema:** ${CURRENT_VERSION}`);
  lines.push(`- **Salvo em:** ${file.savedAt}`);
  lines.push(`- **Regime tributário:** ${meta.taxRegime ?? "—"}`);
  lines.push(`- **Tipo de negócio:** ${meta.businessType ?? "—"}`);
  lines.push(`- **Colaboradores:** ${meta.numColaboradores ?? "—"}`);
  lines.push(`- **Cenários salvos:** ${meta.scenarioCount ?? 0}`);
  lines.push(`- **Ações no plano:** ${meta.actionCount ?? 0}`);
  lines.push(`- **Cenários do simulador:** ${meta.simScenarioCount ?? 0}`);
  lines.push(`- **Tamanho total (JSON):** ${totalChars.toLocaleString("pt-BR")} chars`);
  lines.push("");
  lines.push("## Seções de 1º nível");
  lines.push("```json");
  lines.push(JSON.stringify(topSizes, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Chaves de `state` (use em `get_arquivo_secao`)");
  lines.push("```json");
  lines.push(JSON.stringify(stateSizes, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(
    "> Para ler uma seção: `get_arquivo_secao({ path: 'state.tax' })`. " +
      "Para o arquivo todo: `get_arquivo_completo({ maxChars: 80000 })`.",
  );
  return lines.join("\n");
};

const handleSecao: ToolHandler = (args, ctx) => {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const maxChars =
    typeof args.maxChars === "number" ? Math.max(500, Math.min(120000, args.maxChars)) : 20000;
  if (!path) {
    return "Erro: informe `path` (ex.: 'state.tax', 'scenarios', 'extras.actions', 'meta').";
  }
  const file = buildArquivo(ctx);
  const value = resolvePath(file, path);
  if (value === undefined) {
    return `Erro: caminho \`${path}\` não encontrado no arquivo. Use \`get_arquivo_resumo\` para listar chaves.`;
  }
  const { body, truncated, total } = jsonCapped(value, maxChars);
  const head = `# 📁 Seção \`${path}\`${truncated ? ` (truncada — ${total.toLocaleString("pt-BR")} chars no total)` : ""}\n`;
  return `${head}\n\`\`\`json\n${body}\n\`\`\``;
};

const handleCompleto: ToolHandler = (args, ctx) => {
  const maxChars =
    typeof args.maxChars === "number" ? Math.max(2000, Math.min(200000, args.maxChars)) : 60000;
  const file = buildArquivo(ctx);
  const { body, truncated, total } = jsonCapped(file, maxChars);
  const warn = truncated
    ? `\n\n> ⚠️ Truncado em ${maxChars.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} chars. ` +
      "Para inspecionar áreas específicas use `get_arquivo_secao({ path })`."
    : "";
  return `# 📁 Arquivo .finnance completo\n\n\`\`\`json\n${body}\n\`\`\`${warn}`;
};

// ───────────────────────── module ─────────────────────────

const defs: ToolDef[] = [
  {
    name: "get_arquivo_resumo",
    description:
      "Retorna o resumo do arquivo .finnance (dossiê consolidado da empresa): metadados, contagens e tamanho em chars de cada chave. Use ANTES de get_arquivo_secao/completo para decidir o que ler.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_arquivo_secao",
    description:
      "Lê uma seção específica do arquivo .finnance via dot-path (ex.: 'state.tax', 'state.revenue', 'state.balanco', 'scenarios', 'extras.actions', 'extras.simScenarios', 'meta'). Use para drill-down sem estourar tokens.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho dot-notation dentro do arquivo." },
        maxChars: { type: "number", description: "Cap de caracteres (default 20000, máx 120000)." },
      },
      required: ["path"],
    },
  },
  {
    name: "get_arquivo_completo",
    description:
      "Retorna o arquivo .finnance INTEIRO em JSON (AppState + cenários + plano de ação + cenários do simulador). Use somente quando precisar de análise holística cruzando seções; o payload é grande. Truncado em maxChars (default 60000).",
    parameters: {
      type: "object",
      properties: {
        maxChars: { type: "number", description: "Cap de caracteres (default 60000, máx 200000)." },
      },
      required: [],
    },
  },
];

export const arquivoTools: ToolModule = {
  category: "arquivo",
  description:
    "Acesso ao arquivo .finnance — o dossiê JSON consolidado da empresa (estado + cenários + plano de ação + cenários do simulador).",
  defs,
  handlers: {
    get_arquivo_resumo: handleResumo,
    get_arquivo_secao: handleSecao,
    get_arquivo_completo: handleCompleto,
  },
};
