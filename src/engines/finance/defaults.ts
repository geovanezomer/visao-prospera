import { z } from "zod";
import {
  AppState,
  BusinessType,
  CostLine,
  COST_VENDAS_TABLE_CONFIG,
  APP_STATE_SCHEMA_VERSION,
} from "./types";
import { fill12 } from "./format";
import { coerceMonths } from "./safeMath";
import { CBS_ALIQUOTA_PLENA, IBS_ALIQUOTA_PLENA } from "./taxDefaults";

// ─── Migrações de schema versionadas ──────────────────────────────────
// A cada breaking change no formato persistido do AppState:
//   1) incrementar APP_STATE_SCHEMA_VERSION em types.ts
//   2) adicionar uma função aqui mapeando V → V+1
//   3) registrar em SCHEMA_MIGRATIONS abaixo
// O `migrateState` legado (que normaliza Months[12], adiciona rubricas
// novas via `ensure`, etc.) continua rodando depois e cobre mudanças
// não-breaking. Esse mecanismo aqui é só para mudanças disruptivas.
type SchemaMigration = (s: AppState) => AppState;

const SCHEMA_MIGRATIONS: Record<number, SchemaMigration> = {
  // Exemplo (quando for necessário):
  // 1: (s) => ({ ...s, novoCampo: valorDefault, schemaVersion: 2 }),
};

/** Aplica migrações sequencialmente de `from` até a versão atual. */
function applySchemaMigrations(s: AppState): AppState {
  let current = s;
  let v = current.schemaVersion ?? 0;
  while (v < APP_STATE_SCHEMA_VERSION) {
    const fn = SCHEMA_MIGRATIONS[v];
    if (!fn) break; // sem migração registrada; pula para a versão final
    current = fn(current);
    v = (current.schemaVersion ?? v) + (current.schemaVersion === undefined ? 1 : 0);
  }
  return { ...current, schemaVersion: APP_STATE_SCHEMA_VERSION };
}

// Schema Zod do shape de topo do AppState. Validação defensiva no boot
// e no import de arquivo .finnance — garante que `migrateState` recebe
// um objeto com as chaves esperadas (campos internos são sanitizados
// depois por coerceMonths / ensure / RELABEL no próprio migrateState).
// Intencionalmente raso: validar 100+ campos aninhados seria custo alto
// para pouco ganho — o objetivo é apenas rejeitar JSONs estruturalmente
// inválidos (arquivo corrompido, manipulado, ou de outro app).
const appStateShape = z
  .object({
    businessType: z.enum(["industria", "comercio", "servicos"]).optional(),
    companyName: z.string().optional(),
    numColaboradores: z.number().optional(),
    cnpj: z.string().optional(),
    ramoAtuacao: z.string().optional(),
    benchmarkCustom: z.object({}).passthrough().optional(),
    headcountRange: z.enum(["1-9", "10-49", "50-99", "100+"]).optional(),
    periodoAnaliseMeses: z
      .union([z.literal(6), z.literal(12), z.literal(24), z.literal(36)])
      .optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    margemAlvoPct: z.number().optional(),
    moedaBase: z.string().optional(),
    revenue: z.object({}).passthrough().optional(),
    costs: z.array(z.object({}).passthrough()).optional(),
    capital: z.object({}).passthrough().optional(),
    tax: z.object({}).passthrough().optional(),
    cashflow: z.object({}).passthrough().optional(),
    strategic: z.object({}).passthrough().optional(),
  })
  .passthrough();

/**
 * Valida o shape de topo + aplica migrateState. Retorna DEFAULT_STATE
 * quando o input é estruturalmente inválido (não é objeto, faltam
 * chaves críticas com tipo errado, etc.).
 */
export function validateAndMigrate(input: unknown): AppState {
  const parsed = appStateShape.safeParse(input);
  if (!parsed.success) {
    if (typeof console !== "undefined") {
      console.warn(
        "[FinnancePRO] AppState inválido no boot — usando DEFAULT_STATE.",
        parsed.error.issues,
      );
    }
    return DEFAULT_STATE;
  }
  return migrateState({ ...DEFAULT_STATE, ...(parsed.data as Partial<AppState>) });
}

const baseRevenue = [
  13000, 14000, 15500, 15000, 16000, 17000, 15500, 14500, 16000, 17500, 18500, 21000,
];

const line = (
  id: string,
  label: string,
  category: CostLine["category"],
  value: number,
  subcategory?: string,
  extras?: Partial<CostLine>,
): CostLine => ({
  id,
  label,
  category,
  subcategory,
  values: fill12(value),
  fixed: true,
  ...extras,
});

function costVendasFor(business: BusinessType): CostLine[] {
  const config = COST_VENDAS_TABLE_CONFIG[business];
  return config.map((c) =>
    line(c.id, c.label, "direto_venda", 0, c.subcategory, { fixed: false, values: fill12(0) }),
  );
}

function fixosFor(business: BusinessType): CostLine[] {
  const base: CostLine[] = [
    line("aluguel", "Aluguel", "fixo", 2500),
    // [SSOT] Pró-labore NÃO tem seed manual em `costs`. Fonte única = `state.socios`
    // sincronizado por `syncSociosToCosts` → linha system `__socios_prolabore__`.
    // Seed antigo removido para eliminar duplicidade no DRE/EBITDA/Lucro Líquido.
    line("admin_clt", "Salários administrativos (CLT)", "fixo", 2800, undefined, {
      encargosAuto: true,
      encargosPct: 70,
    }),
    line("beneficios", "Benefícios (VA/VR + Plano Saúde)", "fixo", 600),
    line("plr", "PLR / Divisão de Lucros", "fixo", 0),
    line("contabilidade", "Contabilidade", "fixo", 450),
    line("tecnologia", "Tecnologia / Software (SaaS)", "fixo", 350),
    line("utilities", "Energia, água, internet", "fixo", 600),
    line("manutencao", "Manutenção e Limpeza", "fixo", 200),
    line("material_escritorio", "Material de escritório", "fixo", 0),
    line("seguros", "Seguros", "fixo", 0),
  ];
  if (business === "servicos") {
    base.splice(
      3,
      0,
      // Terceirização é contrato PJ — sem encargos trabalhistas embutidos.
      // O valor mensal já é o custo total faturado pelo prestador.
      line("mod_terc", "Mão de Obra Direta (Terceirização)", "fixo", 4500),
    );
  }
  return base;
}

function variaveisFor(business: BusinessType): CostLine[] {
  const base: CostLine[] = [
    line("marketing", "Marketing e publicidade", "variavel", 800),
    line("comissoes", "Comissões de vendas", "variavel", 600),
    line("frete_venda", "Fretes / Transportes", "variavel", 250),
    line("frete_vendas", "Frete sobre vendas", "variavel", 0, undefined, {
      fixed: false,
      values: fill12(0),
    }),
    line("combustivel", "Combustível", "variavel", 0, undefined, {
      fixed: false,
      values: fill12(0),
    }),
    line("marketplace", "Marketplace", "variavel", 0, undefined, {
      fixed: false,
      values: fill12(0),
    }),
  ];
  // OBS: "Insumos / Matéria Prima" NÃO entra como Despesa Comercial — esse item
  // pertence ao CSP/CPV (Custos Diretos). Mantê-lo aqui causava duplicidade
  // com a rubrica de mesmo nome já provisionada em "Custos Diretos de Venda".
  if (business === "industria") {
    base.push(
      line("mp_aco", "Matéria-prima principal", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
      line("mp_aux", "Matéria-prima auxiliar / componentes", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
      line("mod_prod", "Salários produção (MOD)", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
        encargosAuto: true,
        encargosPct: 70,
      }),
      line("cif_energia", "Energia de fábrica", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
      line("cif_manut", "Manutenção de máquinas", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
    );
  }
  if (business === "comercio") {
    base.push(
      line("merc_principal", "Mercadoria para revenda", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
      line("frete_compra", "Frete sobre compras", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
      line("icms_st", "ICMS-ST / tributos não recuperáveis", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
        semCredito: true,
      }),
      line("embalagem", "Embalagem para venda", "variavel", 0, undefined, {
        fixed: false,
        values: fill12(0),
      }),
    );
  }
  return base;
}

const financeiros = (): CostLine[] => [
  line("cheque_especial", "Juros sobre cheque especial", "financeiro", 0),
  line("iof", "IOF", "financeiro", 120),
  line("tarifas_bancarias", "Tarifas bancárias", "financeiro", 0),
  line("multas_juros", "Multas e juros por atraso", "financeiro", 0),
  line("antecipacao", "Taxas de Antecipação", "financeiro", 0),
  line("maquininha", "Maquininha Cartão", "financeiro", 0, undefined, {
    fixed: false,
    values: fill12(0),
  }),
];

export function defaultCostsFor(business: BusinessType): CostLine[] {
  return [
    ...costVendasFor(business),
    ...fixosFor(business),
    ...variaveisFor(business),
    ...financeiros(),
  ];
}

export const DEFAULT_STATE: AppState = {
  businessType: "servicos",
  companyName: "Minha Empresa LTDA",
  numColaboradores: 10,
  revenue: {
    bruta: baseRevenue,
    inadimplencia: fill12(5),
    pmr: 30,
    pmp: 30,
    pmrMensal: fill12(30),
    pmpMensal: fill12(30),
    pmrFixo: true,
    pmpFixo: true,
    inadimplenciaComoPDD: false,
    pddReversaoMensal: fill12(0),
    deducoes: [
      { id: "desc_incond", label: "Descontos Incondicionais", valores: fill12(0), fixed: true },
      { id: "abatimentos", label: "Abatimentos", valores: fill12(0), fixed: true },
    ],
    receitasFinanceiras: [
      {
        id: "rend_aplic",
        label: "Rendimento de aplicações",
        valores: fill12(0),
        fixed: true,
        tipo: "financeira",
      },
      {
        id: "alugueis",
        label: "Aluguéis Recebidos",
        valores: fill12(0),
        fixed: true,
        tipo: "operacional",
      },
      {
        id: "venda_ativos",
        label: "Ganho na venda de ativos",
        valores: fill12(0),
        fixed: true,
        tipo: "operacional",
      },
    ],
  },
  costs: defaultCostsFor("servicos"),
  capital: {
    // Sem valores hardcoded no Card Capital: todos os R$ vêm de entrada
    // do usuário ou são autocalculados (aberturaDerivada, balancoFechamento,
    // debtContracts, PMR/PMP). Percentuais (proprio/ke/kd) são referências
    // editáveis, não valores monetários.
    proprio: 100, // 100% capital próprio até o usuário informar dívida
    ke: 15, // custo do equity — referência editável
    kd: 0, // custo da dívida — 0 até haver dívida cadastrada
    capitalGiroDisponivel: 0,
    depreciacaoMensal: 0,

    patrimonioLiquido: 0,
    ativoTotal: 0,
    estoques: 0,
    disponibilidades: 0,
    // (removido: `dividaOnerosa` — dívida vem exclusivamente de `debtContracts`)
    ativoCirculante: 0, // 0 = autocalcular
    passivoCirculante: 0, // 0 = autocalcular
    contasReceber: 0, // 0 = autocalcular via PMR
    fornecedores: 0, // 0 = autocalcular via PMP
    caixaOcioso: 0,
    passivosNaoOnerosos: 0,
    estoqueInicial: 0,
    estoqueFinal: 0,
  },
  tax: {
    regime: "simples",
    simplesAnexo: "III",
    fatorR: 30,
    fatorRAuto: true,
    presumidoBaseIRPJ: 32,
    presumidoBaseCSLL: 32,
    issIcms: 5,
    aliquotaICMSCredito: 0,
    pisCreditos: 0,
    cofinsCreditos: 0,
    issDeducoes: 0,
    prejuizoFiscalAcumuladoAbertura: 0,
    era: "atual",
    cbsAliquota: CBS_ALIQUOTA_PLENA,
    ibsAliquotaRef: IBS_ALIQUOTA_PLENA,
    fornecedorSimplesNacionalPct: 0,
  },
  cashflow: {
    caixaMinimo: 15000,
    limiarAlerta: -10000,
    aportes: fill12(0),
    emprestimosCaptados: fill12(0),
    capex: fill12(0),
    dividendos: fill12(0),
    amortizacoes: fill12(0),
    mutuosConcedidos: fill12(0),
    mutuosDevolvidos: fill12(0),

    permutas: [
      {
        id: "perm-credito-default",
        label: "Permuta a crédito simples",
        tipo: "credito",
        values: fill12(0),
        isDefault: true,
      },
      {
        id: "perm-debito-default",
        label: "Permuta a débito simples",
        tipo: "debito",
        values: fill12(0),
        isDefault: true,
      },
    ],
  },

  strategic: {
    concentration: {},
    governance: {},
    competitive: {},
    regulatory: {},
  },

  socios: [],
  distribuicaoRealizada: { values: fill12(0), fixed: true },
};

// ============ Migração de estados antigos ============
const LEGACY_CPV_IDS = new Set(["insumos", "fretes"]);

export function migrateCostLine(c: CostLine): CostLine {
  // Auto-marca ICMS-ST como sem crédito (Auditoria Jun/2026)
  const semCredito = c.semCredito ?? c.subcategory === "icms_st";
  // Normaliza aliases legados → categorias por FUNÇÃO contábil (CPC 26).
  // `fixo`/`variavel` eram proxies para Admin/Comercial — promove para os nomes canônicos.
  const normalizeLegacy = (
    cat: CostLine["category"] | undefined,
  ): CostLine["category"] | undefined => {
    if (cat === "fixo") return "despesa_administrativa";
    if (cat === "variavel") return "despesa_comercial";
    return cat;
  };
  if (c.category) return { ...c, category: normalizeLegacy(c.category)!, semCredito };
  let category: CostLine["category"];
  if (c.group === "financeiro") category = "financeiro";
  else if (LEGACY_CPV_IDS.has(c.id)) category = "custo_vendas";
  else if (c.variavel) category = "despesa_comercial";
  else category = "despesa_administrativa";
  return { ...c, category, semCredito };
}

export function migrateState(s: AppState): AppState {
  // IDs de rubricas descontinuadas (removidas em todas as variantes)
  const REMOVED_IDS = new Set(["outros_fix", "outros_var", "outros_fin", "terceiros"]);
  // Relabels de rubricas existentes (mantém o id, atualiza apenas o label)
  const RELABEL: Record<string, string> = {
    manutencao: "Manutenção e Limpeza",
    frete_venda: "Fretes / Transportes",
    insumos_serv: "Insumos / Matéria Prima",
    iof: "IOF",
    antecipacao: "Taxas de Antecipação",
  };
  let costs = s.costs
    ? s.costs.map(migrateCostLine).filter((c) => !REMOVED_IDS.has(c.id))
    : DEFAULT_STATE.costs;
  costs = costs.map((c) => (RELABEL[c.id] ? { ...c, label: RELABEL[c.id] } : c));
  // Reclassifica "insumos_serv" para CSP — antes ficava em Despesas Comerciais,
  // gerando duplicidade com a rubrica de mesmo nome nos Custos Diretos.
  costs = costs.map((c) =>
    c.id === "insumos_serv" && c.category !== "custo_vendas" && c.category !== "direto_venda"
      ? { ...c, category: "custo_vendas", subcategory: "insumos_servico" }
      : c,
  );
  // Todas as categorias custo_vendas ou direto_venda são processadas
  costs = costs.map((c) => {
    if (c.category !== "custo_vendas" && c.category !== "direto_venda") return c;
    if (
      s.businessType === "servicos" &&
      c.subcategory === "mao_obra_direta" &&
      c.category !== "direto_venda"
    ) {
      return {
        ...c,
        category: "fixo",
        subcategory: undefined,
        label:
          c.label.includes("MOD") || c.label.toLowerCase().includes("salário")
            ? "Mão de Obra Direta (Terceirização)"
            : c.label,
      };
    }
    // Se for migração e ainda estiver como custo_vendas, move para direto_venda
    if (c.category === "custo_vendas") return { ...c, category: "direto_venda" };
    return c;
  });
  // SSOT — Terceirização/Subcontratação é contrato PJ: o valor faturado pelo
  // prestador JÁ é o custo total (encargos ficam por conta dele). Garante que
  // nenhum estado legado tenha `encargosAuto` ligado nessas linhas, evitando
  // inflar o valor mensal em ~70% silenciosamente.
  const TERCEIRIZACAO_IDS = new Set(["mod_terc", "subcon"]);
  costs = costs.map((c) => {
    const isTerc =
      TERCEIRIZACAO_IDS.has(c.id) ||
      c.subcategory === "terceirizacao" ||
      /terceiriz|subcontrat/i.test(c.label);
    if (!isTerc) return c;
    if (!c.encargosAuto && c.encargosPct == null) return c;
    return { ...c, encargosAuto: false, encargosPct: undefined };
  });
  // Garante presença das rubricas novas
  const ensure = (
    id: string,
    label: string,
    category: CostLine["category"],
    extras?: Partial<CostLine>,
  ) => {
    if (!costs.some((c) => c.id === id)) {
      costs.push(
        line(id, label, category, 0, undefined, { fixed: false, values: fill12(0), ...extras }),
      );
    }
  };
  ensure("maquininha", "Maquininha Cartão", "financeiro");
  ensure("marketplace", "Marketplace", "variavel");
  ensure("cheque_especial", "Juros sobre cheque especial", "financeiro");
  ensure("tarifas_bancarias", "Tarifas bancárias", "financeiro");
  ensure("multas_juros", "Multas e juros por atraso", "financeiro");
  ensure("combustivel", "Combustível", "variavel");
  ensure("frete_vendas", "Frete sobre vendas", "variavel");
  ensure("material_escritorio", "Material de escritório", "fixo");
  ensure("seguros", "Seguros", "fixo");

  const cashflow = s.cashflow ?? DEFAULT_STATE.cashflow;
  const capital = { ...DEFAULT_STATE.capital, ...(s.capital ?? {}) };
  const tax = { ...DEFAULT_STATE.tax, ...(s.tax ?? {}) };
  // Migra eras ano-a-ano (legado) para o modelo de 3 marcos.
  const legacyEra = tax.era as unknown as string | undefined;
  if (legacyEra && !["atual", "transicao", "pleno"].includes(legacyEra)) {
    tax.era = legacyEra === "2033" ? "pleno" : legacyEra === "atual" ? "atual" : "transicao";
  }
  const revenue = { ...DEFAULT_STATE.revenue, ...(s.revenue ?? {}) };
  if (typeof revenue.pddReversaoMensal === "number") {
    revenue.pddReversaoMensal = fill12(revenue.pddReversaoMensal);
  } else if (!revenue.pddReversaoMensal) {
    revenue.pddReversaoMensal = fill12(0);
  }

  if (!Array.isArray(revenue.deducoes)) revenue.deducoes = [];
  // Garante Descontos Incondicionais e Abatimentos
  if (!revenue.deducoes.some((d) => d.id === "desc_incond")) {
    revenue.deducoes = [
      ...revenue.deducoes,
      { id: "desc_incond", label: "Descontos Incondicionais", valores: fill12(0), fixed: true },
    ];
  }
  if (!revenue.deducoes.some((d) => d.id === "abatimentos")) {
    revenue.deducoes = [
      ...revenue.deducoes,
      { id: "abatimentos", label: "Abatimentos", valores: fill12(0), fixed: true },
    ];
  }
  // Garante Receitas Financeiras padrão
  if (!Array.isArray(revenue.receitasFinanceiras)) revenue.receitasFinanceiras = [];
  const ensureRF = (id: string, label: string, tipo: "financeira" | "operacional") => {
    if (!revenue.receitasFinanceiras!.some((d) => d.id === id)) {
      revenue.receitasFinanceiras = [
        ...revenue.receitasFinanceiras!,
        { id, label, valores: fill12(0), fixed: true, tipo },
      ];
    } else {
      // Backfill: garante `tipo` em snapshots antigos.
      revenue.receitasFinanceiras = revenue.receitasFinanceiras!.map((d) =>
        d.id === id && d.tipo === undefined ? { ...d, tipo } : d,
      );
    }
  };
  ensureRF("rend_aplic", "Rendimento de aplicações", "financeira");
  ensureRF("alugueis", "Aluguéis Recebidos", "operacional");
  ensureRF("venda_ativos", "Ganho na venda de ativos", "operacional");
  if (!Array.isArray(revenue.pmrMensal) || revenue.pmrMensal.length !== 12) {
    revenue.pmrMensal = fill12(revenue.pmr || 0);
    revenue.pmrFixo = true;
  }
  if (!Array.isArray(revenue.pmpMensal) || revenue.pmpMensal.length !== 12) {
    revenue.pmpMensal = fill12(revenue.pmp || 0);
    revenue.pmpFixo = true;
  }
  const strategic = s.strategic ?? {
    concentration: {},
    governance: {},
    competitive: {},
    regulatory: {},
  };
  // garante que cada subseção exista mesmo em states parcialmente preenchidos
  strategic.concentration = strategic.concentration ?? {};
  strategic.governance = strategic.governance ?? {};
  strategic.competitive = strategic.competitive ?? {};
  strategic.regulatory = strategic.regulatory ?? {};
  // remove campo legado `guided` se presente em states antigos persistidos
  const { guided: _legacyGuided, ...rest } = s as AppState & { guided?: unknown };
  void _legacyGuided;

  // SSOT: sanitização final de TODAS as séries Months[12] — protege contra
  // estados persistidos corrompidos (arrays curtos, NaN, Infinity, undefined).
  // Garante a invariante "Months sempre tem 12 finitos" em runtime.
  revenue.bruta = coerceMonths(revenue.bruta);
  revenue.inadimplencia = coerceMonths(revenue.inadimplencia);
  revenue.pmrMensal = coerceMonths(revenue.pmrMensal, revenue.pmr || 0);
  revenue.pmpMensal = coerceMonths(revenue.pmpMensal, revenue.pmp || 0);
  revenue.pddReversaoMensal = coerceMonths(revenue.pddReversaoMensal);
  revenue.deducoes = revenue.deducoes.map((d) => ({ ...d, valores: coerceMonths(d.valores) }));
  revenue.receitasFinanceiras = (revenue.receitasFinanceiras ?? []).map((d) => ({
    ...d,
    valores: coerceMonths(d.valores),
  }));
  // [SSOT] Remove linha legada `id="prolabore"` (seed antigo) de states persistidos —
  // pró-labore agora vem 100% de `state.socios` via syncSociosToCosts.
  costs = costs.filter((c) => c.id !== "prolabore");
  costs = costs.map((c) => ({ ...c, values: coerceMonths(c.values) }));
  cashflow.aportes = coerceMonths(cashflow.aportes);
  cashflow.emprestimosCaptados = coerceMonths(cashflow.emprestimosCaptados);
  cashflow.capex = coerceMonths(cashflow.capex);
  cashflow.dividendos = coerceMonths(cashflow.dividendos);
  cashflow.amortizacoes = coerceMonths(cashflow.amortizacoes);
  cashflow.mutuosConcedidos = coerceMonths(cashflow.mutuosConcedidos ?? []);
  cashflow.mutuosDevolvidos = coerceMonths(cashflow.mutuosDevolvidos ?? []);
  // Permutas simples — coage cada linha; mantém defaults se array ausente.
  cashflow.permutas = (cashflow.permutas ?? []).map((p) => ({
    ...p,
    values: coerceMonths(p.values),
  }));

  // Distribuição realizada — seed com cashflow.dividendos legado quando ausente
  // (preserva dados antigos onde a sincronização vinha da capacidade prevista).
  const distRealizada = (rest as AppState).distribuicaoRealizada;
  const legacyDividendos = coerceMonths(cashflow.dividendos);
  const temLegado = legacyDividendos.some((v) => v > 0);
  const distFinal =
    distRealizada && Array.isArray(distRealizada.values)
      ? { values: coerceMonths(distRealizada.values), fixed: distRealizada.fixed ?? true }
      : { values: temLegado ? legacyDividendos : fill12(0), fixed: !temLegado };

  // Aplica migrações versionadas (breaking changes) e estampa schemaVersion atual.
  return applySchemaMigrations({
    ...rest,
    revenue,
    capital,
    tax,
    costs,
    cashflow,
    strategic,
    distribuicaoRealizada: distFinal,
  });
}

/**
 * Empresa em branco para começar com dados reais: mesma estrutura do exemplo
 * (rubricas de custo do setor, deduções, receitas financeiras), com todos os
 * valores zerados.
 */
export function blankState(): AppState {
  const zero = fill12(0);
  return {
    ...DEFAULT_STATE,
    companyName: "Minha empresa",
    numColaboradores: 0,
    revenue: {
      ...DEFAULT_STATE.revenue,
      bruta: zero.slice(),
      inadimplencia: zero.slice(),
      deducoes: (DEFAULT_STATE.revenue.deducoes ?? []).map((d) => ({
        ...d,
        valores: zero.slice(),
      })),
      receitasFinanceiras: (DEFAULT_STATE.revenue.receitasFinanceiras ?? []).map((r) => ({
        ...r,
        valores: zero.slice(),
      })),
    },
    costs: defaultCostsFor("servicos").map((c) => ({ ...c, values: zero.slice() })),
    cashflow: { ...DEFAULT_STATE.cashflow, caixaMinimo: 0 },
  };
}

/**
 * Empresa de exemplo do primeiro acesso: prestadora de serviços saudável (nota
 * B), com dois pontos claros a trabalhar — margem modesta e caixa abaixo do
 * mínimo nos meses fracos do início do ano. Balanço de abertura fechado, mão de
 * obra direta no custo do serviço e sem linhas duplicadas.
 * (DEFAULT_STATE segue como base neutra dos testes e dos arquivos importados.)
 */
const EXAMPLE_REVENUE = [
  21000, 22500, 25000, 24000, 25500, 27000, 25000, 23500, 25500, 28000, 29500, 33500,
];
export const EXAMPLE_STATE: AppState = {
  ...DEFAULT_STATE,
  revenue: { ...DEFAULT_STATE.revenue, bruta: EXAMPLE_REVENUE, inadimplencia: fill12(4) },
  costs: defaultCostsFor("servicos")
    // Sem duplicatas: um só frete ("Frete sobre vendas", que a migração exige)
    // e a terceirização no custo do serviço (linha da tabela de custos diretos).
    .filter((c) => c.id !== "frete_venda" && c.id !== "mod_terc")
    .map((c) =>
      c.category === "direto_venda" && c.subcategory === "terceirizacao"
        ? { ...c, values: fill12(9000) }
        : c.id === "frete_vendas"
          ? { ...c, values: fill12(250) }
          : c,
    ),
  capital: {
    ...DEFAULT_STATE.capital,
    disponibilidades: 25000,
    patrimonioLiquido: 49200,
    ativoTotal: 66300,
    abertura: {
      ...(DEFAULT_STATE.capital.abertura ?? {}),
      caixa: 25000,
      lucrosAcumulados: 19732.09,
    },
  },
};

/** Ainda são os dados de exemplo (nada foi digitado na receita nem no nome)? */
export function isExampleState(s: AppState): boolean {
  const igual = (ref: AppState) =>
    s.companyName === ref.companyName &&
    s.revenue.bruta.every((v, i) => v === ref.revenue.bruta[i]);
  // DEFAULT_STATE: exemplo antigo, ainda salvo no navegador de quem já usava.
  return igual(EXAMPLE_STATE) || igual(DEFAULT_STATE);
}
