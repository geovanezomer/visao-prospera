// Dialog do botão "Compartilhar" — gera link, exibe, permite revogar shares ativos.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Share2, Copy, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useAuth } from "@/lib/auth";
import {
  publishShare,
  revokeShare,
  listActiveShares,
  type ActiveShareRow,
} from "@/engines/sharing/publishShare";

export function ShareDialog() {
  const { state } = useFinance();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<string>("30");
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeShares, setActiveShares] = useState<ActiveShareRow[]>([]);

  const refreshShares = async () => {
    if (!user?.id) return;
    try {
      const rows = await listActiveShares(user.id, state.companyName);
      setActiveShares(rows);
    } catch {
      // silencioso
    }
  };

  useEffect(() => {
    if (open) {
      setGeneratedUrl(null);
      setCopied(false);
      refreshShares();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleGenerate = async () => {
    if (!user?.id) {
      toast.error("Faça login para gerar links de compartilhamento");
      return;
    }
    if (!state.companyName) {
      toast.error("Defina o nome da empresa antes de compartilhar");
      return;
    }
    setGenerating(true);
    try {
      const days = expiresInDays === "never" ? null : Number(expiresInDays);
      const { url } = await publishShare(state, user.id, days);
      setGeneratedUrl(url);
      await refreshShares();
      toast.success("Link gerado com sucesso");
    } catch (err) {
      toast.error("Falha ao gerar link", {
        description: err instanceof Error ? err.message : "Tente novamente",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      toast.success("Link revogado");
      await refreshShares();
    } catch {
      toast.error("Falha ao revogar");
    }
  };

  const shareUrl = (id: string) => `${window.location.origin}/compartilhado/${id}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full justify-start"
          title="Gerar link read-only para o cliente"
        >
          <Share2 className="h-3.5 w-3.5 mr-2" />
          <span>Compartilhar</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar análise com cliente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Gera um link somente leitura com DRE, Fluxo de Caixa, Indicadores e
            Diagnóstico da empresa atual. O cliente vê os mesmos números, mas
            não consegue editar nada.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Validade do link</label>
            <Select value={expiresInDays} onValueChange={setExpiresInDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
                <SelectItem value="never">Sem expiração</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {generatedUrl && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Link gerado</label>
              <div className="flex gap-2">
                <Input readOnly value={generatedUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(generatedUrl)}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {activeShares.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Links ativos para "{state.companyName}" ({activeShares.length})
              </label>
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded border p-2">
                {activeShares.map((s) => (
                  <div
                    key={s.share_id}
                    className="flex items-center gap-2 rounded bg-muted/40 p-2 text-[11px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono">{s.share_id}</p>
                      <p className="text-muted-foreground">
                        Criado {new Date(s.created_at).toLocaleDateString("pt-BR")} ·{" "}
                        {s.expires_at
                          ? `expira ${new Date(s.expires_at).toLocaleDateString("pt-BR")}`
                          : "sem expiração"}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleCopy(shareUrl(s.share_id))}
                      title="Copiar link"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleRevoke(s.share_id)}
                      title="Revogar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? "Gerando..." : "Gerar novo link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
