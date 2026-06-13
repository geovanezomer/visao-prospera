/**
 * SSOT Matemático — proteções globais contra NaN, Infinity, divisão por zero
 * e arrays de meses malformados.
 *
 * Toda divisão sensível em indicadores financeiros DEVE usar `safeDivide` ou
 * suas variantes. Isso elimina a categoria inteira de bugs do tipo
 * "WACC = Infinity quando capital próprio = 0" ou "ROIC = NaN quando NOPAT
 * derivou de receita zerada".
 *
 * Regras de fallback:
 *   - numerador ou denominador não finito → fallback
 *   - denominador zero → fallback
 *   - resultado não finito → fallback
 */

/** Divisão segura: retorna `fallback` quando indefinida. */
export function safeDivide(num: number, den: number, fallback = 0): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return fallback;
  const r = num / den;
  return Number.isFinite(r) ? r : fallback;
}

/** Razão como percentual (0–100). Equivalente a `safeDivide(n, d) * 100`. */
export function safePct(num: number, den: number, fallback = 0): number {
  return safeDivide(num, den, fallback) * 100;
}

/** Sanitiza um número: NaN/Infinity → fallback. */
export function safeNumber(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Garante valor finito ≥ 0. Útil para denominadores estruturais (PL, Ativo, CI). */
export function safePositive(n: number, fallback = 1): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** Clampa valor finito a um range [min, max]. NaN/Infinity → fallback. */
export function clampFinite(n: number, min: number, max: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** True se array tem exatamente 12 posições, todas finitas. */
export function isMonths(v: unknown): v is number[] {
  if (!Array.isArray(v) || v.length !== 12) return false;
  for (let i = 0; i < 12; i++) {
    if (typeof v[i] !== "number" || !Number.isFinite(v[i])) return false;
  }
  return true;
}

/**
 * Coage qualquer entrada para um array Months[12] válido.
 *  - array curto: completa com `fill`
 *  - array longo: trunca em 12
 *  - número solto: replica em todas posições
 *  - NaN/Infinity em qualquer slot: vira `fill`
 *  - qualquer outra coisa: array de `fill`
 */
export function coerceMonths(v: unknown, fill = 0): number[] {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Array(12).fill(v);
  }
  if (!Array.isArray(v)) return Array(12).fill(fill);
  const out: number[] = new Array(12);
  for (let i = 0; i < 12; i++) {
    const raw = v[i];
    out[i] = typeof raw === "number" && Number.isFinite(raw) ? raw : fill;
  }
  return out;
}
