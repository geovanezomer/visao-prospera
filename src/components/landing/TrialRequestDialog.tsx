// ============================================================================
// TrialRequestDialog — modal "Solicitar teste" da landing page.
// Coleta e-mail, envia para /api/public/trial/request e exibe estados:
//   • sucesso → "Cheque seu e-mail"
//   • 409 already_used → "Você já testou. Escolha um plano."
//   • 429 rate_limited / outros erros → mensagem amigável.
// ============================================================================
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mail, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; hours: number }
  | { kind: "already" }
  | { kind: "err"; msg: string };

export function TrialRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<State>({ kind: "idle" });
  const [cfgHours, setCfgHours] = useState<number>(2);

  // Lê duração configurada em Admin → Sistema (app_settings.trial.duration_hours).
  // Policy pública permite SELECT do key='trial' para anon.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void supabase
      .from("app_settings")
      .select("value")
      .eq("key", "trial")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.value) return;
        const v = data.value as { duration_hours?: number };
        const h = Number(v.duration_hours);
        if (Number.isFinite(h) && h > 0) setCfgHours(Math.min(Math.max(h, 1), 72));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setEmail("");
    setWebsite("");
    setState({ kind: "idle" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setState({ kind: "loading" });
    try {
      const r = await fetch("/api/public/trial/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, website }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        hours?: number;
        sent?: boolean;
      };
      if (r.ok && body.sent !== false) {
        setEmail(normalizedEmail);
        setState({ kind: "ok", hours: body.hours ?? 2 });
        return;
      }
      if (r.ok && body.sent === false) {
        setState({
          kind: "err",
          msg: "Seu teste foi criado, mas o e-mail não pôde ser enviado agora. Tente novamente em alguns minutos ou fale com o suporte.",
        });
        return;
      }
      if (r.status === 409) {
        setState({ kind: "already" });
        return;
      }
      if (r.status === 429) {
        setState({ kind: "err", msg: "Muitas tentativas. Tente novamente em alguns minutos." });
        return;
      }
      if (body.error === "disposable_email") {
        setState({ kind: "err", msg: "Use um e-mail corporativo ou pessoal válido." });
        return;
      }
      if (body.error === "trial_disabled") {
        setState({ kind: "err", msg: "Testes gratuitos temporariamente desativados." });
        return;
      }
      if (body.error === "email_config_missing") {
        setState({
          kind: "err",
          msg: "O envio de e-mail do teste ainda não está configurado corretamente. Fale com o administrador.",
        });
        return;
      }
      if (body.error === "email_send_failed") {
        setState({
          kind: "err",
          msg: "Não foi possível enviar o link de teste agora. Verifique o e-mail informado e tente novamente.",
        });
        return;
      }
      setState({ kind: "err", msg: "Não foi possível processar agora. Tente novamente." });
    } catch {
      setState({ kind: "err", msg: "Erro de rede. Verifique sua conexão." });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Solicitar teste gratuito
          </DialogTitle>
          <DialogDescription>
            Receba acesso completo à plataforma por tempo limitado, sem cartão de crédito.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "ok" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Pronto! Cheque seu e-mail.</p>
                <p className="mt-1 text-muted-foreground">
                  Enviamos um link de acesso para <strong>{email}</strong>. Ele expira em{" "}
                  <strong>
                    {state.hours} hora{state.hours === 1 ? "" : "s"}
                  </strong>
                  . Após esse período, sua sessão será encerrada automaticamente.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Não viu? Verifique o spam ou aguarde 1–2 minutos.
                </p>
              </div>
            </div>
          </div>
        )}

        {state.kind === "already" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-foreground">Este e-mail já testou a plataforma.</p>
                <p className="mt-1 text-muted-foreground">
                  Para continuar usando, escolha um dos planos abaixo.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/landing" hash="planos" onClick={() => onOpenChange(false)}>
                    Ver planos
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}

        {(state.kind === "idle" || state.kind === "loading" || state.kind === "err") && (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  Você recebe um <strong>link mágico</strong> por e-mail. Ao clicar, entra direto na
                  plataforma — sem senha. Seu acesso expira em <strong>{cfgHours}h</strong> a partir
                  do envio do link.
                </span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trial-email">E-mail</Label>
              <Input
                id="trial-email"
                type="email"
                required
                autoFocus
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={state.kind === "loading"}
              />
            </div>
            {/* honeypot — escondido visualmente, bots costumam preencher */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="hidden"
              aria-hidden="true"
            />
            {state.kind === "err" && <p className="text-sm text-destructive">{state.msg}</p>}
            <Button type="submit" disabled={state.kind === "loading" || !email} className="w-full">
              {state.kind === "loading" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                <>Enviar meu link de acesso</>
              )}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              Já tem conta?{" "}
              <Link
                to="/login"
                className="underline hover:text-foreground"
                onClick={() => onOpenChange(false)}
              >
                Entrar
              </Link>
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
