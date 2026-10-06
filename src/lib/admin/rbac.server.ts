// ============================================================================
// Regras de papel (server-only). Separado das server fns para ser testável.
// ============================================================================
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db/client.server";

/**
 * Define o papel do usuário. Ao revogar admin, recusa se ele for o último
 * administrador (o sistema nunca fica sem admin — inclusive quando o admin
 * tenta remover o próprio papel).
 */
export async function applyAdminRole(
  userId: string,
  admin: boolean,
): Promise<{ changed: boolean; role: "admin" | "user"; email: string }> {
  return db().transaction(async (tx) => {
    const [target] = await tx
      .select({ role: schema.user.role, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update");
    if (!target) throw new Error("Usuário não encontrado.");
    const next = admin ? "admin" : "user";
    if (target.role === next) return { changed: false, role: next, email: target.email };

    if (!admin) {
      // Trava todas as linhas admin: duas revogações simultâneas não
      // conseguem, juntas, zerar os administradores.
      const others = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(and(eq(schema.user.role, "admin"), ne(schema.user.id, userId)))
        .for("update");
      if (others.length === 0) {
        throw new Error("Não é possível remover o último administrador do sistema.");
      }
    }
    await tx
      .update(schema.user)
      .set({ role: next, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
    return { changed: true, role: next, email: target.email };
  });
}
