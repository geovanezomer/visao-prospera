// ============================================================================
// HistoricalYearPills — Seletor de período no cabeçalho das abas com histórico.
//
// Clicar em uma pill recarrega aquele snapshot no AppState corrente
// (com confirmação). O ano vigente é arquivado automaticamente antes da troca.
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
import { MoreVertical, Pencil, Trash2, GitCompareArrows, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  useComparisonMode,
  toggleComparisonMode,
  toggleSelected,
} from "@/engines/scenarios/comparisonStore";

export function HistoricalYearPills() {
  const { state, update } = useFinance();
  const company = state.companyName || "default";
  const all = useScenarios(company);

  const historicals = useMemo(
    () =>
      all
        .filter((s) => s.kind === "historical" && s.state && s.fiscalYear)
        .sort((a, b) => (a.fiscalYear ?? 0) - (b.fiscalYear ?? 0)),
    [all],
  );

  const mesesAtual = useMemo(() => mesesPreenchidos(state.revenue.bruta), [state.revenue.bruta]);

  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ScenarioRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ScenarioRecord | null>(null);
  const { active: compareActive, selected } = useComparisonMode();

  // Regra-chave: sem 2+ historicals, header fica limpo.
  if (historicals.length < 2) return null;

  const confirmLoadTarget = historicals.find((h) => h.id === pendingLoadId);

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
          const isPrev = (h.subKind ?? "realizado") === "previsao";
          const isSel = compareActive && selected.has(h.id);
          return (
            <div key={h.id} className="group/pill inline-flex items-center">
              <button
                type="button"
                role={compareActive ? "checkbox" : "tab"}
                aria-checked={compareActive ? isSel : undefined}
                onClick={() => (compareActive ? toggleSelected(h.id) : setPendingLoadId(h.id))}
                className={cn(
                  "rounded-l-full border border-r-0 px-2.5 py-0.5 text-[11px] font-medium transition-colors inline-flex items-center gap-1",
                  isSel
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : isPrev
                      ? "border-[var(--warning)]/50 bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/20"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                )}
                title={
                  compareActive
                    ? `${isSel ? "Remover" : "Incluir"} ${h.name} na comparação`
                    : `Carregar ${isPrev ? "previsão" : "snapshot"} de ${h.fiscalYear}`
                }
              >
                {compareActive && isSel && <Check className="h-3 w-3" />}
                {!compareActive && isPrev && <span className="mr-0.5 opacity-70">◇</span>}
                {h.name}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "h-[22px] rounded-r-full border px-1 transition-colors",
                      isSel
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                        : isPrev
                          ? "border-[var(--warning)]/50 bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/20"
                          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
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

        {/* Pill "Atual" — em modo Comparar vira checkbox; senão, indicador. */}
        {compareActive ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected.has("atual")}
            onClick={() => toggleSelected("atual")}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors inline-flex items-center gap-1",
              selected.has("atual")
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                : "border-primary bg-primary/10 text-primary hover:bg-primary/20",
            )}
          >
            {selected.has("atual") && <Check className="h-3 w-3" />}
            Atual
            {mesesAtual < 12 && (
              <span className="ml-0.5 text-[10px] font-normal opacity-80">
                · parcial {mesesAtual}/12
              </span>
            )}
          </button>
        ) : (
          <span
            role="tab"
            aria-selected
            className="rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary"
          >
            Atual
            {mesesAtual < 12 && (
              <span className="ml-1.5 text-[10px] font-normal opacity-80">
                · parcial {mesesAtual}/12
              </span>
            )}
          </span>
        )}

        {/* Botão Comparar / Sair — alterna modo multi-seleção FP&A. */}
        <Button
          type="button"
          size="sm"
          variant={compareActive ? "default" : "outline"}
          onClick={toggleComparisonMode}
          className="ml-2 h-6 px-2 text-[11px]"
          title={
            compareActive
              ? "Sair do modo comparar"
              : "Comparar 2+ cenários lado a lado no DRE e Fluxo de Caixa"
          }
        >
          {compareActive ? (
            <>
              <X className="mr-1 h-3 w-3" /> Sair
              {selected.size > 0 && (
                <span className="ml-1 rounded bg-primary-foreground/20 px-1 text-[10px]">
                  {selected.size}
                </span>
              )}
            </>
          ) : (
            <>
              <GitCompareArrows className="mr-1 h-3 w-3" /> Comparar
            </>
          )}
        </Button>
      </div>

      {compareActive && selected.size < 2 && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Selecione 2 ou mais cenários (incluindo <strong>Atual</strong>) para ver o comparativo no
          DRE e no Fluxo de Caixa.
        </p>
      )}

      {/* Confirmação de troca de período. */}
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
              O ano corrente será <strong>arquivado automaticamente</strong> antes da troca — você
              poderá voltar a ele a qualquer momento pelas pills. Nenhum dado é perdido.
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
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
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
              O snapshot será arquivado (soft delete). Esta ação remove-o das pills de período
              imediatamente.
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
