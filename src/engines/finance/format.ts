export const MESES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export const fmtBRL = (n: number) => (Number.isFinite(n) ? brl.format(n) : "—");
export const fmtBRLCompact = (n: number) => (Number.isFinite(n) ? brlCompact.format(n) : "—");
export const fmtPct = (n: number) => (Number.isFinite(n) ? pct.format(n) : "—");
export const fmtNum = (n: number, d = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

/**
 * Formata múltiplos ("vezes") — ex.: cobertura de juros, DSCR, D/PL.
 * Indicadores são capped na engine (sempre finitos). O ramo "—" cobre o
 * caso degenerado de denominador ≤ 0 (sem base de comparação).
 * SSOT — antes duplicado em IndicatorsTab/IndicatorsCard.
 */
export const fmtTimes = (v: number | null, base: number, decimals = 1): string =>
  v == null ? "N/A" : base <= 0 ? "—" : `${v.toFixed(decimals)}×`;

/** Razão sem unidade — ex.: liquidez 4,44. */
export const fmtRatio = (n: number, d = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

/** Dias (PMR, PMP, ciclo). */
export const fmtDays = (n: number, d = 0) =>
  Number.isFinite(n) ? `${fmtNum(n, d)} dias` : "—";

/** Anos (payback, amortização). */
export const fmtAnos = (n: number, d = 1) =>
  Number.isFinite(n) ? `${fmtNum(n, d)} anos` : "—";


export const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
export const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);
export const zeros12 = () => Array(12).fill(0);
export const fill12 = (v: number) => Array(12).fill(v);

/**
 * Gera um identificador único curto. Usa `crypto.randomUUID()` quando
 * disponível (todos os browsers modernos + workers); fallback determinístico
 * baseado em timestamp + random para SSR/ambientes sem `crypto`.
 */
export function genId(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}${id}` : id;
}
