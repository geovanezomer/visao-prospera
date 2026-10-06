// Contrato do bloco ```finance-chart``` emitido pela IA (sem JSX).

export type ChartType = "bar" | "line" | "waterfall" | "tornado";
export type FormatKind = "currency" | "percent" | "number";

export interface ChartSpec {
  type: ChartType;
  title?: string;
  data: Array<Record<string, number | string | boolean>>;
  keys?: string[];
  labelKey?: string;
  format?: FormatKind;
}

/** Tenta parsear; retorna null se inválido. */
export function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (!["bar", "line", "waterfall", "tornado"].includes(obj.type)) return null;
    if (!Array.isArray(obj.data) || obj.data.length === 0) return null;
    return obj as ChartSpec;
  } catch {
    return null;
  }
}
