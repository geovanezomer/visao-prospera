// ============================================================================
// Server fn: criar URL do Portal do Cliente (cancelar, trocar cartão, etc).
// Requer autenticação — consulta a subscription do usuário corrente para
// recuperar provider/customerId e delegar ao adapter ativo.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveProvider } from "./index";

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string }) =>
    z.object({ returnUrl: z.string().url().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("provider, provider_customer_id, stripe_customer_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Nenhuma assinatura encontrada.");

    const customerId = sub.provider_customer_id ?? sub.stripe_customer_id;
    if (!customerId) throw new Error("Cliente do provedor não associado.");

    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const returnUrl = data.returnUrl ?? `${appUrl}/app`;

    const provider = await resolveProvider();
    const { url } = await provider.createPortal({ customerId, returnUrl });
    return { url };
  });
