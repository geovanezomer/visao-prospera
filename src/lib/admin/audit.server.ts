// ============================================================================
// Audit log helper (server-only).
// Usado pelas server fns admin para registrar ações sensíveis.
// Nunca lança — falhas de log não devem bloquear a ação principal.
// ============================================================================
import { getRequest, getRequestHeader } from "@tanstack/react-start/server";
import { clientIp } from "@/lib/rateLimit.server";

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resource: string;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { db, schema } = await import("@/db/client.server");
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const ipRaw = clientIp(getRequest());
      ip = ipRaw === "unknown" ? null : ipRaw;
      userAgent = getRequestHeader("user-agent") ?? null;
    } catch {
      /* contexto não-HTTP (test, etc.) */
    }
    await db()
      .insert(schema.adminAuditLog)
      .values({
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        resource: entry.resource,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel ?? null,
        metadata: entry.metadata ?? {},
        ip,
        userAgent,
      });
  } catch (e) {
    console.error("[audit] log falhou:", e instanceof Error ? e.message : e);
  }
}
