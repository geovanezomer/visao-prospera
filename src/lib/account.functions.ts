// Server functions da própria conta do usuário logado.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(200),
});

/** Troca a senha (exige a atual) e encerra as outras sessões. Limpa `mustChangePassword`. */
export const changeOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => changeSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.newPassword === data.currentPassword) {
      throw new Error("A nova senha precisa ser diferente da atual.");
    }
    const { auth } = await import("@/lib/auth.server");
    const { db, schema } = await import("@/db/client.server");
    const { eq } = await import("drizzle-orm");
    await auth().api.changePassword({
      headers: getRequest().headers,
      body: {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        revokeOtherSessions: true,
      },
    });
    await db()
      .update(schema.user)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(schema.user.id, context.userId));
    return { ok: true };
  });
