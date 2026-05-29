import { z } from "zod";
import { AppState, BusinessType, CostLine, TaxRegime } from "../types";
import { DEFAULT_STATE, defaultCostsFor } from "../defaults";
import { fill12 } from "../format";
import { compareRegimes } from "../calculations";

export type Seasonality = "estavel" | "sazonal" | "crescimento";

export const wizardSchema = z.object({
  // Step 1
  businessType: z.enum(["servicos", "comercio", "industria"]),
  companyName: z.string().trim().min(1, "Informe o nome").max(120, "Máx. 120 caracteres"),
  // Step 2
  faturamentoMensal: z.number().min(0, "Valor inválido").max(1_000_000_000, "Valor irreal"),
  seasonality: z.enum(["estavel", "sazonal", "crescimento"]),
  crescimentoAA: z.number().min(-50).max(300),
  // Step 3 — Margem
  margemCustoVendasPct: z.number().min(0).max(95),
  // Step 4 — Vendas & recebimentos
  pmr: z.number().min(0).max(180),
  pmp: z.number().min(0).max(180),
  inadimplenciaPct: z.number().min(0).max(50),
  inadimplenciaComoPDD: z.boolean(),
  percentualCartao: z.number().min(0).max(100),
  taxaCartaoPct: z.number().min(0).max(15),
  // Step 5 — Equipe CLT
  funcionarios: z.number().int().min(0).max(9999),
  salarioMedio: z.number().min(0).max(1_000_000),
  // Step 6 — Sócios
  numeroSocios: z.number().int().min(0).max(20),
  proLaboreMedio: z.number().min(0).max(500_000),
  comissaoVendasPct: z.number().min(0).max(30),
  // Step 7 — Custos fixos
  aluguel: z.number().min(0).max(10_000_000),
  software: z.number().min(0).max(10_000_000),
  marketing: z.number().min(0).max(10_000_000),
  outrosFixos: z.number().min(0).max(10_000_000),
  // Step 8 — Estoque (comércio/indústria)
  diasEstoque: z.number().int().min(0).max(365),
  // Step 9
  regimeEscolha: z.enum(["simples", "presumido", "real", "auto"]),
  // Step 10
  temEmprestimo: z.boolean(),
  saldoDivida: z.number().min(0).max(1_000_000_000),
  taxaMensal: z.number().min(0).max(20),
  capitalProprio: z.number().min(0).max(1_000_000_000),
});

export type WizardAnswers = z.infer<typeof wizardSchema>;

/** Defaults de margem (custo de vendas / receita) por setor. */
export const MARGEM_DEFAULTS: Record<BusinessType, number> = {
  servicos: 30,
  comercio: 65,
  industria: 55,
};

/** Defaults de dias de estoque por setor. */
export const ESTOQUE_DEFAULTS: Record<BusinessType, number> = {
  servicos: 0,
  comercio: 30,
  industria: 45,
};

export const WIZARD_DEFAULTS: WizardAnswers = {
  businessType: "servicos",
  companyName: "Minha Empresa LTDA",
  faturamentoMensal: 30000,
  seasonality: "estavel",
  crescimentoAA: 20,
  margemCustoVendasPct: MARGEM_DEFAULTS.servicos,
  pmr: 30,
  pmp: 30,
  inadimplenciaPct: 2,
  inadimplenciaComoPDD: true,
  percentualCartao: 40,
  taxaCartaoPct: 2.5,
  funcionarios: 3,
  salarioMedio: 3500,
  numeroSocios: 1,
  proLaboreMedio: 5000,
  comissaoVendasPct: 3,
  aluguel: 2500,
  software: 350,
  marketing: 800,
  outrosFixos: 800,
  diasEstoque: ESTOQUE_DEFAULTS.servicos,
  regimeEscolha: "simples",
  temEmprestimo: false,
  saldoDivida: 0,
  taxaMensal: 1.8,
  capitalProprio: 60000,
};

/**
 * Gera 12 meses de receita conforme sazonalidade.
 * - estavel: constante
 * - sazonal: ±15% (pico em dezembro)
 * - crescimento: composto mensal cuja média anual = `monthly`,
 *   derivado da taxa anual `taxaAA` (%).
 */
export function buildRevenueCurve(monthly: number, mode: Seasonality, taxaAA = 20): number[] {
  if (monthly <= 0) return fill12(0);
  if (mode === "estavel") return fill12(monthly);
  if (mode === "crescimento") {
    const g = Math.pow(1 + taxaAA / 100, 1 / 12) - 1; // taxa mensal composta
    const weights = Array.from({ length: 12 }, (_, i) => Math.pow(1 + g, i));
    const sumW = weights.reduce((s, w) => s + w, 0);
    const base = (monthly * 12) / sumW;
    return weights.map((w) => Math.round(base * w));
  }
  // sazonal: ±15%, pico em dezembro
  return Array.from({ length: 12 }, (_, i) => {
    const fator = 1 + 0.15 * Math.sin(((i - 2) / 12) * Math.PI * 2);
    return Math.round(monthly * fator);
  });
}

/** Escolhe o regime de menor carga anual dado o estado pré-montado. */
function pickOptimalRegime(state: AppState): TaxRegime {
  try {
    const reg = compareRegimes(state);
    const ranked = (Object.entries(reg) as [TaxRegime, { annual: number }][]).sort(
      (a, b) => a[1].annual - b[1].annual,
    );
    return ranked[0][0];
  } catch {
    return "simples";
  }
}

/**
 * Escala todas as linhas de custo_vendas proporcionalmente para que o total
 * mensal médio corresponda à margem informada (% sobre faturamento).
 */
function applyMargemToCostVendas(
  costs: CostLine[],
  faturamentoMensal: number,
  margemPct: number,
  bruta: number[],
): CostLine[] {
  const targetMensalMedio = (faturamentoMensal * margemPct) / 100;
  const cvLines = costs.filter((c) => c.category === "custo_vendas");
  if (cvLines.length === 0 || targetMensalMedio <= 0) return costs;
  const currentMensalMedio =
    cvLines.reduce((s, c) => s + c.values.reduce((a, b) => a + b, 0) / 12, 0) || 1;
  const scale = targetMensalMedio / currentMensalMedio;
  // Modula a curva conforme a receita (mantém proporção entre meses)
  const baseMensalRatio = bruta.map((v) => (faturamentoMensal > 0 ? v / faturamentoMensal : 1));
  return costs.map((c) => {
    if (c.category !== "custo_vendas") return c;
    const novaMedia = (c.values.reduce((a, b) => a + b, 0) / 12) * scale;
    return {
      ...c,
      values: baseMensalRatio.map((r) => Math.round(novaMedia * r)),
    };
  });
}

/**
 * Aplica respostas do wizard sobre o DEFAULT_STATE (ou opcionalmente sobre um
 * estado base, mantendo cenários/dados já configurados que não foram tocados).
 */
export function applyWizard(answers: WizardAnswers, base?: AppState): AppState {
  const businessType: BusinessType = answers.businessType;
  const start: AppState = base
    ? { ...base, businessType, companyName: answers.companyName }
    : { ...DEFAULT_STATE, businessType, companyName: answers.companyName };

  // ---------- Receita ----------
  const bruta = buildRevenueCurve(
    answers.faturamentoMensal,
    answers.seasonality,
    answers.crescimentoAA,
  );

  // ---------- Custos: reseta para defaults do setor e ajusta linhas-chave ----------
  let costs: CostLine[] = defaultCostsFor(businessType);
  const folhaTotal = answers.funcionarios * answers.salarioMedio;
  const proLaboreTotal = answers.numeroSocios * answers.proLaboreMedio;
  const comissaoMensal = (answers.faturamentoMensal * answers.comissaoVendasPct) / 100;
  const taxaCartaoMensal =
    (answers.faturamentoMensal * answers.percentualCartao * answers.taxaCartaoPct) / 10000;

  const overrides: Record<string, Partial<CostLine>> = {
    admin_clt: { values: fill12(folhaTotal), encargosAuto: true, encargosPct: 70 },
    prolabore: { values: fill12(proLaboreTotal), encargosAuto: false },
    comissoes: { values: fill12(comissaoMensal), fixed: false },
    aluguel: { values: fill12(answers.aluguel) },
    tecnologia: { values: fill12(answers.software) },
    marketing: { values: fill12(answers.marketing), fixed: false },
    outros_fix: { values: fill12(answers.outrosFixos) },
  };

  costs = costs.map((c) => (overrides[c.id] ? { ...c, ...overrides[c.id] } : c));

  // Linha de taxa de cartão (adiciona se ainda não existir)
  if (taxaCartaoMensal > 0) {
    const has = costs.find((c) => c.id === "taxa_cartao");
    if (has) {
      costs = costs.map((c) =>
        c.id === "taxa_cartao" ? { ...c, values: fill12(taxaCartaoMensal) } : c,
      );
    } else {
      costs = [
        ...costs,
        {
          id: "taxa_cartao",
          label: "Taxa de cartão / maquininha",
          category: "variavel",
          values: fill12(taxaCartaoMensal),
          fixed: false,
        },
      ];
    }
  }

  // Aplica margem (% custo de vendas / receita) escalando as linhas existentes.
  costs = applyMargemToCostVendas(
    costs,
    answers.faturamentoMensal,
    answers.margemCustoVendasPct,
    bruta,
  );

  // ---------- Estoque (dias × CMV mensal médio) ----------
  const cmvMensalMedio =
    costs
      .filter((c) => c.category === "custo_vendas")
      .reduce((s, c) => s + c.values.reduce((a, b) => a + b, 0) / 12, 0) || 0;
  const estoqueSaldo =
    businessType === "servicos" ? 0 : Math.round((cmvMensalMedio * answers.diasEstoque) / 30);

  // ---------- Capital / dívida ----------
  const capital = {
    ...DEFAULT_STATE.capital,
    patrimonioLiquido: answers.capitalProprio,
    dividaOnerosa: answers.temEmprestimo ? answers.saldoDivida : 0,
    kd:
      answers.temEmprestimo && answers.taxaMensal > 0
        ? answers.taxaMensal * 12
        : DEFAULT_STATE.capital.kd,
    ativoTotal: Math.max(
      answers.capitalProprio + (answers.temEmprestimo ? answers.saldoDivida : 0),
      1000,
    ),
    disponibilidades: Math.max(answers.faturamentoMensal * 0.5, 5000),
    estoques: estoqueSaldo,
  };

  // ---------- Receita: inadimplência e PDD ----------
  const revenue = {
    ...start.revenue,
    bruta,
    pmr: Math.round(answers.pmr),
    pmp: Math.round(answers.pmp),
    inadimplencia: fill12(answers.inadimplenciaPct),
    inadimplenciaComoPDD: answers.inadimplenciaComoPDD,
  };

  // Estado provisório p/ rodar comparativo de regimes
  const provisional: AppState = { ...start, revenue, costs, capital };

  const regime: TaxRegime =
    answers.regimeEscolha === "auto" ? pickOptimalRegime(provisional) : answers.regimeEscolha;

  return {
    ...provisional,
    tax: { ...DEFAULT_STATE.tax, regime },
    guided: { enabled: true, completedWizard: true, dismissedBanner: false },
  };
}
