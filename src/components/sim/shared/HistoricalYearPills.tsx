// ============================================================================
// HistoricalYearPills — Seletor de período no cabeçalho de DRE/CashFlow/Indicadores.
//
// Modos:
//  1) Navegação (default): clicar em uma pill recarrega aquele snapshot no
//     AppState corrente (com confirmação).
//  2) Comparação: ativada via botão "Comparar". Pills viram checkboxes
//     multi-select; o tab pai consome `useComparisonMode()` e renderiza
//     a view de comparação (DRE/Fluxo lado a lado).
//
// Gerenciamento: cada pill histórica tem menu kebab para renomear/excluir.
//
// Regra de exibição: pills só aparecem com ≥ 2 historicals salvos
// (zero ruído pra quem só usa o sistema há um ano).
// ============================================================================

import { useMemo, useState } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import {
  useScenarios,
  deleteScenario,
  saveScenario,
  switchToYear,
  type ScenarioRecord,
} from "@/engines/scenarios/store";
import {
  useComparisonMode,
  setComparisonActive,
  toggleComparisonKey,
} from "@/engines/scenarios/comparisonStore";
import { mesesPreenchidos } from "@/engines/finance/periodUtils";
import { cn } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreVertical, Pencil, Trash2, GitCompare, X } from "lucide-react";
import { toast } from "sonner";

export function HistoricalYearPills() {
  const { state, update } = useFinance();
  const company = state.companyName || "default";
  const all = useScenarios(company);
  const compare = useComparisonMode();

  const historicals = useMemo(
    () =>
      all
        .filter((s) => s.kind === "historical" && s.state && s.fiscalYear)
        .sort((a, b) => (a.fiscalYear ?? 0) - (b.fiscalYear ?? 0)),
    [all],
  );

  const mesesAtual = useMemo(
    () => mesesPreenchidos(state.revenue.bruta),
    [state.revenue.bruta],
  );

  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ScenarioRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ScenarioRecord | null>(null);

  // Regra-chave: sem 2+ historicals, header fica limpo.
  if (historicals.length < 2) return null;

  const confirmLoadTarget = historicals.find((h) => h.id === pendingLoadId);

  const handlePillClick = (h: ScenarioRecord) => {
    if (compare.active) {
      toggleComparisonKey(h.fiscalYear!);
    } else {
      setPendingLoadId(h.id);
    }
  };

  const handleAtualClick = () => {
    if (compare.active) toggleComparisonKey("atual");
  };

  const handleConfirmLoad = () => {
    if (!confirmLoadTarget?.state) return;
    // Auto-arquiva o ano corrente antes de trocar — `switchToYear` preserva
    // tudo que estava em edição no ano vigente.
    const next = switchToYear(company, confirmLoadTarget, state);
    update(() => next);
    toast.success(`Ano ${confirmLoadTarget.fiscalYear} carregado · ano anterior arquivado`);
    setPendingLoadId(null);
  };

  const openRename = (rec: ScenarioRecord) => {
    setRenameTarget(rec);
    setRenameValue(rec.name);
  };

  const handleRename = () => {
    if (!renameTarget) return;
    const name = renameValue.trim().slice(0, 60);
    if (!name) {
      toast.error("Nome não pode ser vazio");
      return;
    }
    saveScenario(company, { ...renameTarget, name });
    toast.success("Snapshot renomeado");
    setRenameTarget(null);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteScenario(company, deleteTarget.id);
    toast.success(`Snapshot "${deleteTarget.name}" removido`);
    setDeleteTarget(null);
  };

  const isSelected = (key: number | "atual") =>
    compare.selected.some((k) => k === key);

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="tablist"
        aria-label="Período de análise"
      >
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
          Período:
        </span>

        {historicals.map((h) => {
          const selected = isSelected(h.fiscalYear!);
          return (
            <div key={h.id} className="group/pill inline-flex items-center">
              <button
                type="button"
                role={compare.active ? "checkbox" : "tab"}
                aria-checked={compare.active ? selected : undefined}
                onClick={() => handlePillClick(h)}
                className={cn(
                  "rounded-l-full border border-r-0 border-input bg-background px-2.5 py-0.5 text-[11px] font-medium",
                  "transition-colors hover:bg-accent hover:text-accent-foreground",
                  compare.active && selected && "border-primary bg-primary/15 text-primary",
                )}
                title={
                  compare.active
                    ? `${selected ? "Remover da" : "Adicionar à"} comparação`
                    : `Carregar snapshot de ${h.fiscalYear}`
                }
              >
                {h.name}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "h-[22px] rounded-r-full border border-input bg-background px-1",
                      "text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                      compare.active && selected && "border-primary bg-primary/15 text-primary",
                    )}
                    aria-label={`Gerenciar ${h.name}`}
                  >
                    <MoreVertical className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openRename(h)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Renomear
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteTarget(h)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}

        {/* Pill "Atual" — sempre presente, selecionável em modo comparação. */}
        <button
          type="button"
          role={compare.active ? "checkbox" : "tab"}
          aria-checked={compare.active ? isSelected("atual") : true}
          onClick={handleAtualClick}
          disabled={!compare.active}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
            !compare.active && "border-primary bg-primary/10 text-primary",
            compare.active && isSelected("atual")
              ? "border-primary bg-primary/15 text-primary"
              : compare.active && "border-input bg-background text-foreground hover:bg-accent",
          )}
        >
          Atual
          {mesesAtual < 12 && (
            <span className="ml-1.5 text-[10px] font-normal opacity-80">
              · parcial {mesesAtual}/12
            </span>
          )}
        </button>

        {/* Ações do modo comparação. */}
        <div className="ml-2 inline-flex items-center gap-1">
          {compare.active ? (
            <>
              <span className="text-[10px] text-muted-foreground">
                {compare.selected.length} selecionado
                {compare.selected.length === 1 ? "" : "s"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => setComparisonActive(false)}
              >
                <X className="mr-1 h-3 w-3" /> Sair
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={() => setComparisonActive(true)}
              title="Comparar períodos lado a lado"
            >
              <GitCompare className="mr-1 h-3 w-3" /> Comparar
            </Button>
          )}
        </div>
      </div>

      {/* Confirmação de troca de período (modo navegação). */}
      <AlertDialog
        open={pendingLoadId !== null}
        onOpenChange={(open) => !open && setPendingLoadId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Carregar snapshot de {confirmLoadTarget?.fiscalYear}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O ano corrente será <strong>arquivado automaticamente</strong> antes
              da troca — você poderá voltar a ele a qualquer momento pelas pills.
              Nenhum dado é perdido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLoad}>
              Carregar {confirmLoadTarget?.fiscalYear}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Renomear snapshot. */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear snapshot</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="renameInput">Novo nome</Label>
            <Input
              id="renameInput"
              value={renameValue}
              maxLength={60}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleRename}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão. */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O snapshot será arquivado (soft delete). Esta ação remove-o das pills
              de período imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
