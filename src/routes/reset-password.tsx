import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { BrandHeader } from "@/components/BrandHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ResetSearch = { token?: string; error?: string };

export const Route = createFileRoute("/reset-password")({
  // Better Auth redireciona para cá com ?token=... (ou ?error=INVALID_TOKEN).
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === "string" && search.token ? search.token : undefined,
    error: typeof search.error === "string" && search.error ? search.error : undefined,
  }),
  head: () => ({
    meta: [{ title: "Nova senha — FinnancePRO" }, { name: "robots", content: "noindex" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const { token, error: linkError } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenRejected, setTokenRejected] = useState(false);

  const linkInvalid = !token || !!linkError || tokenRejected;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("A senha precisa de 8+ caracteres, com letras e números.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!token) return;
    setLoading(true);
    const res = await resetPassword(token, password);
    setLoading(false);
    if (!res.ok) {
      if (/token/i.test(res.error)) setTokenRejected(true);
      else setError(res.error);
      return;
    }
    toast.success("Senha redefinida. Entre com a nova senha.");
    void navigate({ to: "/login" });
  };

  if (linkInvalid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <BrandHeader size="md" className="mb-8" />
          <div className="rounded-lg border border-border/60 bg-card/40 p-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold">Link inválido ou expirado</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Este link de recuperação não é mais válido. Ele pode ter expirado ou já ter sido
              usado. Solicite um novo link.
            </p>
            <Button asChild className="mt-5 w-full">
              <Link to="/forgot-password">
                Solicitar novo link
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Link
              to="/login"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Voltar para o login
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <BrandHeader size="md" className="mb-8" />

        <h2 className="text-2xl font-semibold tracking-tight">Definir nova senha</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha uma senha forte com pelo menos 8 caracteres.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Nova senha</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                className="pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                className="pl-9"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar nova senha"}
            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>
      </div>
    </main>
  );
}
