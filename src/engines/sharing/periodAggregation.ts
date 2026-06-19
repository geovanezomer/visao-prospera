// Agregação por período (Mensal/Trimestral/Anual) para vetores mensais (12 posições).
// Pure function — não recalcula a partir de inputs, apenas reagrupa números já calculados.
export type PeriodView = "mensal" | "trimestral" | "anual";

export const QUARTER_LABELS = ["1º Tri", "2º Tri", "3º Tri", "4º Tri"];
export const MONTH_LABELS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export function aggregateByPeriod(arr: number[], view: PeriodView): number[] {
  if (view === "mensal") return arr.slice(0, 12);
  if (view === "trimestral") {
    return [0, 1, 2, 3].map(
      (q) => (arr[q * 3] ?? 0) + (arr[q * 3 + 1] ?? 0) + (arr[q * 3 + 2] ?? 0),
    );
  }
  return [arr.reduce((a, b) => a + (Number(b) || 0), 0)];
}

export function periodLabelsFor(view: PeriodView): string[] {
  if (view === "mensal") return MONTH_LABELS;
  if (view === "trimestral") return QUARTER_LABELS;
  return ["Ano"];
}
