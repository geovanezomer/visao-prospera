export type Months = number[]; // length 12

export type BusinessType = "servicos" | "comercio" | "industria";
export type TaxRegime = "simples" | "presumido" | "real";
export type SimplesAnexo = "I" | "II" | "III" | "IV" | "V";

export type CostCategory = "custo_vendas" | "fixo" | "variavel" | "financeiro";
export type CostSubcategory = string;

export interface Revenue {
  bruta: Months;
  inadimplencia: Months; // %
  pmr: number;
  pmp: number;
}

export interface CostLine {
  id: string;
  label: string;
  category: CostCategory;
  subcategory?: CostSubcategory;
  values: Months;
  fixed: boolean;
  custom?: boolean;
  /** @deprecated migração legacy */
  group?: "operacional" | "financeiro";
  /** @deprecated migração legacy */
  variavel?: boolean;
}

export interface CapitalStructure {
  proprio: number;
  ke: number;
  kd: number;
  capitalGiroDisponivel: number;
  depreciacaoMensal: number;
  jurosRecebidosMensal: number;
  patrimonioLiquido: number;
  ativoTotal: number;
  estoques: number;
  disponibilidades: number;
}

export interface TaxConfig {
  regime: TaxRegime;
  simplesAnexo: SimplesAnexo;
  fatorR: number;
  presumidoBaseIRPJ: number;
  presumidoBaseCSLL: number;
  issIcms: number;
  pisCreditos: number;
  cofinsCreditos: number;
}

// Itens não-operacionais do fluxo de caixa
export interface CashFlowConfig {
  caixaMinimo: number;            // saldo mínimo de segurança (R$)
  aportes: Months;                // aportes de sócios
  emprestimosCaptados: Months;    // captação de dívida (entrada de caixa)
  capex: Months;                  // investimentos em ativo fixo
  dividendos: Months;             // distribuição de lucros
  amortizacoes: Months;           // pagamentos de principal de dívida (não juros)
}

export interface AppState {
  businessType: BusinessType;
  companyName: string;
  revenue: Revenue;
  costs: CostLine[];
  capital: CapitalStructure;
  tax: TaxConfig;
  cashflow: CashFlowConfig;
  guided: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  createdAt: number;
  state: AppState;
}

export const COST_VENDAS_LABEL: Record<BusinessType, { short: string; long: string }> = {
  industria: { short: "CPV", long: "Custo do Produto Vendido" },
  comercio: { short: "CMV", long: "Custo da Mercadoria Vendida" },
  servicos: { short: "CSP", long: "Custo do Serviço Prestado" },
};

export const SUBCATEGORIES: Record<BusinessType, { id: string; label: string }[]> = {
  industria: [
    { id: "materia_prima", label: "Matéria-prima" },
    { id: "mao_obra_direta", label: "Mão de obra direta" },
    { id: "cif", label: "Custos indiretos de fabricação (CIF)" },
  ],
  comercio: [
    { id: "mercadoria", label: "Mercadoria para revenda" },
    { id: "frete_compra", label: "Frete sobre compras" },
    { id: "icms_st", label: "ICMS-ST / Tributos não recuperáveis" },
    { id: "embalagem", label: "Embalagem" },
  ],
  servicos: [
    { id: "mao_obra_direta", label: "Mão de obra direta (técnica)" },
    { id: "insumos_servico", label: "Insumos de serviço" },
    { id: "terceirizacao", label: "Terceirização / Subcontratação" },
  ],
};
