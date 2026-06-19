// ============================================================================
// useSelectedSnapshots — Resolve as chaves selecionadas no comparisonStore
// em uma lista de Snapshots prontos para ComparisonView (label + AppState).
// Ordena por ano (asc), com "Atual" sempre por último.
// ============================================================================

import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useScenarios } from "@/engines/scenarios/store";
import { useComparisonMode } from "@/engines/scenarios/comparisonStore";
import type { Snapshot } from "@/components/sim/comparison/ComparisonView";

export function useSelectedSnapshots(): Snapshot[] {
  const { state } = useFinance();
  const company = state.companyName || "default";
  const all = useScenarios(company);
  const compare = useComparisonMode();

  return useMemo(() => {
    if (!compare.active || compare.selected.length === 0) return [];
    const out: Snapshot[] = [];
    // Históricos selecionados, ordenados por ano.
    const historicalKeys = compare.selected
      .filter((k): k is number => typeof k === "number")
      .sort((a, b) => a - b);
    for (const year of historicalKeys) {
      const rec = all.find(
        (s) => s.kind === "historical" && s.fiscalYear === year && s.state,
      );
      if (rec?.state) {
        out.push({ label: rec.name, state: rec.state });
      }
    }
    // "Atual" sempre por último (referência para Δ%).
    if (compare.selected.includes("atual")) {
      out.push({ label: "Atual", state, isCurrent: true });
    }
    return out;
  }, [all, compare.active, compare.selected, state]);
}
