// ============================================================================
// Server fn: criar URL do Portal do Cliente (cancelar, trocar cartão, etc).
// Requer autenticação — consulta a subscription do usuário corrente para
// recuperar provider/customerId e delegar ao adapter ativo.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { resolveProvider } from "./index";

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { returnUrl?: string }) =>
    z.object({ returnUrl: z.string().url().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { db, schema } = await import("@/db/client.server");
    const { desc, eq } = await import("drizzle-orm");
    const subs = schema.subscriptions;
    const [sub] = await db()
      .select({
        providerCustomerId: subs.providerCustomerId,
        stripeCustomerId: subs.stripeCustomerId,
      })
      .from(subs)
      .where(eq(subs.userId, context.userId))
      .orderBy(desc(subs.createdAt))
      .limit(1);
    if (!sub) throw new Error("Nenhuma assinatura encontrada.");

    const customerId = sub.providerCustomerId ?? sub.stripeCustomerId;
    if (!customerId) throw new Error("Cliente do provedor não associado.");

    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const returnUrl = data.returnUrl ?? `${appUrl}/app`;

    const provider = await resolveProvider();
    const { url } = await provider.createPortal({ customerId, returnUrl });
    return { url };
  });
