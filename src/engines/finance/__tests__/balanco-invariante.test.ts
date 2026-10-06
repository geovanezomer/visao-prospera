// Invariante contábil — proteção permanente contra regressões futuras.
//
// Gera 50 estados pseudo-aleatórios determinísticos (seeds 1..50) e valida:
//   1. |Ativo − (Passivo + PL)|_fechamento < R$ 1  (identidade global)
//   2. ΔCR = Recebível − Recebimentos DFC          (conservação individual)
//   3. ΔFornecedores = Compras − Pagamentos DFC    (conservação individual)
//   4. ΔImpostosAPagar = Competência − Pagos DFC   (conservação individual)
//   5. Resultado do exercício = Σ Lucro Líquido DRE (SSOT sem destinações)
//
// A abertura é sempre equilibrada com o plug de `lucrosAcumulados` — mesma
// operação que o botão "Ajustar Lucros Acumulados" da UI faz.
//
// Se algum seed falhar, `printReconciliation` imprime a decomposição rubrica
// a rubrica para depuração — NÃO afrouxar a tolerância; corrigir a engine.

import { describe, expect, it } from "vitest";
import type {
  AppState,
  BusinessType,
  CostCategory,
  CostLine,
  DebtContract,
  CapexAtivacao,
  TaxRegime,
  TaxEra,
} from "../types";
import { deriveBalancoFechamento } from "../balancoFechamento";
import { buildDRE } from "../dre";
import { buildCashFlow, buildRecebivelMensal, buildComprasMensal } from "../cashflow";
import { resolveEffectiveRegime } from "../regime";
import { deriveAbertura } from "../aberturaDerivada";
import { normalizeStateFromBalanco } from "../balanco";
import { buildFinancialModel } from "../financialModel";
import { createState } from "./helpers";

// ────────────────── PRNG determinístico (mulberry32) ──────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helpers de amostragem.
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const rInt = (rng: () => number, lo: number, hi: number): number =>
  Math.floor(rng() * (hi - lo + 1)) + lo;
const rFloat = (rng: () => number, lo: number, hi: number): number => rng() * (hi - lo) + lo;

const sumArr = (a: number[] | undefined): number => (a ?? []).reduce((x, y) => x + (y || 0), 0);

// ────────────────── Gerador de estados aleatórios ──────────────────
function randomState(seed: number): AppState {
  const rng = mulberry32(seed);

  const businessType = pick<BusinessType>(rng, ["servicos", "comercio", "industria"]);
  const regime = pick<TaxRegime>(rng, ["simples", "presumido", "real"]);
  const era = pick<TaxEra>(rng, ["atual", "transicao", "pleno"]);

  // Receita: 50k–800k por mês, com 3 padrões.
  const receitaBase = rFloat(rng, 50_000, 800_000);
  const padrao = pick(rng, ["uniforme", "sazonal", "crescente"] as const);
  const bruta = Array.from({ length: 12 }, (_, i) => {
    if (padrao === "uniforme") return receitaBase;
    if (padrao === "sazonal")
      return receitaBase * (0.6 + 0.8 * Math.abs(Math.sin((i / 12) * Math.PI * 2)));
    return receitaBase * (0.7 + (0.6 * i) / 11); // crescente
  });

  // PMR/PMP em 0–90 (valores não múltiplos de 30 inclusos).
  const pmr = rInt(rng, 0, 90);
  const pmp = rInt(rng, 0, 90);
  const inadimplenciaPct = rFloat(rng, 0, 5);

  // Linhas de custo: 3–8 com mix e alguns encargosAuto.
  const nCostLines = rInt(rng, 3, 8);
  const cats: CostCategory[] = [
    "custo_vendas",
    "despesa_administrativa",
    "despesa_comercial",
    "financeiro",
  ];
  const costs: CostLine[] = [];
  for (let i = 0; i < nCostLines; i++) {
    const cat = pick(rng, cats);
    const isFolha = cat !== "financeiro" && rng() < 0.4;
    const valor = rFloat(rng, 1_000, receitaBase * 0.15);
    costs.push({
      id: `rand_${seed}_${i}`,
      label: isFolha ? `Folha CLT time ${i}` : `Custo ${cat} ${i}`,
      category: cat,
      values: Array.from({ length: 12 }, () => valor),
      fixed: true,
      encargosAuto: isFolha,
      encargosPct: isFolha ? 70 : undefined,
      custom: true,
    });
  }

  // Contratos de dívida: 0–3.
  const nContratos = rInt(rng, 0, 3);
  const debtContracts: DebtContract[] = [];
  let dividaTotal = 0;
  for (let i = 0; i < nContratos; i++) {
    const saldo = rFloat(rng, 50_000, 400_000);
    dividaTotal += saldo;
    debtContracts.push({
      id: `dbt_${seed}_${i}`,
      credor: `Banco ${i}`,
      saldoDevedor: saldo,
      taxaAA: rFloat(rng, 8, 25),
      sistema: pick(rng, ["price", "sac"] as const),
      prazoMeses: rInt(rng, 6, 60),
      tipoCredor: "banco",
      frequenciaAmortizacao: "mensal",
    });
  }

  // CAPEX 0–2 ativações.
  const nCapex = rInt(rng, 0, 2);
  const capexAtivacao: CapexAtivacao[] = [];
  for (let i = 0; i < nCapex; i++) {
    capexAtivacao.push({
      id: `cpx_${seed}_${i}`,
      label: `Ativo ${i}`,
      mes: rInt(rng, 1, 12),
      valor: rFloat(rng, 20_000, 300_000),
      vidaUtilMeses: rInt(rng, 24, 120),
    });
  }

  // Dividendos: 0–30% do LL, aproximado como % da receita anual*0.1.
  const dividPct = rFloat(rng, 0, 0.3);
  const llAprox = sumArr(bruta) * 0.1;
  const dividAnual = llAprox * dividPct;
  const dividendos = Array.from({ length: 12 }, () => dividAnual / 12);

  // Aportes: 0 ou valor único.
  const aportes = Array.from({ length: 12 }, () => 0);
  if (rng() < 0.4) aportes[rInt(rng, 0, 11)] = rFloat(rng, 50_000, 300_000);

  // Amortizações — pequenas, coerentes com contratos.
  const amortAnual = dividaTotal * rFloat(rng, 0.05, 0.25);
  const amortizacoes = Array.from({ length: 12 }, () => amortAnual / 12);

  // Depreciação mensal e balanço de abertura coerente.
  const depMensal = rFloat(rng, 200, 5000);
  const caixaIni = rFloat(rng, 20_000, 200_000);
  const crIni = rFloat(rng, 0, receitaBase * 2);
  const estoquesIni = rFloat(rng, 0, receitaBase * 0.5);
  const fornIni = rFloat(rng, 0, receitaBase * 0.5);
  const imobIni = rFloat(rng, 100_000, 800_000);
  const capitalSocial = rFloat(rng, 50_000, 300_000);

  const st = createState({
    businessType,
    revenue: {
      bruta,
      inadimplencia: Array.from({ length: 12 }, () => inadimplenciaPct),
      pmr,
      pmp,
      pmrMensal: Array.from({ length: 12 }, () => pmr),
      pmpMensal: Array.from({ length: 12 }, () => pmp),
    },
    tax: { regime, era, splitPaymentAtivo: era !== "atual" },
    costs,
    capital: {
      depreciacaoMensal: depMensal,
      debtContracts,
      capexAtivacao,
      balanco: {
        ativoCirculante: {
          caixaEquivalentes: caixaIni,
          contasReceberClientes: crIni,
          estoques: estoquesIni,
        },
        ativoNaoCirculante: {
          imobilizado: {
            maquinasEquipamentos: imobIni,
          },
        },
        passivoCirculante: { fornecedores: fornIni },
        patrimonioLiquido: { capitalSocial },
      },
      abertura: { lucrosAcumulados: 0 }, // será ajustado pelo plug abaixo
    },
    cashflow: {
      aportes,
      dividendos,
      amortizacoes,
      capex: Array.from({ length: 12 }, () => 0),
      emprestimosCaptados: Array.from({ length: 12 }, () => 0),
      mutuosConcedidos: Array.from({ length: 12 }, () => 0),
      mutuosDevolvidos: Array.from({ length: 12 }, () => 0),
    },
  });

  // ── Plug de abertura (mesmo procedimento do botão da UI) ──
  const norm = normalizeStateFromBalanco(st);
  const reg = resolveEffectiveRegime(norm);
  const { dre } = buildDRE(norm, reg);
  const ab = deriveAbertura({ state: norm, impostosTotalMensais: dre.impostosTotal });
  const plug = ab.totals.diferenca; // Ativo − (Passivo+PL)
  st.capital.abertura = { ...(st.capital.abertura ?? {}), lucrosAcumulados: plug };

  return st;
}

// ────────────────── Helper de depuração (só no failure path) ──────────────────
function printReconciliation(seed: number, state: AppState): string {
  const norm = normalizeStateFromBalanco(state);
  const reg = resolveEffectiveRegime(norm);
  const { dre } = buildDRE(norm, reg);
  const cf = buildCashFlow(norm);
  const fx = deriveBalancoFechamento({ state: norm, dre, cf });
  const ab = deriveAbertura({ state: norm, impostosTotalMensais: dre.impostosTotal });

  const recebivel = sumArr(buildRecebivelMensal(norm, dre));
  const recebido = sumArr(cf.recebimentos);
  const compras = sumArr(buildComprasMensal(norm, reg));
  const pagFornec = sumArr(cf.pagamentosFornecedores);
  const impComp = sumArr(dre.impostosTotal);
  const impPag = sumArr(cf.pagamentosImpostos);

  const fmt = (n: number) => n.toFixed(2).padStart(14);

  return [
    `\n──── SEED ${seed} — reconciliação (falha na identidade) ────`,
    `Abertura : A=${fmt(ab.totals.ativo)} P=${fmt(ab.totals.passivo)} PL=${fmt(ab.totals.pl)} Δ=${fmt(ab.totals.diferenca)}`,
    `Fechament: A=${fmt(fx.totals.ativo)} P=${fmt(fx.totals.passivo)} PL=${fmt(fx.totals.pl)} Δ=${fmt(fx.totals.diferenca)}`,
    ``,
    `CR      : ini=${fmt(ab.contasReceber.value)} recebível=${fmt(recebivel)} recebido=${fmt(recebido)} fim=${fmt(fx.balanco.ativoCirculante?.contasReceberClientes ?? 0)}`,
    `Fornec  : ini=${fmt(ab.fornecedores.value)} compras=${fmt(compras)} pago=${fmt(pagFornec)} fim=${fmt(fx.balanco.passivoCirculante?.fornecedores ?? 0)}`,
    `ImpPagar: ini=${fmt(ab.impostosPagar.value)} compet.=${fmt(impComp)} pago=${fmt(impPag)} fim=${fmt(fx.balanco.passivoCirculante?.impostosPagar ?? 0)}`,
    ``,
  ].join("\n");
}

// ────────────────── Testes ──────────────────
describe("Balanço — invariante contábil sobre 50 estados aleatórios", () => {
  const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

  it.each(SEEDS)("seed %i — |Ativo − (Passivo+PL)| < R$ 1", (seed) => {
    const state = randomState(seed);
    const model = buildFinancialModel(state);
    const fx = model.balancoFechamento;

    if (Math.abs(fx.totals.diferenca) >= 1) {
      // Imprime decomposição APENAS quando falha (não polui a saída).
      console.error(printReconciliation(seed, state));
    }
    expect(Math.abs(fx.totals.diferenca)).toBeLessThan(1);
  });

  it.each(SEEDS)("seed %i — conservações individuais (CR, Fornec, ImpPagar)", (seed) => {
    const state = randomState(seed);
    const norm = normalizeStateFromBalanco(state);
    const reg = resolveEffectiveRegime(norm);
    const { dre } = buildDRE(norm, reg);
    const cf = buildCashFlow(norm);
    const fx = deriveBalancoFechamento({ state: norm, dre, cf });
    const ab = deriveAbertura({
      state: norm,
      impostosTotalMensais: dre.impostosTotal,
    });

    const crIni = ab.contasReceber.value;
    const crFim = fx.balanco.ativoCirculante?.contasReceberClientes ?? 0;
    const recebivel = sumArr(buildRecebivelMensal(norm, dre));
    const recebido = sumArr(cf.recebimentos);
    // ΔCR = recebível − recebido (tolerância de centavos)
    expect(crFim - crIni).toBeCloseTo(recebivel - recebido, 1);

    const fornIni = ab.fornecedores.value;
    const fornFim = fx.balanco.passivoCirculante?.fornecedores ?? 0;
    const compras = sumArr(buildComprasMensal(norm, reg));
    const pagFornec = sumArr(cf.pagamentosFornecedores);
    expect(fornFim - fornIni).toBeCloseTo(compras - pagFornec, 1);

    const impIni = ab.impostosPagar.value;
    const impFim = fx.balanco.passivoCirculante?.impostosPagar ?? 0;
    const impComp = sumArr(dre.impostosTotal);
    const impPag = sumArr(cf.pagamentosImpostos);
    expect(impFim - impIni).toBeCloseTo(impComp - impPag, 1);
  });

  it.each(SEEDS)("seed %i — Resultado do Exercício do Balanço = Lucro Líquido da DRE", (seed) => {
    const state = randomState(seed);
    const model = buildFinancialModel(state);
    const fx = model.balancoFechamento;

    expect(fx.balanco.patrimonioLiquido?.resultadoExercicio ?? 0).toBeCloseTo(
      sumArr(model.dre.lucroLiquido),
      2,
    );
  });

  // SSOT NCG: o indicador `ind.ncg` deve reproduzir exatamente a identidade
  // do balanço de fechamento — não pode existir divergência entre os dois
  // (bug pré-refactor mostrava R$ 47.625 no indicador vs R$ 29.000 no balanço).
  it.each(SEEDS)("seed %i — NCG do indicador === NCG implícita no Balanço", (seed) => {
    const state = randomState(seed);
    const model = buildFinancialModel(state);
    const bal = model.balancoFechamento.balanco;
    const ac = bal.ativoCirculante ?? {};
    const pc = bal.passivoCirculante ?? {};
    const cr = (ac.contasReceberClientes ?? 0) - (ac.pdd ?? 0);
    const ncgBal =
      cr +
      (ac.estoques ?? 0) -
      ((pc.fornecedores ?? 0) + (pc.salariosEncargos ?? 0) + (pc.impostosPagar ?? 0));
    expect(Math.abs(model.ind.ncg - ncgBal)).toBeLessThan(1);
  });

  it("regressão — R$ 120 mil em dividendos não reduz Resultado do Exercício", () => {
    const state = createState({
      distribuicaoRealizada: { values: Array.from({ length: 12 }, () => 10_000), fixed: true },
      cashflow: { dividendos: Array.from({ length: 12 }, () => 10_000) },
    });
    const model = buildFinancialModel(state);
    const pl = model.balancoFechamento.balanco.patrimonioLiquido;
    const lucroLiquidoDRE = sumArr(model.dre.lucroLiquido);

    expect(pl?.resultadoExercicio ?? 0).toBeCloseTo(lucroLiquidoDRE, 2);
    expect(pl?.dividendosPagosPeriodo ?? 0).toBeCloseTo(120_000, 2);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Regressão: replica o fluxo do botão "Ajustar Lucros Acumulados" da UI
  // (AberturaCard.tsx). Antes da correção da SSOT, o card passava
  // `dre.impostos` (só IRPJ+CSLL) enquanto engine/DFC usavam `impostosTotal`
  // — o plug era menor que o real em ~1 mês de tributos sobre vendas e o
  // fechamento não zerava. Este teste teria capturado o bug.
  // ─────────────────────────────────────────────────────────────────────
  it.each([1, 7, 13, 21, 33, 42])(
    "seed %i — plug calculado como o AberturaCard fecha o balanço",
    (seed) => {
      // Estado SEM aplicar o plug internamente (`randomState` já aplica);
      // reproduzimos aqui a sequência exata do card: modelo → deriveAbertura
      // com `model.dre.impostosTotal` → soma incremental em lucrosAcumulados.
      const base = randomState(seed);
      base.capital.abertura = {
        ...(base.capital.abertura ?? {}),
        lucrosAcumulados: 0,
      };

      // Passo 1 — mesma chamada que o AberturaCard faz.
      const model1 = buildFinancialModel(base);
      const ab1 = deriveAbertura({
        state: base,
        impostosTotalMensais: model1.dre.impostosTotal,
      });

      // Passo 2 — clique do botão: SOMA a diferença ao valor atual.
      base.capital.abertura = {
        ...(base.capital.abertura ?? {}),
        lucrosAcumulados: (base.capital.abertura?.lucrosAcumulados ?? 0) + ab1.totals.diferenca,
      };

      // Passo 3 — reconstrói e valida fechamento < R$ 1.
      const model2 = buildFinancialModel(base);
      expect(Math.abs(model2.balancoFechamento.totals.diferenca)).toBeLessThan(1);
    },
  );
});
