// ============================================================================
// UserSessionsPanel — sessões ativas do usuário, revogação individual e global.
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, LogOut, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getUserSessions,
  revokeAllSessions,
  revokeSession,
  type UserSession,
} from "@/lib/admin/sessions.functions";

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function UserSessionsPanel({ userId }: { userId: string }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const s = await getUserSessions({ data: { userId } });
      setSession(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [userId]);

  const revoke = async () => {
    if (
      !confirm(
        "Revogar TODAS as sessões deste usuário? Ele será deslogado de todos os dispositivos.",
      )
    )
      return;
    setRevoking(true);
    try {
      await revokeAllSessions({ data: { userId } });
      toast.success("Sessões revogadas.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setRevoking(false);
    }
  };

  const revokeOne = async (sessionId: string) => {
    if (!confirm("Encerrar esta sessão? O dispositivo precisará entrar de novo.")) return;
    setRevokingId(sessionId);
    try {
      await revokeSession({ data: { userId, sessionId } });
      toast.success("Sessão encerrada.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setRevokingId(null);
    }
  };

  if (loading && !session)
    return (
      <div className="flex h-20 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  if (!session) return null;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Último login</p>
          <p>{fmt(session.lastSignInAt)}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Atualizar
        </Button>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">Formas de login</p>
        <div className="flex flex-wrap gap-1">
          {session.loginMethods.map((m) => (
            <Badge key={m} variant="outline" className="text-[10px]">
              {m}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">
          Sessões ativas ({session.sessions.length})
        </p>
        {session.sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma sessão ativa.</p>
        ) : (
          <div className="space-y-1">
            {session.sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-2 rounded border border-border/40 px-2 py-1.5 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {s.ipAddress || "IP desconhecido"}
                    </Badge>
                    <span className="text-muted-foreground">
                      criada {fmt(s.createdAt)} · expira {fmt(s.expiresAt)}
                    </span>
                  </div>
                  <p className="truncate text-muted-foreground" title={s.userAgent ?? undefined}>
                    {s.userAgent || "Navegador desconhecido"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2"
                  onClick={() => void revokeOne(s.id)}
                  disabled={revokingId === s.id}
                  aria-label="Encerrar sessão"
                >
                  {revokingId === s.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="mb-2 text-xs">
          Encerrar todas as sessões forçará novo login em todos os dispositivos.
        </p>
        <Button size="sm" variant="destructive" onClick={revoke} disabled={revoking}>
          {revoking ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
          )}
          Revogar todas as sessões
        </Button>
      </div>
    </div>
  );
}
