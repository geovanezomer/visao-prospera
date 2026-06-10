import { AppState, BusinessType, CostLine } from "./types";
import { fill12 } from "./format";

const baseRevenue = [13000, 14000, 15500, 15000, 16000, 17000, 15500, 14500, 16000, 17500, 18500, 21000];

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
  if (business === "industria") {
    return [
      line("mp_aco", "Matéria-prima principal", "custo_vendas", 2500, "materia_prima"),
      line("mp_aux", "Matéria-prima auxiliar / componentes", "custo_vendas", 800, "materia_prima"),
      line("mod_prod", "Salários produção (MOD)", "custo_vendas", 3500, "mao_obra_direta", { encargosAuto: true, encargosPct: 70 }),
      line("cif_energia", "Energia de fábrica", "custo_vendas", 600, "cif"),
      line("cif_manut", "Manutenção de máquinas", "custo_vendas", 400, "cif"),
    ];
  }
  if (business === "comercio") {
    return [
      line("merc_principal", "Mercadoria para revenda", "custo_vendas", 4500, "mercadoria"),
      line("frete_compra", "Frete sobre compras", "custo_vendas", 350, "frete_compra"),
      line("icms_st", "ICMS-ST / tributos não recuperáveis", "custo_vendas", 280, "icms_st", { semCredito: true }),
      line("embalagem", "Embalagem para venda", "custo_vendas", 180, "embalagem"),
    ];
  }
  // Serviços: sem CSP — mão de obra direta vai para Fixos, insumos e subcontratação vão para Variáveis
  return [];
}

function fixosFor(business: BusinessType): CostLine[] {
  const base: CostLine[] = [
    line("aluguel", "Aluguel", "fixo", 2500),
    line("prolabore", "Pró-labore (sócios)", "fixo", 3000),
    line("admin_clt", "Salários administrativos (CLT)", "fixo", 2800, undefined, { encargosAuto: true, encargosPct: 70 }),
    line("beneficios", "Benefícios (VA/VR + Plano Saúde)", "fixo", 600),
    line("plr", "PLR / Divisão de Lucros", "fixo", 0),
    line("contabilidade", "Contabilidade", "fixo", 450),
    line("tecnologia", "Tecnologia / Software (SaaS)", "fixo", 350),
    line("utilities", "Energia, água, internet", "fixo", 600),
    line("manutencao", "Manutenção e reparos", "fixo", 200),
    line("outros_fix", "Outros custos fixos", "fixo", 250),
  ];
  if (business === "servicos") {
    base.splice(3, 0, line("mod_terc", "Mão de Obra Direta (Terceirização)", "fixo", 4500, undefined, { encargosAuto: true, encargosPct: 70 }));
  }
  return base;
}

function variaveisFor(business: BusinessType): CostLine[] {
  const base: CostLine[] = [
    line("marketing", "Marketing e publicidade", "variavel", 800),
    line("comissoes", "Comissões de vendas", "variavel", 600),
    line("frete_venda", "Frete sobre vendas", "variavel", 250),
    line("outros_var", "Outros custos variáveis", "variavel", 0),
  ];
  if (business === "servicos") {
    base.push(
      line("insumos_serv", "Insumos de serviço", "variavel", 500),
      line("terceiros", "Subcontratação / freelancers", "variavel", 600),
    );
  }
  return base;
}

const financeiros = (): CostLine[] => [
  line("juros", "Juros sobre empréstimos", "financeiro", 300),
  line("iof", "IOF / Tarifas bancárias", "financeiro", 120),
  line("antecipacao", "Antecipação de recebíveis", "financeiro", 0),
  line("outros_fin", "Outros custos financeiros", "financeiro", 0),
];

export function defaultCostsFor(business: BusinessType): CostLine[] {
  return [...costVendasFor(business), ...fixosFor(business), ...variaveisFor(business), ...financeiros()];
}

export const DEFAULT_STATE: AppState = {
  businessType: "servicos",
  companyName: "Minha Empresa LTDA",
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
    deducoes: [],
  },
  costs: defaultCostsFor("servicos"),
  capital: {
    proprio: 60,
    ke: 15,
    kd: 18,
    capitalGiroDisponivel: 15000,
    depreciacaoMensal: 400,
    jurosRecebidosMensal: 50,
    patrimonioLiquido: 60000,
    ativoTotal: 100000,
    estoques: 5000,
    disponibilidades: 18000,
    dividaOnerosa: 30000,
    ativoCirculante: 0,           // 0 = autocalcular
    passivoCirculante: 0,         // 0 = autocalcular
    contasReceber: 0,             // 0 = autocalcular via PMR
    fornecedores: 0,              // 0 = autocalcular via PMP
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
    era: "atual",
    cbsAliquota: 8.8,
    ibsAliquotaRef: 17.7,
  },
  cashflow: {
    caixaMinimo: 15000,
    limiarAlerta: -10000,
    aportes: fill12(0),
    emprestimosCaptados: fill12(0),
    capex: fill12(0),
    dividendos: fill12(0),
    amortizacoes: fill12(0),
  },
  
  strategic: {
    concentration: {},
    governance: {},
    competitive: {},
    regulatory: {},
  },
};

// ============ Migração de estados antigos ============
const LEGACY_CPV_IDS = new Set(["insumos", "fretes"]);

export function migrateCostLine(c: CostLine): CostLine {
  // Auto-marca ICMS-ST como sem crédito (Auditoria Jun/2026)
  const semCredito = c.semCredito ?? (c.subcategory === "icms_st");
  if (c.category) return { ...c, semCredito };
  let category: CostLine["category"];
  if (c.group === "financeiro") category = "financeiro";
  else if (LEGACY_CPV_IDS.has(c.id)) category = "custo_vendas";
  else if (c.variavel) category = "variavel";
  else category = "fixo";
  return { ...c, category, semCredito };
}

export function migrateState(s: AppState): AppState {
  let costs = s.costs ? s.costs.map(migrateCostLine) : DEFAULT_STATE.costs;
  // Serviços: descontinuamos CSP — realoca linhas custo_vendas para fixo/variável
  if (s.businessType === "servicos") {
    costs = costs.map((c) => {
      if (c.category !== "custo_vendas") return c;
      if (c.subcategory === "mao_obra_direta") {
        return { ...c, category: "fixo", subcategory: undefined, label: c.label.includes("MOD") || c.label.toLowerCase().includes("salário") ? "Mão de Obra Direta (Terceirização)" : c.label };
      }
      return { ...c, category: "variavel", subcategory: undefined };
    });
  }

  const cashflow = s.cashflow ?? DEFAULT_STATE.cashflow;
  const capital = { ...DEFAULT_STATE.capital, ...(s.capital ?? {}) };
  const tax = { ...DEFAULT_STATE.tax, ...(s.tax ?? {}) };
  // Migra eras ano-a-ano (legado) para o modelo de 3 marcos.
  const legacyEra = tax.era as unknown as string | undefined;
  if (legacyEra && !["atual", "transicao", "pleno"].includes(legacyEra)) {
    tax.era = legacyEra === "2033" ? "pleno" : legacyEra === "atual" ? "atual" : "transicao";
  }
  const revenue = { ...DEFAULT_STATE.revenue, ...(s.revenue ?? {}) };
  if (!Array.isArray(revenue.deducoes)) revenue.deducoes = [];
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
  return { ...rest, revenue, capital, tax, costs, cashflow, strategic };
}
