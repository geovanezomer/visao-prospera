// ============================================================================
// useCompanySnapshots — fonte única para listar cenários da empresa ativa.
// Filtra por `kind` ("historical" | "whatif") e (opcional) ordena por fiscalYear.
// Substitui a lógica duplicada que existia em useAnnualSnapshots e
// ScenarioBar/CompanyConfigDialog.
// ============================================================================
import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useScenarios, type ScenarioRecord } from "@/engines/scenarios/store";

type Kind = NonNullable<ScenarioRecord["kind"]>;

interface Options {
  /** "historical" exige `state` + `fiscalYear`. "whatif" não. */
  kind?: Kind;
  /** Ordena historicals por ano fiscal (asc). */
  sortByYear?: boolean;
}

export function useCompanySnapshots(opts: Options = {}): ScenarioRecord[] {
  const { state } = useFinance();
  const company = state.companyName || "default";
  const all = useScenarios(company);

  return useMemo(() => {
    const { kind, sortByYear } = opts;
    let out = all;
    if (kind === "historical") {
      out = out.filter(
        (s) => s.kind === "historical" && s.state && typeof s.fiscalYear === "number",
      );
    } else if (kind === "whatif") {
      out = out.filter((s) => s.kind !== "historical");
    }
    if (sortByYear) {
      out = [...out].sort((a, b) => (a.fiscalYear ?? 0) - (b.fiscalYear ?? 0));
    }
    return out;
  }, [all, opts]);
}
