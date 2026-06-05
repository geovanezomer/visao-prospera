/**
 * Testes de casos-extremos — cobrem cenários que normalmente quebram
 * cálculos financeiros: entrada zerada, contratos implícitos de
 * estruturas de dados, ciclos operacionais absurdamente longos e
 * degenerações numéricas de TIR.
 *
 * Esses testes ancoram contratos que NÃO devem mudar sem decisão
 * explícita — vide discussão de auditoria em jun/2026.
 */
import { describe, it, expect } from "vitest";
import { buildDRE, fixedCostBase, effectiveMonthValues } from "../calculations";
import { buildCashFlow } from "../cashflow";
import { irr, irrDetailed, npv } from "../forecast";
import { sum } from "../format";
import { createState, m12 } from "./helpers";

// ============================================================
// 1. Receita zerada — nenhum cálculo pode lançar/explodir
// ============================================================
describe("Edge — receita zerada", () => {
  it("DRE não quebra e retorna receitaBruta = 0", () => {
    const s = createState({ revenue: { bruta: m12(0) } });
    const { dre, tax } = buildDRE(s, s.tax.regime);
    expect(sum(dre.receitaBruta)).toBe(0);
    expect(sum(dre.receitaLiquida)).toBe(0);
    expect(Number.isFinite(sum(dre.lucroLiquido))).toBe(true);
    expect(tax.effective).toBe(0); // alíquota efetiva indefinida → 0 por convenção
  });

  it("CashFlow não quebra e recebimentos = 0 em todos os meses", () => {
    const s = createState({ revenue: { bruta: m12(0) } });
    const cf = buildCashFlow(s);
    expect(sum(cf.recebimentos)).toBe(0);
    expect(cf.contasReceberAnoSeguinte).toBe(0);
    // Saldo final deve ser apenas saldo inicial − pagamentos (todos finitos)
    cf.saldoFinal.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });

  it("Lucro Real sem receita → impostos sobre lucro = 0 (sem prejuízo a deduzir)", () => {
    const s = createState({ revenue: { bruta: m12(0) }, tax: { regime: "real" } });
    const { tax } = buildDRE(s, "real");
    expect(tax.annualLucro).toBe(0);
  });
});

// ============================================================
// 2. Contrato de custo fixo — fixedCostBase
// ============================================================
describe("Edge — contrato de custo fixo (fixedCostBase)", () => {
  it("Array uniforme → retorna o valor", () => {
    expect(fixedCostBase([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100])).toBe(100);
  });

  it("11 primeiros iguais + último diferente → assume edição do mês 12 (legado UI)", () => {
    const vals = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 250];
    expect(fixedCostBase(vals)).toBe(250);
  });

  it("Variação mensal arbitrária em custo fixo → usa primeiro (contrato: fixo = escalar)", () => {
    // Documenta o comportamento intencional: se o cost.fixed === true, o sistema
    // colapsa para um único valor. Variação "intencional" em fixo é estado
    // inconsistente — o usuário deve marcar c.fixed = false para preservar.
    const vals = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210];
    expect(fixedCostBase(vals)).toBe(100);
  });

  it("effectiveMonthValues respeita fixed e replica o escalar nos 12 meses", () => {
    const s = createState();
    const fix = s.costs.find((c) => c.fixed && !c.encargosAuto);
    if (!fix) throw new Error("DEFAULT_STATE precisa ter ao menos um fixo sem encargos");
    const vals = effectiveMonthValues(fix);
    expect(vals).toHaveLength(12);
    expect(new Set(vals).size).toBe(1); // todos iguais
  });
});

// ============================================================
// 3. Regime tributário — saídas DEVEM divergir entre regimes
// ============================================================
describe("Edge — comparação entre regimes tributários", () => {
  it("Mesma receita gera impostos diferentes em Simples vs Presumido vs Real", () => {
    const base = { revenue: { bruta: m12(50000) } };
    const sSimp = createState({ ...base, tax: { regime: "simples" } });
    const sPres = createState({ ...base, tax: { regime: "presumido" } });
    const sReal = createState({ ...base, tax: { regime: "real" } });
    const tSimp = buildDRE(sSimp, "simples").tax.annual;
    const tPres = buildDRE(sPres, "presumido").tax.annual;
    const tReal = buildDRE(sReal, "real").tax.annual;
    // Pelo menos dois dos três devem diferir (não pode haver convergência total)
    const valores = new Set([Math.round(tSimp), Math.round(tPres), Math.round(tReal)]);
    expect(valores.size).toBeGreaterThanOrEqual(2);
  });

  it("Simples acima de R$ 4,8M sinaliza desenquadramento no detail", () => {
    const s = createState({
      revenue: { bruta: m12(500_000) }, // 6M anual
      tax: { regime: "simples" },
    });
    const { tax } = buildDRE(s, "simples");
    const hasFlag = Object.keys(tax.detail).some((k) => k.includes("Excedeu limite Simples"));
    expect(hasFlag).toBe(true);
  });
});

// ============================================================
// 4. Ciclo operacional extremo — PMR/PMP > 360
// ============================================================
describe("Edge — PMR/PMP > 360 dias", () => {
  it("PMR = 365 → tudo transborda, recebimentos no ano = 0", () => {
    const s = createState({
      revenue: { bruta: m12(10000), pmr: 365, inadimplencia: m12(0) },
    });
    const cf = buildCashFlow(s);
    expect(sum(cf.recebimentos)).toBe(0);
    expect(cf.contasReceberAnoSeguinte).toBeCloseTo(120000, 2);
  });

  it("PMP = 365 → nenhum pagamento a fornecedor no ano", () => {
    const s = createState({ revenue: { pmp: 365 } });
    const cf = buildCashFlow(s);
    expect(sum(cf.pagamentosFornecedores)).toBe(0);
    expect(cf.fornecedoresAnoSeguinte).toBeGreaterThanOrEqual(0);
  });

  it("PMR = 0 e PMP = 0 → tudo cai no mês corrente, sem transbordo", () => {
    const s = createState({
      revenue: { bruta: m12(10000), pmr: 0, pmp: 0, inadimplencia: m12(0) },
    });
    const cf = buildCashFlow(s);
    expect(cf.contasReceberAnoSeguinte).toBe(0);
    expect(cf.fornecedoresAnoSeguinte).toBe(0);
  });
});

// ============================================================
// 5. TIR / VPL — degenerações numéricas
// ============================================================
describe("Edge — TIR e VPL", () => {
  it("Fluxos só negativos → TIR = null (sem sinais opostos)", () => {
    expect(irr([-100, -50, -50])).toBeNull();
    expect(irrDetailed([-100, -50, -50]).value).toBeNull();
    expect(irrDetailed([-100, -50, -50]).error).toMatch(/sinais opostos/i);
  });

  it("Fluxos só positivos → TIR = null", () => {
    expect(irr([100, 50, 50])).toBeNull();
  });

  it("Fluxos all-zero → TIR = null (degenerado)", () => {
    expect(irr([0, 0, 0, 0])).toBeNull();
  });

  it("Investimento simples com retorno → TIR convergente e finita", () => {
    // -1000 hoje, 600/ano por 2 anos → TIR ≈ 13%
    const v = irr([-1000, 600, 600]);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!)).toBe(true);
    expect(v!).toBeGreaterThan(0.1);
    expect(v!).toBeLessThan(0.2);
  });

  it("VPL com taxa = 0 = soma simples dos fluxos", () => {
    expect(npv([-100, 50, 60, 70], 0)).toBeCloseTo(80, 6);
  });

  it("VPL com taxa muito alta → tende a flows[0]", () => {
    // taxa = 10000% a.p. → demais fluxos viram quase zero
    expect(npv([-100, 50, 60, 70], 100)).toBeGreaterThan(-100);
    expect(npv([-100, 50, 60, 70], 100)).toBeLessThan(-99);
  });
});
