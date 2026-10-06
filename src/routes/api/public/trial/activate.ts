// ============================================================================
// POST /api/public/trial/activate
// Marca o teste como ativado quando o usuário clica no magic link e a sessão
// já foi hidratada no navegador. Não cria acesso; apenas registra funil.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/trial/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const url = process.env.SUPABASE_URL!;
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

        const userClient = createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: authData, error: authError } = await userClient.auth.getUser(token);
        if (authError || !authData.user?.id || !authData.user.email) {
          return new Response("Unauthorized", { status: 401 });
        }

        const meta = (authData.user.user_metadata ?? {}) as Record<string, unknown>;
        if (meta.is_trial !== true) return Response.json({ ok: true, activated: false });

        const admin = createClient(url, service, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { error } = await admin
          .from("trial_requests")
          .update({ consumed_at: new Date().toISOString() })
          .eq("email", authData.user.email.toLowerCase())
          .is("consumed_at", null);
        if (error) {
          console.error("[trial-activate] falha ao marcar ativação:", error.message);
          return Response.json({ error: "activate_failed" }, { status: 500 });
        }

        return Response.json({ ok: true, activated: true });
      },
    },
  },
});
