// Tools de simulador: alavancas pontuais, projeção plurianual e sensibilidade.

import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/engines/finance/simulator";
import {
  projectCashflow,
  projectionToMarkdown,
  defaultCenarios,
  type CenarioProjecao,
  type CaptacaoDivida,
} from "@/engines/finance/cashflowProjection";
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
  {
    name: "sensibilidade_multivariada",
    description:
      "Análise de sensibilidade avançada em 3 modos:\n• 'tornado' — testa ±delta em CADA driver e ranqueia por IMPACTO ABSOLUTO em R$ (não só elasticidade); útil para priorizar alavancas (ex: 'qual move mais o EBITDA?').\n• 'joint' — aplica MÚLTIPLOS drivers SIMULTANEAMENTE para responder cenários compostos (ex: 'se receita cair 10% E folha subir 5%, o que acontece com caixa e EV?').\n• 'monte_carlo' — distribuição probabilística (P5/P25/Mediana/P75/P95) de EBITDA, lucro e caixa com correlações economicamente fundamentadas.\nSuporta múltiplos KPIs de saída simultaneamente (ebitda + caixa + ROIC).",
    parameters: {
      type: "object",
      properties: {
        metodo: {
          type: "string",
          enum: ["tornado", "joint", "monte_carlo"],
          description: "Modo de análise. Default: 'tornado'.",
        },
        drivers: {
          type: "array",
          items: { type: "string", enum: ["preco", "volume", "cpv", "folha", "fixos", "juros"] },
          description: "Drivers a testar (tornado/joint). Default: todos.",
        },
        delta_pct: {
          type: "number",
          description: "Δ% aplicado em cada driver no modo 'tornado'. Default: 10.",
        },
        cenario: {
          type: "array",
          description:
            "Modo 'joint': lista de movimentos compostos. Ex: [{driver:'volume',deltaPct:-10},{driver:'folha',deltaPct:5}].",
          items: {
            type: "object",
            properties: {
              driver: {
                type: "string",
                enum: ["preco", "volume", "cpv", "folha", "fixos", "juros"],
              },
              deltaPct: { type: "number" },
            },
            required: ["driver", "deltaPct"],
          },
        },
        outputs: {
          type: "array",
          items: { type: "string", enum: ["ebitda", "lucroLiquido", "saldoCaixa", "roic"] },
          description: "KPIs a observar (tornado/joint). Default: ['ebitda','saldoCaixa'].",
        },
        iteracoes: {
          type: "number",
          description: "Modo 'monte_carlo': nº de iterações (default 1000, máx 5000).",
        },
      },
      required: [],
    },
  },
  {
    name: "projetar_fluxo_caixa",
    description:
      "Projeta o fluxo de caixa para N meses à frente (12/24/36) sob múltiplos cenários (base/otimista/pessimista) com deltas de receita e folha + eventos de captação de dívida com amortização linear. Retorna tabela resumo, line-chart dos cenários, alertas (mês em que caixa fica negativo / recupera) e detalhe mensal do cenário base. Use quando o cliente perguntar 'quando o caixa melhora?', 'preciso captar quanto?', 'e se eu pegar R$ X em Jul?'.",
    parameters: {
      type: "object",
      properties: {
        meses: { type: "number", description: "Horizonte em meses (default 24, máx 60)." },
        cenarios: {
          type: "array",
          description:
            "Cenários customizados. Omita para usar Base/Otimista/Pessimista padrão (±10%).",
          items: {
            type: "object",
            properties: {
              nome: { type: "string" },
              receita_delta: {
                description:
                  "Escalar (-0.10 = -10%) ou array mês-a-mês de mesma length que `meses`.",
                oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
              },
              folha_delta: {
                description: "Escalar (+0.05) ou array mês-a-mês.",
                oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
              },
              capturas_divida: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    mes: { type: "number", description: "Mês 1-indexado no horizonte." },
                    valor: { type: "number" },
                    prazo_devolucao: {
                      type: "number",
                      description: "Meses de amortização linear.",
                    },
                  },
                  required: ["mes", "valor", "prazo_devolucao"],
                },
              },
            },
            required: ["nome"],
          },
        },
      },
      required: [],
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

  sensibilidade_multivariada: (args, { state }) => {
    const metodo = (args?.metodo as string) || "tornado";
    const driversIn =
      Array.isArray(args?.drivers) && args.drivers.length
        ? (args.drivers as DriverKey[])
        : (["preco", "volume", "cpv", "folha", "fixos", "juros"] as DriverKey[]);
    const outputsIn =
      Array.isArray(args?.outputs) && args.outputs.length
        ? (args.outputs as OutputKey[])
        : (["ebitda", "saldoCaixa"] as OutputKey[]);

    if (metodo === "monte_carlo") {
      const it = Math.max(100, Math.min(5000, Number(args?.iteracoes) || DEFAULT_MC.iterations));
      const res = runMonteCarlo(state, { ...DEFAULT_MC, iterations: it });
      return monteCarloToMarkdown(res);
    }
    if (metodo === "joint") {
      const cenario = Array.isArray(args?.cenario) ? (args.cenario as JointMove[]) : [];
      if (!cenario.length) {
        return "Modo 'joint' requer `cenario: [{driver, deltaPct}, ...]`.";
      }
      const res = runJointScenario(state, cenario, outputsIn);
      return jointToMarkdown(res);
    }
    const delta = Number(args?.delta_pct) || 10;
    const res = runTornado(state, driversIn, delta, outputsIn);
    return tornadoToMarkdown(res);
  },

  projetar_fluxo_caixa: (args, { state }) => {
    const meses = Math.max(1, Math.min(60, Number(args?.meses) || 24));
    const cenariosRaw = Array.isArray(args?.cenarios) ? (args!.cenarios as unknown[]) : [];
    const cenarios: CenarioProjecao[] = cenariosRaw.length
      ? cenariosRaw.map((c) => {
          const o = c as Record<string, unknown>;
          const capsRaw = Array.isArray(o.capturas_divida) ? (o.capturas_divida as unknown[]) : [];
          const caps: CaptacaoDivida[] = capsRaw.map((x) => {
            const k = x as Record<string, unknown>;
            return {
              mes: Number(k.mes) || 0,
              valor: Number(k.valor) || 0,
              prazoDevolucao: Number(k.prazo_devolucao) || 0,
            };
          });
          return {
            nome: String(o.nome || "Cenário"),
            receitaDelta: Array.isArray(o.receita_delta)
              ? (o.receita_delta as unknown[]).map((x) => Number(x) || 0)
              : Number(o.receita_delta) || 0,
            folhaDelta: Array.isArray(o.folha_delta)
              ? (o.folha_delta as unknown[]).map((x) => Number(x) || 0)
              : Number(o.folha_delta) || 0,
            capturasDivida: caps,
          };
        })
      : defaultCenarios();
    const res = projectCashflow(state, meses, cenarios);
    return projectionToMarkdown(res);
  },
};

export const simulatorTools: ToolModule = {
  category: "simulator",
  description: "Parâmetros e execução do simulador financeiro",
  defs,
  handlers,
};
