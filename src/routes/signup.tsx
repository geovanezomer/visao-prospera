import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowRight, Lock, Mail, User as UserIcon, CheckCircle2 } from "lucide-react";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLANS_CATALOG, type PlanId } from "@/lib/plans";

// Search schema: ?plan=mensal|anual|vitalicio (opcional)
const searchSchema = z.object({
  plan: z.enum(["mensal", "anual", "vitalicio"]).optional(),
});

export const Route = createFileRoute("/signup")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Criar conta — FinnancePRO" },
      { name: "description", content: "Crie sua conta no FinnancePRO e escolha seu plano de assinatura." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { user, hydrated, signup } = useAuth();
  const navigate = useNavigate();
  const { plan: preselectedPlan } = useSearch({ from: "/signup" });

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Já logado? Vai direto pro fluxo (planos ou /app)
  useEffect(() => {
    if (!hydrated || !user) return;
    if (preselectedPlan) {
      navigate({ to: "/planos", search: { plan: preselectedPlan } });
    } else {
      navigate({ to: "/app" });
    }
  }, [hydrated, user, navigate, preselectedPlan]);

  const planInfo: PlanId | null = preselectedPlan ?? null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }

    setLoading(true);
    const res = await signup(email, password, displayName);
    setLoading(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    if (res.needsConfirmation) {
      setSuccess(true);
      return;
    }

    // Sessão já ativa — manda pra escolha de plano (ou plano pré-selecionado)
    navigate({ to: "/planos", search: planInfo ? { plan: planInfo } : undefined });
  };

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Confirme seu e-mail</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Enviamos um link de confirmação para <strong className="text-foreground">{email}</strong>.
            Abra a mensagem e clique no link para ativar sua conta. Depois, faça login para escolher seu plano.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link to="/login">Ir para o login</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-2">
      {/* Painel esquerdo: branding + plano selecionado */}
      <section
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--primary) 18%, transparent) 0%, transparent 55%), linear-gradient(160deg, color-mix(in oklab, var(--primary) 14%, var(--background)) 0%, var(--background) 65%, color-mix(in oklab, var(--primary) 8%, var(--background)) 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <img src={logoAsset.url} alt="FinnancePRO" className="h-10 w-10 rounded-md object-contain" />
          <div>
            <p className="text-sm font-semibold tracking-tight">
              Finnance<span className="text-primary">PRO</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Diagnóstico & Simulação</p>
          </div>
        </div>

        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            A clareza financeira da sua empresa começa aqui.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            Crie sua conta em segundos. Depois você escolhe o plano que faz sentido — Mensal, Anual ou Vitalício.
          </p>

          {planInfo && (
            <div className="mt-8 inline-flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <span className="text-xs uppercase tracking-wider text-primary">Plano selecionado</span>
              <span className="text-sm font-semibold">
                {PLANS_CATALOG[planInfo].name} · {PLANS_CATALOG[planInfo].price}
                <span className="text-muted-foreground"> {PLANS_CATALOG[planInfo].period}</span>
              </span>
            </div>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground">
          Desenvolvido por Geovane Zomer | Consultor Financeiro &amp; Investimentos CVM 3354-5
        </div>
      </section>

      {/* Painel direito: formulário */}
      <section className="flex items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src={logoAsset.url} alt="FinnancePRO" className="h-9 w-9 rounded-md object-contain" />
            <p className="text-base font-semibold tracking-tight">
              Finnance<span className="text-primary">PRO</span>
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Criar conta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Entrar
            </Link>
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" autoComplete="on">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Nome</Label>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="displayName"
                  name="name"
                  type="text"
                  autoComplete="name"
                  className="pl-9"
                  placeholder="Seu nome"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
            </div>

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
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className="pl-9"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
              {loading ? "Criando conta..." : "Criar conta e escolher plano"}
              {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
            Ao criar uma conta, você concorda com nossos termos. Sua senha é criptografada.
          </p>
        </div>
      </section>
    </main>
  );
}
