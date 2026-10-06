// ============================================================================
// UserSessionsPanel — sessões/identidades do usuário e revogação global.
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getUserSessions,
  revokeAllSessions,
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
        <p className="mb-1 text-xs text-muted-foreground">Identidades vinculadas</p>
        {session.identities.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma.</p>
        ) : (
          <div className="space-y-1">
            {session.identities.map((i, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded border border-border/40 px-2 py-1 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {i.provider}
                  </Badge>
                  <span className="text-muted-foreground">criada {fmt(i.createdAt)}</span>
                </div>
                <span className="text-muted-foreground">último uso {fmt(i.lastSignInAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="mb-2 text-xs">
          Revogar todos os refresh tokens forçará novo login em todos os dispositivos.
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
