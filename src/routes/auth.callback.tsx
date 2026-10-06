import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { readTrialFlags } from "@/lib/trialFlags";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Confirmando — FinnancePRO" }, { name: "robots", content: "noindex" }],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const finish = async (session: import("@supabase/supabase-js").Session) => {
      if (doneRef.current) return;
      doneRef.current = true;
      // Marca trial como ativado (consumed_at) — não bloqueia redirect.
      const { isTrial } = readTrialFlags(session.user);
      if (isTrial) {
        try {
          await fetch("/api/public/trial/activate", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
        } catch {
          /* ignore */
        }
      }
      setStatus("ok");
      setTimeout(() => navigate({ to: "/app" }), 400);
    };

    // 1) Troca explícita PKCE (?code=...) — necessário em alguns fluxos.
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      void supabase.auth
        .exchangeCodeForSession(window.location.href)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data.session) return; // listener abaixo cuida do fallback hash
          void finish(data.session);
        })
        .catch(() => undefined);
    }

    // 2) Escuta SIGNED_IN (cobre fluxo implicit/hash). detectSessionInUrl roda async.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        void finish(session);
      }
    });

    // 3) Tenta sessão já hidratada.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled || doneRef.current) return;
      if (data.session) void finish(data.session);
    });

    // 4) Timeout de segurança: 6s sem sessão → erro (sem mandar pra /login silencioso).
    const failTimer = setTimeout(() => {
      if (!doneRef.current && !cancelled) setStatus("err");
    }, 6000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      clearTimeout(failTimer);
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          {status === "ok" ? (
            <CheckCircle2 className="h-6 w-6" />
          ) : status === "err" ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <Activity className="h-6 w-6 animate-pulse" />
          )}
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          {status === "ok"
            ? "Acesso confirmado"
            : status === "err"
              ? "Link inválido ou expirado"
              : "Confirmando seu acesso…"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === "err"
            ? "Solicite um novo link na página inicial. O link pode ter sido aberto antes (ex.: pelo antivírus do e-mail) ou já expirou."
            : "Redirecionando…"}
        </p>
      </div>
    </main>
  );
}
