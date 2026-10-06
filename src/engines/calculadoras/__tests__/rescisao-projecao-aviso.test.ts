/**
 * Rescisão: o aviso prévio indenizado projeta avos de 13º e férias
 * (CLT art. 487 §1º; OJ 82 SDI-1).
 */
import { describe, expect, it } from "vitest";
import { avosProjecaoAviso, calcularRescisao } from "../rescisao";

const base = {
  salarioBruto: 3_000,
  diasTrabalhadosMes: 10,
  mesesFeriasProporcionais: 5,
  mesesDecimoProporcional: 5,
  anosNaEmpresa: 3, // aviso de 39 dias
  saldoFGTS: 10_000,
};

const verba = (r: ReturnType<typeof calcularRescisao>, prefixo: string) =>
  r.verbas.find((v) => v.rotulo.startsWith(prefixo));

describe("avosProjecaoAviso", () => {
  it.each([
    [30, 1],
    [39, 1],
    [44, 1],
    [45, 2],
    [90, 3],
  ])("%d dias → %d/12", (dias, avos) => expect(avosProjecaoAviso(dias)).toBe(avos));
});

describe("calcularRescisao — projeção do aviso", () => {
  it("sem justa causa, 3 anos (39 dias): 13º e férias ganham 1/12", () => {
    const r = calcularRescisao({ ...base, motivo: "sem_justa_causa" });
    expect(r.diasAvisoPrevio).toBe(39);
    expect(verba(r, "13º")?.valor).toBeCloseTo((3_000 / 12) * 6, 2);
    expect(verba(r, "Férias proporcionais")?.valor).toBeCloseTo((3_000 / 12) * 6, 2);
    expect(verba(r, "13º")?.rotulo).toContain("projeção do aviso");
  });

  it("aviso trabalhado não projeta", () => {
    const r = calcularRescisao({ ...base, motivo: "sem_justa_causa", avisoPrevio: "trabalhado" });
    expect(verba(r, "13º")?.valor).toBeCloseTo((3_000 / 12) * 5, 2);
  });

  it("pedido de demissão não projeta", () => {
    const r = calcularRescisao({ ...base, motivo: "pedido_demissao" });
    expect(verba(r, "13º")?.valor).toBeCloseTo((3_000 / 12) * 5, 2);
  });

  it("limita a 12/12", () => {
    const r = calcularRescisao({
      ...base,
      motivo: "sem_justa_causa",
      mesesDecimoProporcional: 12,
      mesesFeriasProporcionais: 11,
    });
    expect(verba(r, "13º")?.valor).toBeCloseTo(3_000, 2);
  });
});
