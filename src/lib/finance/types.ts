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
  /** Quando true, inadimplência vira PDD (despesa operacional) ao invés de dedução de receita.
   *  Mais correto contabilmente (CPC 47/IFRS 9) e não reduz base de PIS/COFINS/ISS. */
  inadimplenciaComoPDD?: boolean;
}

export interface CostLine {
  id: string;
  label: string;
  category: CostCategory;
  subcategory?: CostSubcategory;
  values: Months;
  fixed: boolean;
  custom?: boolean;
  /** Linha de folha CLT. Aplica encargos automáticos (INSS Patr + FGTS + RAT/S + provisão 13º/férias). */
  encargosAuto?: boolean;
  /** % de encargos sobre o salário base (default 70% = INSS 20% + FGTS 8% + SAT/Sist.S ~5% + 13º + férias + 1/3). */
  encargosPct?: number;
  /** @deprecated legacy */ group?: "operacional" | "financeiro";
  /** @deprecated legacy */ variavel?: boolean;
}

export interface CapitalStructure {
  proprio: number; // % capital próprio (E) — usado apenas como referência se dividaOnerosa/PL não preenchidos
  ke: number;
  kd: number;
  capitalGiroDisponivel: number;
  depreciacaoMensal: number;
  jurosRecebidosMensal: number;
  patrimonioLiquido: number;
  ativoTotal: number;
  estoques: number;
  disponibilidades: number;
  // ----- novos campos (Fase 3) — fonte da verdade para ROIC, WACC, liquidez -----
  /** Dívida onerosa total (empréstimos, financiamentos, debêntures). NÃO inclui fornecedores nem impostos a pagar. */
  dividaOnerosa: number;
  /** Ativo Circulante (caixa + CR + estoque + outros CP). Se 0, calculado a partir dos demais campos. */
  ativoCirculante: number;
  /** Passivo Circulante (fornecedores + impostos a pagar + empréstimos CP + salários a pagar). */
  passivoCirculante: number;
  /** Contas a Receber de clientes (saldo médio). Se 0, estimado a partir do PMR. */
  contasReceber: number;
  /** Fornecedores a Pagar (saldo médio). Se 0, estimado a partir do PMP. */
  fornecedores: number;
}

export interface TaxConfig {
  regime: TaxRegime;
  simplesAnexo: SimplesAnexo;
  fatorR: number;
  /** Quando true, calcula Fator R automaticamente (folha/RBT12) e migra Anexo V → III se ≥ 28%. */
  fatorRAuto?: boolean;
  presumidoBaseIRPJ: number;
  presumidoBaseCSLL: number;
  /** Alíquota de ISS (serviços) OU ICMS débito (comércio/indústria), em %. */
  issIcms: number;
  /** Alíquota de crédito de ICMS sobre o CPV (entradas). Aplicada apenas em comércio/indústria
   *  nos regimes Presumido/Real. Default 0. ICMS efetivo = max(0, débito − crédito). */
  aliquotaICMSCredito?: number;
  pisCreditos: number;
  cofinsCreditos: number;
  /** Dedução de materiais/subempreitada para ISS (Lei 116/2003 art. 7º §2º). Anual em R$. */
  issDeducoes?: number;
}

export interface CashFlowConfig {
  caixaMinimo: number;
  aportes: Months;
  emprestimosCaptados: Months;
  capex: Months;
  dividendos: Months;
  amortizacoes: Months;
}

export interface GuidedState {
  /** Modo guiado ativo (mostra banner persistente). */
  enabled: boolean;
  /** Wizard de setup já foi concluído pelo menos uma vez. */
  completedWizard: boolean;
  /** Usuário fechou o banner de boas-vindas. */
  dismissedBanner: boolean;
}

// ============= Análise Estratégica (qualitativa, opcional) =============
// Todas as respostas são opcionais. Se nenhuma seção for preenchida, o
// módulo não gera score e não afeta o health financeiro.

export type ClientesPara80 = "1-2" | "3-5" | "6-15" | "16+";
export type TempoCliente = "lt1" | "1-3" | "3-5" | "5+";
export type DependenciaCanal = "sim" | "parcial" | "nao";

export interface ConcentrationAnswers {
  /** % da receita do maior cliente (0–100). */
  pctMaiorCliente?: number;
  /** Quantos clientes respondem por ~80% da receita. */
  clientesPara80Pct?: ClientesPara80;
  /** Há quanto tempo o maior cliente está com você. */
  tempoMaiorCliente?: TempoCliente;
  /** % do CPV/CMV vindo do maior fornecedor (0–100). */
  pctMaiorFornecedor?: number;
  /** Depende de um único canal/plataforma para gerar leads. */
  dependeCanal?: DependenciaCanal;
}

export type SocioAfastado = "normal" | "perde_eficiencia" | "para";
export type QuemFechaContrato = "ninguem" | "socios" | "gerentes" | "equipe";
export type ProcessosDoc = "nenhum" | "financeiros" | "operacionais" | "maioria";
export type PlanoSucessao = "sim" | "parcial" | "nao" | "nunca";

export interface GovernanceAnswers {
  socioAfastado60d?: SocioAfastado;
  quemFechaContrato?: QuemFechaContrato;
  processosDocumentados?: ProcessosDoc;
  planoSucessao?: PlanoSucessao;
}

export type ReajustePrecos = "sem_resistencia" | "com_resistencia" | "nao_repassou" | "reduziu";
export type Elasticidade = "menos_5" | "5_20" | "mais_20" | "nao_sei";
export type RazaoContratacao = "preco" | "relacionamento" | "qualidade" | "unica_opcao" | "prazo" | "marca";
export type Concorrentes = "nenhum" | "1-3" | "4-10" | "10+" | "nao_sei";
export type SwitchingCost = "alto" | "medio" | "baixo" | "commodity";

export interface CompetitiveAnswers {
  reajustePrecos?: ReajustePrecos;
  elasticidade10pct?: Elasticidade;
  razaoContratacao?: RazaoContratacao;
  concorrentes?: Concorrentes;
  switchingCost?: SwitchingCost;
}

export type ExposicaoRegulatoria = "sim" | "parcial" | "nao";

export interface RegulatoryAnswers {
  /** Operação depende de licença, certificação, contrato público, importação ou câmbio. */
  exposicaoRegulatoria?: ExposicaoRegulatoria;
}

export interface StrategicAnswers {
  concentration: ConcentrationAnswers;
  governance: GovernanceAnswers;
  competitive: CompetitiveAnswers;
  regulatory: RegulatoryAnswers;
}

export interface AppState {
  businessType: BusinessType;
  companyName: string;
  revenue: Revenue;
  costs: CostLine[];
  capital: CapitalStructure;
  tax: TaxConfig;
  cashflow: CashFlowConfig;
  guided: GuidedState;
  /** Respostas qualitativas do módulo de Análise Estratégica (opcional). */
  strategic?: StrategicAnswers;
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

/** Fator de encargos default para CLT (INSS 20% + FGTS 8% + SAT/Sist.S ~5% + 13º + férias + 1/3). */
export const DEFAULT_ENCARGOS_PCT = 70;
