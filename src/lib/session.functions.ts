// Sessão única: revoga TODAS as outras sessões do usuário autenticado.
// Chamado logo após signInWithPassword no client; o admin API revoga os
// refresh_tokens dos outros dispositivos. O JWT atual deles segue válido
// até expirar (~1h), mas o próximo refresh falha → SIGNED_OUT no listener.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const revokeOtherSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // scope 'others' = mantém a sessão atual (a que acabou de logar), revoga o resto
    const { error } = await supabaseAdmin.auth.admin.signOut(context.userId, "others");
    if (error) {
      console.error("[revokeOtherSessions] falha:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  });
