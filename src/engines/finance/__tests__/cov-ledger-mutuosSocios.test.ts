/**
 * Mútuo ativo PJ→PF (empresa empresta ao sócio) — contrato Price.
 * Valores esperados calculados à mão nos comentários.
 */
import { describe, expect, it } from "vitest";
import { aggregateMutuos, SELIC_MENSAL_REFERENCIA } from "../mutuosSocios";
import type { MutuoSocio } from "../types";

const mk = (over: Partial<MutuoSocio> = {}): MutuoSocio => ({
  id: "m1",
  nome: "Sócio A",
  valorConcedido: 10_000,
  mesConcessao: 1,
  taxaMensalPct: 1,
  prazoMeses: 12,
  mesInicioDevolucao: 1,
  ...over,
});

const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("aggregateMutuos", () => {
  it("sem mútuos → séries zeradas", () => {
    const r = aggregateMutuos(undefined);
    expect(r.concessao).toEqual(new Array(12).fill(0));
    expect(r.devolucao).toEqual(new Array(12).fill(0));
    expect(r.saldoFinal).toBe(0);
    expect(r.totalConcedido).toBe(0);
    expect(r.totalJurosAno).toBe(0);
  });

  it("Price 12× a 1% a.m. dentro do ano: devolve o principal e juros = 12·PMT − PV", () => {
    // PMT = 10.000 × 0,01 / (1 − 1,01^−12) = 888,4879
    const pmt = (10_000 * 0.01) / (1 - Math.pow(1.01, -12));
    const r = aggregateMutuos([mk()]);
    expect(r.concessao[0]).toBe(10_000); // saída de caixa no mês da concessão
    expect(r.totalConcedido).toBe(10_000);
    // Mês 1: juros 100 (receita financeira); principal devolvido 788,49
    expect(r.juros[0]).toBeCloseTo(100, 6);
    expect(r.devolucao[0]).toBeCloseTo(pmt - 100, 6);
    for (let k = 0; k < 12; k++) expect(r.juros[k] + r.devolucao[k]).toBeCloseTo(pmt, 6);
    expect(soma(r.devolucao)).toBeCloseTo(10_000, 6);
    expect(r.totalJurosAno).toBeCloseTo(12 * pmt - 10_000, 6); // 661,85
    // Todas as parcelas caem no ano → nada a receber no fim
    expect(r.saldoFinal).toBeCloseTo(0, 6);
  });

  it("sem juros, devolução começando no mês 5 em 4× → 2.000/mês nos meses 5..8", () => {
    const r = aggregateMutuos([
      mk({ valorConcedido: 8_000, taxaMensalPct: 0, prazoMeses: 4, mesInicioDevolucao: 5 }),
    ]);
    expect(r.devolucao).toEqual([0, 0, 0, 0, 2_000, 2_000, 2_000, 2_000, 0, 0, 0, 0]);
    expect(r.juros).toEqual(new Array(12).fill(0));
    expect(r.saldoFinal).toBeCloseTo(0, 9);
  });

  it("parcelas que caem depois do mês 12 ficam fora do fluxo do ano", () => {
    // 12.000 em 24× sem juros, a partir do mês 1 → 500/mês nos 12 meses do ano.
    const r = aggregateMutuos([
      mk({ valorConcedido: 12_000, taxaMensalPct: 0, prazoMeses: 24, mesInicioDevolucao: 1 }),
    ]);
    expect(r.devolucao).toEqual(new Array(12).fill(500));
    expect(soma(r.devolucao)).toBe(6_000);
    // 12 parcelas ainda a receber depois do mês 12 ficam no saldo do ano.
    expect(r.saldoFinal).toBe(6_000);
  });

  it("com juros: saldo final = valor presente das parcelas que faltam (Price)", () => {
    // 10.000 a 1% a.m. em 24×; após 12 parcelas o saldo é o PV das 12 restantes.
    const r = aggregateMutuos([
      mk({ valorConcedido: 10_000, taxaMensalPct: 1, prazoMeses: 24, mesInicioDevolucao: 1 }),
    ]);
    const pmt = (10_000 * 0.01) / (1 - Math.pow(1.01, -24));
    const pvRestante = (pmt * (1 - Math.pow(1.01, -12))) / 0.01;
    expect(r.saldoFinal).toBeCloseTo(pvRestante, 6);
    expect(soma(r.devolucao) + r.saldoFinal).toBeCloseTo(10_000, 6);
  });

  it("concessão e início fora de 1..12 são limitados; prazo 0 vira 1 parcela; valor ≤ 0 é ignorado", () => {
    const r = aggregateMutuos([
      mk({
        id: "a",
        valorConcedido: 3_000,
        mesConcessao: 15, // → mês 12
        taxaMensalPct: 0,
        prazoMeses: 0, // → 1 parcela
        mesInicioDevolucao: 0, // → mês 1
      }),
      mk({ id: "b", valorConcedido: 0 }),
      mk({ id: "c", valorConcedido: -500 }),
      mk({ id: "d", valorConcedido: 1_000, taxaMensalPct: -2, prazoMeses: 1 }), // taxa negativa → 0
    ]);
    expect(r.concessao[11]).toBe(3_000);
    expect(r.concessao[0]).toBe(1_000);
    expect(r.totalConcedido).toBe(4_000);
    expect(r.devolucao[0]).toBe(4_000); // 3.000 + 1.000 em parcela única no mês 1
    expect(r.totalJurosAno).toBe(0);
  });

  it("SELIC de referência para alerta de juros baixos é positiva (% a.m.)", () => {
    expect(SELIC_MENSAL_REFERENCIA).toBeGreaterThan(0);
    expect(SELIC_MENSAL_REFERENCIA).toBeLessThan(5);
  });
});
