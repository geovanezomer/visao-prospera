// ============================================================================
// ui-states — componentes reutilizáveis de estados intermediários do admin:
//   • <TableSkeleton />       linhas shimmer para tabelas
//   • <EmptyState />          estado vazio centralizado com ícone + CTA
//   • <TypedConfirmDialog />  confirmação destrutiva com "type-to-confirm"
// Apenas apresentação — não altera lógica de negócio.
// ============================================================================
import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// ─── TableSkeleton ─────────────────────────────────────────────────────────
// Larguras variadas para não parecer um bloco uniforme e feio.
const WIDTHS = ["w-24", "w-32", "w-20", "w-40", "w-16", "w-28", "w-36"];

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="w-full">
      <table className="w-full">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-t border-border/40">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="p-2">
                  <div
                    className={`h-4 rounded bg-muted animate-pulse ${WIDTHS[(r + c) % WIDTHS.length]}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Variante para grades de cards (Dashboard).
export function CardSkeletonGrid({ count = 4, height = 96 }: { count?: number; height?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-card p-4">
          <div className="h-3 w-16 rounded bg-muted animate-pulse" />
          <div
            className="mt-3 w-24 rounded bg-muted animate-pulse"
            style={{ height: Math.round(height / 3) }}
          />
          <div className="mt-2 h-3 w-20 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
      {action}
    </div>
  );
}

// ─── TypedConfirmDialog (padrão GitHub) ───────────────────────────────────
export function TypedConfirmDialog({
  open,
  onOpenChange,
  expectedText,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expectedText: string;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const matches = typed.trim() === expectedText.trim();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground">{description}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">
            Para confirmar, digite{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">
              {expectedText}
            </code>
          </Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Digite ${expectedText} para confirmar`}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction asChild disabled={!matches || busy}>
            <Button
              variant="destructive"
              disabled={!matches || busy}
              onClick={(e) => {
                e.preventDefault();
                if (!matches || busy) return;
                void onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
