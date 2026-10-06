// ============================================================================
// rbac.functions — papel do usuário (`user.role`: "admin" | "user").
//
// - isCurrentUserAdmin: gating de UI (toda mutação admin é revalidada no
//   servidor via `assertAdmin`).
// - setUserAdminRole: concede/revoga o papel admin. Nunca deixa o sistema
//   sem administrador.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { assertAdmin } from "./assertAdmin";
import { actorEmail } from "./_types";

/** true se o usuário autenticado tem papel `admin` (lido do banco). */
export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    try {
      const { isAdminUser } = await import("@/lib/users.server");
      return await isAdminUser(context.userId);
    } catch {
      return false;
    }
  });

/**
 * Concede (`admin: true`) ou revoga (`admin: false`) o papel admin.
 * Bloqueia a revogação quando o alvo é o último administrador.
 */
export const setUserAdminRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { userId: string; admin: boolean }) =>
    z.object({ userId: z.string().uuid(), admin: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { applyAdminRole } = await import("./rbac.server");
    const res = await applyAdminRole(data.userId, data.admin);
    if (res.changed) {
      const { logAudit } = await import("./audit.server");
      await logAudit({
        actorId: context.userId,
        actorEmail: actorEmail(context),
        action: data.admin ? "user.role_grant_admin" : "user.role_revoke_admin",
        resource: "user",
        targetId: data.userId,
        targetLabel: res.email,
      });
    }
    return { ok: true, role: res.role };
  });
