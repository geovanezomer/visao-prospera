// ============================================================================
// Tipos e helpers puros compartilhados pela camada admin.
//
// Sem dependências de servidor em runtime (o import do banco é só de tipo):
// pode ser importado por código do navegador sem arrastar o driver.
// ============================================================================
import type { Db } from "@/db/client.server";

/**
 * Banco da aplicação (Drizzle). Substitui o antigo cliente admin do Supabase
 * em assinaturas internas: `function foo(admin: AdminClient)`.
 */
export type AdminClient = Db;

/** Valor JSON serializável (colunas jsonb devolvidas ao painel). */
export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

/** Contexto mínimo que as server fns admin recebem do `requireAuth`. */
export type AdminContext = {
  userId: string;
  user?: { email?: string | null } | null;
};

/** E-mail do admin que está agindo (para o log de auditoria). */
export function actorEmail(context: AdminContext): string | null {
  return context.user?.email ?? null;
}

type CamelToSnake<S extends string> = S extends `${infer H}${infer T}`
  ? `${H extends Lowercase<H> ? H : `_${Lowercase<H>}`}${CamelToSnake<T>}`
  : S;

/** Mesmo objeto com as chaves em snake_case (formato que a UI já consome). */
export type Snake<T> = { [K in keyof T as K extends string ? CamelToSnake<K> : K]: T[K] };

export function toSnake<T extends Record<string, unknown>>(row: T): Snake<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return out as Snake<T>;
}
