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

function costVendasFor(_business: BusinessType): CostLine[] {
  // Custo de Vendas (CPV/CMV/CSP) foi descontinuado como seção própria.
  // Linhas de custo direto agora aparecem em Variáveis (toggle Fixo desligado, valor 0).
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
    line("manutencao", "Manutenção e Limpeza", "fixo", 200),
    line("material_escritorio", "Material de escritório", "fixo", 0),
    line("seguros", "Seguros", "fixo", 0),
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
    line("frete_venda", "Fretes / Transportes", "variavel", 250),
    line("frete_vendas", "Frete sobre vendas", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
    line("combustivel", "Combustível", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
    line("marketplace", "Marketplace", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
  ];
  if (business === "servicos") {
    base.push(
      line("insumos_serv", "Insumos / Matéria Prima", "variavel", 500),
    );
  }
  if (business === "industria") {
    base.push(
      line("mp_aco", "Matéria-prima principal", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
      line("mp_aux", "Matéria-prima auxiliar / componentes", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
      line("mod_prod", "Salários produção (MOD)", "variavel", 0, undefined, { fixed: false, values: fill12(0), encargosAuto: true, encargosPct: 70 }),
      line("cif_energia", "Energia de fábrica", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
      line("cif_manut", "Manutenção de máquinas", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
    );
  }
  if (business === "comercio") {
    base.push(
      line("merc_principal", "Mercadoria para revenda", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
      line("frete_compra", "Frete sobre compras", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
      line("icms_st", "ICMS-ST / tributos não recuperáveis", "variavel", 0, undefined, { fixed: false, values: fill12(0), semCredito: true }),
      line("embalagem", "Embalagem para venda", "variavel", 0, undefined, { fixed: false, values: fill12(0) }),
    );
  }
  return base;
}

const financeiros = (): CostLine[] => [
  line("juros", "Juros sobre empréstimos", "financeiro", 300),
  line("cheque_especial", "Juros sobre cheque especial", "financeiro", 0),
  line("iof", "IOF", "financeiro", 120),
  line("tarifas_bancarias", "Tarifas bancárias", "financeiro", 0),
  line("multas_juros", "Multas e juros por atraso", "financeiro", 0),
  line("antecipacao", "Taxas de Antecipação", "financeiro", 0),
  line("maquininha", "Maquininha Cartão", "financeiro", 0, undefined, { fixed: false, values: fill12(0) }),
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
    deducoes: [
      { id: "desc_incond", label: "Descontos Incondicionais", valores: fill12(0), fixed: true },
      { id: "abatimentos", label: "Abatimentos", valores: fill12(0), fixed: true },
    ],
    receitasFinanceiras: [
      { id: "rend_aplic", label: "Rendimento de aplicações", valores: fill12(0), fixed: true },
      { id: "alugueis", label: "Aluguéis Recebidos", valores: fill12(0), fixed: true },
      { id: "venda_ativos", label: "Venda de Ativos", valores: fill12(0), fixed: true },
    ],
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
  let costs = s.costs ? s.costs.map(migrateCostLine).filter((c) => !REMOVED_IDS.has(c.id)) : DEFAULT_STATE.costs;
  costs = costs.map((c) => (RELABEL[c.id] ? { ...c, label: RELABEL[c.id] } : c));
  // Todas as categorias custo_vendas viraram variável (CPV/CMV/CSP descontinuado como seção)
  costs = costs.map((c) => {
    if (c.category !== "custo_vendas") return c;
    if (s.businessType === "servicos" && c.subcategory === "mao_obra_direta") {
      return { ...c, category: "fixo", subcategory: undefined, label: c.label.includes("MOD") || c.label.toLowerCase().includes("salário") ? "Mão de Obra Direta (Terceirização)" : c.label };
    }
    return { ...c, category: "variavel", subcategory: undefined };
  });
  // Garante presença das rubricas novas
  const ensure = (id: string, label: string, category: CostLine["category"], extras?: Partial<CostLine>) => {
    if (!costs.some((c) => c.id === id)) {
      costs.push(line(id, label, category, 0, undefined, { fixed: false, values: fill12(0), ...extras }));
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
  if (!Array.isArray(revenue.deducoes)) revenue.deducoes = [];
  // Garante Descontos Incondicionais e Abatimentos
  if (!revenue.deducoes.some((d) => d.id === "desc_incond")) {
    revenue.deducoes = [...revenue.deducoes, { id: "desc_incond", label: "Descontos Incondicionais", valores: fill12(0), fixed: true }];
  }
  if (!revenue.deducoes.some((d) => d.id === "abatimentos")) {
    revenue.deducoes = [...revenue.deducoes, { id: "abatimentos", label: "Abatimentos", valores: fill12(0), fixed: true }];
  }
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
