// Formato de arquivo .finnance — espelha o padrão do Excalidraw:
// envelope estável { type, version, source } + payload + meta para migração futura.
import { z } from "zod";
import { AppState, Scenario } from "./types";
import { DEFAULT_STATE, migrateState } from "./defaults";

export const FINNANCE_FILE_TYPE = "gz-finnance" as const;
export const FINNANCE_FILE_VERSION = 1 as const;
export const FINNANCE_FILE_EXT = ".finnance";

// Schema permissivo no payload (AppState/Scenario já têm muitos campos opcionais);
// a validação forte fica na migração via migrateState, que preenche defaults.
const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  state: z.record(z.string(), z.any()),
});

export const FinnanceFileSchema = z.object({
  type: z.literal(FINNANCE_FILE_TYPE),
  version: z.number().int().positive(),
  source: z.string().optional(),
  savedAt: z.string().optional(),
  app: z.object({ name: z.string(), version: z.string().optional() }).optional(),
  state: z.record(z.string(), z.any()),
  scenarios: z.array(ScenarioSchema).default([]),
  // Dados auxiliares persistidos por empresa: cenários do simulador e plano
  // de ação. Schema permissivo — validação efetiva acontece nos serviços.
  extras: z
    .object({
      actions: z.array(z.record(z.string(), z.any())).optional(),
      simScenarios: z.array(z.record(z.string(), z.any())).optional(),
    })
    .optional(),
  meta: z
    .object({
      companyName: z.string().optional(),
      businessType: z.string().optional(),
      taxRegime: z.string().optional(),
      numColaboradores: z.number().optional(),
      scenarioCount: z.number().optional(),
      actionCount: z.number().optional(),
      simScenarioCount: z.number().optional(),
      sections: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .optional(),
});

export type FinnanceFile = z.infer<typeof FinnanceFileSchema>;

/**
 * Serializa o estado completo + cenários + extras no envelope .finnance.
 * Inclui automaticamente TODAS as seções do app, pois o AppState agrega:
 *  - Configurações Rápidas: companyName, businessType, numColaboradores, tax
 *  - Receitas (revenue), Despesas (costs), Capital (capital)
 *  - Regime Tributário (tax — regime, alíquotas, ISS, Simples, etc.)
 *  - Governança (strategic) e Fluxo de Caixa (cashflow)
 * `extras` (opcional) carrega cenários do simulador e plano de ação, que
 * são persistidos por empresa fora do AppState.
 */
export function serialize(
  state: AppState,
  scenarios: Scenario[],
  extras?: { actions?: unknown[]; simScenarios?: unknown[] },
): FinnanceFile {
  return {
    type: FINNANCE_FILE_TYPE,
    version: FINNANCE_FILE_VERSION,
    source: "FinnancePRO",
    savedAt: new Date().toISOString(),
    app: { name: "FinancePRO", version: "1.x" },
    state: state as unknown as Record<string, unknown>,
    scenarios,
    extras: extras
      ? {
          actions: (extras.actions as Record<string, unknown>[] | undefined) ?? [],
          simScenarios: (extras.simScenarios as Record<string, unknown>[] | undefined) ?? [],
        }
      : undefined,
    meta: {
      companyName: state.companyName,
      businessType: state.businessType,
      taxRegime: state.tax?.regime,
      numColaboradores: state.numColaboradores,
      scenarioCount: scenarios.length,
      actionCount: extras?.actions?.length ?? 0,
      simScenarioCount: extras?.simScenarios?.length ?? 0,
      sections: [
        "configuracoes-rapidas",
        "receitas",
        "despesas",
        "capital",
        "tributos",
        "caixa",
        "governanca",
        "acoes",
        "cenarios-simulador",
      ],
    },
  };
}

/** Aplica migrações entre versões antes de validar. */
function migrateFile(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  // Quando subir para v2+, encadear transformações aqui.
  if (typeof r.version === "number" && r.version > FINNANCE_FILE_VERSION) {
    throw new Error(
      `Arquivo gerado por versão mais nova do FinancePRO (v${r.version}). Atualize o aplicativo.`,
    );
  }
  return r;
}

/** Valida e normaliza um JSON cru lido do disco. */
export function parseFinnanceFile(raw: unknown): {
  state: AppState;
  scenarios: Scenario[];
  extras: { actions: unknown[]; simScenarios: unknown[] };
  file: FinnanceFile;
} {
  const migrated = migrateFile(raw);
  const parsed = FinnanceFileSchema.parse(migrated);
  if (parsed.type !== FINNANCE_FILE_TYPE) {
    throw new Error("Arquivo não é um .finnance válido.");
  }
  const state = migrateState({ ...DEFAULT_STATE, ...(parsed.state as Partial<AppState>) });
  const scenarios = (parsed.scenarios ?? []).map((sc) => ({
    ...sc,
    state: migrateState({ ...DEFAULT_STATE, ...(sc.state as Partial<AppState>) }),
  })) as Scenario[];
  const extras = {
    actions: parsed.extras?.actions ?? [],
    simScenarios: parsed.extras?.simScenarios ?? [],
  };
  return { state, scenarios, extras, file: parsed };
}

/** Remove caracteres inválidos para nome de arquivo cross-OS. */
export function sanitizeFilename(name: string): string {
  return (name || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "empresa";
}

/** Gera nome default: {empresa}-{YYYY-MM-DD}.finnance */
export function defaultFilename(state: AppState): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${sanitizeFilename(state.companyName)}-${ymd}${FINNANCE_FILE_EXT}`;
}
