import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Lock, Mail } from "lucide-react";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — FinnancePRO" },
      {
        name: "description",
        content:
          "Acesse o FinnancePRO: diagnóstico, DRE simulado, regime tributário e análise de cenários.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, hydrated, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hydrated && user) navigate({ to: "/app" });
  }, [hydrated, user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate({ to: "/" });
  };

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-2">
      <section
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--primary) 18%, transparent) 0%, transparent 55%), linear-gradient(160deg, color-mix(in oklab, var(--primary) 14%, var(--background)) 0%, var(--background) 65%, color-mix(in oklab, var(--primary) 8%, var(--background)) 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <img
            src={logoAsset.url}
            alt="FinnancePRO"
            className="h-10 w-10 rounded-md object-contain"
          />
          <div>
            <p className="text-sm font-semibold tracking-tight">
              Finnance<span className="text-primary">PRO</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Diagnóstico & Simulação
            </p>
          </div>
        </div>

        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground xl:text-5xl">
            Sua operação financeira, com clareza em tempo real.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            Acesse a plataforma para fazer um Raio-X do Fluxo de Caixa, DRE, Balanço, Impactos da
            Reforma Tributária e +40 Indicadores, além fazer cálculos trabalhistas e Análises com I.A.
          </p>
        </div>

        <div className="text-[11px] text-muted-foreground">
          Desenvolvido por GZ Consultoria Financeira &amp; Investimentos
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img
              src={logoAsset.url}
              alt="FinnancePRO"
              className="h-9 w-9 rounded-md object-contain"
            />
            <p className="text-base font-semibold tracking-tight">
              Finnance<span className="text-primary">PRO</span>
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h2>
          <p className="mt-1 text-sm text-muted-foreground">Acesse sua plataforma FinnancePRO.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" autoComplete="on">
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

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <Link
                  to="/forgot-password"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Esqueci a senha
                </Link>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  className="pl-9"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
              {loading ? "Entrando..." : "Entrar"}
              {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
            Sua sessão e seus cenários ficam vinculados à sua conta.
          </p>
        </div>
      </section>
    </main>
  );
}
