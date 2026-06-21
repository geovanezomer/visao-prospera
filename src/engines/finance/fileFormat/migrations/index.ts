// Pipeline de migrators versionados — inspirado no `restore.ts` do Excalidraw.
//
// COMO ADICIONAR UM MIGRATOR (quando subir CURRENT_VERSION para N+1):
//   1. Crie `vN_to_vN+1.ts` neste diretório exportando `const vN_to_vN+1: Migration`.
//   2. Adicione-o ao array MIGRATIONS abaixo, em ordem crescente.
//   3. Em `__tests__/fixtures/`, salve `vN.json` (forma antiga, congelada).
//   4. Bump `CURRENT_VERSION` em `../schema.ts`.
//   5. Rode `bunx vitest run fileFormat` — o teste de smoke abre todas as
//      fixtures e garante que viram a versão corrente.
//
// Regras:
//   - APPEND-ONLY: nunca edite um migrator publicado.
//   - Cada migrator é função PURA, pequena, sem efeito colateral.
//   - Migrator pode adicionar campo com default, renomear, restruturar.
//     NÃO pode descartar dado do usuário silenciosamente.
import type { Migration } from "./types";
import { v1_to_v2 } from "./v1_to_v2";

/** Lista ordenada de migrators (append-only). */
export const MIGRATIONS: Migration[] = [v1_to_v2];

/**
 * Aplica os migrators necessários para levar `raw` até `targetVersion`.
 * - Arquivos sem `version` são tratados como v1 (compatibilidade).
 * - Arquivo de versão mais nova que a atual → erro explícito.
 */
export function runMigrations(raw: unknown, targetVersion: number): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const current = typeof obj.version === "number" ? obj.version : 1;

  if (current > targetVersion) {
    throw new Error(
      `Arquivo gerado por versão mais nova do FinnancePRO (v${current}). Atualize o aplicativo.`,
    );
  }

  let data: unknown = obj;
  for (const m of MIGRATIONS) {
    const v = (data as { version?: number }).version ?? 1;
    if (v === m.from && m.to <= targetVersion) {
      data = m.run(data);
    }
  }
  return data;
}

export type { Migration } from "./types";
