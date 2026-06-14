import { describe, it, expect } from "vitest";
import { crossValidate, groupBySeverity } from "../crossValidation";
import { createState, m12 } from "./helpers";

describe("crossValidate — Tier 1 (estrutural)", () => {
  it("detecta margem bruta estrutural negativa (CPV > Receita)", () => {
    const s = createState({
      revenue: { bruta: m12(10_000) },
      costs: [
        // CPV total = 15k/mês > receita 10k/mês
        { id: "cmv", label: "CMV", category: "custo_vendas", values: m12(15_000), fixed: false },
      ],
    });
    const ws = crossValidate(s);
    expect(ws.find((w) => w.id === "estrutural.margem_bruta_negativa")).toBeDefined();
    expect(ws.find((w) => w.id === "estrutural.margem_bruta_negativa")?.severity).toBe("error");
  });

  it("não dispara margem bruta negativa quando CPV < Receita", () => {
    const s = createState({
      revenue: { bruta: m12(10_000) },
      costs: [
        { id: "cmv", label: "CMV", category: "custo_vendas", values: m12(5_000), fixed: false },
      ],
    });
    const ws = crossValidate(s);
    expect(ws.find((w) => w.id === "estrutural.margem_bruta_negativa")).toBeUndefined();
  });

  it("detecta CGD > Ativo Total", () => {
    const s = createState({
      capital: { capitalGiroDisponivel: 500_000, ativoTotal: 100_000 },
    });
    const ws = crossValidate(s);
    expect(ws.find((w) => w.id === "estrutural.cgd_maior_que_ativo")).toBeDefined();
  });

  it("detecta dividendos > lucro líquido", () => {
    const s = createState({
      // receita baixa + custos médios → LL pequeno/negativo
      revenue: { bruta: m12(5_000) },
      cashflow: { dividendos: m12(20_000) },
    });
    const ws = crossValidate(s);
    const w = ws.find((x) => x.id === "estrutural.dividendos_maior_que_ll");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("error");
  });
});

describe("crossValidate — Tier 2 (fiscal)", () => {
  it("detecta Simples acima do limite (RBT12 > R$ 4,8M)", () => {
    const s = createState({
      tax: { regime: "simples" },
      // 500k/mês × 12 = 6M > 4,8M
      revenue: { bruta: m12(500_000) },
    });
    const ws = crossValidate(s);
    const w = ws.find((x) => x.id === "fiscal.simples_acima_limite");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("error");
  });

  it("não dispara Simples acima do limite quando receita < 4.8M", () => {
    const s = createState({
      tax: { regime: "simples" },
      revenue: { bruta: m12(50_000) }, // 600k/ano
    });
    const ws = crossValidate(s);
    expect(ws.find((x) => x.id === "fiscal.simples_acima_limite")).toBeUndefined();
  });

  it("info quando Lucro Real é opcional (receita < R$ 78M)", () => {
    const s = createState({
      tax: { regime: "real" },
      revenue: { bruta: m12(100_000) },
    });
    const ws = crossValidate(s);
    const w = ws.find((x) => x.id === "fiscal.real_sem_obrigatoriedade");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("info");
  });
});

describe("crossValidate — Tier 3 (operacional)", () => {
  it("detecta ciclo financeiro insustentável (> 180 dias)", () => {
    const s = createState({
      revenue: { pmr: 200, pmp: 10 },
    });
    const ws = crossValidate(s);
    expect(ws.find((x) => x.id === "operacional.ciclo_insustentavel")).toBeDefined();
  });

  it("detecta CAPEX > EBITDA anual", () => {
    // Estado lucrativo (margens saudáveis) + CAPEX desproporcional
    const s = createState({
      revenue: { bruta: m12(500_000) }, // 6M/ano, regime simples ainda
      costs: [
        { id: "cmv", label: "CMV", category: "custo_vendas", values: m12(150_000), fixed: false },
      ],
      cashflow: { capex: m12(400_000) }, // 4.8M/ano em CAPEX
    });
    const ws = crossValidate(s);
    expect(ws.find((x) => x.id === "operacional.capex_maior_que_ebitda")).toBeDefined();
  });

  it("detecta caixa mínimo excessivo", () => {
    const s = createState({
      revenue: { bruta: m12(10_000) },
      cashflow: { caixaMinimo: 100_000 }, // 10× receita média mensal
    });
    const ws = crossValidate(s);
    const w = ws.find((x) => x.id === "operacional.caixa_minimo_excessivo");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("info");
  });
});

describe("crossValidate — ordenação e agrupamento", () => {
  it("ordena por severidade (error → warn → info)", () => {
    const s = createState({
      tax: { regime: "simples" },
      revenue: { bruta: m12(500_000) }, // dispara error
      capital: { capitalGiroDisponivel: 500_000, ativoTotal: 100_000 }, // error
    });
    const ws = crossValidate(s);
    const severities = ws.map((w) => w.severity);
    // Todos os "error" devem vir antes de "warn" antes de "info"
    const lastErrorIdx = severities.lastIndexOf("error");
    const firstWarnIdx = severities.indexOf("warn");
    if (lastErrorIdx >= 0 && firstWarnIdx >= 0) {
      expect(lastErrorIdx).toBeLessThan(firstWarnIdx);
    }
  });

  it("groupBySeverity separa corretamente", () => {
    const s = createState({
      tax: { regime: "simples" },
      revenue: { bruta: m12(500_000) },
    });
    const ws = crossValidate(s);
    const grouped = groupBySeverity(ws);
    expect(grouped.error.length).toBeGreaterThan(0);
    expect(Array.isArray(grouped.warn)).toBe(true);
    expect(Array.isArray(grouped.info)).toBe(true);
  });
});

describe("crossValidate — estado padrão", () => {
  it("DEFAULT_STATE não deve gerar erros estruturais críticos", () => {
    const s = createState();
    const ws = crossValidate(s);
    const errors = ws.filter((w) => w.severity === "error");
    // Default deve estar limpo de erros estruturais (sanity check).
    expect(errors).toEqual([]);
  });
});
