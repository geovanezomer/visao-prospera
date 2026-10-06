// =====================================================================
// Resposta Auditável — verificação determinística dos números citados
// pela IA contra os payloads reais das tools da conversa.
//
// Zero LLM: apenas regex pt-BR + comparação numérica com tolerância.
// Um número citado é "verified" se aparece em algum payload de tool com:
//   - moeda: tolerância relativa 0,5% OU absoluta 1
//   - percentual: tolerância absoluta 0,1 p.p.
//
// Regra 12 do prompt diz que a IA não calcula. Esta camada não bloqueia
// a resposta — apenas ANOTA, para o consultor CVM poder auditar antes de
// apresentar ao cliente.
// =====================================================================

export type NumberKind = "currency" | "percent";

export interface CitedNumber {
  raw: string;
  value: number;
  kind: NumberKind;
  start: number;
  end: number;
}

export interface VerificationResult {
  verified: CitedNumber[];
  unverified: CitedNumber[];
  /** verified / (verified+unverified) × 100 — 100 quando não há números. */
  coveragePct: number;
}

// -------------------- Regex --------------------
// Moeda pt-BR: "R$ 1.234.567,89" | "R$-1.500" | "R$ 12"
const RE_CURRENCY = /R\$\s?-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?/g;
// Percentual pt-BR: "18,2%" | "3 p.p." | "-1,5%"
const RE_PERCENT = /-?\d{1,3}(?:,\d{1,2})?\s?(?:%|p\.p\.)/g;
// Números crus (payload): "487320", "487.320,60", "18.2", "0,15"
const RE_RAW_NUMBER = /-?\d+(?:[.,]\d+)?/g;

// Blocos a ignorar na resposta do assistente:
// - ```finance-chart ...``` (dados de gráfico já vêm da engine)
// - qualquer bloco ``` ... ``` (código/tabelas literais de payload)
// - tabelas markdown | ... | (payload literal citado)
const RE_CODE_BLOCK = /```[\s\S]*?```/g;
const RE_MD_TABLE_ROW = /^\s*\|.*\|\s*$/gm;

/** Remove trechos que não devem ser extraídos como citação. */
function stripNonCitationBlocks(text: string): string {
  return text
    .replace(RE_CODE_BLOCK, (m) => " ".repeat(m.length)) // preserva offsets
    .replace(RE_MD_TABLE_ROW, (m) => " ".repeat(m.length));
}

/** "1.234.567,89" → 1234567.89 ; "18,2" → 18.2 ; "487320" → 487320 */
function parsePtBrNumber(s: string): number {
  const cleaned = s
    .replace(/[R$\s%]/g, "")
    .replace(/p\.p\./g, "")
    .trim();
  // Se tem "," ela é o decimal e "." é milhar
  if (cleaned.includes(",")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  // Sem vírgula: "." pode ser decimal ("18.2") OU milhar ("487.320").
  // Heurística: se há um único "." com 1-2 dígitos depois, é decimal.
  const dotMatch = cleaned.match(/^-?\d+\.(\d+)$/);
  if (dotMatch && dotMatch[1].length <= 2) return Number(cleaned);
  return Number(cleaned.replace(/\./g, ""));
}

// -------------------- Extração --------------------

/** Extrai todos os valores monetários e percentuais citados no texto. */
export function extractNumbers(text: string): CitedNumber[] {
  const scrubbed = stripNonCitationBlocks(text);
  const out: CitedNumber[] = [];

  for (const m of scrubbed.matchAll(RE_CURRENCY)) {
    const raw = m[0];
    const value = parsePtBrNumber(raw);
    if (Number.isFinite(value)) {
      out.push({ raw, value, kind: "currency", start: m.index!, end: m.index! + raw.length });
    }
  }
  for (const m of scrubbed.matchAll(RE_PERCENT)) {
    const raw = m[0];
    const value = parsePtBrNumber(raw);
    if (Number.isFinite(value)) {
      out.push({ raw, value, kind: "percent", start: m.index!, end: m.index! + raw.length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Extrai TODOS os números dos payloads das tools — formatados ou crus.
 * Retorna Set<number> para lookup O(1) na verificação (aproximada por tolerância).
 */
export function extractNumbersFromPayloads(toolResults: string[]): number[] {
  const values: number[] = [];
  for (const payload of toolResults) {
    if (!payload) continue;
    for (const m of payload.matchAll(RE_CURRENCY)) {
      const v = parsePtBrNumber(m[0]);
      if (Number.isFinite(v)) values.push(v);
    }
    for (const m of payload.matchAll(RE_PERCENT)) {
      const v = parsePtBrNumber(m[0]);
      if (Number.isFinite(v)) values.push(v);
    }
    // Números crus (sem R$/%): capturam valores em tabelas/JSON dos payloads.
    // Ambíguo: "487.320" pode ser milhar OU decimal. Empurramos as duas
    // interpretações para o pool — a comparação com tolerância descarta a errada.
    for (const m of payload.matchAll(RE_RAW_NUMBER)) {
      const raw = m[0];
      const asPtBr = parsePtBrNumber(raw);
      if (Number.isFinite(asPtBr)) values.push(asPtBr);
      // Interpretação alternativa: "." como separador decimal cru (ex.: JSON "0.182").
      const asPlain = Number(raw.replace(/,/g, "."));
      if (Number.isFinite(asPlain) && asPlain !== asPtBr) values.push(asPlain);
    }
  }
  return values;
}

// -------------------- Comparação --------------------

function matchesCurrency(cited: number, pool: number[]): boolean {
  const absTol = 1;
  const relTol = 0.005; // 0,5%
  for (const p of pool) {
    if (Math.abs(cited - p) <= absTol) return true;
    const denom = Math.max(Math.abs(cited), Math.abs(p));
    if (denom > 0 && Math.abs(cited - p) / denom <= relTol) return true;
  }
  return false;
}

function matchesPercent(cited: number, pool: number[]): boolean {
  const absTol = 0.1; // 0,1 p.p.
  for (const p of pool) {
    if (Math.abs(cited - p) <= absTol) return true;
    // Payloads podem trazer o percentual como fração (0,182 vs 18,2%).
    if (Math.abs(cited - p * 100) <= absTol) return true;
  }
  return false;
}

/** Verifica todos os números citados na resposta contra os payloads. */
export function verifyResponse(responseText: string, toolResults: string[]): VerificationResult {
  const cited = extractNumbers(responseText);
  const pool = extractNumbersFromPayloads(toolResults);
  const verified: CitedNumber[] = [];
  const unverified: CitedNumber[] = [];
  for (const c of cited) {
    const ok =
      c.kind === "currency" ? matchesCurrency(c.value, pool) : matchesPercent(c.value, pool);
    (ok ? verified : unverified).push(c);
  }
  const total = verified.length + unverified.length;
  const coveragePct = total === 0 ? 100 : Math.round((verified.length / total) * 1000) / 10;
  return { verified, unverified, coveragePct };
}
