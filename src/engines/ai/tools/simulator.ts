// Tools de simulador: alavancas pontuais, projeção plurianual e sensibilidade.

import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/engines/finance/simulator";
import {
  buildForecast,
  DEFAULT_FORECAST_CFG,
  type ForecastConfig,
  type ForecastResult,
} from "@/engines/finance/forecast";
import {
  runSensitivity,
  type DriverKey,
  type OutputKey,
  type SensitivityResult,
} from "@/engines/finance/sensitivity";
import {
  solveBreakEvenDinamico,
  breakEvenDinamicoToMarkdown,
  type RestricaoBreakEven,
} from "@/engines/finance/breakEvenDinamico";
import {
  runTornado,
  runJointScenario,
  runMonteCarlo,
  DEFAULT_MC,
  tornadoToMarkdown,
  jointToMarkdown,
  monteCarloToMarkdown,
  type JointMove,
} from "@/engines/finance/sensibilidadeMulti";
import { getSectionsCached } from "../snapshot";
import { brl, type ToolDef, type ToolHandler, type ToolModule } from "./shared";

function forecastToMarkdown(cfg: ForecastConfig, r: ForecastResult): string {
  const lines: string[] = [];
  lines.push(`## Projeção ${cfg.horizonteMeses} meses (engine buildForecast)`);
  lines.push(
    `- Crescimento receita: ${cfg.crescimentoMensalPct.toFixed(2)}% a.m. · Inflação fixos: ${cfg.inflacaoFixosAA}% a.a. · Ganho escala CPV: ${cfg.ganhoEscalaCpvAA}% a.a.`,
  );
  lines.push(
    `- Step folha: a cada ${cfg.stepReceitaPct}% de receita extra → +${cfg.stepFolhaPct}% folha · Capex inicial: ${brl(cfg.capexInicial)}`,
  );
  lines.push("");
  lines.push(
    `**Acumulado:** Receita ${brl(r.totalReceita)} · EBITDA ${brl(r.totalEbitda)} · Lucro ${brl(r.totalLucro)} · FCL ${brl(r.totalFcl)} · ΔNCG ${brl(r.totalDeltaNcg)}`,
  );
  lines.push(
    `**Métricas de retorno:** VPL ${brl(r.vpl)} · TIR ${r.tir != null ? `${r.tir.toFixed(2)}% a.m.` : (r.tirError ?? "n/d")} · Payback ${r.paybackMeses != null ? `${r.paybackMeses} meses` : "não recuperado"} · Taxa desconto ${(r.taxaDescontoMensal * 100).toFixed(2)}% a.m.`,
  );
  const yearly: { ano: number; receita: number; ebitda: number; fcl: number }[] = [];
  for (let y = 0; y * 12 < r.meses.length; y++) {
    const chunk = r.meses.slice(y * 12, (y + 1) * 12);
    yearly.push({
      ano: y + 1,
      receita: chunk.reduce((s, m) => s + m.receita, 0),
      ebitda: chunk.reduce((s, m) => s + m.ebitda, 0),
      fcl: chunk.reduce((s, m) => s + m.fcl, 0),
    });
  }
  lines.push("\n| Ano | Receita | EBITDA | Margem | FCL |\n| --- | --- | --- | --- | --- |");
  yearly.forEach((y) => {
    const mg = y.receita > 0 ? (y.ebitda / y.receita) * 100 : 0;
    lines.push(
      `| ${y.ano} | ${brl(y.receita)} | ${brl(y.ebitda)} | ${mg.toFixed(1)}% | ${brl(y.fcl)} |`,
    );
  });
  return lines.join("\n");
}

function sensitivityToMarkdown(r: SensitivityResult): string {
  const out: string[] = [];
  out.push(`## Sensibilidade — ${r.outputLabel} (baseline ${brl(r.baseline)})`);
  out.push(`_Deltas testados: ${r.deltas.map((d) => `${d >= 0 ? "+" : ""}${d}%`).join(", ")}_`);
  out.push("");
  out.push(
    `| Driver | ${r.deltas.map((d) => `${d >= 0 ? "+" : ""}${d}%`).join(" | ")} | Elasticidade |`,
  );
  out.push(`| --- | ${r.deltas.map(() => "---").join(" | ")} | --- |`);
  r.rows.forEach((row) => {
    const cells = r.deltas.map((d) => {
      const c = row.cells.find((x) => x.deltaPct === d);
      return c ? `${c.pctChange >= 0 ? "+" : ""}${c.pctChange.toFixed(1)}%` : "—";
    });
    out.push(`| ${row.label} | ${cells.join(" | ")} | ${row.elasticity.toFixed(2)} |`);
  });
  const top = r.rows[0];
  if (top)
    out.push(`\n**Maior alavanca:** ${top.label} (elasticidade ${top.elasticity.toFixed(2)}).`);
  return out.join("\n");
}

const defs: ToolDef[] = [
  {
    name: "simular_alavanca",
    description:
      "Aplica alavancas e retorna impacto imediato em EBITDA, margem e valuation.\nConvenção de sinais — siga exatamente:\n- receitaPct: positivo = aumento (ex: 10 = +10% receita), negativo = queda\n- cpvPct: negativo = redução de custo (ex: -15 = cortar 15% do CPV), positivo = aumento\n- fixosPct: negativo = corte (ex: -20 = cortar 20% dos fixos), positivo = aumento\n- pmrDelta: negativo = reduzir prazo de recebimento (melhora caixa), positivo = piorar\n- pmpDelta: positivo = ampliar prazo com fornecedor (melhora caixa), negativo = reduzir\nExemplos: 'cortar 20% dos fixos' → fixosPct: -20 | 'reduzir PMR em 5 dias' → pmrDelta: -5",
    parameters: {
      type: "object",
      properties: {
        receitaPct: { type: "number" },
        cpvPct: { type: "number" },
        fixosPct: { type: "number" },
        pmrDelta: { type: "number" },
        pmpDelta: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "projetar",
    description:
      "Projeção plurianual estruturada (mesmo engine da aba Análise — buildForecast). Gera receita/EBITDA/Lucro/FCL/NCG mês-a-mês com escalonamento de folha por step, ganho de escala no CPV e cálculo de VPL/TIR/Payback. Use quando o consultor pedir 'projete os próximos N meses' ou 'qual o VPL desse projeto?'.",
    parameters: {
      type: "object",
      properties: {
        meses: { type: "number", description: "Horizonte em meses (12, 24, 36, 60)." },
        crescimentoMensalPct: {
          type: "number",
          description: "Crescimento composto mensal da receita (%). Default 1,0.",
        },
        inflacaoFixosAA: {
          type: "number",
          description: "Inflação anual dos custos fixos (%). Default 5.",
        },
        ganhoEscalaCpvAA: {
          type: "number",
          description: "Ganho de escala anual no CPV (%). Default 0.",
        },
        stepReceitaPct: {
          type: "number",
          description: "A cada X% de receita extra vs base, folha sobe 1 step. Default 50.",
        },
        stepFolhaPct: {
          type: "number",
          description: "Incremento de folha por step (%). Default 25.",
        },
        capexInicial: {
          type: "number",
          description: "Investimento inicial em t=0 (R$). Default 0.",
        },
      },
      required: ["meses"],
    },
  },
  {
    name: "sensibilidade",
    description:
      "Análise de sensibilidade (mesmo engine da aba Análise — runSensitivity). Varia preço/volume/CPV/folha/fixos/juros em ±5/10/15% e mede impacto no output escolhido. Retorna elasticidade média por driver.",
    parameters: {
      type: "object",
      properties: {
        output: {
          type: "string",
          enum: ["ebitda", "lucroLiquido", "saldoCaixa", "roic"],
          description: "Métrica de saída. Default: ebitda.",
        },
        drivers: {
          type: "array",
          items: { type: "string", enum: ["preco", "volume", "cpv", "folha", "fixos", "juros"] },
          description: "Drivers a testar. Default: todos.",
        },
      },
      required: [],
    },
  },
  {
    name: "break_even_dinamico",
    description:
      "Encontra a RECEITA MÍNIMA (anual + distribuição mensal) necessária para satisfazer uma restrição financeira real. Diferente do ponto de equilíbrio estático, considera sazonalidade do baseline, CPV variável e fluxo de caixa. Use quando o consultor perguntar 'quanto preciso vender para...': sair do prejuízo (ebitda_positivo), zerar o caixa em todos os meses (caixa_min) ou cumprir covenant de dívida (dscr). Retorna receita total anual + tabela mês a mês.",
    parameters: {
      type: "object",
      properties: {
        restricao: {
          type: "string",
          enum: ["dscr", "caixa_min", "ebitda_positivo"],
          description:
            "Restrição alvo: 'dscr' (cobertura do serviço da dívida), 'caixa_min' (saldo mínimo de caixa em todos os meses) ou 'ebitda_positivo' (EBITDA anual).",
        },
        meta_valor: {
          type: "number",
          description:
            "Valor-alvo. Defaults: dscr=1.25, caixa_min=0, ebitda_positivo=0. Exemplo: para covenant de DSCR ≥ 1.50x, passe 1.5.",
        },
        sazonalidade: {
          type: "boolean",
          description:
            "Se true (default), a distribuição mensal preserva o padrão sazonal do baseline. Se false, divide a receita anual igualmente nos 12 meses.",
        },
      },
      required: ["restricao"],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  simular_alavanca: (args, { state }) => {
    const params: SimulatorParams = {
      ...DEFAULT_SIM,
      priceDeltaPct: Number(args?.receitaPct) || 0,
      cpvDeltaPct: Number(args?.cpvPct) || 0,
      // fixosPct: negativo=corte. Simulator usa fixedCutPct invertido (positivo=corte).
      fixedCutPct: -(Number(args?.fixosPct) || 0),
      pmrDeltaDays: Number(args?.pmrDelta) || 0,
      pmpDeltaDays: Number(args?.pmpDelta) || 0,
    };
    const simulated = applySimulator(state, params);
    // Reaproveita cache — getSectionsCached só recalcula se `simulated` mudou.
    const simSec = getSectionsCached(state, simulated);
    return simSec.comparativo ?? "Simulação aplicada, mas sem comparativo disponível.";
  },

  projetar: (args, { state }) => {
    const cfg: ForecastConfig = {
      ...DEFAULT_FORECAST_CFG,
      horizonteMeses: Number(args?.meses) || DEFAULT_FORECAST_CFG.horizonteMeses,
      crescimentoMensalPct: Number(
        args?.crescimentoMensalPct ?? DEFAULT_FORECAST_CFG.crescimentoMensalPct,
      ),
      inflacaoFixosAA: Number(args?.inflacaoFixosAA ?? DEFAULT_FORECAST_CFG.inflacaoFixosAA),
      ganhoEscalaCpvAA: Number(args?.ganhoEscalaCpvAA ?? DEFAULT_FORECAST_CFG.ganhoEscalaCpvAA),
      stepReceitaPct: Number(args?.stepReceitaPct ?? DEFAULT_FORECAST_CFG.stepReceitaPct),
      stepFolhaPct: Number(args?.stepFolhaPct ?? DEFAULT_FORECAST_CFG.stepFolhaPct),
      capexInicial: Number(args?.capexInicial ?? DEFAULT_FORECAST_CFG.capexInicial),
    };
    const res = buildForecast(state, cfg);
    return forecastToMarkdown(cfg, res);
  },

  sensibilidade: (args, { state }) => {
    const out = (args?.output as OutputKey) || "ebitda";
    const drivers =
      Array.isArray(args?.drivers) && args.drivers.length
        ? (args.drivers as DriverKey[])
        : undefined;
    const res = runSensitivity(state, out, drivers);
    return sensitivityToMarkdown(res);
  },

  break_even_dinamico: (args, { state }) => {
    const restricao = (args?.restricao as RestricaoBreakEven) || "ebitda_positivo";
    const metaValor =
      typeof args?.meta_valor === "number" ? (args.meta_valor as number) : undefined;
    const sazonalidade = args?.sazonalidade !== false;
    const res = solveBreakEvenDinamico(state, { restricao, metaValor, sazonalidade });
    return breakEvenDinamicoToMarkdown(res);
  },
};

export const simulatorTools: ToolModule = {
  category: "simulator",
  description: "Parâmetros e execução do simulador financeiro",
  defs,
  handlers,
};
