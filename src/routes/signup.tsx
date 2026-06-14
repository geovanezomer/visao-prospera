import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Cadastro indisponível — FinnancePRO" },
      { name: "description", content: "O cadastro de novas contas no FinnancePRO está temporariamente desativado." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SignupDisabledPage,
});

function SignupDisabledPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Activity className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold tracking-tight">
          Finnance<span className="text-primary">PRO</span>
        </p>

        <div className="mt-8 rounded-lg border border-border bg-card/50 p-6">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Cadastro temporariamente indisponível</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            No momento, o cadastro de novas contas está desativado. Se você já possui acesso,
            entre com seu e-mail e senha.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link to="/login">
              Ir para o login
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
