// Compatibilidade: links mágicos agora são verificados em
// /api/auth/magic-link/verify e já redirecionam ao destino com o cookie de
// sessão definido. Esta página só atende links antigos/favoritos: espera a
// sessão hidratar e manda para /app (logado) ou /login.
import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Confirmando — FinnancePRO" }, { name: "robots", content: "noindex" }],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const { user, hydrated } = useAuth();
  const doneRef = useRef(false);

  useEffect(() => {
    if (!hydrated || doneRef.current) return;
    doneRef.current = true;
    if (!user) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (user.isTrial) {
      // Marca o trial como ativado (consumed_at) — não bloqueia o redirect.
      void fetch("/api/public/trial/activate", { method: "POST", credentials: "include" }).catch(
        () => undefined,
      );
    }
    void navigate({ to: "/app", replace: true });
  }, [hydrated, user, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Activity className="h-6 w-6 animate-pulse" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Confirmando seu acesso…</h1>
        <p className="mt-2 text-sm text-muted-foreground">Redirecionando…</p>
      </div>
    </main>
  );
}
