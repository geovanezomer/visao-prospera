/**
 * CLT × PJ: no Lucro Presumido a empresa recolhe CPP de 20% sobre o
 * pró-labore (Lei 8.212/91 art. 22, III). No Simples (Anexo III) ela está no
 * DAS; o MEI não recolhe.
 */
import { describe, expect, it } from "vitest";
import { calcularPJ, cltVsPjInputSchema } from "../cltVsPj";

const input = cltVsPjInputSchema.parse({
  salarioBrutoCLT: 10_000,
  faturamentoPJMensal: 30_000,
  proLaborePct: 0.28,
});

describe("calcularPJ — CPP sobre pró-labore", () => {
  it("Presumido: R$ 30 mil × 28% = R$ 8.400 de pró-labore → CPP R$ 1.680", () => {
    const r = calcularPJ("presumido", input);
    expect(r.proLaboreMensal).toBeCloseTo(8_400, 2);
    expect(r.cppProLaboreMensal).toBeCloseTo(1_680, 2);
  });

  it("CPP reduz o líquido do Presumido no mesmo valor", () => {
    const r = calcularPJ("presumido", input);
    const semCpp =
      r.faturamentoMensal -
      r.impostosMensal -
      r.inssProLaboreMensal -
      r.irrfProLaboreMensal -
      r.custosFixosMensal;
    expect(semCpp - r.distribuicaoDividendoMensal).toBeCloseTo(1_680, 2);
  });

  it("Simples e MEI não têm CPP à parte", () => {
    expect(calcularPJ("simples", input).cppProLaboreMensal).toBe(0);
    expect(calcularPJ("mei", input).cppProLaboreMensal).toBe(0);
  });
});
