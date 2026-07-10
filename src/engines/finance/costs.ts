// =====================================================================
// CUSTOS — helpers puros de classificação e normalização mensal
// =====================================================================
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// `folhaAnual` permanece em ./regime.ts para evitar ciclo de imports
// (regime ↔ folha ↔ effectiveMonthValues).

import { CostLine, TaxRegime, DEFAULT_ENCARGOS_PCT } from "./types";
import { fill12 } from "./format";
import { DEFAULT_ENCARGOS_PCT_SIMPLES } from "./taxDefaults";
import {
  calcularCustoFuncionario,
  type GrauRAT,
} from "@/engines/calculadoras/custoFuncionario";

/** Classificação canônica: linhas que compõem o CPV/CMV/CSP (geram crédito tributário
 *  e escalam com receita no forecast). Usado em buildDRE, calcReal e forecast. */
export function isCpvCost(c: CostLine): boolean {
  return c.category === "custo_vendas" || c.category === "direto_venda";
}

// =====================================================================
// FOLHA / PESSOAL — regexes canônicos (SSOT). Reusados por regime.ts
// (folhaAnual, Fator R) e por isCreditoAmploCbsIbs (LC 214/2025).
// Mantidos AQUI para evitar ciclo de imports com regime.ts.
// =====================================================================
export const LABOR_INCLUDE_RE =
  /sal[áa]rio|folha|pr[óo]\s*-?\s*labore|prolabore|\bmod\b|m[ãa]o\s*de\s*obra|m\.o\.|\bclt\b|benef[íi]cio|\bplr\b|participa[çc][ãa]o.*lucro|terceiriz/i;
export const DISTRIBUICAO_SOCIO_RE =
  /s[óo]ci[oa]s?|acionist|cotist|dividendo|distribui[çc][ãa]o.*(lucro|result)|lucro.*distribu/i;
export const LABOR_EXCLUDE_RE = /comiss[ãa]o|comiss[õo]es/i;

/** True se a linha representa gasto com PESSOAL (folha, pró-labore, benefícios,
 *  MO terceirizada). NÃO entra em crédito de CBS/IBS (LC 214/2025 art. 57). */
export function isLaborLine(c: CostLine): boolean {
  if (LABOR_EXCLUDE_RE.test(c.label)) return false; // comissões nunca são folha
  if (DISTRIBUICAO_SOCIO_RE.test(c.label)) return false; // distribuição a sócio ≠ folha
  return !!c.encargosAuto || LABOR_INCLUDE_RE.test(c.label);
}

/** Linhas de folha (SSOT — reusado por Fator R, abertura e balanço de fechamento).
 *  Combina o flag `encargosAuto` OU o rótulo canônico (folha/salário/pró-labore),
 *  excluindo despesas financeiras. */
export function isFolhaCost(c: CostLine): boolean {
  if (c.category === "financeiro") return false;
  return isLaborLine(c);
}

/**
 * Base de crédito CBS/IBS (LC 214/2025 arts. 47-56 — não-cumulatividade AMPLA).
 * INCLUI: praticamente todo insumo/despesa operacional (CPV, aluguel, energia,
 * frete, serviços tomados, marketing, TI, etc.).
 * EXCLUI:
 *   (a) Folha/pessoal (art. 57) — salários, pró-labore, benefícios, MO terceirizada
 *   (b) Despesas financeiras (juros de dívida não geram crédito)
 *   (c) Linhas marcadas `semCredito` (uso e consumo pessoal, ICMS-ST embutido, etc.)
 */
export function isCreditoAmploCbsIbs(c: CostLine): boolean {
  if (c.semCredito) return false;
  if (c.category === "financeiro") return false;
  if (isLaborLine(c)) return false;
  return true;
}


/** Despesa Administrativa (função CPC 26). Aceita o alias legado `fixo`. */
export function isAdminCost(c: CostLine): boolean {
  return c.category === "despesa_administrativa" || c.category === "fixo";
}

/** Despesa Comercial / Vendas (função CPC 26). Aceita o alias legado `variavel`. */
export function isComercialCost(c: CostLine): boolean {
  return c.category === "despesa_comercial" || c.category === "variavel";
}

/** Despesa Financeira (Resultado Financeiro pós-EBIT). */
export function isFinanceiroCost(c: CostLine): boolean {
  return c.category === "financeiro";
}

export function fixedCostBase(values: number[]): number {
  const normalized = values.length === 12 ? values : fill12(values[0] || 0);

  const first = normalized[0] || 0;
  // Se todos os meses são iguais, retorna o valor.
  if (normalized.every((v) => v === first)) return first;
  // Caso contrário (estado inconsistente para um custo marcado fixo),
  // adota a edição mais recente — varre do mês 12 para trás procurando
  // o último valor distinto do anterior. Generaliza o antigo heurístico
  // que só detectava alteração no mês 12.
  for (let i = normalized.length - 1; i > 0; i--) {
    if (normalized[i] !== normalized[i - 1]) return normalized[i] || 0;
  }
  return normalized[normalized.length - 1] || first;
}

/**
 * Opções para cálculo do fator patronal CLT — regime-aware.
 * Ampliação do antigo `DEFAULT_ENCARGOS_PCT` (constante fixa) para consumir
 * o SSOT único da calculadora `calcularCustoFuncionario`, respeitando:
 *  - Simples I/II/III/V (CPP embutida no DAS → fator ~1,36)
 *  - Simples IV (CPP à parte → fator ~1,72, antes subestimado)
 *  - Presumido/Real (fator ~1,72)
 */
export interface EncargosOpts {
  simplesAnexo?: "I" | "II" | "III" | "IV" | "V";
  grauRAT?: GrauRAT;
  /** Alíquota de Terceiros/Sistema S (default 5,8%). */
  aliquotaTerceiros?: number;
}

// Cache do fator por combinação (regime|anexo|rat|terceiros).
const _fatorCache = new Map<string, number>();

/**
 * Fator patronal CLT (encargos + provisões) em %, sobre o salário bruto.
 * Retorna, por exemplo, 72 para Presumido/Real (custo = salário × 1,72).
 * SSOT único — delega para `calcularCustoFuncionario`.
 */
export function fatorEncargosCLT(regime: TaxRegime, opts: EncargosOpts = {}): number {
  const grauRAT: GrauRAT = opts.grauRAT ?? 1;
  const aliquotaTerceiros = opts.aliquotaTerceiros ?? 0.058;
  const anexoIV = opts.simplesAnexo === "IV";
  const key = `${regime}|${anexoIV ? "IV" : "geral"}|${grauRAT}|${aliquotaTerceiros}`;
  const cached = _fatorCache.get(key);
  if (cached !== undefined) return cached;

  // Regime da calculadora só distingue simples/presumido/real.
  const regimeCalc = regime === "simples" ? "simples" : regime === "real" ? "real" : "presumido";
  const out = calcularCustoFuncionario({
    salarioBruto: 1000,
    regime: regimeCalc,
    simplesAnexoIV: anexoIV,
    grauRAT,
    aliquotaTerceiros,
    beneficios: { vt: { ativo: false, custoMensal: 0 }, vr: 0, planoSaude: 0, outros: 0 },
  });
  // fatorMultiplicador inclui o salário (1,00). Encargos = (fator − 1) × 100.
  const pct = (out.fatorMultiplicador - 1) * 100;
  _fatorCache.set(key, pct);
  return pct;
}

export function effectiveMonthValues(
  c: CostLine,
  regime?: TaxRegime,
  opts?: EncargosOpts,
): number[] {
  const raw = c.fixed ? fill12(fixedCostBase(c.values)) : c.values.slice();
  if (c.encargosAuto) {
    let ratePct: number;
    if (c.encargosPct != null) {
      // Override manual do consultor — respeita.
      ratePct = c.encargosPct;
    } else if (regime) {
      // SSOT: fator regime-aware via calculadora CLT.
      ratePct = fatorEncargosCLT(regime, opts);
    } else {
      // Fallback legado quando o regime não é conhecido no call-site.
      ratePct = DEFAULT_ENCARGOS_PCT;
    }
    // Preserva a constante legada apenas como fallback (evita "unused import").
    void DEFAULT_ENCARGOS_PCT_SIMPLES;
    const factor = 1 + ratePct / 100;
    return raw.map((v) => v * factor);
  }
  return raw;
}

/** Mantido para retro-compatibilidade — agora aplica encargos. */
export function monthValues(c: CostLine, regime?: TaxRegime, opts?: EncargosOpts): number[] {
  return effectiveMonthValues(c, regime, opts);
}
