// /checkout/sucesso — landing após retorno do provedor.
// Padrão de SaaS (Linear / Cal.com / Vercel):
//   1) Resumo do pedido sempre no topo (plano + adicional + total).
//   2) Bloco de status (paid/failed/pendente) com CTA contextual.
//   3) Estado "paid" mostra "Verifique seu e-mail" + atalhos de inbox
//      + reenviar magic link (e-mail mascarado, sem expor PII).
// O webhook continua sendo a fonte da verdade.
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mail, AlertCircle, Clock, ExternalLink } from "lucide-react";
import { z } from "zod";

const Search = z.object({
  plan: z.string().optional(),
  i: z.string().optional(),
});

export const Route = createFileRoute("/checkout/sucesso")({
  head: () => ({ meta: [{ title: "Pagamento confirmado — FinnancePRO" }] }),
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
  emailMasked?: string | null;
  lastError?: string | null;
};

function fmtMoney(cents: number | null | undefined, currency = "BRL") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function planLabel(slug?: string) {
  if (!slug) return "Plano";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function SucessoPage() {
  const { i, plan: planParam } = useSearch({ from: "/checkout/sucesso" });
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
        /* tenta de novo */
      }
      setElapsed(Math.floor((Date.now() - start) / 1000));
      const next = Math.min(2000 + Math.floor((Date.now() - start) / 5000) * 1000, 6000);
      if (Date.now() - start < 90_000) setTimeout(tick, next);
      else stoppedRef.current = true;
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [i]);

  const status: IntentStatus["status"] = data?.status ?? (i ? "created" : "paid");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="max-w-md w-full space-y-4">
        {/* 1) Resumo do pedido — sempre primeiro */}
        <OrderSummary data={data} fallbackPlan={planParam} />

        {/* 2) Bloco de status */}
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
          <StatusIcon status={status} />
          <StatusTitle status={status} />
          <StatusBody status={status} data={data} elapsed={elapsed} intentKey={i} />
        </div>
      </div>
    </div>
  );
}

function OrderSummary({
  data,
  fallbackPlan,
}: {
  data: IntentStatus | null;
  fallbackPlan?: string;
}) {
  const plan = data?.plan ?? fallbackPlan;
  const currency = data?.currency ?? "BRL";
  const planAmt = data?.planAmountCents ?? null;
  const upsellAmt = data?.withUpsell ? (data?.upsellAmountCents ?? 0) : 0;
  const total = (planAmt ?? 0) + (upsellAmt ?? 0);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>Resumo do pedido</span>
        <span>{currency}</span>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between text-foreground">
          <span>
            Plano <span className="font-medium">{planLabel(plan)}</span>
          </span>
          <span className="tabular-nums">{fmtMoney(planAmt, currency)}</span>
        </div>
        {data?.withUpsell && (
          <div className="flex justify-between text-muted-foreground">
            <span>Adicional</span>
            <span className="tabular-nums">{fmtMoney(upsellAmt, currency)}</span>
          </div>
        )}
        <div className="border-t border-border/60 pt-2 flex justify-between text-foreground font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{fmtMoney(total, currency)}</span>
        </div>
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
    paid: "Verifique seu e-mail",
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
  elapsed,
  intentKey,
}: {
  status: IntentStatus["status"];
  data: IntentStatus | null;
  elapsed: number;
  intentKey?: string;
}) {
  if (status === "paid") return <PaidBody data={data} intentKey={intentKey} />;
  if (status === "failed") {
    return (
      <>
        <p className="mt-3 text-sm text-muted-foreground">
          Não conseguimos confirmar este pagamento. Se o valor foi debitado, aguarde alguns minutos
          — o sistema reconcilia automaticamente.
        </p>
        {data?.lastError && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {data.lastError}
          </p>
        )}
        <a
          href="/#planos"
          className="mt-6 inline-block w-full rounded-lg bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Tentar novamente
        </a>
      </>
    );
  }
  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">
        Seu pagamento foi enviado ao provedor. Estamos confirmando — isto leva normalmente poucos
        segundos.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        Aguardando confirmação… {elapsed}s
      </div>
      <Link
        to="/login"
        className="mt-6 inline-block w-full rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-accent"
      >
        Continuar para o login
      </Link>
    </>
  );
}

function PaidBody({ data, intentKey }: { data: IntentStatus | null; intentKey?: string }) {
  const email = data?.emailMasked;
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error" | "wait">(
    "idle",
  );
  const [resendMsg, setResendMsg] = useState<string>("");

  async function resend() {
    if (!intentKey) return;
    setResendState("sending");
    setResendMsg("");
    try {
      const r = await fetch("/api/public/payments/resend-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ i: intentKey }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setResendState("sent");
        setResendMsg("Enviamos um novo link. Verifique sua caixa de entrada.");
      } else if (r.status === 429) {
        setResendState("wait");
        setResendMsg(`Aguarde ${j.retryAfter ?? 60}s antes de tentar de novo.`);
      } else {
        setResendState("error");
        setResendMsg(
          j.error === "not_paid" ? "Pagamento ainda não confirmado." : "Não foi possível reenviar.",
        );
      }
    } catch {
      setResendState("error");
      setResendMsg("Falha de rede. Tente novamente.");
    }
  }

  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">
        Pagamento confirmado. Enviamos um <strong>link de acesso</strong>
        {email ? (
          <>
            {" "}
            para <span className="font-mono text-foreground">{email}</span>
          </>
        ) : null}
        . Clique no link do e-mail para entrar — não precisa criar senha.
      </p>

      <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-foreground">
        <Mail className="h-4 w-4 text-primary" />
        Verifique a caixa de entrada (e o spam, por garantia).
      </div>

      {/* Atalhos para webmails populares — padrão Cal.com / Linear */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href="https://mail.google.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
        >
          Abrir Gmail <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href="https://outlook.live.com/mail"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
        >
          Abrir Outlook <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <button
        type="button"
        onClick={resend}
        disabled={resendState === "sending" || resendState === "wait"}
        className="mt-4 text-xs text-primary hover:underline disabled:opacity-60 disabled:no-underline"
      >
        {resendState === "sending" ? "Reenviando…" : "Não recebi — reenviar link"}
      </button>
      {resendMsg && (
        <p
          className={`mt-2 text-xs ${resendState === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {resendMsg}
        </p>
      )}

      <Link
        to="/login"
        className="mt-6 inline-block w-full rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-accent"
      >
        Ir para o login
      </Link>
    </>
  );
}
