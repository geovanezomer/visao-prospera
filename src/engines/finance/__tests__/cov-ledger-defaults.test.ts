/**
 * Defaults e migração de estado persistido — garante que snapshots antigos
 * (.finnance / localStorage) chegam à engine com as rubricas na categoria
 * contábil correta (CPC 26: custo × despesa por função) e com séries
 * Months[12] sanitizadas.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STATE,
  defaultCostsFor,
  migrateCostLine,
  migrateState,
  validateAndMigrate,
} from "../defaults";
import { APP_STATE_SCHEMA_VERSION } from "../types";
import type { AppState, CostLine } from "../types";
import { m12 } from "./helpers";

const ln = (over: Partial<CostLine>): CostLine =>
  ({ id: "x", label: "X", values: m12(100), fixed: true, ...over }) as CostLine;

/** Estado mínimo "antigo": clona o default para não mutar o objeto compartilhado. */
const legacy = (over: Record<string, unknown>): AppState =>
  ({ ...structuredClone(DEFAULT_STATE), ...over }) as AppState;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateAndMigrate", () => {
  it("JSON estruturalmente inválido → DEFAULT_STATE (com aviso)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(validateAndMigrate("não é objeto")).toBe(DEFAULT_STATE);
    expect(validateAndMigrate({ businessType: "mineracao" })).toBe(DEFAULT_STATE);
    expect(validateAndMigrate({ costs: "x" })).toBe(DEFAULT_STATE);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("objeto válido parcial é completado com o default e recebe a versão de schema atual", () => {
    const s = validateAndMigrate({ companyName: "ACME", businessType: "comercio" });
    expect(s.companyName).toBe("ACME");
    expect(s.businessType).toBe("comercio");
    expect(s.schemaVersion).toBe(APP_STATE_SCHEMA_VERSION);
    expect(s.revenue.bruta).toHaveLength(12);
  });
});

describe("defaultCostsFor — plano de custos por tipo de negócio", () => {
  it("indústria: matéria-prima, MOD (com encargos) e CIF como custos variáveis", () => {
    const ids = defaultCostsFor("industria").map((c) => c.id);
    for (const id of ["mp_aco", "mp_aux", "mod_prod", "cif_energia", "cif_manut"])
      expect(ids).toContain(id);
    const mod = defaultCostsFor("industria").find((c) => c.id === "mod_prod")!;
    expect(mod.encargosAuto).toBe(true);
    expect(mod.encargosPct).toBe(70);
    expect(ids).not.toContain("mod_terc");
  });

  it("comércio: mercadoria, frete s/ compras e ICMS-ST sem crédito", () => {
    const costs = defaultCostsFor("comercio");
    const ids = costs.map((c) => c.id);
    for (const id of ["merc_principal", "frete_compra", "icms_st", "embalagem"])
      expect(ids).toContain(id);
    expect(costs.find((c) => c.id === "icms_st")!.semCredito).toBe(true);
    expect(ids).not.toContain("mp_aco");
  });

  it("serviços: terceirização PJ sem encargos trabalhistas embutidos", () => {
    const terc = defaultCostsFor("servicos").find((c) => c.id === "mod_terc")!;
    expect(terc.values).toEqual(m12(4_500));
    expect(terc.encargosAuto).toBeFalsy();
  });

  it("nenhum seed manual de pró-labore (SSOT = state.socios)", () => {
    for (const b of ["industria", "comercio", "servicos"] as const)
      expect(defaultCostsFor(b).some((c) => c.id === "prolabore")).toBe(false);
  });
});

describe("migrateCostLine — categoria por função contábil", () => {
  it("aliases legados fixo/variavel viram despesa administrativa/comercial", () => {
    expect(migrateCostLine(ln({ category: "fixo" })).category).toBe("despesa_administrativa");
    expect(migrateCostLine(ln({ category: "variavel" })).category).toBe("despesa_comercial");
    expect(migrateCostLine(ln({ category: "financeiro" })).category).toBe("financeiro");
  });

  it("linha sem categoria: grupo financeiro, CPV legado, variável ou administrativa", () => {
    const sem = (o: Record<string, unknown>) =>
      migrateCostLine(ln({ category: undefined, ...o } as Partial<CostLine>)).category;
    expect(sem({ group: "financeiro" })).toBe("financeiro");
    expect(sem({ id: "insumos" })).toBe("custo_vendas");
    expect(sem({ id: "fretes" })).toBe("custo_vendas");
    expect(sem({ variavel: true })).toBe("despesa_comercial");
    expect(sem({})).toBe("despesa_administrativa");
  });

  it("ICMS-ST é marcado sem crédito automaticamente; flag explícita prevalece", () => {
    expect(migrateCostLine(ln({ category: "fixo", subcategory: "icms_st" })).semCredito).toBe(true);
    expect(
      migrateCostLine(ln({ category: "fixo", subcategory: "icms_st", semCredito: false }))
        .semCredito,
    ).toBe(false);
    expect(migrateCostLine(ln({ category: undefined, subcategory: "icms_st" })).semCredito).toBe(
      true,
    );
  });
});

describe("migrateState — rubricas", () => {
  it("remove rubricas descontinuadas, aplica relabels e o seed legado de pró-labore", () => {
    const s = migrateState(
      legacy({
        costs: [
          ln({ id: "outros_fix", category: "fixo" }),
          ln({ id: "terceiros", category: "fixo" }),
          ln({ id: "prolabore", label: "Pró-labore", category: "fixo" }),
          ln({ id: "iof", label: "iof antigo", category: "financeiro" }),
        ],
      }),
    );
    const ids = s.costs.map((c) => c.id);
    expect(ids).not.toContain("outros_fix");
    expect(ids).not.toContain("terceiros");
    expect(ids).not.toContain("prolabore");
    expect(s.costs.find((c) => c.id === "iof")!.label).toBe("IOF");
  });

  it("CPV: custo_vendas migra para direto_venda; insumos_serv sai das despesas comerciais", () => {
    const s = migrateState(
      legacy({
        businessType: "comercio",
        costs: [
          ln({ id: "cmv", category: "custo_vendas" }),
          ln({ id: "insumos_serv", label: "x", category: "despesa_comercial" }),
        ],
      }),
    );
    expect(s.costs.find((c) => c.id === "cmv")!.category).toBe("direto_venda");
    const ins = s.costs.find((c) => c.id === "insumos_serv")!;
    expect(ins.category).toBe("direto_venda");
    expect(ins.subcategory).toBe("insumos_servico");
    expect(ins.label).toBe("Insumos / Matéria Prima");
  });

  it("serviços: MOD em CPV vira Terceirização (fora do CPV) e perde encargos CLT", () => {
    const s = migrateState(
      legacy({
        businessType: "servicos",
        costs: [
          ln({
            id: "mod_x",
            label: "Salários MOD",
            category: "custo_vendas",
            subcategory: "mao_obra_direta",
            encargosAuto: true,
            encargosPct: 70,
          }),
          ln({
            id: "mod_y",
            label: "Equipe de campo",
            category: "custo_vendas",
            subcategory: "mao_obra_direta",
          }),
        ],
      }),
    );
    const x = s.costs.find((c) => c.id === "mod_x")!;
    expect(x.label).toBe("Mão de Obra Direta (Terceirização)");
    expect(["custo_vendas", "direto_venda"]).not.toContain(x.category);
    expect(x.subcategory).toBeUndefined();
    // Contrato PJ: o valor faturado já é o custo total → sem encargos automáticos
    expect(x.encargosAuto).toBe(false);
    expect(x.encargosPct).toBeUndefined();
    expect(s.costs.find((c) => c.id === "mod_y")!.label).toBe("Equipe de campo");
  });

  it("terceirização/subcontratação legada com encargos ligados é corrigida", () => {
    const s = migrateState(
      legacy({
        costs: [
          ln({ id: "subcon", label: "Subcontratados", category: "fixo", encargosAuto: true }),
          ln({ id: "z", label: "Serviços terceirizados", category: "fixo", encargosPct: 70 }),
          ln({ id: "ok", label: "Terceirização limpa", category: "fixo" }),
        ],
      }),
    );
    for (const id of ["subcon", "z"]) {
      const c = s.costs.find((c) => c.id === id)!;
      expect(c.encargosAuto).toBe(false);
      expect(c.encargosPct).toBeUndefined();
    }
  });

  it("garante as rubricas novas (maquininha, tarifas, seguros...) zeradas", () => {
    const s = migrateState(legacy({ costs: [ln({ id: "aluguel", category: "fixo" })] }));
    for (const id of [
      "maquininha",
      "marketplace",
      "cheque_especial",
      "tarifas_bancarias",
      "multas_juros",
      "combustivel",
      "frete_vendas",
      "material_escritorio",
      "seguros",
    ]) {
      const c = s.costs.find((c) => c.id === id);
      expect(c, id).toBeDefined();
      expect(c!.values).toEqual(m12(0));
    }
    expect(s.costs.find((c) => c.id === "maquininha")!.category).toBe("financeiro");
  });

  it("sem costs no snapshot usa o plano default", () => {
    const s = migrateState(legacy({ costs: undefined }));
    expect(s.costs.length).toBeGreaterThan(5);
    expect(s.costs.find((c) => c.id === "aluguel")!.values).toEqual(m12(2_500));
  });
});

describe("migrateState — receita, tributos, estratégia e séries", () => {
  it("era legada ano-a-ano vira o modelo de 3 marcos", () => {
    const era = (e: string) =>
      migrateState(legacy({ tax: { ...DEFAULT_STATE.tax, era: e } })).tax.era;
    expect(era("2033")).toBe("pleno");
    expect(era("2028")).toBe("transicao");
    expect(era("pleno")).toBe("pleno");
  });

  it("PDD reversão escalar vira série; deduções e receitas financeiras padrão são garantidas", () => {
    const s = migrateState(
      legacy({
        revenue: {
          ...DEFAULT_STATE.revenue,
          pddReversaoMensal: 150 as unknown as number[],
          deducoes: "x",
          receitasFinanceiras: [{ id: "rend_aplic", label: "Rend.", valores: m12(10) }],
          pmrMensal: [1, 2],
          pmpMensal: undefined,
          pmr: 45,
          pmp: 20,
        },
      }),
    );
    expect(s.revenue.pddReversaoMensal).toEqual(m12(150));
    expect(s.revenue.deducoes!.map((d) => d.id)).toEqual(["desc_incond", "abatimentos"]);
    const rf = s.revenue.receitasFinanceiras!;
    expect(rf.map((d) => d.id)).toEqual(["rend_aplic", "alugueis", "venda_ativos"]);
    // Backfill do tipo em snapshots antigos, preservando os valores
    expect(rf[0]).toMatchObject({ tipo: "financeira", valores: m12(10) });
    expect(rf[1].tipo).toBe("operacional");
    // PMR/PMP mensais inválidos → replicam o prazo médio e marcam como fixo
    expect(s.revenue.pmrMensal).toEqual(m12(45));
    expect(s.revenue.pmpMensal).toEqual(m12(20));
    expect(s.revenue.pmrFixo).toBe(true);
  });

  it("PDD ausente vira série zerada; séries corrompidas (NaN/curtas) são sanitizadas", () => {
    const s = migrateState(
      legacy({
        revenue: {
          ...DEFAULT_STATE.revenue,
          pddReversaoMensal: undefined,
          bruta: [1_000, NaN, Infinity],
          receitasFinanceiras: undefined,
        },
        costs: [ln({ id: "aluguel", category: "fixo", values: [5, NaN] as number[] })],
      }),
    );
    expect(s.revenue.pddReversaoMensal).toEqual(m12(0));
    expect(s.revenue.bruta).toEqual([1_000, ...new Array(11).fill(0)]);
    expect(s.costs.find((c) => c.id === "aluguel")!.values).toEqual([5, ...new Array(11).fill(0)]);
  });

  it("estratégia ausente ou parcial ganha todas as subseções; campo legado `guided` é removido", () => {
    const s1 = migrateState(legacy({ strategic: undefined, guided: { passo: 3 } }));
    expect(s1.strategic).toEqual({
      concentration: {},
      governance: {},
      competitive: {},
      regulatory: {},
    });
    expect("guided" in s1).toBe(false);
    const s2 = migrateState(legacy({ strategic: { governance: { conselho: true } } }));
    expect(s2.strategic!.governance).toEqual({ conselho: true });
    expect(s2.strategic!.concentration).toEqual({});
  });

  it("distribuição realizada: semeada pelos dividendos legados; senão zerada e fixa", () => {
    const comLegado = migrateState(
      legacy({
        distribuicaoRealizada: undefined,
        cashflow: { ...structuredClone(DEFAULT_STATE.cashflow), dividendos: m12(2_000) },
      }),
    );
    expect(comLegado.distribuicaoRealizada).toEqual({ values: m12(2_000), fixed: false });

    const semLegado = migrateState(legacy({ distribuicaoRealizada: undefined }));
    expect(semLegado.distribuicaoRealizada).toEqual({ values: m12(0), fixed: true });

    const informada = migrateState(legacy({ distribuicaoRealizada: { values: [7, 8] } }));
    expect(informada.distribuicaoRealizada).toEqual({
      values: [7, 8, ...new Array(10).fill(0)],
      fixed: true,
    });
  });

  it("estampa a versão de schema atual mesmo em snapshot sem versão", () => {
    expect(migrateState(legacy({ schemaVersion: undefined })).schemaVersion).toBe(
      APP_STATE_SCHEMA_VERSION,
    );
  });
});

describe("blankState / isExampleState", () => {
  it("empresa em branco: estrutura do exemplo, valores zerados e motor sem erro", async () => {
    const { blankState, isExampleState, DEFAULT_STATE } = await import("../defaults");
    const { buildFinancialModel } = await import("../financialModel");
    const b = blankState();
    expect(b.revenue.bruta.every((v) => v === 0)).toBe(true);
    expect(b.costs.length).toBeGreaterThan(0);
    expect(b.costs.every((c) => c.values.every((v) => v === 0))).toBe(true);
    expect(isExampleState(DEFAULT_STATE)).toBe(true);
    expect(isExampleState(b)).toBe(false);
    const m = buildFinancialModel(b);
    expect(m.dre.receitaBruta.reduce((a, x) => a + x, 0)).toBe(0);
    expect(m.dre.lucroLiquido.every(Number.isFinite)).toBe(true);
  });
});
