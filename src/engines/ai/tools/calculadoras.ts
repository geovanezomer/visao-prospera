// Tools de CALCULADORAS trabalhistas/financeiras — modo Contador.
// Expõe ao LLM as engines puras de:
//   - Custo real de funcionário CLT (encargos + provisões + benefícios)
//   - Comparativo CLT × PJ (MEI, Simples Anexo III, Lucro Presumido)
//   - Férias CLT (com/sem abono pecuniário)
//   - Rescisão trabalhista (todos os motivos)
//   - Financiamento SAC × PRICE
// Todas as engines são puras e validam input via Zod — repassamos erros como
// markdown amigável para o agente.

import {
  calcularCustoFuncionario,
  custoFuncionarioInputSchema,
  type CustoFuncionarioInput,
} from "@/engines/calculadoras/custoFuncionario";
import {
  compararCltVsPj,
  cltVsPjInputSchema,
  type CltVsPjInput,
} from "@/engines/calculadoras/cltVsPj";
import { calcularFerias, feriasInputSchema, type FeriasInput } from "@/engines/calculadoras/ferias";
import {
  calcularDecimoTerceiro,
  decimoTerceiroInputSchema,
  type DecimoTerceiroInput,
} from "@/engines/calculadoras/decimoTerceiro";
import {
  calcularRescisao,
  rescisaoInputSchema,
  motivosLabel,
  type RescisaoInput,
} from "@/engines/calculadoras/rescisao";
import { simularSacPrice } from "@/engines/calculadoras/sacPrice";
import { brl, pct, type ToolArgs, type ToolDef, type ToolHandler, type ToolModule } from "./shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function safeParse<T>(
  schema: { parse: (x: unknown) => T },
  args: ToolArgs,
): { ok: true; data: T } | { ok: false; err: string } {
  try {
    return { ok: true, data: schema.parse(args) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, err: `❌ Parâmetros inválidos: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Definições
// ---------------------------------------------------------------------------
const defs: ToolDef[] = [
  {
    name: "calc_custo_funcionario",
    description:
      "Calcula o CUSTO REAL mensal/anual de um funcionário CLT para a empresa (encargos patronais INSS+RAT+Terceiros+FGTS, provisões de 13º/férias, benefícios líquidos) e o fator multiplicador sobre o salário. Use para responder 'quanto custa contratar', 'qual o custo real', 'fator K', 'impacto de aumentar headcount'.",
    parameters: {
      type: "object",
      properties: {
        salarioBruto: { type: "number", description: "Salário bruto mensal (R$)." },
        regime: {
          type: "string",
          enum: ["simples", "presumido", "real"],
          description: "Regime da empresa contratante (default: simples).",
        },
        simplesAnexoIV: {
          type: "boolean",
          description:
            "Empresa no Anexo IV do Simples (construção civil, serviços advocatícios) — INSS patronal incide à parte.",
        },
        grauRAT: { type: "number", enum: [1, 2, 3], description: "Grau de risco RAT (1/2/3)." },
        aliquotaTerceiros: {
          type: "number",
          description: "Alíquota Sistema S (default 0.058 = 5,8%).",
        },
        beneficios: {
          type: "object",
          properties: {
            vt: {
              type: "object",
              properties: {
                ativo: { type: "boolean" },
                custoMensal: { type: "number" },
              },
            },
            vr: { type: "number" },
            planoSaude: { type: "number" },
            outros: { type: "number" },
          },
        },
      },
      required: ["salarioBruto"],
    },
  },
  {
    name: "calc_clt_vs_pj",
    description:
      "Compara a renda LÍQUIDA anual entre regime CLT e três regimes PJ (MEI, Simples Nacional Anexo III, Lucro Presumido). Retorna líquido mensal/anual de cada cenário, vencedor e ponto de equilíbrio (faturamento PJ que iguala CLT). Use para 'vale a pena virar PJ?', 'qual regime é melhor', 'breakeven CLT vs PJ'.",
    parameters: {
      type: "object",
      properties: {
        salarioBrutoCLT: { type: "number", description: "Salário bruto CLT mensal." },
        faturamentoPJMensal: { type: "number", description: "Faturamento PJ proposto (mensal)." },
        dependentesIR: { type: "number" },
        plrAnual: { type: "number" },
        beneficiosCLTMensal: { type: "number", description: "Benefícios CLT (VR/VA/saúde)." },
        contabilidadeMensal: { type: "number" },
        planoSaudeMensal: { type: "number", description: "Plano de saúde PJ (custo próprio)." },
        proLaborePct: { type: "number", description: "% do faturamento como pró-labore (0–1)." },
        irpjAdicionalPct: { type: "number" },
        irpjAdicionalGatilhoMensal: { type: "number" },
      },
      required: ["salarioBrutoCLT", "faturamentoPJMensal"],
    },
  },
  {
    name: "calc_ferias",
    description:
      "Calcula férias CLT (gozadas + 1/3 constitucional, com opção de vender 10 dias / abono pecuniário). Retorna bruto, INSS, IRRF e líquido. Use para 'calcular férias', 'vale vender 10 dias', 'líquido das férias'.",
    parameters: {
      type: "object",
      properties: {
        salarioBruto: { type: "number" },
        abonoPecuniario: { type: "boolean", description: "Vender 10 dias (goza 20)." },
        dependentesIR: { type: "number" },
      },
      required: ["salarioBruto"],
    },
  },
  {
    name: "calc_decimo_terceiro",
    description:
      "Calcula o 13º SALÁRIO (gratificação natalina) proporcional aos meses trabalhados, com 1ª parcela (50%, sem descontos) e 2ª parcela (líquida após INSS e IRRF calculados em separado). Use para 'calcular 13º', 'décimo terceiro', 'quanto vou receber de 13º', 'gratificação natalina proporcional'.",
    parameters: {
      type: "object",
      properties: {
        salarioBruto: { type: "number", description: "Salário bruto mensal (R$)." },
        mesesTrabalhados: {
          type: "number",
          description: "Meses trabalhados no ano (1–12). Mês com >15 dias conta como inteiro.",
        },
        dependentesIR: { type: "number", description: "Dependentes para dedução do IRRF." },
      },
      required: ["salarioBruto"],
    },
  },
  {
    name: "calc_rescisao",
    description:
      "Calcula RESCISÃO CLT por motivo (sem justa causa, justa causa, pedido demissão, acordo art. 484-A, rescisão indireta, término de experiência). Retorna verbas detalhadas, INSS/IRRF, saque FGTS, multa rescisória e líquido. Use para 'quanto custa demitir', 'rescisão de fulano', 'multa rescisória', 'acordo 484-A'.",
    parameters: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: [
            "sem_justa_causa",
            "justa_causa",
            "pedido_demissao",
            "acordo_484a",
            "rescisao_indireta",
            "termino_experiencia",
          ],
        },
        salarioBruto: { type: "number" },
        diasTrabalhadosMes: { type: "number" },
        mesesFeriasProporcionais: { type: "number" },
        mesesDecimoProporcional: { type: "number" },
        anosNaEmpresa: { type: "number" },
        saldoFGTS: { type: "number" },
        possuiFeriasVencidas: { type: "boolean" },
        dependentesIR: { type: "number" },
        avisoPrevio: { type: "string", enum: ["indenizado", "trabalhado", "dispensado"] },
        diasRestantesExperiencia: { type: "number" },
        rupturaExperienciaPor: { type: "string", enum: ["empregador", "empregado"] },
      },
      required: ["motivo", "salarioBruto"],
    },
  },
  {
    name: "calc_sac_price",
    description:
      "Simula financiamento SAC × PRICE. Retorna primeira/última parcela, total pago, total de juros e a economia de juros do SAC sobre o PRICE. Use para 'qual sistema é melhor', 'simular empréstimo', 'comparar SAC e Price', 'parcela do financiamento'.",
    parameters: {
      type: "object",
      properties: {
        pv: { type: "number", description: "Valor presente / principal (R$)." },
        taxaAnualPct: { type: "number", description: "Taxa nominal anual (% a.a., ex.: 12)." },
        n: { type: "number", description: "Prazo em meses." },
      },
      required: ["pv", "taxaAnualPct", "n"],
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers — todos retornam markdown
// ---------------------------------------------------------------------------
const handlers: Record<string, ToolHandler> = {
  calc_custo_funcionario: (args) => {
    const r = safeParse<CustoFuncionarioInput>(custoFuncionarioInputSchema, args);
    if (!r.ok) return r.err;
    const out = calcularCustoFuncionario(r.data);
    const lines = [
      `## Custo Real CLT — Salário ${brl(out.salarioBruto)} (${out.regime})`,
      ``,
      `- **Encargos:** ${brl(out.encargos.total)}`,
      ...out.encargos.itens.map(
        (i) =>
          `  - ${i.rotulo}${i.aliquota != null ? ` (${pct(i.aliquota * 100, 2)})` : ""}: ${brl(i.valor)}`,
      ),
      `- **Provisões:** ${brl(out.provisoes.total)}`,
      ...out.provisoes.itens.map((i) => `  - ${i.rotulo}: ${brl(i.valor)}`),
      `- **Benefícios líquidos:** ${brl(out.beneficios.total)} (VT empresa ${brl(out.beneficios.vtCustoEmpresa)})`,
      ``,
      `**Custo mensal:** ${brl(out.custoMensalTotal)} · **Anual:** ${brl(out.custoAnualTotal)}`,
      `**Fator multiplicador:** ${out.fatorMultiplicador.toFixed(2).replace(".", ",")}× sobre o salário bruto`,
    ];
    return lines.join("\n");
  },

  calc_clt_vs_pj: (args) => {
    const r = safeParse<CltVsPjInput>(cltVsPjInputSchema, args);
    if (!r.ok) return r.err;
    const c = compararCltVsPj(r.data);
    const fmtPJ = (label: string, key: "mei" | "simples" | "presumido") => {
      const p = c.pj[key];
      const obs = p.acimaDoTetoRegime ? "⚠️ acima do teto" : "—";
      return `| ${label} | ${brl(p.liquidoMensal)} | ${brl(p.liquidoAnual)} | ${obs} | ${brl(c.faturamentoEmpate[key])} |`;
    };
    return [
      `## Comparativo CLT × PJ`,
      ``,
      `| Regime | Líquido mensal | Líquido anual | Obs. | Fat. p/ empatar CLT |`,
      `|---|---:|---:|---|---:|`,
      `| CLT | ${brl(c.clt.liquidoMensal)} | ${brl(c.clt.totalAnualLiquido)} | inclui 13º+férias+PLR+benefícios | — |`,
      fmtPJ("PJ MEI", "mei"),
      fmtPJ("PJ Simples III", "simples"),
      fmtPJ("PJ Presumido", "presumido"),
      ``,
      `**Vencedor:** ${c.vencedor.toUpperCase()} (melhor PJ = ${c.melhorRegimePJ.toUpperCase()}) · **Δ anual vs CLT:** ${brl(c.diferencaAnual)}`,
    ].join("\n");
  },

  calc_ferias: (args) => {
    const r = safeParse<FeriasInput>(feriasInputSchema, args);
    if (!r.ok) return r.err;
    const f = calcularFerias(r.data);
    return [
      `## Férias CLT — Salário ${brl((args.salarioBruto as number) || 0)}`,
      `- Dias gozados: ${f.diasGozados} · Abono: ${f.diasAbono} dias`,
      `- Férias base: ${brl(f.feriasBase)} + 1/3: ${brl(f.tercoFerias)}`,
      f.abonoValor
        ? `- Abono (isento): ${brl(f.abonoValor)} + 1/3 abono: ${brl(f.tercoAbono)}`
        : ``,
      `- Base tributável: ${brl(f.baseTributavel)} → INSS ${brl(f.inss)} · IRRF ${brl(f.irrf)}`,
      ``,
      `**Bruto:** ${brl(f.brutoTotal)} · **Líquido:** ${brl(f.liquido)}`,
    ]
      .filter(Boolean)
      .join("\n");
  },

  calc_decimo_terceiro: (args) => {
    const r = safeParse<DecimoTerceiroInput>(decimoTerceiroInputSchema, args);
    if (!r.ok) return r.err;
    const d = calcularDecimoTerceiro(r.data);
    return [
      `## 13º Salário — Salário ${brl((args.salarioBruto as number) || 0)}`,
      `- Meses trabalhados: ${r.data.mesesTrabalhados ?? 12}/12`,
      `- 13º bruto: ${brl(d.bruto)}`,
      `- 1ª parcela (até 30/nov): ${brl(d.primeiraParcela)} — sem descontos`,
      `- INSS (sobre o total): ${brl(d.inss)} · IRRF (em separado): ${brl(d.irrf)}`,
      `- 2ª parcela (até 20/dez): ${brl(d.segundaParcela)}`,
      ``,
      `**Líquido total:** ${brl(d.liquido)}`,
    ].join("\n");
  },

  calc_rescisao: (args) => {
    const r = safeParse<RescisaoInput>(rescisaoInputSchema, args);
    if (!r.ok) return r.err;
    const o = calcularRescisao(r.data);
    return [
      `## Rescisão — ${motivosLabel[o.motivo]}`,
      `- Aviso prévio: ${o.diasAvisoPrevio} dias`,
      ``,
      `| Verba | Valor | INSS | IRRF |`,
      `|---|---:|:-:|:-:|`,
      ...o.verbas.map(
        (v) =>
          `| ${v.rotulo} | ${brl(v.valor)} | ${v.incideINSS ? "✓" : "—"} | ${v.incideIRRF ? "✓" : "—"} |`,
      ),
      ``,
      `**Bruto:** ${brl(o.totalBruto)} · INSS ${brl(o.inss)} · IRRF ${brl(o.irrf)}`,
      `**Líquido:** ${brl(o.totalLiquido)}`,
      `**Saque FGTS:** ${brl(o.saqueFGTS)} · **Multa FGTS:** ${brl(o.multaFGTS)}`,
    ].join("\n");
  },

  calc_sac_price: (args) => {
    const pv = Number(args.pv);
    const taxa = Number(args.taxaAnualPct);
    const n = Math.round(Number(args.n));
    if (!Number.isFinite(pv) || pv <= 0 || !Number.isFinite(taxa) || !Number.isFinite(n) || n <= 0)
      return "❌ Parâmetros inválidos: informe `pv > 0`, `taxaAnualPct` e `n > 0`.";
    const s = simularSacPrice(pv, taxa, n);
    return [
      `## Financiamento — PV ${brl(pv)} · ${taxa.toFixed(2).replace(".", ",")}% a.a. · ${n} meses`,
      `Taxa mensal equivalente: ${pct(s.taxaMensal * 100, 4)}`,
      ``,
      `| Sistema | 1ª parcela | Última | Total pago | Total juros |`,
      `|---|---:|---:|---:|---:|`,
      `| SAC | ${brl(s.sac.primeiraParcela)} | ${brl(s.sac.ultimaParcela)} | ${brl(s.sac.totalPago)} | ${brl(s.sac.totalJuros)} |`,
      `| PRICE | ${brl(s.price.primeiraParcela)} | ${brl(s.price.ultimaParcela)} | ${brl(s.price.totalPago)} | ${brl(s.price.totalJuros)} |`,
      ``,
      `**Economia de juros do SAC sobre PRICE:** ${brl(s.economiaJurosSac)}`,
    ].join("\n");
  },
};

export const calculadorasTools: ToolModule = {
  category: "calculadoras",
  description:
    "Calculadoras trabalhistas e financeiras (custo CLT, CLT×PJ, férias, rescisão, SAC×PRICE) — modo Contador.",
  defs,
  handlers,
};
