import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Confirmando — FinnancePRO" }, { name: "robots", content: "noindex" }],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const { hydrated, user } = useAuth();
  const navigate = useNavigate();
  const markedTrialRef = useRef(false);

  // Supabase handles the email-confirmation hash automatically (detectSessionInUrl).
  // We just wait for the session to hydrate and forward the user.
  useEffect(() => {
    if (!hydrated) return;
    if (user?.isTrial && !markedTrialRef.current) {
      markedTrialRef.current = true;
      void fetch("/api/public/trial/activate", { method: "POST" }).catch(() => undefined);
    }
    const t = setTimeout(() => {
      navigate({ to: user ? "/app" : "/login" });
    }, 800);
    return () => clearTimeout(t);
  }, [hydrated, user, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          {user ? (
            <CheckCircle2 className="h-6 w-6" />
          ) : (
            <Activity className="h-6 w-6 animate-pulse" />
          )}
        </div>
        <h1 className="text-lg font-semibold tracking-tight">
          {user ? "E-mail confirmado" : "Confirmando seu e-mail…"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Redirecionando…</p>
      </div>
    </main>
  );
}
