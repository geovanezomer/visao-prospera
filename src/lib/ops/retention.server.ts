// ============================================================================
// Limpeza diária: tabelas que só cresciam (links vencidos, sessões expiradas,
// contadores de limite de acesso, logs antigos). Prazos conservadores; nada
// que esteja em uso ou pendente é apagado.
// ============================================================================
import { sql } from "drizzle-orm";
import { db } from "@/db/client.server";

/** Prazos de guarda (dias). */
export const RETENCAO = {
  linksVencidos: 7,
  webhooksFinalizados: 180,
  checkoutsAntigos: 180,
  emails: 365,
  auditoria: 730,
} as const;

const LIMPEZAS: Array<[string, ReturnType<typeof sql>]> = [
  [
    "shared_reports",
    sql`delete from shared_reports
        where coalesce(revoked_at, expires_at) < now() - make_interval(days => ${RETENCAO.linksVencidos})`,
  ],
  [
    "rate_limit_buckets",
    sql`delete from rate_limit_buckets where reset_at < now() - interval '1 day'`,
  ],
  ["session", sql`delete from session where expires_at < now()`],
  ["verification", sql`delete from verification where expires_at < now()`],
  [
    "webhook_events",
    sql`delete from webhook_events
        where status in ('processed', 'skipped', 'ignored')
          and received_at < now() - make_interval(days => ${RETENCAO.webhooksFinalizados})`,
  ],
  [
    "checkout_intents",
    sql`delete from checkout_intents
        where created_at < now() - make_interval(days => ${RETENCAO.checkoutsAntigos})`,
  ],
  [
    "email_log",
    sql`delete from email_log where sent_at < now() - make_interval(days => ${RETENCAO.emails})`,
  ],
  [
    "signup_events",
    sql`delete from signup_events where created_at < now() - make_interval(days => ${RETENCAO.auditoria})`,
  ],
  [
    "admin_audit_log",
    sql`delete from admin_audit_log where created_at < now() - make_interval(days => ${RETENCAO.auditoria})`,
  ],
];

/** Roda cada limpeza isolada (uma falha não impede as outras). */
export async function runRetention(): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  for (const [tabela, q] of LIMPEZAS) {
    try {
      const r = (await db().execute(q)) as unknown as { count?: number; affectedRows?: number };
      out[tabela] = r.count ?? r.affectedRows ?? 0;
    } catch (e) {
      out[tabela] = `erro: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}
