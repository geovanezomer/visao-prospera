// ============================================================================
// ChangePasswordDialog — troca de senha do usuário logado.
//
// • `forced`: senha provisória (user.mustChangePassword). Modal bloqueante —
//   sem botão de fechar, ESC ou clique fora; única saída é trocar ou sair.
// • Sem `forced`: aberto pelo menu do usuário, pode ser fechado normalmente.
// ============================================================================
import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Bloqueante (não pode ser dispensado). */
  forced?: boolean;
}

const MIN_LENGTH = 8;

export function ChangePasswordDialog({
  open,
  onOpenChange,
  forced = false,
}: ChangePasswordDialogProps) {
  const { changePassword, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  };

  const handleOpenChange = (v: boolean) => {
    if (forced || loading) return;
    if (!v) reset();
    onOpenChange?.(v);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) {
      setError(`A nova senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (next !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    if (next === current) {
      setError("A nova senha precisa ser diferente da atual.");
      return;
    }
    setLoading(true);
    const res = await changePassword(current, next);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success("Senha alterada com sucesso.");
    reset();
    onOpenChange?.(false);
  };

  const block = (e: Event) => {
    if (forced) e.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn("sm:max-w-md", forced && "[&>button]:hidden")}
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
        onInteractOutside={block}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            {forced ? "Defina uma nova senha" : "Trocar senha"}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? "Você está usando uma senha provisória. Para continuar, escolha uma nova senha."
              : "Informe a senha atual e escolha uma nova senha."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" autoComplete="on">
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">Senha atual</Label>
            <Input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">Nova senha</Label>
            <Input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
            <p className="text-[11px] text-muted-foreground">Mínimo de {MIN_LENGTH} caracteres.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Confirmar nova senha</Label>
            <Input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {forced ? (
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => void logout()}
              >
                Sair da conta
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => handleOpenChange(false)}
              >
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
