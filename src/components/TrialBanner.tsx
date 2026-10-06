// ============================================================================
// TrialBanner — exibido no topo do app quando user.isTrial.
// • Mostra countdown até trial_expires_at.
// • Toast aos 10 min restantes.
// • signOut + redirect para /landing#planos ao expirar.
// • CTA 1-click: "Assinar Pro" cria checkout direto com email do trial.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Clock, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

function fmt(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function TrialBanner({ expiresAt }: { expiresAt: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());
  const [upgrading, setUpgrading] = useState(false);
  const warnedRef = useRef(false);
  const expiredRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const remaining = target - now;
    if (!warnedRef.current && remaining <= 10 * 60_000 && remaining > 0) {
      warnedRef.current = true;
      toast.warning("Seu teste termina em menos de 10 minutos. Considere assinar um plano.", {
        duration: 8000,
      });
    }
    if (!expiredRef.current && remaining <= 0) {
      expiredRef.current = true;
      // Não desloga: o SubscriptionGate detecta trial expirado via useAccessStatus
      // e troca para a PaywallScreen na próxima renderização (mesmos dados, menos hostil).
      toast.info("Seu teste gratuito terminou. Escolha um plano para continuar.", {
        duration: 6000,
      });
    }
  }, [now, target, navigate]);

  // ── Upgrade 1-click: cria checkout do plano "pro" com o e-mail do trial ──
  const upgrade = async (plan: "starter" | "pro") => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const email = user?.email ?? "";
      if (!email) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }
      const name = user?.displayName || email.split("@")[0];

      const res = await fetch("/api/public/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, email, name, withUpsell: false }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        toast.error(json.error || "Não foi possível iniciar o checkout.");
        return;
      }
      // Redireciona para a hosted page do provedor.
      window.location.href = json.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar checkout.");
    } finally {
      setUpgrading(false);
    }
  };

  const remaining = target - now;
  if (remaining <= 0) return null;

  return (
    <div className="border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium">Modo teste</span>
          <span className="text-muted-foreground">·</span>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono tabular-nums">{fmt(remaining)}</span>
          <span className="text-muted-foreground">restante</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link to="/landing" hash="planos">
              Ver planos
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            disabled={upgrading}
            onClick={() => upgrade("starter")}
          >
            {upgrading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assinar Starter"}
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-7 px-3 text-xs"
            disabled={upgrading}
            onClick={() => upgrade("pro")}
          >
            {upgrading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assinar Pro"}
          </Button>
        </div>
      </div>
    </div>
  );
}
