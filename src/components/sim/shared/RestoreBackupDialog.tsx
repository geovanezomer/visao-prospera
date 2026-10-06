// Dialog para listar e restaurar backups salvos na nuvem (Supabase Storage).
// Substitui o estado atual do editor pelo conteúdo do arquivo escolhido.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Cloud,
  CloudDownload,
  Loader2,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { listBackups, downloadBackup, deleteBackup } from "@/lib/api/cloudBackup";
import { parseFinnanceFile } from "@/engines/finance/fileFormat";
import { applyExtras } from "@/engines/finance/fileExtras";
import type { AppState, Scenario } from "@/engines/finance/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  /** Empresa do arquivo atualmente carregado — usado no diálogo de descarte. */
  currentCompanyName: string;
  /** Nome do arquivo atual (se houver) — usado no diálogo de descarte. */
  currentFileName: string | null;
  /** Última modificação local — usada no diálogo de descarte. */
  lastModified: number | null;
  hasUnsavedChanges: boolean;
  confirm: (opts: {
    title: string;
    description?: string;
    confirmLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
  setState: (s: AppState) => void;
  replaceScenarios: (s: Scenario[]) => void;
  onRestored: (filename: string) => void;
}

interface BackupItem {
  name: string;
  updatedAt: string | null;
}

const PAGE_SIZE = 8;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function formatLocal(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR");
}

export function RestoreBackupDialog({
  open,
  onOpenChange,
  userId,
  currentCompanyName,
  currentFileName,
  lastModified,
  hasUnsavedChanges,
  confirm,
  setState,
  replaceScenarios,
  onRestored,
}: Props) {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // Confirmação explícita do que será descartado antes de restaurar.
  const [pendingRestore, setPendingRestore] = useState<BackupItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBackups(userId);
      setItems(list);
      setPage(0);
    } catch (err) {
      toast.error("Não foi possível listar os backups", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Filtragem por substring (case-insensitive) + paginação local.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    // Reseta página quando a busca muda e o range fica fora dos limites.
    setPage(0);
  }, [query]);

  const performRestore = async (item: BackupItem) => {
    setBusyFile(item.name);
    try {
      const text = await downloadBackup(userId, item.name);
      const raw = JSON.parse(text);
      const opened = parseFinnanceFile(raw);
      setState(opened.state);
      replaceScenarios(opened.scenarios);
      applyExtras(opened.state.companyName, {
        actions: (opened.extras.actions ?? []) as never,
        simScenarios: (opened.extras.simScenarios ?? []) as never,
      });
      onRestored(item.name);
      toast.success(`Backup restaurado: ${item.name}`);
      onOpenChange(false);
    } catch (err) {
      toast.error("Falha ao restaurar backup", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFile(null);
      setPendingRestore(null);
    }
  };

  const handleRestoreClick = (item: BackupItem) => {
    // Sempre abre o diálogo explícito (mesmo sem dirty) para o usuário ver
    // exatamente qual estado vai ser substituído.
    setPendingRestore(item);
  };

  const handleDelete = async (filename: string) => {
    const ok = await confirm({
      title: "Remover backup?",
      description: `O arquivo "${filename}" será excluído da nuvem. Esta ação não pode ser desfeita.`,
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;
    setBusyFile(filename);
    try {
      await deleteBackup(userId, filename);
      setItems((prev) => prev.filter((i) => i.name !== filename));
      toast.success(`Backup removido: ${filename}`);
    } catch (err) {
      toast.error("Falha ao remover backup", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFile(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="h-4 w-4" /> Restaurar da nuvem
            </DialogTitle>
            <DialogDescription>
              Backups automáticos do seu arquivo <code className="text-[11px]">.finnance</code>.
              Selecione um arquivo para carregar no editor.
            </DialogDescription>
          </DialogHeader>

          {/* Busca por nome */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome do arquivo…"
              className="h-8 pl-7 text-sm"
            />
          </div>

          <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border/40">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? "Nenhum backup encontrado."
                  : `Nenhum resultado para "${query}".`}
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {pageItems.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-accent/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={item.name}>
                        {item.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Atualizado em {formatDate(item.updatedAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busyFile === item.name}
                      onClick={() => handleRestoreClick(item)}
                      className="h-7"
                    >
                      {busyFile === item.name ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <CloudDownload className="h-3.5 w-3.5 mr-1" /> Restaurar
                        </>
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busyFile === item.name}
                      onClick={() => void handleDelete(item.name)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Remover backup"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Paginação */}
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)}{" "}
                de {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-1">
                  {safePage + 1} / {totalPages}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              Atualizar lista
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação explícita do que será descartado */}
      <AlertDialog open={!!pendingRestore} onOpenChange={(v) => !v && setPendingRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Restaurar este backup?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  O conteúdo atual do editor será <strong>substituído</strong> pelo arquivo
                  selecionado. Esta ação não pode ser desfeita.
                </p>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-border/50 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Será descartado
                    </div>
                    <div className="mt-1 truncate font-medium">
                      {currentCompanyName?.trim() || "Sem empresa"}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {currentFileName ?? "Arquivo não salvo"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Modif. {formatLocal(lastModified)}
                    </div>
                    {hasUnsavedChanges && (
                      <div className="mt-1 text-[11px] font-medium text-amber-600">
                        ● Alterações não salvas serão perdidas
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-primary">
                      Será carregado
                    </div>
                    <div className="mt-1 truncate font-medium" title={pendingRestore?.name}>
                      {pendingRestore?.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Backup de {formatDate(pendingRestore?.updatedAt ?? null)}
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingRestore && void performRestore(pendingRestore)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Descartar atual e restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
