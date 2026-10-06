// Dialog "Salvar / Compartilhar" — 3 cards (disco, nuvem, link público).
// Inspirado no padrão Excalidraw, mas usando tokens do design system.
import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HardDrive, Cloud, Link2, Loader2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { createShareLink } from "@/lib/api/sharedReports.functions";
import { collectExtras } from "@/engines/finance/fileExtras";
import { serialize } from "@/engines/finance/fileFormat";
import type { AppState, Scenario } from "@/engines/finance/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Salva no computador (download local). */
  onSaveDisk: () => void;
  /** Salva backup imediato na nuvem (Supabase). undefined ⇒ usuário deslogado. */
  onSaveCloud?: () => Promise<void> | void;
  /** Estado/cenários atuais — usados para gerar payload do link público. */
  state: AppState;
  scenarios: Scenario[];
  /** Quando false, oculta o card "Salvar na nuvem". */
  canUseCloud: boolean;
}

type CardKey = "disk" | "cloud" | "share";

export function SaveShareDialog({
  open,
  onOpenChange,
  onSaveDisk,
  onSaveCloud,
  state,
  scenarios,
  canUseCloud,
}: Props) {
  const [busy, setBusy] = useState<CardKey | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createShare = useServerFn(createShareLink);

  const handleDisk = () => {
    onSaveDisk();
    onOpenChange(false);
  };

  const handleCloud = async () => {
    if (!onSaveCloud) return;
    setBusy("cloud");
    try {
      await onSaveCloud();
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy("share");
    setShareUrl(null);
    setCopied(false);
    try {
      const extras = collectExtras(state.companyName);
      const payload = serialize(state, scenarios, extras);
      const { shareId } = await createShare({
        data: { payload, companyName: state.companyName || "Sem nome" },
      });
      const url = `${window.location.origin}/shared/${shareId}`;
      setShareUrl(url);
      toast.success("Link de compartilhamento criado");
    } catch (err) {
      toast.error("Falha ao gerar link", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setShareUrl(null);
          setCopied(false);
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Salvar / Compartilhar</DialogTitle>
          <DialogDescription>
            Exporte o arquivo, salve um backup na nuvem ou gere um link público somente leitura.
          </DialogDescription>
        </DialogHeader>

        <div className={cn("grid gap-4 pt-2", canUseCloud ? "md:grid-cols-3" : "md:grid-cols-2")}>
          <ActionCard
            icon={<HardDrive className="h-7 w-7" />}
            tone="primary"
            title="Salvar no computador"
            description="Baixa um arquivo .finnance que você pode importar depois."
            cta="Salvar arquivo"
            onClick={handleDisk}
            busy={busy === "disk"}
          />

          {canUseCloud && (
            <ActionCard
              icon={<Cloud className="h-7 w-7" />}
              tone="info"
              title="Salvar na nuvem"
              description="Guarda um backup criptografado vinculado à sua conta."
              cta="Salvar backup"
              onClick={handleCloud}
              busy={busy === "cloud"}
              disabled={!onSaveCloud}
            />
          )}

          <ActionCard
            icon={<Link2 className="h-7 w-7" />}
            tone="accent"
            title="Compartilhar link"
            description="Gera uma URL pública somente leitura do sistema inteiro."
            cta={shareUrl ? "Gerar outro link" : "Gerar link"}
            onClick={handleShare}
            busy={busy === "share"}
            disabled={!canUseCloud}
            disabledHint={!canUseCloud ? "Faça login para compartilhar" : undefined}
          />
        </div>

        {shareUrl && (
          <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Link somente leitura</p>
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? "Copiado" : "Copiar"}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Qualquer pessoa com esse link verá uma cópia somente leitura. Edições são bloqueadas.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CardProps {
  icon: React.ReactNode;
  tone: "primary" | "info" | "accent";
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  disabledHint?: string;
}

function ActionCard({
  icon,
  tone,
  title,
  description,
  cta,
  onClick,
  busy,
  disabled,
  disabledHint,
}: CardProps) {
  // Tons baseados em design tokens — nada hard-coded.
  const toneClasses = {
    primary: { bg: "bg-primary/10", text: "text-primary", btn: "default" as const },
    info: { bg: "bg-sky-500/10", text: "text-sky-500", btn: "secondary" as const },
    accent: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-500", btn: "secondary" as const },
  }[tone];

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-5 text-center shadow-sm transition-colors hover:border-border/80">
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full",
          toneClasses.bg,
          toneClasses.text,
        )}
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="flex-1 text-xs text-muted-foreground">{description}</p>
      <Button
        size="sm"
        variant={toneClasses.btn}
        onClick={onClick}
        disabled={busy || disabled}
        className="w-full"
        title={disabledHint}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {cta}
      </Button>
    </div>
  );
}
