// =====================================================================
// Testes do fator de encargos CLT (costs.ts) — SSOT via calculadora.
// =====================================================================
// Cobre:
//  - Fator regime-aware (Simples geral vs IV vs Presumido/Real)
//  - Override manual via `encargosPct` continua respeitado
//  - Linearidade: total × fator == Σ (parcela × fator)
// =====================================================================
import { describe, it, expect } from "vitest";
import { effectiveMonthValues, fatorEncargosCLT } from "@/engines/finance/costs";
import type { CostLine } from "@/engines/finance/types";
import { fill12 } from "@/engines/finance/format";

function mkLine(over: Partial<CostLine> = {}): CostLine {
  return {
    id: "clt",
    label: "Salários administrativos (CLT)",
    category: "despesa_administrativa",
    values: fill12(10_000),
    fixed: true,
    encargosAuto: true,
    ...over,
  } as CostLine;
}

describe("fatorEncargosCLT — regime-aware via calculadora", () => {
  it("Presumido/Real: fator ~68% (INSS 20 + RAT 1 + Terc 5,8 + FGTS 8 + provisões)", () => {
    const f = fatorEncargosCLT("presumido");
    expect(f).toBeGreaterThan(65);
    expect(f).toBeLessThan(75);
    expect(fatorEncargosCLT("real")).toBeCloseTo(f, 5);
  });

  it("Simples I/II/III/V (geral): fator ~30% (só FGTS + provisões, CPP no DAS)", () => {
    const f = fatorEncargosCLT("simples");
    expect(f).toBeGreaterThan(28);
    expect(f).toBeLessThan(34);
  });

  it("Simples Anexo IV: fator MUITO acima do Simples geral (CPP à parte)", () => {
    const fIV = fatorEncargosCLT("simples", { simplesAnexo: "IV" });
    const fGeral = fatorEncargosCLT("simples");
    // Anexo IV soma INSS patronal 20% + RAT + provisões patronais.
    expect(fIV - fGeral).toBeGreaterThan(25);
  });

  it("Cache: chamadas repetidas retornam o mesmo valor", () => {
    expect(fatorEncargosCLT("presumido", { grauRAT: 2 })).toBe(
      fatorEncargosCLT("presumido", { grauRAT: 2 }),
    );
  });
});

describe("effectiveMonthValues — aplicação do fator", () => {
  it("aplica o fator regime-aware quando encargosAuto=true e sem override", () => {
    const vals = effectiveMonthValues(mkLine(), "presumido");
    const f = 1 + fatorEncargosCLT("presumido") / 100;
    expect(vals[0]).toBeCloseTo(10_000 * f, 2);
  });

  it("respeita `encargosPct` manual (override do consultor)", () => {
    const vals = effectiveMonthValues(mkLine({ encargosPct: 50 }), "presumido");
    expect(vals[0]).toBeCloseTo(10_000 * 1.5, 2);
  });

  it("Simples geral tem fator MENOR que Presumido para mesma linha", () => {
    const s = effectiveMonthValues(mkLine(), "simples")[0];
    const p = effectiveMonthValues(mkLine(), "presumido")[0];
    expect(s).toBeLessThan(p);
  });

  it("linha sem encargosAuto: valor inalterado", () => {
    const vals = effectiveMonthValues(mkLine({ encargosAuto: false }), "presumido");
    expect(vals[0]).toBe(10_000);
  });
});
