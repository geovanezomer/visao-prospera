// ============================================================================
// TrialBanner — exibido no topo do app quando user.user_metadata.is_trial.
// • Mostra countdown até trial_expires_at.
// • Toast aos 10 min restantes.
// • signOut + redirect para /landing#planos ao expirar.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());
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
      void (async () => {
        toast.info("Seu teste gratuito terminou. Escolha um plano para continuar.", { duration: 6000 });
        await supabase.auth.signOut();
        navigate({ to: "/landing", hash: "planos" });
      })();
    }
  }, [now, target, navigate]);

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
        <Button asChild size="sm" variant="default" className="h-7 px-3 text-xs">
          <Link to="/landing" hash="planos">Assinar agora</Link>
        </Button>
      </div>
    </div>
  );
}
