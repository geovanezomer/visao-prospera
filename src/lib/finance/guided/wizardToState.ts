import { z } from "zod";
import { AppState, BusinessType, CostLine, TaxRegime } from "../types";
import { DEFAULT_STATE, defaultCostsFor } from "../defaults";
import { fill12 } from "../format";
import { compareRegimes } from "../calculations";

export type Seasonality = "estavel" | "sazonal" | "crescimento";

export const wizardSchema = z.object({
  businessType: z.enum(["servicos", "comercio", "industria"]),
  companyName: z.string().trim().min(1, "Informe o nome").max(120, "Máx. 120 caracteres"),
  faturamentoMensal: z.number().min(0, "Valor inválido").max(1_000_000_000, "Valor irreal"),
  seasonality: z.enum(["estavel", "sazonal", "crescimento"]),
  pmr: z.number().min(0).max(180),
  pmp: z.number().min(0).max(180),
  funcionarios: z.number().int().min(0).max(9999),
  salarioMedio: z.number().min(0).max(1_000_000),
  aluguel: z.number().min(0).max(10_000_000),
  software: z.number().min(0).max(10_000_000),
  marketing: z.number().min(0).max(10_000_000),
  outrosFixos: z.number().min(0).max(10_000_000),
  regimeEscolha: z.enum(["simples", "presumido", "real", "auto"]),
  temEmprestimo: z.boolean(),
  saldoDivida: z.number().min(0).max(1_000_000_000),
  taxaMensal: z.number().min(0).max(20),
  capitalProprio: z.number().min(0).max(1_000_000_000),
});

export type WizardAnswers = z.infer<typeof wizardSchema>;

export const WIZARD_DEFAULTS: WizardAnswers = {
  businessType: "servicos",
  companyName: "Minha Empresa LTDA",
  faturamentoMensal: 30000,
  seasonality: "estavel",
  pmr: 30,
  pmp: 30,
  funcionarios: 3,
  salarioMedio: 3500,
  aluguel: 2500,
  software: 350,
  marketing: 800,
  outrosFixos: 800,
  regimeEscolha: "simples",
  temEmprestimo: false,
  saldoDivida: 0,
  taxaMensal: 1.8,
  capitalProprio: 60000,
};

/** Gera 12 meses de receita conforme a sazonalidade. */
export function buildRevenueCurve(monthly: number, mode: Seasonality): number[] {
  if (monthly <= 0) return fill12(0);
  if (mode === "estavel") return fill12(monthly);
  if (mode === "crescimento") {
    // rampa linear: começa em ~83% do alvo e termina em ~117% (média = alvo)
    return Array.from({ length: 12 }, (_, i) => Math.round(monthly * (0.83 + (i / 11) * 0.34)));
  }
  // sazonal: ±15%, pico em dezembro
  return Array.from({ length: 12 }, (_, i) => {
    const fator = 1 + 0.15 * Math.sin(((i - 2) / 12) * Math.PI * 2);
    return Math.round(monthly * fator);
  });
}

function pmrPmpPreset(answer: { pmr: number; pmp: number }) {
  return { pmr: Math.round(answer.pmr), pmp: Math.round(answer.pmp) };
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
 * Aplica respostas do wizard sobre o DEFAULT_STATE (ou opcionalmente sobre um
 * estado base, mantendo cenários/dados já configurados que não foram tocados).
 */
export function applyWizard(answers: WizardAnswers, base?: AppState): AppState {
  const businessType: BusinessType = answers.businessType;
  const start: AppState = base
    ? { ...base, businessType, companyName: answers.companyName }
    : { ...DEFAULT_STATE, businessType, companyName: answers.companyName };

  // ---------- Receita ----------
  const bruta = buildRevenueCurve(answers.faturamentoMensal, answers.seasonality);
  const { pmr, pmp } = pmrPmpPreset(answers);

  // ---------- Custos: reseta para defaults do setor e ajusta linhas-chave ----------
  const fresh = defaultCostsFor(businessType);
  const folhaTotal = answers.funcionarios * answers.salarioMedio;

  const overrides: Record<string, Partial<CostLine>> = {
    admin_clt: { values: fill12(folhaTotal), encargosAuto: true },
    aluguel: { values: fill12(answers.aluguel) },
    tecnologia: { values: fill12(answers.software) },
    marketing: { values: fill12(answers.marketing) },
    outros_fix: { values: fill12(answers.outrosFixos) },
  };

  const costs: CostLine[] = fresh.map((c) =>
    overrides[c.id] ? { ...c, ...overrides[c.id] } : c,
  );

  // ---------- Capital / dívida ----------
  const capital = {
    ...DEFAULT_STATE.capital,
    patrimonioLiquido: answers.capitalProprio,
    dividaOnerosa: answers.temEmprestimo ? answers.saldoDivida : 0,
    kd: answers.temEmprestimo && answers.taxaMensal > 0 ? answers.taxaMensal * 12 : DEFAULT_STATE.capital.kd,
    ativoTotal: Math.max(answers.capitalProprio + (answers.temEmprestimo ? answers.saldoDivida : 0), 1000),
    disponibilidades: Math.max(answers.faturamentoMensal * 0.5, 5000),
  };

  // Estado provisório p/ rodar comparativo de regimes
  const provisional: AppState = {
    ...start,
    revenue: { ...start.revenue, bruta, pmr, pmp },
    costs,
    capital,
  };

  const regime: TaxRegime =
    answers.regimeEscolha === "auto" ? pickOptimalRegime(provisional) : answers.regimeEscolha;

  return {
    ...provisional,
    tax: { ...DEFAULT_STATE.tax, regime },
    guided: { enabled: true, completedWizard: true, dismissedBanner: false },
  };
}
