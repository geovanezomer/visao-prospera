// ============================================================================
// Server function: cria uma sessão do Stripe Customer Portal para autoatendimento
// (cancelar, trocar plano com proração imediata, atualizar cartão, ver faturas).
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  returnUrl: z.string().url(),
});

type PortalSession = { url: string };

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Busca o stripe_customer_id mais recente do usuário
    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .not("stripe_customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !sub?.stripe_customer_id) {
      throw new Error("Nenhuma assinatura encontrada para este usuário.");
    }

    const { stripeFetch, toFormBody } = await import("./stripe.server");
    const session = await stripeFetch<PortalSession>("/v1/billing_portal/sessions", {
      method: "POST",
      body: toFormBody({
        customer: sub.stripe_customer_id,
        return_url: data.returnUrl,
      }),
    });

    return { url: session.url };
  });
