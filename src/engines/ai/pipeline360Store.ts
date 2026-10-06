// Persistência do estado do pipeline 360° em sessionStorage.
// Escopo: por empresa + thread, para que o Reiniciar sobreviva a um refresh
// mas não polua outras conversas. sessionStorage (não localStorage) porque
// um pipeline retomável só faz sentido na mesma sessão do navegador.

export type Pipeline360Stage = "cfo" | "controller" | "auditor";

export interface Pipeline360Persisted {
  completed: Pipeline360Stage[];
  total: number;
  aborted?: boolean;
  question?: string;
  outputs?: Array<{ stage: Pipeline360Stage; output: string }>;
}

const KEY = (company: string, thread: string) =>
  `gz-finance-pipeline360-${company || "default"}-${thread}`;

export function loadPipeline360(company: string, thread: string): Pipeline360Persisted | null {
  if (typeof window === "undefined" || !thread) return null;
  try {
    const raw = sessionStorage.getItem(KEY(company, thread));
    if (!raw) return null;
    const v = JSON.parse(raw) as Pipeline360Persisted;
    if (!Array.isArray(v.completed) || typeof v.total !== "number") return null;
    return v;
  } catch {
    return null;
  }
}

export function savePipeline360(company: string, thread: string, data: Pipeline360Persisted): void {
  if (typeof window === "undefined" || !thread) return;
  try {
    sessionStorage.setItem(KEY(company, thread), JSON.stringify(data));
  } catch {
    /* quota — ignore */
  }
}

export function clearPipeline360(company: string, thread: string): void {
  if (typeof window === "undefined" || !thread) return;
  try {
    sessionStorage.removeItem(KEY(company, thread));
  } catch {
    /* ignore */
  }
}
