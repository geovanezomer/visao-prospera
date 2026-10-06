// DRE do PDF: despesas comerciais e administrativas pelas categorias atuais,
// fechando com o EBIT da DRE do motor.
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { buildDRE } from "../dre";
import { resolveEffectiveRegime } from "../regime";
import { despesasPorFuncao } from "../pdfExport";
import { splitReceitasFinanceiras } from "../shared";
import { sum } from "../format";

describe("despesasPorFuncao (PDF)", () => {
  it.each([false, true])("Lucro Bruto − despesas − D&A ± outras = EBIT (PDD=%s)", (pdd) => {
    const base = createState();
    const s = { ...base, revenue: { ...base.revenue, inadimplenciaComoPDD: pdd } };
    const regime = resolveEffectiveRegime(s);
    const { dre } = buildDRE(s, regime);
    const { despComerciais, despAdmin } = despesasPorFuncao(s, regime);
    expect(sum(despComerciais)).toBeGreaterThan(0);
    expect(sum(despAdmin)).toBeGreaterThan(0);
    const outrasOp = splitReceitasFinanceiras(s).operacionais;
    const ebit =
      sum(dre.lucroBruto) -
      sum(despComerciais) -
      sum(despAdmin) -
      sum(dre.depreciacao) -
      (pdd ? sum(dre.pdd) : 0) +
      sum(outrasOp);
    expect(ebit).toBeCloseTo(sum(dre.ebit), 2);
  });
});
