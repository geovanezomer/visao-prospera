import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Activity, ArrowRight, CheckCircle2, Lock, Mail, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Criar conta — GZ FinnancePRO" },
      { name: "description", content: "Crie sua conta no GZ FinnancePRO e comece a simular DRE, tributos e cenários financeiros." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SignupPage,
});

const schema = z.object({
  displayName: z.string().trim().min(2, "Informe seu nome.").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(255),
  password: z
    .string()
    .min(8, "Senha precisa de 8+ caracteres.")
    .max(72)
    .regex(/[A-Za-z]/, "Inclua letras.")
    .regex(/[0-9]/, "Inclua números."),
});

function SignupPage() {
  const { user, hydrated, signup } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (hydrated && user) navigate({ to: "/" });
  }, [hydrated, user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ displayName, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      return;
    }
    setLoading(true);
    const res = await signup(parsed.data.email, parsed.data.password, parsed.data.displayName);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.needsConfirmation) {
      setSent(true);
    } else {
      navigate({ to: "/" });
    }
  };

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm rounded-lg border border-border/60 bg-card/40 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Confirme seu e-mail</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enviamos um link de confirmação para <span className="font-medium text-foreground">{email}</span>.
            Clique nele para ativar sua conta.
          </p>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Não recebeu? Verifique a caixa de spam. O link expira em 24 horas.
          </p>
          <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
            Voltar para o login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <p className="text-base font-semibold tracking-tight">
            GZ Finnance<span className="text-primary">PRO</span>
          </p>
        </div>

        <h2 className="text-2xl font-semibold tracking-tight">Criar sua conta</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Leva menos de 1 minuto. Sem cartão de crédito.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4" autoComplete="on">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="name"
                name="name"
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
                placeholder="Mín. 8 caracteres, letras e números"
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
            {loading ? "Criando..." : "Criar conta"}
            {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
