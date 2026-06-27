// ============================================================================
// Tipos compartilhados pela camada admin (server-side).
//
// Substituem os `any` históricos em helpers internos que passavam o cliente
// admin do Supabase e os claims do JWT entre módulos. Concentrar aqui mantém
// o resto do código declarativo e dá narrowing real em quem consome.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Cliente admin do Supabase (service_role) já tipado com o schema gerado.
 * Use em assinaturas internas: `function foo(admin: AdminClient)`.
 */
export type AdminClient = SupabaseClient<Database>;

/**
 * Claims do JWT extraídos pelo `requireSupabaseAuth`. Espelha o subset que
 * o app efetivamente consome (sub, email, app_metadata.role). Mantemos
 * permissivo (`Record<string, unknown>` no resto) para não engessar.
 */
export type AuthClaims = {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: {
    role?: string;
    provider?: string;
    [k: string]: unknown;
  };
  user_metadata?: Record<string, unknown>;
  [k: string]: unknown;
};
