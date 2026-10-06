// Helpers de agregação por período (mensal/trimestral/anual) para a DFC.
import { MESES } from "@/engines/finance/format";

export type Period = "mensal" | "trimestral" | "anual";
export type Agg = "sum" | "last" | "first";
export type NonOpKey = "aportes" | "emprestimosCaptados" | "capex" | "dividendos" | "amortizacoes";

export function bucketIndices(period: Period): number[][] {
  if (period === "mensal") return MESES.map((_, i) => [i]);
  if (period === "trimestral")
    return [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ];
  return [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
}
/** `meses`: rótulos dos 12 meses (no modo Odoo, a janela real — ex.: "out/25"). */
export function periodLabels(period: Period, meses: string[] = MESES): string[] {
  if (period === "mensal") return meses;
  if (period === "trimestral")
    return meses === MESES
      ? ["T1", "T2", "T3", "T4"]
      : [0, 3, 6, 9].map((i) => `${meses[i]}–${meses[i + 2]}`);
  return meses === MESES ? ["Ano"] : [`${meses[0]}–${meses[11]}`];
}
export function aggregate(values: number[], period: Period, agg: Agg): number[] {
  return bucketIndices(period).map((idxs) => {
    if (agg === "sum") return idxs.reduce((a, i) => a + (values[i] || 0), 0);
    if (agg === "last") return values[idxs[idxs.length - 1]] || 0;
    return values[idxs[0]] || 0;
  });
}

export function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nonZero = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nonZero as number) ? (nonZero as number) : values[0] || 0;
}

// True quando o array tem variação real entre meses (mais de um valor distinto)
export function hasSazonalidade(values: number[]): boolean {
  if (!values?.length) return false;
  const first = values[0];
  return values.some((v) => v !== first);
}
