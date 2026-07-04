// Análise de covenants e risco de default.
//
// Avalia métricas-chave de risco contra covenants contratuais (default: padrões
// bancários PME — DSCR≥1.25, D/EBITDA≤3.0, LiqCorr≥1.5, D/PL≤2.0). Calcula
// score de risco 0–10 e estima dias até default a partir do fluxo de caixa
// mensal (primeiro mês em que o saldo final cruza zero).

import { totalDividaOnerosa } from "./debtContracts";
import type { AppState } from "./types";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { buildCashFlow } from "./cashflow";
import { resolveEffectiveRegime } from "./regime";

export interface CovenantSpec {
  /** DSCR mínimo (>=). Default 1.25. */
  dscrMin?: number;
  /** Dívida Líquida / EBITDA máximo (<=). Default 3.0. */
  dEbitdaMax?: number;
  /** Liquidez Corrente mínima (>=). Default 1.5. */
  liqCorrMin?: number;
  /** Dívida / Patrimônio Líquido máximo (<=). Default 2.0. */
  dPlMax?: number;
}

export type CovenantStatus = "GREEN" | "YELLOW" | "RED";

export interface CovenantCheck {
  covenant: string;
  metrica: string;
  valor: number;
  limite: number;
  /** Tipo de comparação: ">=" (valor deve ser ≥ limite) ou "<=". */
  direcao: ">=" | "<=";
  status: CovenantStatus;
  /** Distância relativa do limite, em %. Positivo = folga; negativo = breach. */
  folgaPct: number;
}

export interface CovenantsResult {
  cenario: "base" | "simulado";
  checks: CovenantCheck[];
  /** Score 0–10. 0 = sem risco; 10 = breach total em todas. */
  scoreRisco: number;
  classificacao: "BAIXO" | "MEDIO" | "ALTO" | "CRITICO";
  /** Mês (1-12) em que o saldo final cruza zero pela 1ª vez. */
  mesDefault: number | null;
  /** Estimativa de dias até default (mes_default × 30). null = sem risco no ano. */
  diasParaDefault: number | null;
}

const DEFAULT_COVENANTS: Required<CovenantSpec> = {
  dscrMin: 1.25,
  dEbitdaMax: 3.0,
  liqCorrMin: 1.5,
  dPlMax: 2.0,
};

/** Avalia um covenant e devolve status (RED/YELLOW/GREEN) + folga %. */
function evaluate(
  valor: number,
  limite: number,
  direcao: ">=" | "<=",
): { status: CovenantStatus; folgaPct: number } {
  // folga relativa positiva = OK; negativa = breach. Banda amarela: ±10%.
  const folga =
    direcao === ">="
      ? limite !== 0
        ? ((valor - limite) / Math.abs(limite)) * 100
        : valor >= 0
          ? 100
          : -100
      : limite !== 0
        ? ((limite - valor) / Math.abs(limite)) * 100
        : valor <= 0
          ? 100
          : -100;
  let status: CovenantStatus = "GREEN";
  if (folga < 0) status = "RED";
  else if (folga < 10) status = "YELLOW";
  return { status, folgaPct: folga };
}

export function analyzeCovenants(
  state: AppState,
  spec: CovenantSpec = {},
  cenario: "base" | "simulado" = "base",
): CovenantsResult {
  const c = { ...DEFAULT_COVENANTS, ...spec };
  const { dre } = buildDRE(state, resolveEffectiveRegime(state));
  const ind = calcIndicators(state, dre);
  const cf = buildCashFlow(state);

  const dividaOnerosa = Math.max(0, totalDividaOnerosa(state));
  const pl = Math.max(0, state.capital.patrimonioLiquido);
  const dPl = pl > 0 ? dividaOnerosa / pl : dividaOnerosa > 0 ? 99 : 0;

  const checks: CovenantCheck[] = [
    {
      covenant: `DSCR ≥ ${c.dscrMin.toFixed(2)}x`,
      metrica: "DSCR",
      valor: ind.dscr,
      limite: c.dscrMin,
      direcao: ">=",
      ...evaluate(ind.dscr, c.dscrMin, ">="),
    },
    {
      covenant: `Dívida Líq / EBITDA ≤ ${c.dEbitdaMax.toFixed(1)}x`,
      metrica: "DL/EBITDA",
      valor: ind.dividaLiqEbitda,
      limite: c.dEbitdaMax,
      direcao: "<=",
      ...evaluate(ind.dividaLiqEbitda, c.dEbitdaMax, "<="),
    },
    {
      covenant: `Liquidez Corrente ≥ ${c.liqCorrMin.toFixed(2)}`,
      metrica: "Liq. Corrente",
      valor: ind.liquidezCorrente,
      limite: c.liqCorrMin,
      direcao: ">=",
      ...evaluate(ind.liquidezCorrente, c.liqCorrMin, ">="),
    },
    {
      covenant: `Dívida / PL ≤ ${c.dPlMax.toFixed(1)}x`,
      metrica: "D/PL",
      valor: dPl,
      limite: c.dPlMax,
      direcao: "<=",
      ...evaluate(dPl, c.dPlMax, "<="),
    },
  ];

  // Score 0–10: RED=3pts, YELLOW=1pt, GREEN=0. Máx = 4×3 = 12 → normaliza para 10.
  const raw = checks.reduce(
    (s, ck) => s + (ck.status === "RED" ? 3 : ck.status === "YELLOW" ? 1 : 0),
    0,
  );
  const scoreRisco = Math.min(10, Math.round((raw / 12) * 10));
  const classificacao: CovenantsResult["classificacao"] =
    scoreRisco >= 8 ? "CRITICO" : scoreRisco >= 5 ? "ALTO" : scoreRisco >= 2 ? "MEDIO" : "BAIXO";

  // Mês de default: primeiro saldo final < 0.
  let mesDefault: number | null = null;
  for (let i = 0; i < cf.saldoFinal.length; i++) {
    if (Number.isFinite(cf.saldoFinal[i]) && cf.saldoFinal[i] < 0) {
      mesDefault = i + 1;
      break;
    }
  }
  const diasParaDefault = mesDefault ? mesDefault * 30 : null;

  return {
    cenario,
    checks,
    scoreRisco,
    classificacao,
    mesDefault,
    diasParaDefault,
  };
}

/** Formata como markdown para a IA citar números. */
export function covenantsToMarkdown(r: CovenantsResult): string {
  const icon = (s: CovenantStatus) =>
    s === "GREEN" ? "🟢" : s === "YELLOW" ? "🟡" : "🔴";
  const fmtVal = (m: string, v: number) => {
    if (m.includes("DSCR") || m.includes("/EBITDA") || m.includes("D/PL")) return `${v.toFixed(2)}x`;
    if (m.includes("Liq")) return v.toFixed(2);
    return v.toFixed(2);
  };
  const lines: string[] = [];
  lines.push(`## Análise de Covenants — cenário ${r.cenario}`);
  lines.push("");
  lines.push("| Covenant | Valor | Status | Folga |");
  lines.push("| --- | ---: | :---: | ---: |");
  for (const ck of r.checks) {
    lines.push(
      `| ${ck.covenant} | ${fmtVal(ck.metrica, ck.valor)} | ${icon(ck.status)} ${ck.status} | ${ck.folgaPct >= 0 ? "+" : ""}${ck.folgaPct.toFixed(1)}% |`,
    );
  }
  lines.push("");
  lines.push(`**Score de Risco:** ${r.scoreRisco}/10 → **${r.classificacao}**`);
  if (r.diasParaDefault != null) {
    lines.push(
      `**Timeline de default:** caixa fura no mês ${r.mesDefault} (~${r.diasParaDefault} dias). Ação imediata necessária.`,
    );
  } else {
    lines.push(`**Timeline de default:** sem cruzamento de zero no horizonte de 12 meses. ✅`);
  }
  return lines.join("\n");
}
