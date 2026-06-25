// /checkout/sucesso — landing após retorno do provedor.
// O webhook é a fonte da verdade; aqui só damos feedback e direcionamos.
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Mail } from "lucide-react";

export const Route = createFileRoute("/checkout/sucesso")({
  head: () => ({ meta: [{ title: "Pagamento confirmado — FinancePRO" }] }),
  component: SucessoPage,
});

function SucessoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-foreground">Pagamento confirmado</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Recebemos sua assinatura. Em alguns instantes você receberá um e-mail
          com o link de acesso à plataforma.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-foreground">
          <Mail className="h-4 w-4 text-primary" />
          Verifique sua caixa de entrada (e o spam, por garantia).
        </div>
        <Link
          to="/login"
          className="mt-6 inline-block w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Ir para a tela de login
        </Link>
      </div>
    </div>
  );
}
