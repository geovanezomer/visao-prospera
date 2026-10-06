// Leitura e exibição de números digitados no formato brasileiro.
//   "150.000" → 150000 · "1.500,75" → 1500.75 · "12,5" → 12.5 · "1.5" → 1.5
// Ponto só é decimal quando não forma grupos de milhar (1.500 = mil e quinhentos).

const MILHAR_PONTO = /^-?\d{1,3}(\.\d{3})+$/;
const MILHAR_VIRGULA = /^-?\d{1,3}(,\d{3}){2,}$/;

export function lerNumeroBR(entrada: string): number {
  if (!entrada) return 0;
  let s = entrada.replace(/[^0-9.,-]/g, "");
  const negativo = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (!s) return 0;
  if (s.includes(",")) {
    // Vírgula decimal: pontos são milhar. Várias vírgulas sem decimal = milhar (cópia US).
    s = MILHAR_VIRGULA.test(s) ? s.replace(/,/g, "") : s.replace(/\./g, "");
    const ultima = s.lastIndexOf(",");
    if (ultima >= 0) s = s.slice(0, ultima).replace(/,/g, "") + "." + s.slice(ultima + 1);
  } else if (MILHAR_PONTO.test(s)) {
    s = s.replace(/\./g, "");
  } else {
    const ultimo = s.lastIndexOf(".");
    if (ultimo >= 0) s = s.slice(0, ultimo).replace(/\./g, "") + s.slice(ultimo);
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negativo ? -n : n;
}

/** Texto do campo fora de edição: "1.500,75"; zero vira vazio (placeholder). */
export function numeroParaCampo(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 6, useGrouping: true });
}
