// Projeção atravessando a Reforma: carga sobre vendas ano a ano (calculada à
// mão para uma prestadora de serviços no Lucro Presumido, sem custos).
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { buildForecast, DEFAULT_FORECAST_CFG } from "../forecast";

// Serviços, Presumido, ISS 5%, presunção 32%, faturamento baixo (sem adicional de IRPJ).
const prestadora = () => ({
  ...createState({ tax: { regime: "presumido", issIcms: 5 } as never }),
  costs: [],
});
const cfg = { ...DEFAULT_FORECAST_CFG, crescimentoMensalPct: 0, horizonteMeses: 48 };
const carga = (m: { receita: number; impostosReceita: number }) =>
  (m.impostosReceita / m.receita) * 100;

describe("projeção com o cronograma da Reforma", () => {
  // IRPJ 15% + CSLL 9% sobre 32% da receita = 7,68% (não muda com a Reforma).
  const IR_CSLL = 0.32 * (15 + 9);

  it("Presumido serviços 2026→2029: carga sobre a receita ano a ano", () => {
    const f = buildForecast(prestadora(), { ...cfg, anoBase: 2026 }).meses;
    expect(f.map((m) => m.anoCalendario).filter((_, i) => i % 12 === 0)).toEqual([
      2026, 2027, 2028, 2029,
    ]);
    // 2026: PIS 0,65 + COFINS 3 + ISS 5 (CBS/IBS de teste compensáveis).
    expect(carga(f[0])).toBeCloseTo(0.65 + 3 + 5 + IR_CSLL, 6); // 16,33%
    // 2027–2028: PIS/COFINS extintos; CBS 8,8 + IBS 0,1; ISS integral.
    expect(carga(f[12])).toBeCloseTo(8.8 + 0.1 + 5 + IR_CSLL, 6); // 21,58%
    expect(carga(f[35])).toBeCloseTo(8.8 + 0.1 + 5 + IR_CSLL, 6);
    // 2029: IBS 10% de 17,7 = 1,77; ISS a 90% = 4,5.
    expect(carga(f[36])).toBeCloseTo(8.8 + 1.77 + 4.5 + IR_CSLL, 6); // 22,75%
    // Dentro do ano a carga é a mesma em todos os meses.
    for (let i = 13; i < 24; i++) expect(carga(f[i])).toBeCloseTo(carga(f[12]), 9);
  });

  it("sem ano-base (chamadas antigas) a carga do ano-base vale para todo o horizonte", () => {
    const f = buildForecast(prestadora(), cfg).meses;
    expect(f[0].anoCalendario).toBeNull();
    expect(f[0].label).toBe("Y1 Jan");
    expect(carga(f[47])).toBeCloseTo(carga(f[0]), 9);
  });

  it("era escolhida à mão (simulação 'e se') mantém a carga constante", () => {
    const s = prestadora();
    const pleno = { ...s, tax: { ...s.tax, era: "pleno" as const } };
    const f = buildForecast(pleno, { ...cfg, anoBase: 2026 }).meses;
    expect(carga(f[36])).toBeCloseTo(carga(f[0]), 9);
  });

  it("ano-base 2027: a calibração parte de 2027 e só o IBS/ISS de 2029 mexe", () => {
    const s = prestadora();
    const transicao = { ...s, tax: { ...s.tax, era: "transicao" as const } };
    const f = buildForecast(transicao, { ...cfg, anoBase: 2027 }).meses;
    const base = carga(f[0]) - IR_CSLL;
    // 2028 = 2027 (fator 1); 2029 multiplica a carga sobre vendas por 15,07/13,9.
    expect(carga(f[12])).toBeCloseTo(carga(f[0]), 9);
    expect(carga(f[24])).toBeCloseTo((base * (8.8 + 1.77 + 4.5)) / (8.8 + 0.1 + 5) + IR_CSLL, 6);
  });

  it("manual: crescimento mensal contínuo desde o ano-base (inalterado)", () => {
    const s = prestadora();
    const f = buildForecast(s, { ...cfg, crescimentoMensalPct: 1, anoBase: 2026 }).meses;
    // Mesmo mês-base, i meses depois: fator 1,01^i (contínuo, sem degrau anual).
    expect(f[12].receita / f[0].receita).toBeCloseTo(1.01 ** 12, 9);
    expect(f[25].receita / f[1].receita).toBeCloseTo(1.01 ** 24, 9);
  });
});
