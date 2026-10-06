// Rótulos dos 12 meses da análise. No modo Odoo seguem a janela real
// ("out/25", "nov/25", …); fora dele (simulação/consultoria), Jan…Dez.
import { useMemo } from "react";
import { periodLabels } from "@/engines/finance/anchor";
import { useOdooCockpitContext } from "./cockpit";

export function usePeriodLabels(): string[] {
  const cockpit = useOdooCockpitContext();
  const key = cockpit?.active ? (cockpit.data?.months.join(",") ?? "") : "";
  return useMemo(() => periodLabels(key ? { meses: padTo12(key.split(",")) } : null), [key]);
}

function padTo12(m: string[]): string[] {
  if (m.length >= 12) return m.slice(-12);
  const out = [...m];
  while (out.length < 12) {
    const [y, mm] = out[0].split("-").map(Number);
    const d = new Date(Date.UTC(y, mm - 2, 1));
    out.unshift(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
