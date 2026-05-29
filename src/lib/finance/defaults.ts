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
      line("icms_st", "ICMS-ST / tributos não recuperáveis", "custo_vendas", 280, "icms_st"),
      line("embalagem", "Embalagem para venda", "custo_vendas", 180, "embalagem"),
    ];
  }
  return [
    line("mod_tec", "Salários técnicos (MOD)", "custo_vendas", 4500, "mao_obra_direta", { encargosAuto: true, encargosPct: 70 }),
    line("insumos_serv", "Insumos de serviço", "custo_vendas", 500, "insumos_servico"),
    line("terceiros", "Subcontratação / freelancers", "custo_vendas", 600, "terceirizacao"),
  ];
}

const fixos = (): CostLine[] => [
  line("aluguel", "Aluguel", "fixo", 2500),
  line("prolabore", "Pró-labore (sócios)", "fixo", 3000),
  line("admin_clt", "Salários administrativos (CLT)", "fixo", 2800, undefined, { encargosAuto: true, encargosPct: 70 }),
  line("contabilidade", "Contabilidade", "fixo", 450),
  line("tecnologia", "Tecnologia / Software (SaaS)", "fixo", 350),
  line("utilities", "Energia, água, internet", "fixo", 600),
  line("manutencao", "Manutenção e reparos", "fixo", 200),
  line("outros_fix", "Outros custos fixos", "fixo", 250),
];

const variaveis = (): CostLine[] => [
  line("marketing", "Marketing e publicidade", "variavel", 800),
  line("comissoes", "Comissões de vendas", "variavel", 600),
  line("frete_venda", "Frete sobre vendas", "variavel", 250),
  line("outros_var", "Outros custos variáveis", "variavel", 0),
];

const financeiros = (): CostLine[] => [
  line("juros", "Juros sobre empréstimos", "financeiro", 300),
  line("iof", "IOF / Tarifas bancárias", "financeiro", 120),
  line("antecipacao", "Antecipação de recebíveis", "financeiro", 0),
  line("outros_fin", "Outros custos financeiros", "financeiro", 0),
];

export function defaultCostsFor(business: BusinessType): CostLine[] {
  return [...costVendasFor(business), ...fixos(), ...variaveis(), ...financeiros()];
}

export const DEFAULT_STATE: AppState = {
  businessType: "servicos",
  companyName: "Minha Empresa LTDA",
  revenue: {
    bruta: baseRevenue,
    inadimplencia: fill12(5),
    pmr: 30,
    pmp: 30,
    inadimplenciaComoPDD: false,
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
  },
  tax: {
    regime: "simples",
    simplesAnexo: "III",
    fatorR: 30,
    fatorRAuto: true,
    presumidoBaseIRPJ: 32,
    presumidoBaseCSLL: 32,
    issIcms: 5,
    pisCreditos: 0,
    cofinsCreditos: 0,
    issDeducoes: 0,
  },
  cashflow: {
    caixaMinimo: 15000,
    aportes: fill12(0),
    emprestimosCaptados: fill12(0),
    capex: fill12(0),
    dividendos: fill12(0),
    amortizacoes: fill12(0),
  },
  guided: { enabled: false, completedWizard: false, dismissedBanner: false },
};

// ============ Migração de estados antigos ============
const LEGACY_CPV_IDS = new Set(["insumos", "fretes"]);

export function migrateCostLine(c: CostLine): CostLine {
  if (c.category) return c;
  let category: CostLine["category"];
  if (c.group === "financeiro") category = "financeiro";
  else if (LEGACY_CPV_IDS.has(c.id)) category = "custo_vendas";
  else if (c.variavel) category = "variavel";
  else category = "fixo";
  return { ...c, category };
}

export function migrateState(s: AppState): AppState {
  const costs = s.costs ? s.costs.map(migrateCostLine) : DEFAULT_STATE.costs;
  const cashflow = s.cashflow ?? DEFAULT_STATE.cashflow;
  const capital = { ...DEFAULT_STATE.capital, ...(s.capital ?? {}) };
  const tax = { ...DEFAULT_STATE.tax, ...(s.tax ?? {}) };
  const revenue = { ...DEFAULT_STATE.revenue, ...(s.revenue ?? {}) };
  // guided era boolean em versões antigas — migra para o objeto.
  const rawGuided: unknown = (s as { guided?: unknown }).guided;
  const guided =
    typeof rawGuided === "boolean"
      ? { enabled: rawGuided, completedWizard: false, dismissedBanner: false }
      : { ...DEFAULT_STATE.guided, ...(rawGuided as Partial<typeof DEFAULT_STATE.guided> | undefined) };
  return { ...s, revenue, capital, tax, costs, cashflow, guided };
}
