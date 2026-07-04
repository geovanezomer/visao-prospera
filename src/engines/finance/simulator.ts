/**
 * Simulator engine — aplica uma combinação de "alavancas" sobre o AppState
 * base e retorna um novo AppState ajustado, pronto para passar por buildDRE.
 *
 * Todas as alavancas são aditivas / multiplicativas e neutras quando em 0.
 * Permite combinar livremente para criar o "cenário perfeito".
 */

import { AppState, CostLine, TaxRegime } from "./types";
import { sumContractSaldos } from "./debtContracts";
import { buildDRE, type DRE } from "./dre";
import { calcIndicators, type Indicators } from "./indicators";
import { monthValues } from "./costs";
import { resolveEffectiveRegime } from "./regime";
import { buildValuation, defaultValuationParams } from "./valuation";
import { buildCashFlow, type CashFlow } from "./cashflow";
import { fill12, sum } from "./format";
// PR4a (Fase 1.5): unificação parcial com o catálogo de primitivas.
// Alavancas 1:1 equivalentes passam a chamar `levers/primitives.ts`.
// Alavancas com comportamento específico (volume, payroll/isLaborLine,
// terceirização, antecipação, kd, addLoan com id fixo) ficam inline e
// serão migradas depois que o registry ganhar variantes equivalentes.
import {
  adjustRevenue as p_adjustRevenue,
  cloneCosts as p_cloneCosts,
  scaleCostLines as p_scaleCostLines,
  setPmp as p_setPmp,
  setPmr as p_setPmr,
  switchRegime as p_switchRegime,
  topNFixedLines as p_topNFixedLines,
} from "./levers/primitives";

// Mesmo regex usado em sensitivity.ts/prescriptive.ts — verdade única para identificar folha.
const LABOR_RE = /sal[áa]rio|folha|clt|prolabore|pr[óo]-labore|mod|m[ãa]o de obra/i;
const PROLABORE_RE = /pr[óo]-?labore|prolabore/i;
const isLaborLine = (c: CostLine) => c.encargosAuto === true || LABOR_RE.test(c.label);
const isProlaboreLine = (c: CostLine) => PROLABORE_RE.test(c.label);


export interface SimulatorParams {
  // Receita & Preço
  priceDeltaPct: number; // -30..+30  → multiplica receita
  volumeDeltaPct: number; // -50..+50  → multiplica receita + CPV variável
  // Elasticidade-preço da demanda (|E|). 0 = desliga (volume independe do preço).
  // Convenção: variação induzida de volume = −priceElasticity × priceDeltaPct.
  // Ex.: E=1.2, +10% preço → −12% volume induzido (soma ao volumeDeltaPct manual).
  priceElasticity: number; // 0..3


  // Custos & Pessoal
  cpvDeltaPct: number; // -20..+30  → multiplica linhas custo_vendas
  payrollDeltaPct: number; // -30..+30  → multiplica linhas com encargosAuto
  prolaboreDeltaPct: number; // -50..+50  → multiplica linhas de pró-labore (subset folha) — afeta DRE
  distribuicaoDeltaPct: number; // -100..+200 → escala distribuição de lucros — afeta CAIXA (não DRE)
  fixedCutPct: number; // -50..+50  → positivo = corte, negativo = aumento nos top-N fixos
  fixedCutTopN: number; // 1..5


  // Capital de Giro
  pmrDeltaDays: number; // -60..0    (sempre reduz ou 0)
  pmpDeltaDays: number; // 0..+60    (sempre aumenta ou 0)
  antecipPctAm: number; // 0..6      custo % a.m. sobre 50% da receita
  inadimplenciaDeltaPp: number; // -5..+10 p.p. somados à inadimplência mensal

  // Dívida & Juros
  loanPrincipal: number; // R$ captado no mês 1
  loanTermMonths: number; // 6..60
  loanRatePctAm: number; // 0.5..5 % a.m.
  debtPaydownPct: number; // 0..100  % do principal quitado no mês 1
  kdDeltaPp: number; // -5..+5  pontos percentuais ao ano

  // Tributário
  regimeOverride: TaxRegime | "base"; // base = não muda
}

export const DEFAULT_SIM: SimulatorParams = {
  priceDeltaPct: 0,
  volumeDeltaPct: 0,
  priceElasticity: 0,
  cpvDeltaPct: 0,

  payrollDeltaPct: 0,
  prolaboreDeltaPct: 0,
  distribuicaoDeltaPct: 0,
  fixedCutPct: 0,
  fixedCutTopN: 3,

  pmrDeltaDays: 0,
  pmpDeltaDays: 0,
  antecipPctAm: 0,
  inadimplenciaDeltaPp: 0,

  loanPrincipal: 0,
  loanTermMonths: 12,
  loanRatePctAm: 2,
  debtPaydownPct: 0,
  kdDeltaPp: 0,
  regimeOverride: "base",
};

const cloneCosts = p_cloneCosts;

function topNFixedIds(state: AppState, n: number): Set<string> {
  return new Set(p_topNFixedLines(state, Math.max(1, Math.round(n))).map((l) => l.id));
}

export function applySimulator(base: AppState, p: SimulatorParams): AppState {
  const s: AppState = {
    ...base,
    revenue: {
      ...base.revenue,
      bruta: base.revenue.bruta.slice(),
      inadimplencia: base.revenue.inadimplencia.slice(),
      // Clona deduções e receitas financeiras profundas — para aplicar volume sem mutar o estado base.
      deducoes: base.revenue.deducoes?.map((d) => ({ ...d, valores: d.valores.slice() })),
      receitasFinanceiras: base.revenue.receitasFinanceiras?.map((d) => ({
        ...d,
        valores: d.valores.slice(),
      })),
    },
    costs: cloneCosts(base.costs),
    capital: {
      ...base.capital,
      debtContracts: (base.capital.debtContracts ?? []).map((d) => ({ ...d })),
    },
    cashflow: {
      ...base.cashflow,
      emprestimosCaptados: base.cashflow.emprestimosCaptados.slice(),
      amortizacoes: base.cashflow.amortizacoes.slice(),
      capex: base.cashflow.capex.slice(),
      dividendos: base.cashflow.dividendos.slice(),
    },
    distribuicaoRealizada: base.distribuicaoRealizada
      ? {
          ...base.distribuicaoRealizada,
          values: base.distribuicaoRealizada.values.slice() as typeof base.distribuicaoRealizada.values,
        }
      : base.distribuicaoRealizada,

    tax: { ...base.tax },
  };

  // 1) Preço — primitiva adjustRevenue (escala receita bruta).
  if (p.priceDeltaPct !== 0) {
    s.revenue = p_adjustRevenue(s, 1 + p.priceDeltaPct / 100).revenue;
  }

  // 2) Volume: receita + custo_vendas + variavel + deduções absolutas (S2)
  // Inadimplência é %, escala automaticamente. Devoluções/descontos/abatimentos são R$ absolutos —
  // precisam crescer junto, senão Receita Líquida fica artificialmente alta em volumes maiores.
  // Volume efetivo = volumeDeltaPct manual + induzido pela elasticidade-preço.
  // E.g., E=1.2 e +10% preço → −12% volume induzido. Clamp em [−90, +200] para
  // evitar destruição completa da receita em combinações extremas.
  const inducedVolPct = -(p.priceElasticity || 0) * (p.priceDeltaPct || 0);
  const effectiveVolPct = Math.max(-90, Math.min(200, (p.volumeDeltaPct || 0) + inducedVolPct));
  if (effectiveVolPct !== 0) {
    const f = 1 + effectiveVolPct / 100;
    s.revenue.bruta = s.revenue.bruta.map((v) => v * f);

    if (s.revenue.deducoes) {
      s.revenue.deducoes = s.revenue.deducoes.map((d) => ({
        ...d,
        valores: d.valores.map((v) => v * f),
      }));
    }
    s.costs = s.costs.map((c) =>
      c.category === "custo_vendas" || c.category === "direto_venda" ||
      c.category === "variavel" || c.category === "despesa_comercial"
        ? { ...c, values: c.values.map((v) => v * f) }
        : c,
    );
  }

  // 3) CPV — escala TODAS as linhas tratadas como CPV (custo_vendas E direto_venda).
  if (p.cpvDeltaPct !== 0) {
    const f = 1 + p.cpvDeltaPct / 100;
    s.costs = s.costs.map((c) =>
      c.category === "custo_vendas" || c.category === "direto_venda"
        ? { ...c, values: c.values.map((v) => v * f) }
        : c,
    );
  }

  // 4) Folha — usa isLaborLine (encargosAuto OU regex de folha), igual a sensitivity/prescriptive (S3).
  if (p.payrollDeltaPct !== 0) {
    const f = 1 + p.payrollDeltaPct / 100;
    s.costs = s.costs.map((c) =>
      isLaborLine(c) ? { ...c, values: c.values.map((v) => v * f) } : c,
    );
  }

  // 4b) Pró-labore — escala APENAS linhas de pró-labore (subset de folha). Afeta DRE
  //     (despesa de pessoal/administrativa), portanto EBITDA, LAIR e Lucro Líquido.
  //     Aplicado APÓS a folha (compõe multiplicativamente se ambas alavancas estiverem ativas).
  if (p.prolaboreDeltaPct !== 0) {
    const f = 1 + p.prolaboreDeltaPct / 100;
    s.costs = s.costs.map((c) =>
      isProlaboreLine(c) ? { ...c, values: c.values.map((v) => v * f) } : c,
    );
  }

  // 4c) Distribuição de Lucros — NÃO afeta DRE (é destinação do lucro líquido).
  //     [SSOT] Escala APENAS state.distribuicaoRealizada; cashflow.dividendos é
  //     derivado no buildCashFlow. Escalar ambos causaria drift.
  if (p.distribuicaoDeltaPct !== 0) {
    const f = 1 + p.distribuicaoDeltaPct / 100;
    if (s.distribuicaoRealizada) {
      s.distribuicaoRealizada = {
        ...s.distribuicaoRealizada,
        values: s.distribuicaoRealizada.values.map((v) => Math.max(0, v * f)) as typeof s.distribuicaoRealizada.values,
      };
    } else {
      // Fallback legado — sem distribuicaoRealizada, escala o campo antigo.
      s.cashflow.dividendos = s.cashflow.dividendos.map((v) => Math.max(0, v * f));
    }
  }



  // 5) Ajuste de fixos (top-N) — primitiva scaleCostLines (já cobre fixo + despesa_administrativa).
  if (p.fixedCutPct !== 0) {
    const ids = topNFixedIds(s, p.fixedCutTopN);
    const f = 1 - p.fixedCutPct / 100;
    s.costs = p_scaleCostLines(s, ids, f).costs;
  }

  // 6) Inadimplência — soma p.p. à série mensal (clampada a [0, 100]).
  if (p.inadimplenciaDeltaPp !== 0) {
    s.revenue.inadimplencia = s.revenue.inadimplencia.map((v) =>
      Math.max(0, Math.min(100, v + p.inadimplenciaDeltaPp)),
    );
  }

  // 7) PMR / PMP — primitivas setPmr / setPmp.
  if (p.pmrDeltaDays !== 0) {
    s.revenue = p_setPmr(s, s.revenue.pmr + p.pmrDeltaDays).revenue;
  }
  if (p.pmpDeltaDays !== 0) {
    s.revenue = p_setPmp(s, s.revenue.pmp + p.pmpDeltaDays).revenue;
  }

  // 8) Antecipação de recebíveis — custo financeiro + aceleração de caixa (PMR ↓).
  //    Hipótese: antecipa-se 50% da carteira; reduzimos PMR proporcionalmente ao % a.m.,
  //    cap em 20 dias para evitar redução irreal em taxas altas.
  if (p.antecipPctAm > 0) {
    const custo = s.revenue.bruta.map((v) => v * 0.5 * (p.antecipPctAm / 100));
    s.costs.push({
      id: "sim_antecip",
      label: `Antecipação de recebíveis (${p.antecipPctAm.toFixed(2)}% a.m.)`,
      category: "financeiro",
      values: custo,
      fixed: false,
      custom: true,
    });
    const reduce = Math.min(20, Math.round(s.revenue.pmr * 0.5));
    s.revenue = p_setPmr(s, Math.max(0, s.revenue.pmr - reduce)).revenue;
  }

  // 9) kd / Selic — escala juros existentes (linhas financeiras com "juros" no rótulo
  //    OU linhas sintéticas do simulador/contratos de dívida).
  const isInterestLine = (c: CostLine) =>
    c.category === "financeiro" &&
    (/juros/i.test(c.label) ||
      c.id === "sim_loan_juros" ||
      c.id.startsWith("__debt_contracts"));
  if (p.kdDeltaPp !== 0) {
    const kdAtual = Math.max(s.capital.kd, 0.5);
    const novoKd = Math.max(0.5, s.capital.kd + p.kdDeltaPp);
    const fator = novoKd / kdAtual;
    s.capital.kd = novoKd;
    s.costs = s.costs.map((c) =>
      isInterestLine(c) ? { ...c, values: c.values.map((v) => v * fator) } : c,
    );
  }


  // 10) Quitar dívida EXISTENTE (antes de captar)
  if (p.debtPaydownPct > 0) {
    const pct = p.debtPaydownPct / 100;
    const pago = sumContractSaldos(s.capital.debtContracts) * pct;
    s.capital = { ...s.capital, debtContracts: (s.capital.debtContracts ?? []).map(c => ({...c, saldoDevedor: Math.max(0, (c.saldoDevedor||0)*(1-pct))})) };
    s.costs = s.costs.map((c) =>
      isInterestLine(c) ? { ...c, values: c.values.map((v) => v * (1 - pct)) } : c,
    );
    // Reduz também o saldo dos contratos para que a projeção plurianual reflita a quitação.
    if (s.capital.debtContracts?.length) {
      s.capital.debtContracts = s.capital.debtContracts.map((d) => ({
        ...d,
        saldoDevedor: Math.max(0, (d.saldoDevedor || 0) * (1 - pct)),
      }));
    }
    s.cashflow.amortizacoes[0] = (s.cashflow.amortizacoes[0] || 0) + pago;
  }

  // 11) Captar empréstimo NOVO (PRICE) — depois da quitação.
  //     Bug-fix: também registra como DebtContract para que projectCashflow capture
  //     juros/amortização nos meses > 12 (antes ficava capado em 12 meses).
  if (p.loanPrincipal > 0 && p.loanTermMonths > 0) {
    const i = p.loanRatePctAm / 100;
    const pmt =
      i === 0
        ? p.loanPrincipal / p.loanTermMonths
        : p.loanPrincipal * (i / (1 - Math.pow(1 + i, -p.loanTermMonths)));
    const jurosArr = Array(12).fill(0);
    const amortArr = s.cashflow.amortizacoes.slice();
    let saldo = p.loanPrincipal;
    for (let k = 0; k < p.loanTermMonths && k < 12; k++) {
      const j = saldo * i;
      const a = pmt - j;
      jurosArr[k] += j;
      amortArr[k] = (amortArr[k] || 0) + a;
      saldo -= a;
    }
    s.cashflow.emprestimosCaptados[0] = (s.cashflow.emprestimosCaptados[0] || 0) + p.loanPrincipal;
    s.cashflow.amortizacoes = amortArr;
    // (loan principal já entra via cashflow.emprestimosCaptados; a dívida é rastreada pelos contratos — o simulador não cria contrato sintético neste MVP)
    s.costs.push({
      id: "sim_loan_juros",
      label: `Juros novo empréstimo (${p.loanRatePctAm.toFixed(2)}% a.m.)`,
      category: "financeiro",
      values: jurosArr,
      fixed: false,
      custom: true,
    });
    // Contrato sintético para projeção plurianual (taxa aa equivalente nominal).
    const taxaAA = p.loanRatePctAm * 12;
    s.capital.debtContracts = [
      ...(s.capital.debtContracts ?? []),
      {
        id: `sim_loan_${Date.now()}`,
        credor: "Simulação",
        descricao: "Empréstimo simulado",
        saldoDevedor: p.loanPrincipal,
        taxaAA,
        sistema: "price",
        prazoMeses: p.loanTermMonths,
        mesCaptacao: 1,
        valorCaptado: p.loanPrincipal,
      },
    ];
  }


  // 12) Regime — primitiva switchRegime.
  if (p.regimeOverride !== "base") {
    s.tax = p_switchRegime(s, p.regimeOverride).tax;
  }

  return s;
}

// ---------- Resumo de DRE para a UI ----------

export interface SimDREView {
  receitaBruta: number;
  deducoes: number;
  // Detalhamento das deduções (anual)
  devolucoesCancelamentos: number;
  descontosIncondicionais: number;
  abatimentos: number;
  tributosReceita: number;
  receitaLiquida: number;
  cpv: number;
  lucroBruto: number;
  despesasOp: number;
  // Detalhamento das despesas operacionais (anual)
  despesasComerciais: number;
  despesasAdministrativas: number;
  outrasOperacionais: number; // inclui D&A com sinal negativo
  ebitda: number;
  depreciacao: number;
  ebit: number; // = Lucro Operacional
  // Bloco financeiro
  receitasFinanceiras: number;
  ganhoAlienacao: number;
  laft: number; // Lucro Antes do Financiamento e Tributos
  despesasFinanceiras: number;
  resultadoFinanceiro: number; // receitasFin − despesasFin (compat)
  lair: number; // = EBT
  impostos: number;
  lucroLiquido: number;

  margemBruta: number;
  margemEbitda: number;
  margemLiquida: number;
  roic: number;
  ncg: number;
  gapCapitalGiro: number;
  saldoCaixaFinal: number;
  piorMesCaixa: number;
  coberturaJuros: number;
  enterpriseValue: number;
  equityValue: number;
}

/**
 * Snapshot resumido do DRE/indicadores para o painel Base × Simulado.
 *
 * S1/S9: usa regime efetivo (não nominal) — alinhado com Indicators/Diagnosis.
 * S6: aceita `precomputed` (vindo de useFinanceModel) para o `baseView`,
 *     evitando uma rodada extra de buildDRE+calcIndicators+buildCashFlow por render.
 */
export interface SimViewPrecomputed {
  regime?: TaxRegime;
  dre?: DRE;
  ind?: Indicators;
  cf?: CashFlow;
}

export function computeSimView(state: AppState, precomputed?: SimViewPrecomputed): SimDREView {
  const regime = precomputed?.regime ?? resolveEffectiveRegime(state);
  const dre = precomputed?.dre ?? buildDRE(state, regime).dre;
  const ind = precomputed?.ind ?? calcIndicators(state, dre);
  const cf = precomputed?.cf ?? buildCashFlow(state);
  const deducoes = sum(dre.deducoesInadimplencia);

  // Descontos Incondicionais e Abatimentos via revenue.deducoes
  const dedById = (id: string) => state.revenue.deducoes?.find((d) => d.id === id);
  const descIncond = sum(dedById("desc_incond")?.valores ?? []);
  const abatim = sum(dedById("abatimentos")?.valores ?? []);

  // Comerciais (variavel) / Administrativas (fixo) / Financeiras (financeiro) — usa regime EFETIVO.
  let despComerciais = 0,
    despAdmin = 0,
    despFinanc = 0;
  for (const c of state.costs) {
    const v = sum(monthValues(c, regime));
    if (c.category === "despesa_comercial" || c.category === "variavel") despComerciais += v;
    else if (c.category === "despesa_administrativa" || c.category === "fixo") despAdmin += v;
    else if (c.category === "financeiro") despFinanc += v;
  }
  // Outras receitas/(despesas) operacionais — alinhado ao buildDRE:
  //   outras = outrasReceitasOperacionais − depreciação (D&A entra como redutor).
  const outrasOp = sum(dre.outrasReceitasOperacionais) - sum(dre.depreciacao);
  const receitasFin = sum(state.revenue.receitasFinanceiras?.flatMap((r) => r.valores ?? []) ?? []);


  const ganhoAlien = 0;
  const ebit = sum(dre.ebit);
  const laft = ebit + receitasFin + ganhoAlien;

  const valParams = defaultValuationParams(state.businessType);
  const val = buildValuation(state, valParams);

  // tax.annual = total de impostos (vendas + lucro). Derivamos de dre.impostosTotal para
  // evitar uma 2ª chamada a buildDRE quando temos precomputed.
  const impostosAnuais = sum(dre.impostosTotal);

  return {
    receitaBruta: sum(dre.receitaBruta),
    deducoes,
    devolucoesCancelamentos: deducoes,
    descontosIncondicionais: descIncond,
    abatimentos: abatim,
    tributosReceita: sum(dre.impostosVendas),
    receitaLiquida: sum(dre.receitaLiquida),
    cpv: sum(dre.cpv),
    lucroBruto: sum(dre.lucroBruto),
    despesasOp: sum(dre.despesasOperacionais),
    despesasComerciais: despComerciais,
    despesasAdministrativas: despAdmin,
    outrasOperacionais: outrasOp,
    ebitda: sum(dre.ebitda),
    depreciacao: sum(dre.depreciacao),
    ebit,
    receitasFinanceiras: receitasFin,
    ganhoAlienacao: ganhoAlien,
    laft,
    despesasFinanceiras: despFinanc,
    resultadoFinanceiro: sum(dre.resultadoFinanceiro),
    lair: sum(dre.lair),
    impostos: impostosAnuais,
    lucroLiquido: sum(dre.lucroLiquido),
    margemBruta: ind.margemBruta,
    margemEbitda: ind.margemEbitda,
    margemLiquida: ind.margemLiquida,
    roic: ind.roic,
    ncg: ind.ncg,
    gapCapitalGiro: ind.gapCapitalGiro,
    saldoCaixaFinal: cf.totais.saldoFinal,
    piorMesCaixa: cf.totais.pioresMes?.saldo ?? 0,
    coberturaJuros: ind.coberturaJuros,
    enterpriseValue: val.enterpriseValue.base,
    equityValue: val.equityValue.base,
  };
}

export function countActiveLevers(p: SimulatorParams): number {
  let n = 0;
  if (p.priceDeltaPct !== 0) n++;
  if (p.volumeDeltaPct !== 0) n++;
  if (p.priceElasticity > 0 && p.priceDeltaPct !== 0) n++;
  if (p.cpvDeltaPct !== 0) n++;
  if (p.payrollDeltaPct !== 0) n++;
  if (p.prolaboreDeltaPct !== 0) n++;
  if (p.distribuicaoDeltaPct !== 0) n++;

  if (p.fixedCutPct !== 0) n++;

  
  if (p.pmrDeltaDays !== 0) n++;
  if (p.pmpDeltaDays !== 0) n++;
  if (p.antecipPctAm > 0) n++;
  if (p.inadimplenciaDeltaPp !== 0) n++;

  if (p.loanPrincipal > 0) n++;
  if (p.debtPaydownPct > 0) n++;
  if (p.kdDeltaPp !== 0) n++;
  if (p.regimeOverride !== "base") n++;
  return n;
}

export const PRESETS: { id: string; label: string; params: Partial<SimulatorParams> }[] = [
  { id: "neutro", label: "Resetar", params: {} },
  {
    id: "crise_leve",
    label: "Crise leve",
    params: { volumeDeltaPct: -10, cpvDeltaPct: 5, kdDeltaPp: 1 },
  },
  {
    id: "crise_dura",
    label: "Crise dura",
    params: {
      volumeDeltaPct: -25,
      cpvDeltaPct: 10,
      kdDeltaPp: 3,
      fixedCutPct: 10,
      fixedCutTopN: 3,
    },
  },
  {
    id: "expansao",
    label: "Expansão",
    params: { volumeDeltaPct: 25, payrollDeltaPct: 15, priceDeltaPct: 3 },
  },
  {
    id: "reestruturacao",
    label: "Reestruturação",
    params: {
      fixedCutPct: 20,
      fixedCutTopN: 3,
      payrollDeltaPct: -15,
      debtPaydownPct: 30,
      pmrDeltaDays: -10,
    },
  },
];
