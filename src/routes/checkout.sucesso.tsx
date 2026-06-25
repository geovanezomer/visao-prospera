// /checkout/sucesso — landing após retorno do provedor.
// Consulta o registro em `checkout_intents` (via ?i=<idempotencyKey>)
// para mostrar feedback real: paid / pendente / failed.
// O webhook continua sendo a fonte da verdade.
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mail, AlertCircle, Clock } from "lucide-react";
import { z } from "zod";

const Search = z.object({
  plan: z.string().optional(),
  i: z.string().optional(),
});

export const Route = createFileRoute("/checkout/sucesso")({
  head: () => ({ meta: [{ title: "Pagamento confirmado — FinancePRO" }] }),
  validateSearch: Search,
  component: SucessoPage,
});

type IntentStatus = {
  status: "created" | "redirected" | "paid" | "failed" | "unknown";
  plan?: string;
  withUpsell?: boolean;
  currency?: string;
  planAmountCents?: number | null;
  upsellAmountCents?: number | null;
  provider?: string;
  confirmedAt?: string | null;
  lastError?: string | null;
};

function fmtMoney(cents: number | null | undefined, currency = "BRL") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function SucessoPage() {
  const { i } = useSearch({ from: "/checkout/sucesso" });
  const [data, setData] = useState<IntentStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!i) return;
    let cancelled = false;
    const start = Date.now();

    async function tick() {
      if (cancelled || stoppedRef.current) return;
      try {
        const r = await fetch(`/api/public/payments/intent-status?i=${encodeURIComponent(i!)}`);
        const j = (await r.json()) as IntentStatus;
        if (!cancelled) {
          setData(j);
          if (j.status === "paid" || j.status === "failed") {
            stoppedRef.current = true;
            return;
          }
        }
      } catch {
        // silencioso — tentamos de novo
      }
      setElapsed(Math.floor((Date.now() - start) / 1000));
      // Polling exponencial leve: 2s → 4s → 6s, máximo 90s total.
      const next = Math.min(2000 + Math.floor((Date.now() - start) / 5000) * 1000, 6000);
      if (Date.now() - start < 90_000) setTimeout(tick, next);
      else stoppedRef.current = true;
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [i]);

  const status = data?.status ?? (i ? "created" : "paid");
  const total =
    (data?.planAmountCents ?? 0) + (data?.withUpsell ? data?.upsellAmountCents ?? 0 : 0);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
        <StatusIcon status={status} />
        <StatusTitle status={status} />
        <StatusBody status={status} data={data} total={total} elapsed={elapsed} />

        {status === "paid" && (
          <Link
            to="/login"
            className="mt-6 inline-block w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Ir para a tela de login
          </Link>
        )}
        {status === "failed" && (
          <Link
            to="/planos"
            className="mt-6 inline-block w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Tentar novamente
          </Link>
        )}
        {(status === "created" || status === "redirected") && (
          <Link
            to="/login"
            className="mt-6 inline-block w-full rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-accent"
          >
            Continuar para o login
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: IntentStatus["status"] }) {
  if (status === "paid")
    return (
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <CheckCircle2 className="h-7 w-7 text-primary" />
      </div>
    );
  if (status === "failed")
    return (
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-7 w-7 text-destructive" />
      </div>
    );
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
      <Loader2 className="h-7 w-7 text-amber-500 animate-spin" />
    </div>
  );
}

function StatusTitle({ status }: { status: IntentStatus["status"] }) {
  const map: Record<IntentStatus["status"], string> = {
    paid: "Pagamento confirmado",
    failed: "Não foi possível confirmar",
    created: "Aguardando confirmação",
    redirected: "Aguardando confirmação",
    unknown: "Pagamento recebido",
  };
  return <h1 className="mt-5 text-2xl font-semibold text-foreground">{map[status]}</h1>;
}

function StatusBody({
  status,
  data,
  total,
  elapsed,
}: {
  status: IntentStatus["status"];
  data: IntentStatus | null;
  total: number;
  elapsed: number;
}) {
  if (status === "paid") {
    return (
      <>
        <p className="mt-3 text-sm text-muted-foreground">
          Recebemos sua assinatura{data?.plan ? ` do plano ${data.plan.toUpperCase()}` : ""}.
          Em alguns instantes você receberá um e-mail com o link de acesso.
        </p>
        {total > 0 && (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm">
            <div className="flex justify-between text-foreground">
              <span>Total pago</span>
              <span className="font-semibold">{fmtMoney(total, data?.currency)}</span>
            </div>
            {data?.withUpsell && data.upsellAmountCents ? (
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>Inclui adicional</span>
                <span>{fmtMoney(data.upsellAmountCents, data.currency)}</span>
              </div>
            ) : null}
          </div>
        )}
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-foreground">
          <Mail className="h-4 w-4 text-primary" />
          Verifique sua caixa de entrada (e o spam, por garantia).
        </div>
      </>
    );
  }

  if (status === "failed") {
    return (
      <>
        <p className="mt-3 text-sm text-muted-foreground">
          Não conseguimos confirmar este pagamento. Se o valor foi debitado,
          aguarde alguns minutos — o sistema reconcilia automaticamente.
        </p>
        {data?.lastError && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {data.lastError}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">
        Seu pagamento foi enviado ao provedor. Estamos confirmando — isto
        leva normalmente poucos segundos.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        Aguardando confirmação… {elapsed}s
      </div>
    </>
  );
}
