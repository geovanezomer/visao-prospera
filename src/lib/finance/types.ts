export type Months = number[]; // length 12

export type BusinessType = "servicos" | "comercio" | "industria";
export type TaxRegime = "simples" | "presumido" | "real";
export type SimplesAnexo = "I" | "II" | "III" | "IV" | "V";

export type CostCategory = "custo_vendas" | "fixo" | "variavel" | "financeiro";

// Subcategorias dentro do Custo de Vendas, dependem do tipo de empresa.
// industria: materia_prima | mao_obra_direta | cif
// comercio:  mercadoria | frete_compra | icms_st | embalagem
// servicos:  mao_obra_direta | insumos_servico | terceirizacao
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
  fixed: boolean; // modo de entrada: valor único replicado em 12 meses
  custom?: boolean; // adicionada pelo usuário, pode ser removida
  /** @deprecated mantido apenas para migração de versões antigas */
  group?: "operacional" | "financeiro";
  /** @deprecated substituído por category */
  variavel?: boolean;
}

export interface CapitalStructure {
  proprio: number; // %
  ke: number; // %
  kd: number; // %
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
  presumidoBaseIRPJ: number; // %
  presumidoBaseCSLL: number; // %
  issIcms: number; // %
  pisCreditos: number; // monthly R$
  cofinsCreditos: number; // monthly R$
}

export interface AppState {
  businessType: BusinessType;
  companyName: string;
  revenue: Revenue;
  costs: CostLine[];
  capital: CapitalStructure;
  tax: TaxConfig;
  guided: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  createdAt: number;
  state: AppState;
}

// ============= helpers =============

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
