import { AppState } from "./types";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { resolveEffectiveRegime } from "./regime";
import { buildCashFlow } from "./cashflow";
import { sum } from "./format";

export type DriverKey = "preco" | "volume" | "cpv" | "folha" | "fixos" | "juros";

const DRIVER_LABEL: Record<DriverKey, string> = {
  preco: "Preço de venda",
  volume: "Volume / Demanda",
  cpv: "Custo de Vendas (CMV/CPV/CSP)",
  folha: "Folha CLT (com encargos)",
  fixos: "Custos Fixos não-folha",
  juros: "Despesas Financeiras",
};

const LABOR_RE = /sal[áa]rio|folha|clt|prolabore|pró-labore|mod|mão de obra/i;

export function applyDriver(state: AppState, driver: DriverKey, deltaPct: number): AppState {
  const f = 1 + deltaPct / 100;
  if (driver === "preco") {
    // preço sobe receita e mantém custos
    return {
      ...state,
      revenue: { ...state.revenue, bruta: state.revenue.bruta.map((v) => v * f) },
    };
  }
  if (driver === "volume") {
    // volume sobe receita e custos variáveis proporcionalmente.
    // Inclui `direto_venda` (CPV de serviços/comércio) — auditoria bug #1.
    const costs = state.costs.map((c) =>
      c.category === "custo_vendas" ||
      c.category === "direto_venda" ||
      c.category === "variavel" ||
      c.category === "despesa_comercial"
        ? { ...c, values: c.values.map((v) => v * f) }
        : c,
    );
    return {
      ...state,
      costs,
      revenue: { ...state.revenue, bruta: state.revenue.bruta.map((v) => v * f) },
    };
  }
  const costs = state.costs.map((c) => {
    const isLabor = c.encargosAuto || LABOR_RE.test(c.label);
    let hit = false;
    if (driver === "cpv" && (c.category === "custo_vendas" || c.category === "direto_venda"))
      hit = true;
    if (driver === "folha" && isLabor) hit = true;
    if (
      driver === "fixos" &&
      (c.category === "fixo" || c.category === "despesa_administrativa") &&
      !isLabor
    )
      hit = true;
    if (driver === "juros" && c.category === "financeiro") hit = true;
    return hit ? { ...c, values: c.values.map((v) => v * f) } : c;
  });
  return { ...state, costs };
}

export interface SensitivityRow {
  driver: DriverKey;
  label: string;
  baseline: number; // valor base do output
  cells: { deltaPct: number; value: number; pctChange: number }[];
  elasticity: number; // % do output / % do input (média dos cells ≠ 0)
}

export type OutputKey = "ebitda" | "lucroLiquido" | "saldoCaixa" | "roic";

const OUTPUT_LABEL: Record<OutputKey, string> = {
  ebitda: "EBITDA",
  lucroLiquido: "Lucro Líquido",
  saldoCaixa: "Saldo de Caixa (Dez)",
  roic: "ROIC (%)",
};

export function readOutput(state: AppState, output: OutputKey): number {
  const { dre } = buildDRE(state, resolveEffectiveRegime(state));
  if (output === "ebitda") return sum(dre.ebitda);
  if (output === "lucroLiquido") return sum(dre.lucroLiquido);
  // Compute cf uma única vez e reaproveita — evita 2ª chamada interna a
  // buildCashFlow dentro de calcIndicators no loop de sensibilidade.
  const cf = buildCashFlow(state);
  if (output === "roic") return calcIndicators(state, dre, cf).roic;
  return cf.totais.saldoFinal;
}

const DEFAULT_DELTAS = [-15, -10, -5, 5, 10, 15];

export interface SensitivityResult {
  output: OutputKey;
  outputLabel: string;
  baseline: number;
  deltas: number[];
  rows: SensitivityRow[];
}

export function runSensitivity(
  state: AppState,
  output: OutputKey,
  drivers: DriverKey[] = ["preco", "volume", "cpv", "folha", "fixos", "juros"],
): SensitivityResult {
  const baseline = readOutput(state, output);
  const rows: SensitivityRow[] = drivers.map((d) => {
    const cells = DEFAULT_DELTAS.map((dp) => {
      const v = readOutput(applyDriver(state, d, dp), output);
      const pctChange = baseline !== 0 ? ((v - baseline) / Math.abs(baseline)) * 100 : 0;
      return { deltaPct: dp, value: v, pctChange };
    });
    const elasticityVals = cells
      .filter((c) => c.deltaPct !== 0)
      .map((c) => c.pctChange / c.deltaPct);
    const elasticity =
      elasticityVals.length > 0
        ? elasticityVals.reduce((a, b) => a + b, 0) / elasticityVals.length
        : 0;
    return { driver: d, label: DRIVER_LABEL[d], baseline, cells, elasticity };
  });
  // ordenar por sensibilidade absoluta
  rows.sort((a, b) => Math.abs(b.elasticity) - Math.abs(a.elasticity));
  return { output, outputLabel: OUTPUT_LABEL[output], baseline, deltas: DEFAULT_DELTAS, rows };
}

export const OUTPUT_OPTIONS: { value: OutputKey; label: string }[] = [
  { value: "ebitda", label: "EBITDA" },
  { value: "lucroLiquido", label: "Lucro Líquido" },
  { value: "saldoCaixa", label: "Saldo de Caixa (Dez)" },
  { value: "roic", label: "ROIC" },
];
