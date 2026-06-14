import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, CheckCircle2, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Recuperar senha — FinnancePRO" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await requestPasswordReset(email);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <p className="text-base font-semibold tracking-tight">
            Finnance<span className="text-primary">PRO</span>
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold">Verifique seu e-mail</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Se houver uma conta com <span className="font-medium text-foreground">{email}</span>,
              você receberá um link para redefinir sua senha.
            </p>
            <Link to="/login" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold tracking-tight">Recuperar senha</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Informe o e-mail da sua conta e enviamos um link para redefinir.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    className="pl-9"
                    placeholder="voce@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Enviando..." : "Enviar link"}
                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Lembrou a senha?{" "}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Voltar
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
