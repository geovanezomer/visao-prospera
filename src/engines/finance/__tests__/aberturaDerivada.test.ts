// Testes da SSOT de abertura (deriveAbertura + splitDebtByMaturity).
// Cobre: fontes primárias, fallbacks, classificação CP/LP por maturidade,
// 1º mês de impostos/folha, overrides editáveis e totais Ativo=Passivo+PL.

import { describe, expect, it } from "vitest";
import { deriveAbertura, splitDebtByMaturity } from "../aberturaDerivada";
import { createState, m12 } from "./helpers";
import type { DebtContract } from "../types";

const contrato = (over: Partial<DebtContract> = {}): DebtContract => ({
  id: over.id ?? crypto.randomUUID(),
  credor: over.credor ?? "Banco X",
  saldoDevedor: over.saldoDevedor ?? 100_000,
  taxaAA: over.taxaAA ?? 12,
  sistema: over.sistema ?? "price",
  prazoMeses: over.prazoMeses ?? 24,
  ...over,
});

describe("splitDebtByMaturity", () => {
  it("classifica contratos por prazo remanescente (≤12m = CP, >12m = LP)", () => {
    const { cp, lp } = splitDebtByMaturity([
      contrato({ saldoDevedor: 50_000, prazoMeses: 6 }),
      contrato({ saldoDevedor: 30_000, prazoMeses: 12 }), // limite ≤ 12 = CP
      contrato({ saldoDevedor: 100_000, prazoMeses: 13 }), // LP
      contrato({ saldoDevedor: 200_000, prazoMeses: 60 }),
    ]);
    expect(cp).toBe(80_000);
    expect(lp).toBe(300_000);
  });

  it("ignora contratos com saldo ≤ 0 ou prazo negativo", () => {
    const { cp, lp } = splitDebtByMaturity([
      contrato({ saldoDevedor: 0, prazoMeses: 6 }),
      contrato({ saldoDevedor: -100, prazoMeses: 6 }),
      contrato({ saldoDevedor: 50_000, prazoMeses: 0 }), // prazo 0 → CP
    ]);
    expect(cp).toBe(50_000);
    expect(lp).toBe(0);
  });

  it("retorna zero para lista vazia ou undefined", () => {
    expect(splitDebtByMaturity([])).toEqual({ cp: 0, lp: 0 });
    expect(splitDebtByMaturity(undefined)).toEqual({ cp: 0, lp: 0 });
  });
});

describe("deriveAbertura — fontes primárias (Card 1 do Balanço)", () => {
  it("usa capital.balanco.ativoCirculante.* como fonte primária", () => {
    const s = createState({
      capital: {
        balanco: {
          ativoCirculante: {
            caixaEquivalentes: 500_000,
            contasReceberClientes: 200_000,
            estoques: 80_000,
          },
          passivoCirculante: { fornecedores: 60_000 },
        },
        // Mesmos campos no nível raiz: NÃO devem ser usados quando Card 1 está preenchido
        disponibilidades: 999_999,
        contasReceber: 999_999,
        estoques: 999_999,
        fornecedores: 999_999,
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.caixa.value).toBe(500_000);
    expect(r.contasReceber.value).toBe(200_000);
    expect(r.estoques.value).toBe(80_000);
    expect(r.fornecedores.value).toBe(60_000);
  });

  it("cai no fallback raiz quando Card 1 está vazio", () => {
    const s = createState({
      capital: {
        balanco: undefined,
        disponibilidades: 100_000,
        contasReceber: 40_000,
        estoques: 20_000,
        fornecedores: 15_000,
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.caixa.value).toBe(100_000);
    expect(r.contasReceber.value).toBe(40_000);
    expect(r.estoques.value).toBe(20_000);
    expect(r.fornecedores.value).toBe(15_000);
  });
});

describe("deriveAbertura — empréstimos CP/LP", () => {
  it("usa splitDebtByMaturity dos contratos quando existem", () => {
    const s = createState({
      capital: {
        debtContracts: [
          contrato({ saldoDevedor: 100_000, prazoMeses: 6 }),
          contrato({ saldoDevedor: 500_000, prazoMeses: 48 }),
        ],
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.emprestimosCP.value).toBe(100_000);
    expect(r.emprestimosLP.value).toBe(500_000);
    expect(r.emprestimosCP.origem).toMatch(/Contratos.*≤ 12/);
  });

  it("sem contratos → CP = LP = 0 (sem fallback agregado)", () => {
    const s = createState({
      capital: {
        debtContracts: [],
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.emprestimosCP.value).toBe(0);
    expect(r.emprestimosLP.value).toBe(0);
    expect(r.emprestimosCP.origem).toMatch(/Sem contratos/i);
  });
});


describe("deriveAbertura — passivos derivados de DRE/Despesas (1º mês)", () => {
  it("usa impostos[0] do mês 1 para impostosPagar", () => {
    const s = createState();
    const r = deriveAbertura({
      state: s,
      impostosTotalMensais: [12_000, 11_500, 10_800, ...m12(0).slice(3)],
    });
    expect(r.impostosPagar.value).toBe(12_000);
    expect(r.impostosPagar.origem).toMatch(/mês 1/i);
  });

  it("usa folha do mês 1 (isFolhaCost — SSOT) para salariosEncargos", () => {
    // Regra atualizada: `isFolhaCost` reconhece linhas de folha via rótulo
    // (Salários, pró-labore, etc.) ou flag `encargosAuto`. Comissões nunca
    // são folha (LABOR_EXCLUDE_RE).
    const s = createState({
      costs: [
        { id: "f1", label: "Salários", category: "despesa_administrativa", fixed: true, values: [25_000, ...m12(0).slice(1)] },
        { id: "v1", label: "Comissão", category: "despesa_comercial", fixed: false, values: [5_000, ...m12(0).slice(1)] },
        { id: "c1", label: "CPV", category: "custo_vendas", fixed: false, values: m12(10_000) },
      ],
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.salariosEncargos.value).toBe(25_000);
  });

  it("zero quando arrays vazios", () => {
    const s = createState({ costs: [] });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.salariosEncargos.value).toBe(0);
    expect(r.impostosPagar.value).toBe(0);
  });
});

describe("deriveAbertura — overrides manuais editáveis", () => {
  it("respeita lucrosAcumulados, impostosRecuperar, dep/amort acum como overrides", () => {
    const s = createState({
      capital: {
        abertura: {
          lucrosAcumulados: 1_500_000,
          impostosRecuperar: 25_000,
          depreciacaoAcumulada: 80_000,
          amortizacaoAcumulada: 10_000,
        },
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.lucrosAcumulados.value).toBe(1_500_000);
    expect(r.lucrosAcumulados.editavel).toBe(true);
    expect(r.impostosRecuperar.value).toBe(25_000);
    expect(r.depreciacaoAcumulada.value).toBe(80_000);
    expect(r.amortizacaoAcumulada.value).toBe(10_000);
  });
});

describe("deriveAbertura — totais Ativo = Passivo + PL", () => {
  it("fecha balanço de abertura com tolerância", () => {
    const s = createState({
      costs: [], // zera folha p/ isolar Ativo = Passivo + PL
      capital: {
        balanco: {
          ativoCirculante: {
            caixaEquivalentes: 100_000,
            contasReceberClientes: 50_000,
            estoques: 30_000,
          },
          passivoCirculante: { fornecedores: 20_000 },
          patrimonioLiquido: {
            capitalSocial: 100_000,
            reservasCapital: 0,
          },
        },
        abertura: {
          lucrosAcumulados: 60_000, // plug para fechar
        },
        debtContracts: [],
        
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    // Ativo = 180k; Passivo = 20k; PL = 160k → diferença = 0 → fechado
    expect(r.totals.ativo).toBe(180_000);
    expect(r.totals.passivo).toBe(20_000);
    expect(r.totals.pl).toBe(160_000);
    expect(r.totals.fechado).toBe(true);
  });

  it("marca fechado=false quando ultrapassa tolerância (0.1% do ativo)", () => {
    const s = createState({
      capital: {
        balanco: {
          ativoCirculante: { caixaEquivalentes: 1_000_000 },
          patrimonioLiquido: { capitalSocial: 100_000 },
        },
        abertura: { lucrosAcumulados: 0 },
        debtContracts: [],
        
      },
    });
    const r = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(r.totals.fechado).toBe(false);
    expect(r.totals.diferenca).toBeGreaterThan(1000);
  });
});

describe("deriveAbertura — plug assistido de Lucros Acumulados", () => {
  it("aplicar o plug (lucros += diferenca) equilibra a abertura — sinal positivo", () => {
    // Ativo > Passivo+PL → diferenca > 0 → plug positivo (lucros retidos).
    const s = createState({
      capital: {
        balanco: {
          ativoCirculante: { caixaEquivalentes: 500_000 },
          patrimonioLiquido: { capitalSocial: 100_000 },
        },
        abertura: { lucrosAcumulados: 0 },
        debtContracts: [],
        
      },
    });
    const before = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(before.totals.fechado).toBe(false);
    expect(before.totals.diferenca).toBeGreaterThan(0);

    // Aplica o plug (mesma fórmula do botão "Ajustar Lucros Acumulados").
    s.capital.abertura = {
      ...(s.capital.abertura ?? {}),
      lucrosAcumulados: (s.capital.abertura?.lucrosAcumulados ?? 0) + before.totals.diferenca,
    };
    const after = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(after.totals.fechado).toBe(true);
    expect(Math.abs(after.totals.diferenca)).toBeLessThan(1);
  });

  it("aplicar o plug equilibra a abertura — sinal negativo (prejuízo acumulado)", () => {
    // Passivo+PL > Ativo → diferenca < 0 → plug negativo (prejuízo acumulado).
    const s = createState({
      capital: {
        balanco: {
          ativoCirculante: { caixaEquivalentes: 50_000 },
          patrimonioLiquido: { capitalSocial: 500_000 },
        },
        abertura: { lucrosAcumulados: 0 },
        debtContracts: [],
        
      },
    });
    const before = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(before.totals.fechado).toBe(false);
    expect(before.totals.diferenca).toBeLessThan(0);

    s.capital.abertura = {
      ...(s.capital.abertura ?? {}),
      lucrosAcumulados: (s.capital.abertura?.lucrosAcumulados ?? 0) + before.totals.diferenca,
    };
    const after = deriveAbertura({ state: s, impostosTotalMensais: [] });
    expect(after.totals.fechado).toBe(true);
    expect(after.lucrosAcumulados.value).toBeLessThan(0);
  });
});
