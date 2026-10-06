// Dialog "Abrir / Restaurar" — 2 cards (disco, nuvem).
// Modelo de UI copiado do SaveShareDialog.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HardDrive, Cloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Abre arquivo .finnance do computador. */
  onOpenDisk: () => void;
  /** Abre dialog de restauração da nuvem. undefined ⇒ usuário deslogado. */
  onOpenCloud?: () => void;
  /** Indica se o card de nuvem deve aparecer. */
  canUseCloud: boolean;
}

type CardKey = "disk" | "cloud";

export function OpenRestoreDialog({
  open,
  onOpenChange,
  onOpenDisk,
  onOpenCloud,
  canUseCloud,
}: Props) {
  const [busy, setBusy] = useState<CardKey | null>(null);

  const handleDisk = () => {
    onOpenDisk();
    onOpenChange(false);
  };

  const handleCloud = async () => {
    if (!onOpenCloud) return;
    setBusy("cloud");
    try {
      onOpenCloud();
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Abrir / Restaurar</DialogTitle>
          <DialogDescription>
            Carregue um arquivo salvo no computador ou restaure um backup da nuvem.
          </DialogDescription>
        </DialogHeader>

        <div className={cn("grid gap-4 pt-2", canUseCloud ? "md:grid-cols-2" : "md:grid-cols-1")}>
          <ActionCard
            icon={<HardDrive className="h-7 w-7" />}
            tone="primary"
            title="Abrir do computador"
            description="Selecione um arquivo .finnance salvo localmente."
            cta="Escolher arquivo"
            onClick={handleDisk}
            busy={busy === "disk"}
          />

          {canUseCloud && (
            <ActionCard
              icon={<Cloud className="h-7 w-7" />}
              tone="info"
              title="Restaurar da nuvem"
              description="Liste e recupere backups vinculados à sua conta."
              cta="Ver backups"
              onClick={handleCloud}
              busy={busy === "cloud"}
              disabled={!onOpenCloud}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CardProps {
  icon: React.ReactNode;
  tone: "primary" | "info";
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}

function ActionCard({ icon, tone, title, description, cta, onClick, busy, disabled }: CardProps) {
  const toneClasses = {
    primary: { bg: "bg-primary/10", text: "text-primary", btn: "default" as const },
    info: { bg: "bg-sky-500/10", text: "text-sky-500", btn: "secondary" as const },
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
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {cta}
      </Button>
    </div>
  );
}
