// ============================================================================
// useAnnualSnapshots — Lista snapshots para visualização ANUAL lado a lado.
// Devolve os últimos N históricos (ordenados por fiscalYear) + "Atual".
// Usado por DRETab e DFCTable quando o usuário seleciona o período Anual.
// ============================================================================
import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useScenarios } from "@/engines/scenarios/store";
import type { Snapshot } from "@/components/sim/ComparisonView";

export function useAnnualSnapshots(max = 3): Snapshot[] {
  const { state } = useFinance();
  const company = state.companyName || "default";
  const all = useScenarios(company);

  return useMemo(() => {
    const hist = all
      .filter((s) => s.kind === "historical" && s.state && typeof s.fiscalYear === "number")
      .sort((a, b) => (a.fiscalYear ?? 0) - (b.fiscalYear ?? 0));
    // Mantém os `max` mais recentes (últimos da lista asc).
    const recent = hist.slice(-max);
    const out: Snapshot[] = recent.map((r) => ({ label: r.name, state: r.state! }));
    out.push({ label: "Atual", state, isCurrent: true });
    return out;
  }, [all, state, max]);
}
