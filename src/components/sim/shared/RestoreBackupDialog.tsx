// Dialog para listar e restaurar backups salvos na nuvem (Supabase Storage).
// Substitui o estado atual do editor pelo conteúdo do arquivo escolhido.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Cloud, CloudDownload, Loader2, Trash2 } from "lucide-react";
import { listBackups, downloadBackup, deleteBackup } from "@/lib/api/cloudBackup";
import { parseFinnanceFile } from "@/engines/finance/fileFormat";
import { applyExtras } from "@/engines/finance/fileExtras";
import type { AppState, Scenario } from "@/engines/finance/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  /** Confirma com o usuário antes de descartar alterações locais não salvas. */
  hasUnsavedChanges: boolean;
  confirm: (opts: { title: string; description?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  setState: (s: AppState) => void;
  replaceScenarios: (s: Scenario[]) => void;
  onRestored: (filename: string) => void;
}

interface BackupItem {
  name: string;
  updatedAt: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

export function RestoreBackupDialog({
  open,
  onOpenChange,
  userId,
  hasUnsavedChanges,
  confirm,
  setState,
  replaceScenarios,
  onRestored,
}: Props) {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBackups(userId);
      setItems(list);
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

  const handleRestore = async (filename: string) => {
    if (hasUnsavedChanges) {
      const ok = await confirm({
        title: "Descartar alterações?",
        description: "Você tem alterações não salvas. Restaurar o backup vai descartá-las.",
        confirmLabel: "Descartar e restaurar",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusyFile(filename);
    try {
      const text = await downloadBackup(userId, filename);
      const raw = JSON.parse(text);
      const opened = parseFinnanceFile(raw);
      setState(opened.state);
      replaceScenarios(opened.scenarios);
      applyExtras(opened.state.companyName, {
        actions: (opened.extras.actions ?? []) as never,
        simScenarios: (opened.extras.simScenarios ?? []) as never,
      });
      onRestored(filename);
      toast.success(`Backup restaurado: ${filename}`);
      onOpenChange(false);
    } catch (err) {
      toast.error("Falha ao restaurar backup", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFile(null);
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-4 w-4" /> Restaurar da nuvem
          </DialogTitle>
          <DialogDescription>
            Backups automáticos do seu arquivo <code className="text-[11px]">.finnance</code>.
            Selecione um arquivo para carregar no editor.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border/40">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum backup encontrado.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {items.map((item) => (
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
                    onClick={() => void handleRestore(item.name)}
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
  );
}
