// =====================================================================
// KANITZ — Termômetro de Insolvência (Stephen Charles Kanitz, 1974/1978)
// Função pura. Não altera tipos/engine existentes — consome `Indicators`.
//
//   FI = 0,05·X1 + 1,65·X2 + 3,55·X3 − 1,06·X4 − 0,33·X5
//
//   X1 = Lucro Líquido / Patrimônio Líquido         (ROE em fração)
//   X2 = (AC + RLP) / (PC + ELP)                    (Liquidez Geral)
//   X3 = (AC − Estoques) / PC                       (Liquidez Seca)
//   X4 = AC / PC                                    (Liquidez Corrente)
//   X5 = (PC + ELP) / PL                            (Endiv. Terceiros/PL)
//
// Faixas de classificação (originais Kanitz):
//   FI ≥  0  → SOLVÊNCIA   (verde)
//  −3 ≤ FI < 0 → PENUMBRA  (âmbar) — zona cinzenta, exige atenção
//   FI < −3  → INSOLVÊNCIA (vermelho)
// =====================================================================
import type { AppState } from "./types";
import type { Indicators } from "./indicators";
import { safeDivide } from "./safeMath";
import { sumContractSaldos } from "./debtContracts";

export type KanitzStatus = "solvencia" | "penumbra" | "insolvencia" | "indisponivel";

export interface KanitzResult {
  /** Fator de Insolvência (FI). NaN quando base insuficiente. */
  fi: number;
  status: KanitzStatus;
  label: string;
  /** Cor semântica (token de design). */
  tone: "pos" | "warn" | "neg" | "muted";
  /** Insumos (frações/×) usados no cálculo. */
  x1: number;
  x2: number;
  x3: number;
  x4: number;
  x5: number;
  /** Contribuição ponderada de cada termo na soma final. */
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
  /** true quando faltam dados confiáveis (PL ≤ 0). */
  baseInsuficiente: boolean;
}

/** Teto técnico de liquidez em indicators.ts (CAP_LIQ). */
const LIQ_TETO = 99;

const W = { x1: 0.05, x2: 1.65, x3: 3.55, x4: -1.06, x5: -0.33 } as const;

export function calcKanitz(state: AppState, ind: Indicators): KanitzResult {
  const { capital } = state;
  const PL = Math.max(0, capital.patrimonioLiquido);

  // Sem PL positivo o modelo perde sentido econômico (denominador X1 e X5).
  // Liquidez no teto técnico (sem passivo circulante) ou negativa (ativo
  // circulante < 0) também: o índice explodiria (ex.: FI 159,99 na escala ±7).
  const liqInvalida = [ind.liquidezGeral, ind.liquidezSeca, ind.liquidezCorrente].some(
    (x) => !Number.isFinite(x) || x < 0 || x >= LIQ_TETO,
  );
  if (PL <= 0 || liqInvalida) {
    return {
      fi: NaN,
      status: "indisponivel",
      label: "Base insuficiente",
      tone: "muted",
      x1: 0,
      x2: 0,
      x3: 0,
      x4: 0,
      x5: 0,
      c1: 0,
      c2: 0,
      c3: 0,
      c4: 0,
      c5: 0,
      baseInsuficiente: true,
    };
  }

  // X1 — ROE em FRAÇÃO (ind.roe já vem em %). Null (PL ≤ 0) → 0 para não quebrar o score.
  const x1 = (ind.roe ?? 0) / 100;

  // X2/X3/X4 — já calculados na engine, em "× vezes" (ratio puro).
  const x2 = ind.liquidezGeral;
  const x3 = ind.liquidezSeca;
  const x4 = ind.liquidezCorrente;

  // X5 — Passivo de Terceiros / PL. Usa balanço quando informado;
  // senão, aproxima por (Dívida Onerosa + Passivos Não Onerosos) / PL.
  const pno = Math.max(0, capital.passivosNaoOnerosos ?? capital.fornecedores ?? 0);
  const D = Math.max(0, sumContractSaldos(capital.debtContracts));
  const passivoTerceiros = capital.ativoTotal > PL ? capital.ativoTotal - PL : D + pno;
  const x5 = safeDivide(passivoTerceiros, PL);

  const c1 = W.x1 * x1;
  const c2 = W.x2 * x2;
  const c3 = W.x3 * x3;
  const c4 = W.x4 * x4;
  const c5 = W.x5 * x5;
  const fi = c1 + c2 + c3 + c4 + c5;

  let status: KanitzStatus;
  let label: string;
  let tone: KanitzResult["tone"];
  if (fi >= 0) {
    status = "solvencia";
    label = "Solvência";
    tone = "pos";
  } else if (fi >= -3) {
    status = "penumbra";
    label = "Penumbra";
    tone = "warn";
  } else {
    status = "insolvencia";
    label = "Insolvência";
    tone = "neg";
  }

  return {
    fi,
    status,
    label,
    tone,
    x1,
    x2,
    x3,
    x4,
    x5,
    c1,
    c2,
    c3,
    c4,
    c5,
    baseInsuficiente: false,
  };
}

/** Memória de cálculo formatada (pt-BR) para tooltip/expansor. */
export function kanitzCalcMemo(k: KanitzResult): string {
  if (k.baseInsuficiente)
    return "Base insuficiente — informe Patrimônio Líquido > 0 e o circulante (caixa, contas a receber, fornecedores) no Balanço.";
  const f = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return [
    `X1 (LL/PL)        = ${f(k.x1)}  ×  0,05  = ${f(k.c1)}`,
    `X2 (Liq. Geral)   = ${f(k.x2)}  ×  1,65  = ${f(k.c2)}`,
    `X3 (Liq. Seca)    = ${f(k.x3)}  ×  3,55  = ${f(k.c3)}`,
    `X4 (Liq. Corr.)   = ${f(k.x4)}  × −1,06  = ${f(k.c4)}`,
    `X5 (PT/PL)        = ${f(k.x5)}  × −0,33  = ${f(k.c5)}`,
    `FI = ${f(k.fi)}`,
  ].join("\n");
}
