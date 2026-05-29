export type Months = number[]; // length 12

export type BusinessType = "servicos" | "comercio" | "industria";
export type TaxRegime = "simples" | "presumido" | "real";
export type SimplesAnexo = "I" | "II" | "III" | "IV" | "V";

export interface Revenue {
  bruta: Months;
  inadimplencia: Months; // %
  pmr: number;
  pmp: number;
}

export interface CostLine {
  id: string;
  label: string;
  group: "operacional" | "financeiro";
  values: Months;
  fixed: boolean; // if true, values[0] applied to all
  variavel?: boolean; // counts as variable cost for break-even
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
  fatorR: number; // folha / receita 12m (auto, but stored)
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
