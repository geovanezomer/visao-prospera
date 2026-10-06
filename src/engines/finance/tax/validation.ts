/**
 * Validação de faixas legais para inputs tributários.
 *
 * Cada campo tem duas faixas:
 * - [min, max]:            faixa HARD (fora → erro, valor bloqueado / clampado na engine)
 * - [legalMin, legalMax]:  faixa DENTRO da lei vigente (fora → apenas aviso)
 *
 * A UI (FriendlyRow) usa `validateTaxOverride` para bloquear valores impossíveis
 * e avisar quando o consultor sai da faixa legal usual. A engine (taxDefaults.ts)
 * usa `clampFaixa` como defesa em profundidade — mesmo snapshot corrompido não
 * injeta alíquota absurda.
 */
import { z } from "zod";

export interface FaixaLegal {
  min: number;
  max: number;
  /** Faixa DENTRO da lei — fora dela é warning, não erro. */
  legalMin?: number;
  legalMax?: number;
  label: string;
}

export type NivelValidacao = "erro" | "aviso" | "ok";
export interface ResultadoValidacao {
  ok: boolean;
  nivel: NivelValidacao;
  msg?: string;
}

/**
 * Faixas tributárias — SSOT das regras de sanidade de alíquotas/bases.
 * A chave é o identificador do campo (bate com override e getter).
 */
export const FAIXAS_TRIBUTARIAS = {
  irpj: { min: 0, max: 40, legalMin: 15, legalMax: 15, label: "IRPJ" },
  irpjAdicional: { min: 0, max: 20, legalMin: 10, legalMax: 10, label: "Adicional IRPJ" },
  irpjAdicionalGatilhoTri: {
    min: 0,
    max: 1_000_000,
    legalMin: 60_000,
    legalMax: 60_000,
    label: "Gatilho trimestral do Adicional IRPJ",
  },
  csll: { min: 0, max: 20, legalMin: 9, legalMax: 9, label: "CSLL" },
  pisCum: { min: 0, max: 5, legalMin: 0.65, legalMax: 0.65, label: "PIS cumulativo" },
  cofinsCum: { min: 0, max: 10, legalMin: 3, legalMax: 3, label: "COFINS cumulativo" },
  pisNaoCum: { min: 0, max: 5, legalMin: 1.65, legalMax: 1.65, label: "PIS não-cumulativo" },
  cofinsNaoCum: { min: 0, max: 12, legalMin: 7.6, legalMax: 7.6, label: "COFINS não-cumulativo" },
  iss: { min: 0, max: 25, legalMin: 2, legalMax: 5, label: "ISS (LC 116: 2% a 5%)" },
  cbsAliquota: { min: 0, max: 20, legalMin: 8, legalMax: 10, label: "CBS" },
  ibsAliquotaRef: { min: 0, max: 30, legalMin: 15, legalMax: 20, label: "IBS" },
  presumidoBaseIRPJ: {
    min: 0,
    max: 100,
    legalMin: 1.6,
    legalMax: 32,
    label: "Base presunção IRPJ",
  },
  presumidoBaseCSLL: { min: 0, max: 100, legalMin: 12, legalMax: 32, label: "Base presunção CSLL" },
  fatorRMinimo: { min: 0, max: 100, legalMin: 28, legalMax: 28, label: "Fator R mínimo" },
} as const satisfies Record<string, FaixaLegal>;

export type CampoTributario = keyof typeof FAIXAS_TRIBUTARIAS;

/** Schema Zod correspondente — todos opcionais, cada um limitado ao [min,max] da faixa. */
export const taxOverridesSchema = z.object(
  Object.fromEntries(
    Object.entries(FAIXAS_TRIBUTARIAS).map(([campo, f]) => [
      campo,
      z
        .number()
        .min(f.min, { message: `${f.label}: mínimo ${f.min}` })
        .max(f.max, { message: `${f.label}: máximo ${f.max}` })
        .optional(),
    ]),
  ) as Record<CampoTributario, z.ZodOptional<z.ZodNumber>>,
);

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toString() : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Valida um campo tributário isolado. Retorna nível + mensagem para a UI. */
export function validateTaxOverride(campo: string, valor: number): ResultadoValidacao {
  const f = (FAIXAS_TRIBUTARIAS as Record<string, FaixaLegal | undefined>)[campo];
  if (!f) return { ok: true, nivel: "ok" }; // campo desconhecido: não bloqueia
  if (!Number.isFinite(valor)) {
    return { ok: false, nivel: "erro", msg: `${f.label}: informe um número válido.` };
  }
  if (valor < f.min || valor > f.max) {
    return {
      ok: false,
      nivel: "erro",
      msg: `${f.label}: valor deve estar entre ${fmt(f.min)} e ${fmt(f.max)}.`,
    };
  }
  const lo = f.legalMin;
  const hi = f.legalMax;
  const foraDaLei = (lo !== undefined && valor < lo) || (hi !== undefined && valor > hi);
  if (foraDaLei) {
    const faixaTxt =
      lo !== undefined && hi !== undefined && lo === hi
        ? `${fmt(lo)}`
        : `${fmt(lo ?? f.min)}–${fmt(hi ?? f.max)}`;
    return {
      ok: true,
      nivel: "aviso",
      msg: `${f.label}: fora da faixa legal usual (${faixaTxt}). Confirme a base normativa.`,
    };
  }
  return { ok: true, nivel: "ok" };
}

/** Clampa um valor à faixa HARD [min,max] do campo. Defesa em profundidade
 *  usada nos getters da engine para blindar snapshots corrompidos. */
export function clampFaixa(valor: number, faixa: FaixaLegal): number {
  if (!Number.isFinite(valor)) return faixa.min;
  return Math.min(faixa.max, Math.max(faixa.min, valor));
}

/** Helper: clampa por chave da tabela — usado nos getters. */
export function clampCampo(campo: CampoTributario, valor: number): number {
  return clampFaixa(valor, FAIXAS_TRIBUTARIAS[campo]);
}
