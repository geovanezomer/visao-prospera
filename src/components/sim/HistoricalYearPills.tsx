// ============================================================================
// HistoricalYearPills — Seletor de período no cabeçalho de Indicadores/DRE.
//
// Comportamento (Fase 3):
//  - Não renderiza nada se houver < 2 historicals salvos (zero ruído para
//    quem usa o sistema há pouco tempo, com só o ano corrente).
//  - Pills com anos fiscais arquivados + pill "Atual" no fim.
//  - Pill "Atual" exibe badge "parcial X/12" quando ano não está completo,
//    usando mesesPreenchidos() — alerta visual de anualização extrapolada.
//  - Clicar em um ano arquivado carrega aquele AppState (com confirmação,
//    pois sobrescreve a visualização atual da engine).
// ============================================================================

import { useMemo, useState } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useScenarios } from "@/engines/scenarios/store";
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
import { toast } from "sonner";

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

  const mesesAtual = useMemo(
    () => mesesPreenchidos(state.revenue.bruta),
    [state.revenue.bruta],
  );

  // Diálogo de confirmação ao trocar para snapshot histórico.
  const [pendingHistoricalId, setPendingHistoricalId] = useState<string | null>(null);

  // Regra-chave: sem 2+ historicals, header fica limpo (sem ruído).
  if (historicals.length < 2) return null;

  const confirmTarget = historicals.find((h) => h.id === pendingHistoricalId);

  const handleSelectHistorical = (id: string) => {
    setPendingHistoricalId(id);
  };

  const handleConfirmLoad = () => {
    if (!confirmTarget?.state) return;
    update(() => confirmTarget.state!);
    toast.success(`Visualizando ${confirmTarget.name}`);
    setPendingHistoricalId(null);
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
        {historicals.map((h) => (
          <button
            key={h.id}
            type="button"
            role="tab"
            onClick={() => handleSelectHistorical(h.id)}
            className={cn(
              "rounded-full border border-input bg-background px-2.5 py-0.5 text-[11px] font-medium",
              "transition-colors hover:bg-accent hover:text-accent-foreground",
            )}
            title={`Carregar snapshot de ${h.fiscalYear}`}
          >
            {h.fiscalYear}
          </button>
        ))}
        {/* Pill do ano corrente — sempre selecionada visualmente (é a fonte viva). */}
        <span
          className="rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary"
          role="tab"
          aria-selected="true"
        >
          Atual
          {mesesAtual < 12 && (
            <span className="ml-1.5 text-[10px] font-normal opacity-80">
              · parcial {mesesAtual}/12
            </span>
          )}
        </span>
      </div>

      <AlertDialog
        open={pendingHistoricalId !== null}
        onOpenChange={(open) => !open && setPendingHistoricalId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Carregar snapshot de {confirmTarget?.fiscalYear}?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso substitui o AppState corrente pelos dados arquivados de{" "}
              {confirmTarget?.fiscalYear}. Salve o ano atual antes (
              <strong>Configurar Empresa → Fechar ano</strong>) para não perdê-lo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLoad}>
              Carregar {confirmTarget?.fiscalYear}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
