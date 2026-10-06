// ============================================================================
// Retroteste das premissas de projeção contra o realizado do Odoo.
//
// Com 24 meses no retrato: monta o estado do 1º ano (como se fosse "hoje" no
// fim dele), projeta 12 meses com o motor de projeção e compara mês a mês com
// o que de fato aconteceu no 2º ano. Ao lado, o modelo ingênuo "repetir o ano
// anterior", para saber se as premissas acrescentam informação.
// ============================================================================
import { buildForecast, type ForecastConfig } from "@/engines/finance/forecast";
import type { AppState } from "@/engines/finance/types";
import {
  anchorOdooState,
  applyOdooOverlay,
  buildEntityData,
  prepareOdooOverlay,
  suggestPremissas,
  type OdooEntity,
} from "./toAppState";
import type { OdooSnapshot, PlLine } from "./types";

export type BacktestMetric = {
  metrica: "Receita bruta" | "EBITDA" | "Lucro líquido";
  previsto: number;
  realizado: number;
  /** (previsto − realizado) / |realizado|, em %. */
  erroPct: number | null;
};

export type BacktestResult =
  | { disponivel: false; motivo: string }
  | {
      disponivel: true;
      base: { inicio: string; fim: string };
      teste: { inicio: string; fim: string };
      metricas: BacktestMetric[];
      /** Erro percentual absoluto médio da receita mês a mês. */
      mapeReceita: number;
      /** O mesmo para "repetir o ano anterior". */
      mapeIngenuo: number;
      meses: Array<{ mes: string; previsto: number; realizado: number; ingenuo: number }>;
    };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

const OPEX: PlLine[] = [
  "deducoes",
  "impostos_vendas",
  "cpv",
  "pessoal_salarios",
  "pessoal_encargos",
  "pessoal_beneficios",
  "despesa_administrativa",
  "despesa_comercial",
];

function erro(previsto: number, realizado: number): number | null {
  return Math.abs(realizado) > 0.005
    ? r2(((previsto - realizado) / Math.abs(realizado)) * 100)
    : null;
}

function mape(previsto: number[], realizado: number[]): number {
  const pares = realizado
    .map((r, i) => [previsto[i], r] as const)
    .filter(([, r]) => Math.abs(r) > 0.005);
  if (!pares.length) return 0;
  return r2((sum(pares.map(([p, r]) => Math.abs(p - r) / Math.abs(r))) / pares.length) * 100);
}

export function backtest(
  snapshot: OdooSnapshot,
  entity: OdooEntity,
  base: AppState,
  cfg: ForecastConfig,
  endMonth?: string | null,
): BacktestResult {
  const teste = buildEntityData(snapshot, entity, endMonth);
  const fimTeste = snapshot.months.indexOf(teste.months[teste.months.length - 1]);
  const fimBase = fimTeste - 12;
  if (teste.months.length < 12 || fimBase - 11 < 0)
    return { disponivel: false, motivo: "São necessários 24 meses de histórico no Odoo." };
  const anoBase = buildEntityData(snapshot, entity, snapshot.months[fimBase]);
  const receitaBase = anoBase.actuals.pl.receita_bruta;
  if (sum(receitaBase) <= 0)
    return { disponivel: false, motivo: "Sem receita no ano anterior para servir de base." };

  const estado = anchorOdooState(
    applyOdooOverlay(suggestPremissas(base, anoBase), prepareOdooOverlay(anoBase)),
  );
  const proj = buildForecast(estado, { ...cfg, horizonteMeses: 12, capexInicial: 0 }).meses;

  const pl = teste.actuals.pl;
  const receitaReal = pl.receita_bruta;
  const ebitdaReal = receitaReal.map((rb, i) => rb - sum(OPEX.map((k) => pl[k][i] ?? 0)));
  const lucroReal = teste.actuals.resultadoMensal;
  const prev = (k: "receita" | "ebitda" | "lucroLiquido") => proj.map((m) => m[k]);

  const metrica = (nome: BacktestMetric["metrica"], p: number[], r: number[]): BacktestMetric => ({
    metrica: nome,
    previsto: r2(sum(p)),
    realizado: r2(sum(r)),
    erroPct: erro(sum(p), sum(r)),
  });

  return {
    disponivel: true,
    base: { inicio: anoBase.months[0], fim: anoBase.months[anoBase.months.length - 1] },
    teste: { inicio: teste.months[0], fim: teste.months[teste.months.length - 1] },
    metricas: [
      metrica("Receita bruta", prev("receita"), receitaReal),
      metrica("EBITDA", prev("ebitda"), ebitdaReal),
      metrica("Lucro líquido", prev("lucroLiquido"), lucroReal),
    ],
    mapeReceita: mape(prev("receita"), receitaReal),
    mapeIngenuo: mape(receitaBase, receitaReal),
    meses: teste.months.map((mes, i) => ({
      mes,
      previsto: r2(proj[i]?.receita ?? 0),
      realizado: r2(receitaReal[i] ?? 0),
      ingenuo: r2(receitaBase[i] ?? 0),
    })),
  };
}
