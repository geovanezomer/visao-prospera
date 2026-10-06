import { describe, it, expect } from "vitest";
import {
  extractNumbers,
  extractNumbersFromPayloads,
  verifyResponse,
} from "@/engines/ai/verification";

describe("verification — parsing pt-BR", () => {
  it("moeda com milhar e decimal", () => {
    const nums = extractNumbers("O EBITDA foi de R$ 1.234.567,89 no período.");
    expect(nums).toHaveLength(1);
    expect(nums[0].kind).toBe("currency");
    expect(nums[0].value).toBeCloseTo(1234567.89, 2);
  });

  it("percentual com vírgula", () => {
    const nums = extractNumbers("A margem líquida ficou em 18,2% no trimestre.");
    expect(nums).toHaveLength(1);
    expect(nums[0].kind).toBe("percent");
    expect(nums[0].value).toBeCloseTo(18.2, 2);
  });

  it("p.p. tratado como percentual", () => {
    const nums = extractNumbers("Queda de 3 p.p. vs ano anterior.");
    expect(nums).toHaveLength(1);
    expect(nums[0].kind).toBe("percent");
    expect(nums[0].value).toBe(3);
  });

  it("moeda negativa", () => {
    const nums = extractNumbers("Prejuízo de R$-1.500 no mês.");
    expect(nums[0].value).toBe(-1500);
  });
});

describe("verification — tolerância de arredondamento", () => {
  it("moeda: 487.320 vs 487.319,60 → verified", () => {
    const r = verifyResponse("EBITDA de R$ 487.320 no período.", ["| EBITDA | R$ 487.319,60 |"]);
    expect(r.verified).toHaveLength(1);
    expect(r.unverified).toHaveLength(0);
  });

  it("percentual: 18,2% vs 0,182 na payload (fração) → verified", () => {
    const r = verifyResponse("Margem: 18,2%.", ['{"margem": 0.182}']);
    expect(r.verified).toHaveLength(1);
  });

  it("número inventado → unverified", () => {
    const r = verifyResponse("Receita de R$ 52.400 no ano.", ["| Receita | R$ 987.000 |"]);
    expect(r.unverified).toHaveLength(1);
    expect(r.coveragePct).toBe(0);
  });
});

describe("verification — blocos ignorados", () => {
  it("números dentro de finance-chart não são extraídos", () => {
    const text = [
      "Veja o gráfico:",
      "```finance-chart",
      '{"data":[{"x":"2024","y":999999}]}',
      "```",
      "Total: R$ 100.",
    ].join("\n");
    const nums = extractNumbers(text);
    expect(nums).toHaveLength(1);
    expect(nums[0].value).toBe(100);
  });

  it("linhas de tabela markdown são ignoradas (auto-verificação)", () => {
    const text = [
      "| Indicador | Valor |",
      "| --- | --- |",
      "| EBITDA | R$ 999.999 |",
      "",
      "Resumo: EBITDA de R$ 999.999.",
    ].join("\n");
    const nums = extractNumbers(text);
    // Só o parágrafo de resumo — não a tabela literal.
    expect(nums).toHaveLength(1);
  });
});

describe("verification — coverage", () => {
  it("resposta sem números → coveragePct 100 (vacuamente verdadeiro)", () => {
    const r = verifyResponse("Análise qualitativa sem cifras.", []);
    expect(r.coveragePct).toBe(100);
    expect(r.verified).toHaveLength(0);
    expect(r.unverified).toHaveLength(0);
  });

  it("cobertura parcial calculada corretamente", () => {
    const r = verifyResponse("EBITDA R$ 100 e margem 20%. Receita R$ 999 inventada.", [
      "EBITDA 100; margem 0,20",
    ]);
    expect(r.verified).toHaveLength(2);
    expect(r.unverified).toHaveLength(1);
    expect(r.coveragePct).toBeCloseTo(66.7, 1);
  });
});

describe("verification — extração de payloads", () => {
  it("captura números formatados e crus", () => {
    const vals = extractNumbersFromPayloads(["EBITDA: R$ 100.000", '{"raw": 42, "pct": 0.15}']);
    expect(vals).toContain(100000);
    expect(vals).toContain(42);
    expect(vals).toContain(0.15);
  });
});
