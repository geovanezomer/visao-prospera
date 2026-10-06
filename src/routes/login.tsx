import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/hooks/useBranding";
import { BrandHeader } from "@/components/BrandHeader";
import { getAppSettings } from "@/lib/admin/settings.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  // Pré-carrega branding/login_texts no SSR para evitar flash do mock.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 60 * 60_000,
    });
  },
  head: () => ({
    meta: [
      { title: "Entrar — FinnancePRO" },
      {
        name: "description",
        content:
          "Acesse o FinnancePRO: diagnóstico, DRE simulado, regime tributário e análise de cenários.",
      },
      { property: "og:title", content: "Entrar no FinnancePRO" },
      {
        property: "og:description",
        content: "Acesse sua conta para abrir cenários, DRE, Balanço e simulação CBS/IBS.",
      },
      { name: "twitter:title", content: "Entrar no FinnancePRO" },
      {
        name: "twitter:description",
        content: "Acesse sua conta para abrir cenários, DRE, Balanço e simulação CBS/IBS.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, hydrated, login } = useAuth();
  const { loginTexts, footer } = useBranding();
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
    const res = await login(email.trim(), password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate({ to: "/app" });
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
        <BrandHeader size="lg" subtitle="Diagnóstico & Simulação" />

        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground xl:text-5xl">
            {loginTexts.headline}
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            {loginTexts.subheadline}
          </p>
        </div>

        <div className="space-y-2 text-[11px] text-muted-foreground">
          <div>{footer.text}</div>
          <div className="flex items-center gap-4">
            <Link to="/termos" className="hover:text-foreground">
              Termos
            </Link>
            <Link to="/privacidade" className="hover:text-foreground">
              Privacidade
            </Link>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-sm">
          <BrandHeader size="md" className="mb-8 lg:hidden" />

          <h2 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h2>
          <p className="mt-1 text-sm text-muted-foreground">Acesse sua plataforma FinnancePRO.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" autoComplete="on">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail ou usuário</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="username"
                  type="text"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  className="pl-9"
                  placeholder="voce@empresa.com ou usuário"
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
