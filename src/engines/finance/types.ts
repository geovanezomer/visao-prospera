/**
 * `Months` representa uma série mensal de 12 posições.
 *
 * Tecnicamente é `number[]` para evitar quebrar literais de array espalhados
 * pelo codebase (defaults, testes, formulários). A invariante de 12 posições
 * finitas é garantida em RUNTIME por:
 *   - `fill12` (construção segura) — `format.ts`
 *   - `coerceMonths` (sanitização) — `safeMath.ts`
 *   - `migrateState` (boundary do localStorage) — `defaults.ts`
 *
 * Não construa um `Months` manualmente — sempre passe por `fill12` ou
 * `coerceMonths` para garantir 12 posições e valores finitos.
 */
export type Months = number[]; // length 12 (validado em runtime)

/** Chaves das abas da interface principal (src/routes/index.tsx).
 *  Mantém o `value` dos componentes Tabs/TabsTrigger/TabsContent fortemente tipado:
 *  qualquer string fora deste union dispara erro de compilação. */
export type TabKey =
  | "receitas" // 1. Receita mensal + deduções (CPC/IFRS 15)
  | "custos" // 2. CPV/CMV/CSP + fixos + variáveis + financeiros
  | "capital" // 3. Estrutura de capital, WACC, capex
  | "tributos" // 4. Regime tributário (Simples/Presumido/Real + reforma CBS/IBS)
  | "caixa" // 5. Fluxo de Caixa (DFC) + burn/runway
  | "governanca" // 6. Análise estratégica (concentração, governança, competitiva, regulatória)
  | "dre" // 7. DRE consolidada
  | "indicadores" // 8. Indicadores financeiros e gráficos
  | "resultados" // 9. Diagnóstico + cenários
  | "simulador" // 10. Simulador de alavancas
  | "valuation"; // 11. Valuation (múltiplos + DCF)

/** Lista canônica das abas, em ordem. Use em vez de hardcodar strings. */
export const TAB_KEYS: readonly TabKey[] = [
  "receitas",
  "custos",
  "capital",
  "tributos",
  "caixa",
  "governanca",
  "dre",
  "indicadores",
  "resultados",
  "simulador",
  "valuation",
] as const;

export type BusinessType = "servicos" | "comercio" | "industria";
export type TaxRegime = "simples" | "presumido" | "real";
export type SimplesAnexo = "I" | "II" | "III" | "IV" | "V";

export type CostCategory = "custo_vendas" | "fixo" | "variavel" | "financeiro" | "direto_venda";
export type CostSubcategory = string;

export interface RevenueDeducao {
  id: string;
  label: string;
  valores: Months;
  /** Se true, o mesmo valor é aplicado em todos os 12 meses (modo fixo). */
  fixed?: boolean;
  /**
   * Receitas Financeiras apenas: marca rendimentos sujeitos à tributação EXCLUSIVA na fonte
   * (IRRF definitivo em aplicações financeiras de renda fixa/variável). Quando true, o
   * rendimento NÃO entra na base de IRPJ/CSLL do Lucro Presumido nem do Lucro Real
   * (evita superestimar imposto em PMEs com caixa ocioso relevante). Default: false.
   */
  tributacaoExclusivaFonte?: boolean;
}

export interface Revenue {
  bruta: Months;
  inadimplencia: Months; // %
  /** PMR médio (em dias) — derivado de pmrMensal. Mantido para backward-compat. */
  pmr: number;
  /** PMP médio (em dias) — derivado de pmpMensal. Mantido para backward-compat. */
  pmp: number;
  /** PMR mês a mês (em dias). */
  pmrMensal?: Months;
  /** PMP mês a mês (em dias). */
  pmpMensal?: Months;
  /** Modo fixo para PMR (mesmo valor nos 12 meses). */
  pmrFixo?: boolean;
  /** Modo fixo para PMP (mesmo valor nos 12 meses). */
  pmpFixo?: boolean;
  /** Quando true, inadimplência vira PDD (despesa operacional) ao invés de dedução de receita.
   *  Mais correto contabilmente (CPC 47/IFRS 9) e não reduz base de PIS/COFINS/ISS. */
  inadimplenciaComoPDD?: boolean;
  /** Reversão/recuperação de PDD mensal (R$). Reduz a PDD líquida do mês (CPC 47). */
  pddReversaoMensal?: Months;
  /** Linhas livres de deduções (devoluções, perdas, furtos, descontos comerciais, abatimentos...).
   *  Subtraídas da Receita Bruta antes da Receita Líquida e da base de impostos sobre venda. */
  deducoes?: RevenueDeducao[];
  /** Modo fixo para a linha Receita Bruta (mesmo valor nos 12 meses). */
  brutaFixa?: boolean;
  /** Modo fixo para a linha Inadimplência % (mesmo % nos 12 meses). */
  inadimplenciaFixa?: boolean;
  /** Modo de edição da inadimplência: "pct" (padrão) ou "brl". Storage é sempre em %. */
  inadimplenciaModo?: "pct" | "brl";
  /** Receitas Financeiras (rendimentos de aplicações, aluguéis, venda de ativos, etc.). */
  receitasFinanceiras?: RevenueDeducao[];
}

export interface CostLine {
  id: string;
  label: string;
  category: CostCategory;
  subcategory?: CostSubcategory;
  values: Months;
  fixed: boolean;
  /**
   * Comportamento da linha para MC/PE — desacopla a NATUREZA contábil (category)
   * do COMPORTAMENTO em relação ao volume. Ex.: folha CLT no CPV de uma prestadora
   * de serviços é "custo_vendas" contabilmente, mas é FIXO no curto prazo. Quando
   * definido, sobrescreve a classificação automática derivada de `category`.
   * Default: derivado da categoria (custo_vendas/direto_venda/variavel = variável; outros = fixo).
   */
  comportamento?: "fixo" | "variavel";
  custom?: boolean;
  /** Linha de folha CLT. Aplica encargos automáticos (INSS Patr + FGTS + RAT/S + provisão 13º/férias). */
  encargosAuto?: boolean;
  /** % de encargos sobre o salário base (default 70% = INSS 20% + FGTS 8% + SAT/Sist.S ~5% + 13º + férias + 1/3). */
  encargosPct?: number;
  /** Linha de custo de aquisição que NÃO gera crédito de ICMS/PIS/COFINS (ex: ICMS-ST, simples nacional do fornecedor).
   *  Quando true, o valor da linha é excluído da base de cálculo de crédito de ICMS em Presumido/Real. */
  semCredito?: boolean;
  /** Capex de ativação no mês N (1..12) com vida útil em meses; gera depreciação adicional a partir do mês informado.
   *  Default: undefined (linha sem ativação especial). */
  ativacao?: { mes: number; valor: number; vidaUtilMeses: number };
  /** @deprecated legacy */ group?: "operacional" | "financeiro";
  /** @deprecated legacy */ variavel?: boolean;
}

export interface CapitalStructure {
  proprio: number; // % capital próprio (E) — usado apenas como referência se dividaOnerosa/PL não preenchidos
  ke: number;
  kd: number;
  capitalGiroDisponivel: number;
  depreciacaoMensal: number;
  // (removido: jurosRecebidosMensal — rendimentos vêm de revenue.receitasFinanceiras.rend_aplic)
  /** PL final do período (saldo atual). Usado como fallback do PL médio quando abertura não informada. */
  patrimonioLiquido: number;
  /**
   * PL de abertura do período (saldo inicial). Quando > 0, o ROE usa PL MÉDIO
   * = (abertura + final) / 2 (CFA/Damodaran), corrigindo o viés em empresas em
   * crescimento (subestima ROE) ou com prejuízo acumulado (superestima). Default 0
   * = fallback para PL fim de período.
   */
  patrimonioLiquidoAbertura?: number;
  ativoTotal: number;
  estoques: number;
  disponibilidades: number;
  // ----- Fonte da verdade para ROIC, WACC e índices de liquidez -----
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
  // ----- novos campos (Auditoria Jun/2026) — correções de ROIC e PME -----
  /** Caixa ocioso/excedente (não-operacional). Subtraído do Capital Investido no cálculo do ROIC. */
  caixaOcioso?: number;
  /** Passivos não-onerosos (fornecedores + salários + impostos a pagar) subtraídos do CI. Se omitido, usa fornecedores. */
  passivosNaoOnerosos?: number;
  /** Estoque inicial do período (R$). Usado para PME = (inicial+final)/2 quando ambos preenchidos. */
  estoqueInicial?: number;
  /** Estoque final do período (R$). Se omitido, usa `estoques`. */
  estoqueFinal?: number;
  /** Lista de Capex ativados ao longo do ano. Cada item gera depreciação adicional
   *  de `valor / vidaUtilMeses` a partir do mês `mes` (1..12) até o fim do ano. */
  capexAtivacao?: CapexAtivacao[];
  /** NCG de abertura (R$). Quando informada, ΔNCG = NCG_atual − NCG_abertura
   *  no cálculo do FCF (auditoria #3). Default usa `capitalGiroDisponivel`. */
  ncgAbertura?: number;
  /** Fração da dívida onerosa que vence em CP (0..1). Default 0.30.
   *  Usado apenas quando `passivoCirculante` não foi informado pelo consultor (auditoria #10). */
  dividaCurtoPrazoPct?: number;
  /** Contratos de dívida onerosa (empréstimos, financiamentos, debêntures).
   *  Quando preenchidos, agregam-se em `dividaOnerosa`, alimentam o serviço da dívida
   *  (juros mensais como custo financeiro + amortizações em cashflow.amortizacoes)
   *  e atualizam DSCR, ROIC, WACC e cobertura de juros automaticamente. */
  debtContracts?: DebtContract[];
}

export type DebtSystem = "price" | "sac";

export interface DebtContract {
  id: string;
  credor: string;
  descricao?: string;
  /** Saldo devedor atual (R$). */
  saldoDevedor: number;
  /** Taxa nominal anual (%). Converte para mensal por i/12. */
  taxaAA: number;
  sistema: DebtSystem;
  /** Prazo remanescente em meses. */
  prazoMeses: number;
}

export interface CapexAtivacao {
  id: string;
  label: string;
  /** Mês de ativação (1..12). */
  mes: number;
  /** Valor capitalizado (R$). */
  valor: number;
  /** Vida útil em meses (linear). */
  vidaUtilMeses: number;
}

/** Eras da Reforma Tributária (EC 132/2023 + LC 214/2025).
 *  Modelo simplificado em 3 marcos:
 *  - "atual"     → sistema pré-reforma (até 2025)
 *  - "transicao" → período 2027–2032 (CBS pleno, PIS/COFINS extintos, IBS faseado, ICMS/ISS em redução) — usa ponto médio
 *  - "pleno"     → regime cheio a partir de 2033 (CBS+IBS, sem PIS/COFINS, sem ICMS/ISS) */
export type TaxEra = "atual" | "transicao" | "pleno";

export const TAX_ERAS: TaxEra[] = ["atual", "transicao", "pleno"];

export const TAX_ERA_LABEL: Record<TaxEra, string> = {
  atual: "Sistema atual (até 2026)",
  transicao: "Transição (2027–2032) — CBS pleno, IBS faseado",
  pleno: "Regime pleno (2033+) — CBS + IBS",
};

export const TAX_ERA_SHORT: Record<TaxEra, string> = {
  atual: "Atual",
  transicao: "Transição",
  pleno: "Pleno 2033",
};

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
  // ----- Reforma Tributária (CBS/IBS) — EC 132/2023 + LC 214/2025 -----
  /** Era do sistema tributário aplicado ao cálculo. Default "atual". */
  era?: TaxEra;
  /** Alíquota plena de CBS (federal) em %. Default 8,8 (referência MF/Senado). */
  cbsAliquota?: number;
  /** Alíquota plena de referência do IBS (estadual+municipal) em %. Default 17,7. */
  ibsAliquotaRef?: number;
  /** [CBS/IBS] % do CPV oriundo de fornecedores Simples Nacional sem destaque
   *  (0..100). Nessas compras o comprador (Lucro Real/Presumido) só tem direito
   *  a crédito presumido — ~3% CBS e ~1,2% IBS, não a alíquota cheia.
   *  Default 0 (assume todos fornecedores no regime regular).
   *  Referência: LC 214/2025 + percentuais provisórios usados pelo mercado. */
  fornecedorSimplesNacionalPct?: number;
  /** Overrides de alíquotas/tabelas oficiais (painel "Parâmetros tributários").
   *  Cada campo ausente = usa o padrão oficial em src/lib/finance/taxDefaults.ts. */
  ratesOverride?: import("./taxDefaults").TaxRatesOverride;
}

export interface CashFlowConfig {
  caixaMinimo: number;
  /** Limiar crítico de alerta (R$). Quando o saldo final de algum mês fica ≤ limiarAlerta,
   *  badges/toasts/destaques de risco são exibidos. Default −10.000. */
  limiarAlerta?: number;
  aportes: Months;
  emprestimosCaptados: Months;
  capex: Months;
  dividendos: Months;
  amortizacoes: Months;
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
export type RazaoContratacao =
  | "preco"
  | "relacionamento"
  | "qualidade"
  | "unica_opcao"
  | "prazo"
  | "marca";
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

/** Versão atual do schema do AppState. Incrementar a cada breaking change
 *  no formato persistido — `migrateAppStateVersion` em defaults.ts deve
 *  ter um case correspondente para fazer a transição. */
export const APP_STATE_SCHEMA_VERSION = 1;

export interface AppState {
  /** Versão do schema persistido. Quando ausente, assume v0 (legado pré-versionamento). */
  schemaVersion?: number;
  businessType: BusinessType;
  companyName: string;
  /** Número de colaboradores (headcount). Base para indicadores de produtividade. */
  numColaboradores?: number;
  revenue: Revenue;
  costs: CostLine[];
  capital: CapitalStructure;
  tax: TaxConfig;
  cashflow: CashFlowConfig;

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
  industria: { short: "Custo Produto Vendido", long: "Custo do Produto Vendido" },
  comercio: { short: "Custo Mercadoria Vendida", long: "Custo da Mercadoria Vendida" },
  servicos: { short: "Custo Serviço Prestado", long: "Custo do Serviço Prestado" },
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

export const COST_VENDAS_TABLE_CONFIG: Record<
  BusinessType,
  { id: string; label: string; subcategory: string }[]
> = {
  industria: [
    { id: "mp", label: "Matéria-prima", subcategory: "materia_prima" },
    { id: "mod", label: "Mão de obra direta", subcategory: "materia_prima" },
    { id: "insumos_ind", label: "Insumos Industriais", subcategory: "cif" },
  ],
  comercio: [
    { id: "merc", label: "Mercadoria para revenda", subcategory: "mercadoria" },
    { id: "frete", label: "Frete sobre compras", subcategory: "frete_compra" },
    { id: "emb", label: "Embalagem", subcategory: "embalagem" },
  ],
  servicos: [
    { id: "mod_serv", label: "Mão de obra direta (técnica)", subcategory: "mao_obra_direta" },
    { id: "insumos_serv", label: "Insumos de serviço", subcategory: "insumos_servico" },
    { id: "subcon", label: "Subcontratação", subcategory: "terceirizacao" },
  ],
};

/** Fator de encargos default para CLT (INSS 20% + FGTS 8% + SAT/Sist.S ~5% + 13º + férias + 1/3). */
export const DEFAULT_ENCARGOS_PCT = 70;
