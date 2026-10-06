// Formatação compartilhada do modo Odoo.
const MONTH_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_PT[(m ?? 1) - 1]}/${String(y).slice(2)}`;
}
