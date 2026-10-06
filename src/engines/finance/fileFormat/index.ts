// Pasta fileFormat — orquestra schema + migrators + serialize/parse.
// API pública estável: importadores continuam usando `@/engines/finance/fileFormat`.
import { AppState, Scenario } from "../types";
import { DEFAULT_STATE, validateAndMigrate } from "../defaults";
import {
  CURRENT_VERSION,
  FINNANCE_FILE_EXT,
  FINNANCE_FILE_TYPE,
  FINNANCE_FILE_VERSION,
  FinnanceFile,
  FinnanceFileSchema,
} from "./schema";
import { runMigrations } from "./migrations";

export {
  CURRENT_VERSION,
  FINNANCE_FILE_EXT,
  FINNANCE_FILE_TYPE,
  FINNANCE_FILE_VERSION,
  FinnanceFileSchema,
};
export type { FinnanceFile };
export type { Migration } from "./migrations";
export { MIGRATIONS, runMigrations } from "./migrations";

/**
 * Serializa o estado completo + cenários + extras no envelope `.finnance`.
 * Carimba sempre com `CURRENT_VERSION`.
 */
export function serialize(
  state: AppState,
  scenarios: Scenario[],
  extras?: { actions?: unknown[]; simScenarios?: unknown[]; memories?: unknown[] },
): FinnanceFile {
  return {
    type: FINNANCE_FILE_TYPE,
    version: CURRENT_VERSION,
    source: "FinnancePRO",
    savedAt: new Date().toISOString(),
    app: { name: "FinnancePRO", version: "1.x" },
    state: state as unknown as Record<string, unknown>,
    scenarios: scenarios as unknown as FinnanceFile["scenarios"],
    extras: extras
      ? ({
          actions: extras.actions ?? [],
          simScenarios: extras.simScenarios ?? [],
          memories: extras.memories ?? [],
        } as FinnanceFile["extras"])
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
        "memorias",
      ],
    },
  };
}

/** Resultado canônico de abrir um arquivo `.finnance`. */
export interface OpenedFile {
  state: AppState;
  scenarios: Scenario[];
  extras: { actions: unknown[]; simScenarios: unknown[]; memories: unknown[] };
  file: FinnanceFile;
  /** Versão original do arquivo lido do disco (antes de migrar). */
  originalVersion: number;
  /** Versão corrente do schema — `originalVersion < currentVersion` ⇒ foi migrado. */
  currentVersion: number;
  /** True quando o pipeline aplicou pelo menos um migrator. */
  migrated: boolean;
}

/**
 * Pipeline completo de leitura: migrate → validate → normalize.
 * Nome canônico do parser do envelope `.finnance`.
 */
export function parseFinnanceFile(raw: unknown): OpenedFile {
  const originalVersion =
    raw && typeof raw === "object" && typeof (raw as { version?: number }).version === "number"
      ? (raw as { version: number }).version
      : 1;
  const migrated = runMigrations(raw, CURRENT_VERSION);
  const parsed = FinnanceFileSchema.parse(migrated);
  if (parsed.type !== FINNANCE_FILE_TYPE) {
    throw new Error("Arquivo não é um .finnance válido.");
  }
  // validateAndMigrate: Zod no shape de topo + migrateState (sanitiza
  // NaN/Infinity/strings em numéricos). Garante que arquivos editados
  // à mão ou corrompidos caiam em DEFAULT_STATE sem quebrar o app.
  const state = validateAndMigrate({ ...DEFAULT_STATE, ...(parsed.state as Partial<AppState>) });
  const scenarios = (parsed.scenarios ?? []).map((sc) => ({
    ...sc,
    state: validateAndMigrate({ ...DEFAULT_STATE, ...(sc.state as Partial<AppState>) }),
  })) as Scenario[];
  const extras = {
    actions: parsed.extras?.actions ?? [],
    simScenarios: parsed.extras?.simScenarios ?? [],
    memories: parsed.extras?.memories ?? [],
  };
  return {
    state,
    scenarios,
    extras,
    file: parsed,
    originalVersion,
    currentVersion: CURRENT_VERSION,
    migrated: originalVersion < CURRENT_VERSION,
  };
}

/** Remove caracteres inválidos para nome de arquivo cross-OS. */
export function sanitizeFilename(name: string): string {
  return (
    (name || "empresa")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "empresa"
  );
}

/** Gera nome default: {empresa}-{YYYY-MM-DD}.finnance */
export function defaultFilename(state: AppState): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${sanitizeFilename(state.companyName)}-${ymd}${FINNANCE_FILE_EXT}`;
}
