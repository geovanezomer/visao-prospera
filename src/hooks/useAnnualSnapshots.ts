// ============================================================================
// useAnnualSnapshots — Lista snapshots para visualização ANUAL lado a lado.
// Devolve os últimos N históricos (ordenados por fiscalYear) + "Atual".
// Usado por DRETab e DFCTable quando o usuário seleciona o período Anual.
//
// Implementação fina sobre `useCompanySnapshots` (single source of truth).
// ============================================================================
import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useCompanySnapshots } from "./useCompanySnapshots";
import type { Snapshot } from "@/components/sim/comparison/ComparisonView";

export function useAnnualSnapshots(max = 3): Snapshot[] {
  const { state } = useFinance();
  const hist = useCompanySnapshots({ kind: "historical", sortByYear: true });

  return useMemo(() => {
    const recent = hist.slice(-max);
    const out: Snapshot[] = recent.map((r) => ({
      label: r.name,
      state: r.state!,
      // Propaga `subKind` para que ComparisonView consiga ativar o modo
      // "Orçado × Realizado" (FP&A) quando houver uma `previsao` selecionada.
      subKind: r.subKind ?? "realizado",
    }));
    out.push({ label: "Atual", state, isCurrent: true, subKind: "realizado" });
    return out;
  }, [hist, state, max]);
}
