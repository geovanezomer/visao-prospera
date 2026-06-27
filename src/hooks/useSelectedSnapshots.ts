// ============================================================================
// useSelectedSnapshots — Resolve as chaves do comparisonStore em Snapshot[]
// prontos para `DREComparison` / `CashFlowComparison`. "Atual" sempre por
// último (convenção FP&A: realizado vai à direita).
// ============================================================================
import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useCompanySnapshots } from "./useCompanySnapshots";
import { useComparisonMode } from "@/engines/scenarios/comparisonStore";
import type { Snapshot } from "@/components/sim/comparison/ComparisonView";

const OPTS = { kind: "historical" as const, sortByYear: true };

export function useSelectedSnapshots(): Snapshot[] {
  const { state } = useFinance();
  const hist = useCompanySnapshots(OPTS);
  const { selected } = useComparisonMode();

  return useMemo(() => {
    if (selected.size === 0) return [];
    const out: Snapshot[] = [];
    for (const h of hist) {
      if (selected.has(h.id) && h.state) {
        out.push({
          label: h.name,
          state: h.state,
          subKind: h.subKind ?? "realizado",
        });
      }
    }
    if (selected.has("atual")) {
      out.push({ label: "Atual", state, isCurrent: true, subKind: "realizado" });
    }
    return out;
  }, [hist, state, selected]);
}
