// Ícone de gerenciamento de links compartilhados na header.
// - Só aparece se houver pelo menos 1 link ativo do usuário.
// - Abre um lightbox com a lista, prazo de expiração e botão de revogar.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Share2, Trash2, Loader2, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listShareLinks,
  revokeShareLink,
} from "@/lib/api/sharedReports.functions";
import { useAuth } from "@/lib/auth";

interface ShareItem {
  shareId: string;
  companyName: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Formata "1d 4h" / "3h 20m" / "12m" restantes até `expiresAt`. */
function fmtRemaining(expiresAt: string | null): { label: string; tone: "ok" | "warn" | "crit" } {
  if (!expiresAt) return { label: "sem expiração", tone: "ok" };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: "expirado", tone: "crit" };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const d = Math.floor(h / 24);
  let label: string;
  if (d >= 1) label = `${d}d ${h % 24}h`;
  else if (h >= 1) label = `${h}h ${m}m`;
  else if (m >= 1) label = `${m}m ${s}s`;
  else label = `${s}s`;
  const tone: "ok" | "warn" | "crit" = h < 1 ? "crit" : h < 6 ? "warn" : "ok";
  return { label, tone };
}

export function SharedLinksDialog() {
  const { user } = useAuth();
  const [items, setItems] = useState<ShareItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // força re-render por segundo p/ contagem regressiva
  const list = useServerFn(listShareLinks);
  const revoke = useServerFn(revokeShareLink);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    try {
      const data = await list();
      setItems(data);
    } catch (err) {
      console.error("[shared-links] falha ao listar:", err);
    }
  }, [list, user]);

  // Carrega ao montar e a cada minuto (limpa itens expirados).
  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Atualiza o contador a cada segundo enquanto o lightbox está aberto.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const handleOpen = async (v: boolean) => {
    setOpen(v);
    if (v) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    setBusyId(shareId);
    try {
      await revoke({ data: { shareId } });
      setItems((prev) => prev.filter((i) => i.shareId !== shareId));
      toast.success("Link revogado");
    } catch (err) {
      toast.error("Falha ao revogar", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (shareId: string) => {
    const url = `${window.location.origin}/shared/${shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  // Esconde o ícone quando não há nenhum link ativo.
  if (!user || items.length === 0) return null;

  // `tick` é lido para evitar warning de variável não usada e forçar re-render.
  void tick;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="relative h-8 w-8 p-0"
        onClick={() => void handleOpen(true)}
        title={`Links compartilhados (${items.length})`}
        aria-label="Gerenciar links compartilhados"
      >
        <Share2 className="h-3.5 w-3.5" />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
          {items.length}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Links compartilhados</DialogTitle>
            <DialogDescription>
              Gerencie os links públicos somente leitura. Revogue para invalidar o acesso imediatamente.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum link ativo no momento.
            </p>
          ) : (
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {items.map((it) => {
                const r = fmtRemaining(it.expiresAt);
                const toneClass =
                  r.tone === "crit"
                    ? "text-destructive"
                    : r.tone === "warn"
                      ? "text-amber-500"
                      : "text-emerald-500";
                return (
                  <li
                    key={it.shareId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/40 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.companyName}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        /shared/{it.shareId}
                      </p>
                      <p className={`text-[11px] font-medium ${toneClass}`}>
                        expira em {r.label}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => void handleCopy(it.shareId)}
                        title="Copiar link"
                        aria-label="Copiar link"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        asChild
                        title="Abrir em nova aba"
                      >
                        <a
                          href={`/shared/${it.shareId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Abrir link"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleRevoke(it.shareId)}
                        disabled={busyId === it.shareId}
                        title="Revogar link"
                        aria-label="Revogar"
                      >
                        {busyId === it.shareId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
