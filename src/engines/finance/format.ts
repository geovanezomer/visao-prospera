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

export const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
export const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);
export const zeros12 = () => Array(12).fill(0);
export const fill12 = (v: number) => Array(12).fill(v);
