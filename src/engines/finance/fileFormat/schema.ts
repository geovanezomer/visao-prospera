// Schema CORRENTE do arquivo .finnance. Só valida a versão atual —
// versões antigas viram a forma corrente via `migrations/` antes do parse.
import { z } from "zod";

export const FINNANCE_FILE_TYPE = "gz-finnance" as const;
/** Versão atual do envelope. Bump = adicionar migrator vN_to_vN+1. */
export const FINNANCE_FILE_VERSION = 2 as const;
/** Alias semântico de `FINNANCE_FILE_VERSION`. */
export const CURRENT_VERSION = FINNANCE_FILE_VERSION;
export const FINNANCE_FILE_EXT = ".finnance";

const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  state: z.record(z.string(), z.unknown()),
});

export const FinnanceFileSchema = z.object({
  type: z.literal(FINNANCE_FILE_TYPE),
  version: z.number().int().positive(),
  source: z.string().optional(),
  savedAt: z.string().optional(),
  app: z.object({ name: z.string(), version: z.string().optional() }).optional(),
  state: z.record(z.string(), z.unknown()),
  scenarios: z.array(ScenarioSchema).default([]),
  extras: z
    .object({
      actions: z.array(z.record(z.string(), z.unknown())).optional(),
      simScenarios: z.array(z.record(z.string(), z.unknown())).optional(),
      memories: z.array(z.record(z.string(), z.unknown())).optional(),
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
