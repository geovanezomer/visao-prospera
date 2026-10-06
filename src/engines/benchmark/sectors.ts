// Base de benchmarks setoriais — medianas e quartis (P25/P50/P75).
// Fontes: consolidação SEBRAE/Serasa Experian/IBGE PIA-PAS/PMC + literatura de valuation BR.
// Valores em % salvo onde indicado. Atualizar anualmente.

import type { BusinessType } from "@/engines/finance/types";

export interface SectorBenchmark {
  id: string;
  label: string;
  businessType: BusinessType;
  /** Margem Bruta % */
  margemBruta: { p25: number; p50: number; p75: number };
  /** Margem EBITDA % */
  margemEbitda: { p25: number; p50: number; p75: number };
  /** Margem Líquida % */
  margemLiquida: { p25: number; p50: number; p75: number };
  /** Giro do ativo (vezes) */
  giroAtivo: { p25: number; p50: number; p75: number };
  /** Endividamento geral % */
  endividamento: { p25: number; p50: number; p75: number };
  /** PMR — dias */
  pmr: { p25: number; p50: number; p75: number };
  /** PMP — dias */
  pmp: { p25: number; p50: number; p75: number };
  /** EV/EBITDA típico (múltiplo de saída) */
  evEbitda: { p25: number; p50: number; p75: number };
}

export const SECTORS: SectorBenchmark[] = [
  // ===== SERVIÇOS =====
  {
    id: "serv-consultoria",
    label: "Consultoria / Profissional liberal",
    businessType: "servicos",
    margemBruta: { p25: 55, p50: 70, p75: 82 },
    margemEbitda: { p25: 12, p50: 22, p75: 35 },
    margemLiquida: { p25: 8, p50: 16, p75: 26 },
    giroAtivo: { p25: 1.0, p50: 1.8, p75: 3.0 },
    endividamento: { p25: 20, p50: 35, p75: 55 },
    pmr: { p25: 15, p50: 30, p75: 60 },
    pmp: { p25: 7, p50: 15, p75: 30 },
    evEbitda: { p25: 3, p50: 5, p75: 8 },
  },
  {
    id: "serv-ti-saas",
    label: "TI / Software / SaaS",
    businessType: "servicos",
    margemBruta: { p25: 60, p50: 75, p75: 85 },
    margemEbitda: { p25: 10, p50: 20, p75: 35 },
    margemLiquida: { p25: 5, p50: 14, p75: 25 },
    giroAtivo: { p25: 0.8, p50: 1.4, p75: 2.5 },
    endividamento: { p25: 25, p50: 45, p75: 65 },
    pmr: { p25: 20, p50: 35, p75: 55 },
    pmp: { p25: 10, p50: 20, p75: 35 },
    evEbitda: { p25: 5, p50: 9, p75: 15 },
  },
  {
    id: "serv-saude",
    label: "Saúde / Clínicas / Odonto",
    businessType: "servicos",
    margemBruta: { p25: 50, p50: 62, p75: 75 },
    margemEbitda: { p25: 10, p50: 18, p75: 28 },
    margemLiquida: { p25: 6, p50: 12, p75: 20 },
    giroAtivo: { p25: 0.9, p50: 1.5, p75: 2.4 },
    endividamento: { p25: 30, p50: 50, p75: 65 },
    pmr: { p25: 25, p50: 45, p75: 70 },
    pmp: { p25: 15, p50: 25, p75: 40 },
    evEbitda: { p25: 4, p50: 7, p75: 10 },
  },
  {
    id: "serv-educacao",
    label: "Educação",
    businessType: "servicos",
    margemBruta: { p25: 40, p50: 55, p75: 68 },
    margemEbitda: { p25: 8, p50: 15, p75: 25 },
    margemLiquida: { p25: 4, p50: 10, p75: 18 },
    giroAtivo: { p25: 0.7, p50: 1.2, p75: 1.8 },
    endividamento: { p25: 35, p50: 55, p75: 70 },
    pmr: { p25: 5, p50: 15, p75: 30 },
    pmp: { p25: 15, p50: 25, p75: 40 },
    evEbitda: { p25: 4, p50: 6, p75: 9 },
  },
  {
    id: "serv-alimentacao",
    label: "Bares / Restaurantes / Food",
    businessType: "servicos",
    margemBruta: { p25: 50, p50: 62, p75: 72 },
    margemEbitda: { p25: 5, p50: 12, p75: 22 },
    margemLiquida: { p25: 2, p50: 7, p75: 14 },
    giroAtivo: { p25: 1.5, p50: 2.5, p75: 4.0 },
    endividamento: { p25: 40, p50: 60, p75: 75 },
    pmr: { p25: 0, p50: 3, p75: 10 },
    pmp: { p25: 15, p50: 25, p75: 35 },
    evEbitda: { p25: 3, p50: 5, p75: 7 },
  },
  {
    id: "serv-construcao",
    label: "Construção / Engenharia",
    businessType: "servicos",
    margemBruta: { p25: 18, p50: 28, p75: 38 },
    margemEbitda: { p25: 5, p50: 12, p75: 20 },
    margemLiquida: { p25: 2, p50: 7, p75: 13 },
    giroAtivo: { p25: 0.6, p50: 1.1, p75: 1.7 },
    endividamento: { p25: 45, p50: 60, p75: 75 },
    pmr: { p25: 30, p50: 50, p75: 80 },
    pmp: { p25: 25, p50: 45, p75: 70 },
    evEbitda: { p25: 3, p50: 5, p75: 8 },
  },
  {
    id: "serv-transporte",
    label: "Transporte / Logística",
    businessType: "servicos",
    margemBruta: { p25: 20, p50: 30, p75: 42 },
    margemEbitda: { p25: 6, p50: 13, p75: 22 },
    margemLiquida: { p25: 2, p50: 6, p75: 12 },
    giroAtivo: { p25: 1.0, p50: 1.6, p75: 2.4 },
    endividamento: { p25: 45, p50: 60, p75: 75 },
    pmr: { p25: 25, p50: 45, p75: 65 },
    pmp: { p25: 20, p50: 35, p75: 50 },
    evEbitda: { p25: 3, p50: 5, p75: 7 },
  },
  {
    id: "serv-imobiliario",
    label: "Imobiliário / Locação",
    businessType: "servicos",
    margemBruta: { p25: 50, p50: 65, p75: 80 },
    margemEbitda: { p25: 15, p50: 28, p75: 45 },
    margemLiquida: { p25: 8, p50: 18, p75: 30 },
    giroAtivo: { p25: 0.3, p50: 0.6, p75: 1.0 },
    endividamento: { p25: 40, p50: 60, p75: 75 },
    pmr: { p25: 5, p50: 15, p75: 30 },
    pmp: { p25: 10, p50: 20, p75: 35 },
    evEbitda: { p25: 6, p50: 9, p75: 13 },
  },
  {
    id: "serv-agencia",
    label: "Agência / Marketing / Comunicação",
    businessType: "servicos",
    margemBruta: { p25: 45, p50: 60, p75: 75 },
    margemEbitda: { p25: 8, p50: 17, p75: 28 },
    margemLiquida: { p25: 4, p50: 11, p75: 20 },
    giroAtivo: { p25: 1.2, p50: 2.0, p75: 3.2 },
    endividamento: { p25: 25, p50: 45, p75: 60 },
    pmr: { p25: 20, p50: 40, p75: 65 },
    pmp: { p25: 15, p50: 30, p75: 50 },
    evEbitda: { p25: 3, p50: 6, p75: 9 },
  },

  // ===== COMÉRCIO =====
  {
    id: "com-varejo-geral",
    label: "Varejo geral",
    businessType: "comercio",
    margemBruta: { p25: 22, p50: 32, p75: 42 },
    margemEbitda: { p25: 4, p50: 9, p75: 16 },
    margemLiquida: { p25: 1.5, p50: 5, p75: 10 },
    giroAtivo: { p25: 1.5, p50: 2.5, p75: 4.0 },
    endividamento: { p25: 45, p50: 60, p75: 72 },
    pmr: { p25: 5, p50: 15, p75: 30 },
    pmp: { p25: 25, p50: 40, p75: 60 },
    evEbitda: { p25: 3, p50: 5, p75: 8 },
  },
  {
    id: "com-supermercado",
    label: "Supermercado / Mercearia",
    businessType: "comercio",
    margemBruta: { p25: 18, p50: 24, p75: 30 },
    margemEbitda: { p25: 3, p50: 6, p75: 10 },
    margemLiquida: { p25: 1, p50: 3, p75: 5 },
    giroAtivo: { p25: 2.5, p50: 4.0, p75: 6.0 },
    endividamento: { p25: 45, p50: 60, p75: 72 },
    pmr: { p25: 0, p50: 3, p75: 8 },
    pmp: { p25: 20, p50: 35, p75: 50 },
    evEbitda: { p25: 4, p50: 6, p75: 9 },
  },
  {
    id: "com-vestuario",
    label: "Vestuário / Moda",
    businessType: "comercio",
    margemBruta: { p25: 40, p50: 52, p75: 62 },
    margemEbitda: { p25: 5, p50: 11, p75: 20 },
    margemLiquida: { p25: 2, p50: 6, p75: 13 },
    giroAtivo: { p25: 1.2, p50: 2.0, p75: 3.0 },
    endividamento: { p25: 40, p50: 55, p75: 68 },
    pmr: { p25: 10, p50: 25, p75: 45 },
    pmp: { p25: 30, p50: 45, p75: 60 },
    evEbitda: { p25: 4, p50: 6, p75: 9 },
  },
  {
    id: "com-eletro",
    label: "Eletro / Eletrônicos",
    businessType: "comercio",
    margemBruta: { p25: 18, p50: 26, p75: 35 },
    margemEbitda: { p25: 3, p50: 7, p75: 13 },
    margemLiquida: { p25: 1, p50: 4, p75: 8 },
    giroAtivo: { p25: 1.8, p50: 3.0, p75: 4.5 },
    endividamento: { p25: 45, p50: 60, p75: 72 },
    pmr: { p25: 10, p50: 25, p75: 45 },
    pmp: { p25: 30, p50: 45, p75: 65 },
    evEbitda: { p25: 3, p50: 5, p75: 8 },
  },
  {
    id: "com-farmacia",
    label: "Farmácia",
    businessType: "comercio",
    margemBruta: { p25: 22, p50: 30, p75: 38 },
    margemEbitda: { p25: 4, p50: 9, p75: 15 },
    margemLiquida: { p25: 2, p50: 5, p75: 10 },
    giroAtivo: { p25: 2.0, p50: 3.5, p75: 5.0 },
    endividamento: { p25: 40, p50: 55, p75: 68 },
    pmr: { p25: 5, p50: 15, p75: 30 },
    pmp: { p25: 25, p50: 40, p75: 55 },
    evEbitda: { p25: 5, p50: 7, p75: 10 },
  },
  {
    id: "com-autopecas",
    label: "Autopeças / Veículos",
    businessType: "comercio",
    margemBruta: { p25: 18, p50: 26, p75: 35 },
    margemEbitda: { p25: 3, p50: 7, p75: 13 },
    margemLiquida: { p25: 1, p50: 4, p75: 8 },
    giroAtivo: { p25: 1.5, p50: 2.5, p75: 3.8 },
    endividamento: { p25: 45, p50: 60, p75: 72 },
    pmr: { p25: 15, p50: 30, p75: 50 },
    pmp: { p25: 25, p50: 40, p75: 60 },
    evEbitda: { p25: 3, p50: 5, p75: 7 },
  },
  {
    id: "com-atacado",
    label: "Atacado / Distribuição",
    businessType: "comercio",
    margemBruta: { p25: 12, p50: 18, p75: 26 },
    margemEbitda: { p25: 3, p50: 6, p75: 11 },
    margemLiquida: { p25: 1, p50: 3, p75: 7 },
    giroAtivo: { p25: 2.0, p50: 3.5, p75: 5.5 },
    endividamento: { p25: 50, p50: 65, p75: 78 },
    pmr: { p25: 25, p50: 45, p75: 65 },
    pmp: { p25: 25, p50: 40, p75: 55 },
    evEbitda: { p25: 3, p50: 5, p75: 7 },
  },

  // ===== INDÚSTRIA =====
  {
    id: "ind-alimentos",
    label: "Indústria de alimentos / bebidas",
    businessType: "industria",
    margemBruta: { p25: 25, p50: 35, p75: 45 },
    margemEbitda: { p25: 8, p50: 14, p75: 22 },
    margemLiquida: { p25: 3, p50: 7, p75: 13 },
    giroAtivo: { p25: 0.8, p50: 1.3, p75: 2.0 },
    endividamento: { p25: 40, p50: 55, p75: 70 },
    pmr: { p25: 25, p50: 40, p75: 60 },
    pmp: { p25: 25, p50: 40, p75: 55 },
    evEbitda: { p25: 4, p50: 7, p75: 10 },
  },
  {
    id: "ind-metalmec",
    label: "Indústria metal-mecânica",
    businessType: "industria",
    margemBruta: { p25: 22, p50: 30, p75: 40 },
    margemEbitda: { p25: 6, p50: 12, p75: 20 },
    margemLiquida: { p25: 2, p50: 6, p75: 12 },
    giroAtivo: { p25: 0.7, p50: 1.2, p75: 1.8 },
    endividamento: { p25: 45, p50: 60, p75: 72 },
    pmr: { p25: 30, p50: 50, p75: 75 },
    pmp: { p25: 25, p50: 45, p75: 65 },
    evEbitda: { p25: 4, p50: 6, p75: 9 },
  },
  {
    id: "ind-quimica",
    label: "Indústria química / cosméticos",
    businessType: "industria",
    margemBruta: { p25: 30, p50: 42, p75: 55 },
    margemEbitda: { p25: 10, p50: 18, p75: 28 },
    margemLiquida: { p25: 4, p50: 10, p75: 18 },
    giroAtivo: { p25: 0.7, p50: 1.2, p75: 1.8 },
    endividamento: { p25: 40, p50: 55, p75: 68 },
    pmr: { p25: 30, p50: 50, p75: 70 },
    pmp: { p25: 30, p50: 45, p75: 60 },
    evEbitda: { p25: 5, p50: 8, p75: 12 },
  },
  {
    id: "ind-textil",
    label: "Indústria têxtil / confecção",
    businessType: "industria",
    margemBruta: { p25: 22, p50: 32, p75: 42 },
    margemEbitda: { p25: 5, p50: 10, p75: 17 },
    margemLiquida: { p25: 1, p50: 4, p75: 10 },
    giroAtivo: { p25: 0.8, p50: 1.3, p75: 2.0 },
    endividamento: { p25: 45, p50: 60, p75: 72 },
    pmr: { p25: 35, p50: 55, p75: 75 },
    pmp: { p25: 30, p50: 45, p75: 60 },
    evEbitda: { p25: 3, p50: 5, p75: 7 },
  },
];

export function listSectors(bt?: BusinessType): SectorBenchmark[] {
  return bt ? SECTORS.filter((s) => s.businessType === bt) : SECTORS;
}

export function getSector(id: string): SectorBenchmark | undefined {
  return SECTORS.find((s) => s.id === id);
}

/** Encontra setor por palavra-chave (label/id). */
export function findSector(query: string): SectorBenchmark | undefined {
  const q = query.toLowerCase().trim();
  return SECTORS.find((s) => s.id.toLowerCase().includes(q) || s.label.toLowerCase().includes(q));
}

/**
 * Resolve o benchmark efetivo da empresa, com precedência:
 *   1) `state.benchmarkCustom` (P50 personalizado, P25/P75 = ±20%)
 *   2) `state.ramoAtuacao` (id direto de SECTORS)
 *   3) primeiro setor que case com `state.businessType`
 */
export function resolveBenchmark(state: {
  businessType?: BusinessType;
  ramoAtuacao?: string;
  benchmarkCustom?: Partial<
    Record<
      | "margemBruta"
      | "margemEbitda"
      | "margemLiquida"
      | "giroAtivo"
      | "endividamento"
      | "pmr"
      | "pmp"
      | "evEbitda",
      number
    >
  >;
}): SectorBenchmark | undefined {
  // Base: setor escolhido ou primeiro do businessType.
  const base: SectorBenchmark | undefined =
    (state.ramoAtuacao ? getSector(state.ramoAtuacao) : undefined) ??
    (state.businessType ? listSectors(state.businessType)[0] : undefined);
  if (!base) return undefined;

  const cb = state.benchmarkCustom;
  if (!cb) return base;

  // Override por métrica: usa P50 customizado e deriva P25/P75 = ±20%.
  const band = (p50: number) => ({
    p25: +(p50 * 0.8).toFixed(2),
    p50,
    p75: +(p50 * 1.2).toFixed(2),
  });
  return {
    ...base,
    label: base.label + " (personalizado)",
    margemBruta: cb.margemBruta != null ? band(cb.margemBruta) : base.margemBruta,
    margemEbitda: cb.margemEbitda != null ? band(cb.margemEbitda) : base.margemEbitda,
    margemLiquida: cb.margemLiquida != null ? band(cb.margemLiquida) : base.margemLiquida,
    giroAtivo: cb.giroAtivo != null ? band(cb.giroAtivo) : base.giroAtivo,
    endividamento: cb.endividamento != null ? band(cb.endividamento) : base.endividamento,
    pmr: cb.pmr != null ? band(cb.pmr) : base.pmr,
    pmp: cb.pmp != null ? band(cb.pmp) : base.pmp,
    evEbitda: cb.evEbitda != null ? band(cb.evEbitda) : base.evEbitda,
  };
}

/** Classifica valor da empresa frente ao setor: posição em quartil. */
export function rank(
  value: number,
  b: { p25: number; p50: number; p75: number },
  higherIsBetter = true,
): {
  position: "bottom" | "below-median" | "above-median" | "top";
  label: string;
  delta: number;
} {
  const delta = value - b.p50;
  if (higherIsBetter) {
    if (value < b.p25) return { position: "bottom", label: "abaixo do P25 (pior quartil)", delta };
    if (value < b.p50) return { position: "below-median", label: "entre P25 e mediana", delta };
    if (value < b.p75) return { position: "above-median", label: "entre mediana e P75", delta };
    return { position: "top", label: "acima do P75 (melhor quartil)", delta };
  }
  // lower is better (endividamento, pmr)
  if (value > b.p75) return { position: "bottom", label: "acima do P75 (pior quartil)", delta };
  if (value > b.p50) return { position: "below-median", label: "entre mediana e P75", delta };
  if (value > b.p25) return { position: "above-median", label: "entre P25 e mediana", delta };
  return { position: "top", label: "abaixo do P25 (melhor quartil)", delta };
}
