import { AppState } from "@/engines/finance/types";
import { IndicatorsGrid } from "./IndicatorsGrid";

// Card de indicadores usado no Simulador.
// IMPORTANTE: reusa `IndicatorsGrid` (SSOT visual). Não duplicar markup
// nem fórmulas aqui — qualquer ajuste é feito em IndicatorsGrid.tsx.
export function IndicatorsCard({ state }: { state: AppState }) {
  return <IndicatorsGrid state={state} />;
}
