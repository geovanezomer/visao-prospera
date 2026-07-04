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
  | "prolabore" // 4b. Pró-labore × Distribuição de Lucros
  | "caixa" // 5. Fluxo de Caixa (DFC) + burn/runway
  | "governanca" // 6. Análise estratégica (concentração, governança, competitiva, regulatória)
  | "dre" // 7. DRE consolidada
  | "balanco" // 8. Balanço Patrimonial detalhado (3 modos de profundidade)
  | "indicadores" // 9. Indicadores financeiros e gráficos
  | "resultados" // 10. Diagnóstico + cenários
  | "dashboard" // 11. Dashboard executivo (visão consolidada)
  | "simulador" // 12. Simulador de alavancas
  | "valuation"; // 13. Valuation (múltiplos + DCF)

/** Lista canônica das abas, em ordem. Use em vez de hardcodar strings. */
export const TAB_KEYS: readonly TabKey[] = [
  "receitas",
  "custos",
  "capital",
  "tributos",
  "prolabore",
  "caixa",
  "governanca",
  "dre",
  "balanco",
  "indicadores",
  "resultados",
  "dashboard",
  "simulador",
  "valuation",
] as const;


export type BusinessType = "servicos" | "comercio" | "industria";
export type TaxRegime = "simples" | "presumido" | "real";
export type SimplesAnexo = "I" | "II" | "III" | "IV" | "V";

/**
 * Categorias de custo — desdobradas em FUNÇÃO contábil (CPC 26 / Lei 6.404):
 *  - custo_vendas / direto_venda → CPV/CMV/CSP
 *  - despesa_administrativa      → Despesas Administrativas (estrutura mínima)
 *  - despesa_comercial           → Despesas Comerciais / Vendas (marketing, comissões, frete s/ vendas)
 *  - financeiro                  → Despesas Financeiras (Resultado Financeiro)
 *
 * Os valores `fixo` e `variavel` permanecem como ALIASES LEGADOS de
 * `despesa_administrativa` e `despesa_comercial`, respectivamente — preservam
 * estados antigos persistidos. A migração `migrateCostLine` normaliza ao carregar.
 *
 * COMPORTAMENTO (fixo × variável para MC/PE/Monte Carlo) é tratado em
 * `CostLine.comportamento` — desacoplado da função contábil acima.
 */
export type CostCategory =
  | "custo_vendas"
  | "direto_venda"
  | "despesa_administrativa"
  | "despesa_comercial"
  | "financeiro"
  /** @deprecated alias de `despesa_administrativa` — mantido p/ compat de snapshots antigos. */
  | "fixo"
  /** @deprecated alias de `despesa_comercial` — mantido p/ compat de snapshots antigos. */
  | "variavel";
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
  /**
   * Classificação contábil (somente para `revenue.receitasFinanceiras`):
   * - "financeira": entra no Resultado Financeiro (pós-EBIT).
   * - "operacional": entra como Outras Receitas Operacionais (compõe o EBITDA).
   * Quando ausente, o sistema usa o id como fallback (alugueis/venda_ativos = operacional;
   * demais = financeira) — mantém compatibilidade com snapshots antigos.
   */
  tipo?: "financeira" | "operacional";
  /** Linha criada pelo usuário (permite editar rótulo e remover). */
  custom?: boolean;
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
  /** Linha sintética gerada por outro módulo (ex.: pró-labore de sócios).
   *  UI deve exibi-la como somente leitura e direcionar edição à fonte. */
  system?: boolean;
}

/** Sócio retirante — Pró-labore × Distribuição de Lucros (Plano v3). */
export interface SocioRetirada {
  id: string;
  nome: string;
  /** % de participação no capital (0..100). Soma de todos os sócios = 100. */
  participacaoPct: number;
  /** Sócio operacional (presta serviço à PJ) — exige piso de salário mínimo. */
  operacional: boolean;
  /** Pró-labore mensal escolhido pelo usuário (R$). */
  prolaboreMensal: number;
  /** Dependentes para IRPF. */
  dependentes: number;
  /** Outras deduções mensais do IRPF (PGBL, pensão etc.) em R$. */
  outrasDeducoes: number;
  /** "manual" = respeita prolaboreMensal; "otimizar" = engine calcula split ótimo. */
  modo: "manual" | "otimizar";
}

/** Contrato de mútuo PJ→PF (empréstimo da empresa para um sócio).
 *  Registra principal, taxa, prazo e cronograma. O engine deriva
 *  concessão/devolução/juros/saldo. ZERO hardcode tributário aqui. */
export interface MutuoSocio {
  id: string;
  socioId?: string; // referencia opcional a SocioRetirada.id
  nome: string; // nome do sócio para exibição (denormalizado)
  valorConcedido: number; // R$ principal
  mesConcessao: number; // 1..12 (mês da saída de caixa)
  taxaMensalPct: number; // % a.m. (juros cobrados; ≥ SELIC mensal recomendado)
  prazoMeses: number; // nº de parcelas de devolução
  mesInicioDevolucao: number; // 1..12 (mês da 1ª parcela)
}

// [SSOT] Mútuos PF→PJ (sócio empresta para a empresa) são cadastrados como
// DebtContract com `tipoCredor="socio"` na aba Capital. Não há tipo separado
// para evitar duplicidade contábil (DRE/DFC/BP).


export interface CapitalStructure {
  proprio: number; // % capital próprio (E) — referência editável quando PL não preenchido
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
  /** Ativo Total de abertura (saldo inicial). Quando > 0, ROA e Giro do Ativo usam ATIVO MÉDIO
   *  = (abertura + final) / 2 (consistente com PL médio do ROE). Default 0 = fallback ponto final. */
  ativoTotalAbertura?: number;
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

  /**
   * Balanço detalhado (Fase 1 — schema hierárquico CPC/BR).
   *
   * Opcional e não-quebrante: quando preenchido, a UI passa a renderizar as
   * rubricas detalhadas e RECALCULA os agregados de topo (`ativoTotal`,
   * `dividaOnerosa`, `passivoCirculante`, `fornecedores`, `contasReceber`,
   * `estoques`, `disponibilidades`, `patrimonioLiquido`). Quando ausente, o
   * engine continua usando os campos agregados legados — toda a indicadoria
   * (ROE/ROA/ROIC/liquidez/NCG) segue funcionando sem alteração.
   *
   * Sub-totais e totais são SEMPRE derivados (nunca digitados). A migração
   * v1→v2 pré-popula este objeto a partir dos campos legados.
   */
  balanco?: BalancoDetalhado;

  /**
   * Saldos de ABERTURA do exercício (Fase 1 — Balanço por construção).
   *
   * Conjunto mínimo de saldos iniciais necessário para que o Balanço de
   * fechamento feche por construção (Ativo = Passivo + PL) sem precisar
   * de ajustes manuais. Combinado com DRE + DFC + PMR/PMP/PME, deriva
   * todos os saldos finais via:
   *   saldoFim = saldoIni + movimentoPeríodo
   *
   * Itens patrimoniais constantes (Capital Social, Reservas, Imobilizado
   * bruto, Terrenos, etc.) NÃO entram aqui — vivem em `balanco` porque
   * não mudam dentro do exercício (são abertura E fechamento).
   *
   * `lucrosAcumulados` é o ÚNICO "plug" aceitável: representa o histórico
   * de exercícios anteriores que o consultor pode não ter como reconstruir.
   */
  abertura?: BalancoAbertura;
}

/** Saldos de abertura do exercício — fluxo-sensíveis (mudam mês a mês). */
export interface BalancoAbertura {
  /** Caixa + bancos + aplicações de liquidez imediata na abertura. */
  caixa?: number;
  /** Contas a receber de clientes na abertura. */
  contasReceber?: number;
  /** Estoques na abertura. */
  estoques?: number;
  /** Impostos a recuperar na abertura (PIS/COFINS/ICMS a compensar). */
  impostosRecuperar?: number;
  /** Depreciação acumulada na abertura (POSITIVO; subtrai do imobilizado). */
  depreciacaoAcumulada?: number;
  /** Amortização acumulada de intangíveis na abertura (POSITIVO). */
  amortizacaoAcumulada?: number;
  /** Fornecedores a pagar na abertura. */
  fornecedores?: number;
  /** Empréstimos CP saldo na abertura (auto-derivado de debtContracts se 0). */
  emprestimosCP?: number;
  /** Empréstimos LP saldo na abertura (auto-derivado de debtContracts se 0). */
  emprestimosLP?: number;
  /** Impostos a pagar na abertura (ISS/ICMS/PIS/COFINS/IRPJ/CSLL devidos). */
  impostosPagar?: number;
  /** Salários e encargos a pagar na abertura (~1 mês de folha). */
  salariosEncargos?: number;
  /** Lucros/prejuízos acumulados na abertura — PLUG do histórico. */
  lucrosAcumulados?: number;
}


/** Rubricas detalhadas do Balanço Patrimonial (modelo brasileiro CPC). */
export interface BalancoDetalhado {
  /** Data-base do balanço (ISO YYYY-MM-DD). */
  dataBase?: string;

  ativoCirculante?: {
    caixaEquivalentes?: number;
    aplicacoesFinanceirasCP?: number;
    contasReceberClientes?: number;
    /** Provisão p/ devedores duvidosos — valor POSITIVO; engine subtrai. */
    pdd?: number;
    estoques?: number;
    impostosRecuperar?: number;
    adiantamentos?: number;
    despesasAntecipadas?: number;
    outrosAtivosCirculantes?: number;
  };

  ativoNaoCirculante?: {
    realizavelLP?: {
      creditosLP?: number;
      depositosJudiciais?: number;
      impostosDiferidos?: number;
      outros?: number;
    };
    investimentos?: number;
    imobilizado?: {
      terrenos?: number;
      edificacoes?: number;
      maquinasEquipamentos?: number;
      veiculos?: number;
      moveisUtensilios?: number;
      outrosImobilizados?: number;
      /** Depreciação acumulada — valor POSITIVO; engine subtrai. */
      depreciacaoAcumulada?: number;
    };
    intangivel?: {
      software?: number;
      marcasPatentes?: number;
      goodwill?: number;
      outrosIntangiveis?: number;
      /** Amortização acumulada — valor POSITIVO; engine subtrai. */
      amortizacaoAcumulada?: number;
    };
  };

  passivoCirculante?: {
    fornecedores?: number;
    emprestimosFinanciamentosCP?: number;
    impostosPagar?: number;
    salariosEncargos?: number;
    adiantamentosClientes?: number;
    dividendosPagar?: number;
    provisoesCP?: number;
    outrosPassivosCirculantes?: number;
  };

  passivoNaoCirculante?: {
    emprestimosFinanciamentosLP?: number;
    impostosParcelados?: number;
    debentures?: number;
    provisoesLP?: number;
    impostosDiferidos?: number;
    outrasObrigacoesLP?: number;
  };

  patrimonioLiquido?: {
    capitalSocial?: number;
    reservasCapital?: number;
    reservasLucros?: number;
    lucrosPrejuizosAcumulados?: number;
    /** Resultado do exercício — idealmente vem do DRE (auto-preenchido). */
    resultadoExercicio?: number;
    ajustesAvaliacaoPatrimonial?: number;
    /** Ações em tesouraria — valor POSITIVO; engine subtrai. */
    acoesEmTesouraria?: number;
  };

  /** Período anterior (N-1) p/ análise horizontal AH%. Mesma forma. */
  anterior?: Omit<BalancoDetalhado, "anterior">;
}

export type DebtSystem = "price" | "sac";

export type FrequenciaAmortizacao = "mensal" | "trimestral" | "semestral" | "anual" | "bullet";
export type TipoCredor = "banco" | "fomento" | "fornecedor" | "socio" | "outro";

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
  /** Tipo de credor — usado em análise de risco (ex.: dívida com sócio é subordinada). */
  tipoCredor?: TipoCredor;
  /** Frequência de amortização do principal (default: mensal). */
  frequenciaAmortizacao?: FrequenciaAmortizacao;
  /** Covenants do contrato (ex.: "DSCR ≥ 1.25x", "Dívida Líq./EBITDA ≤ 3x"). Texto livre. */
  covenants?: string;
  /** Garantia oferecida (ex.: "Imóvel matrícula 1234", "Aval do sócio"). */
  garantia?: string;
  /** Observações livres do consultor. */
  observacoes?: string;
  /** Mês (1..12) em que ocorre a captação (novo desembolso). Se omitido, considera-se contrato pré-existente (sem captação no ano). */
  mesCaptacao?: number;
  /** Valor captado no `mesCaptacao` (R$). Entra como (+) Captação de empréstimos no DFC. */
  valorCaptado?: number;
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
  /** Prejuízo fiscal acumulado de exercícios anteriores (R$, valor absoluto ≥ 0),
   *  compensável no Lucro Real com trava de 30% do lucro trimestral
   *  (Lei 9.065/95 art. 42). Base negativa de CSLL é tratada com o mesmo
   *  saldo (simplificação — na prática são registros separados na ECF). */
  prejuizoFiscalAcumuladoAbertura?: number;
  // ----- Reforma Tributária (CBS/IBS) — EC 132/2023 + LC 214/2025 -----
  /** Era do sistema tributário aplicado ao cálculo. Default "atual". */
  era?: TaxEra;
  /** Split Payment (LC 214/2025): retém CBS/IBS na liquidação financeira,
   *  eliminando o float tributário. Default `true` — Lovable assume vigência
   *  a partir de 2027. Desligar simula o "mundo antigo" com lag de 25–30 dias. */
  splitPaymentAtivo?: boolean;
  /** Ano em que o Split passa a valer. Apenas informativo (default 2027). */
  splitPaymentAnoInicio?: number;
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
  /** Alíquota média de IRRF retido na fonte sobre rendimentos de aplicações
   * financeiras (%). Compensável com IRPJ no Presumido. Default 15
   * (aplicações > 720 dias). */
  irrfAplicacoesPct?: number;
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
  /** Empréstimos concedidos a sócios (mútuo PJ→PF) — saída de caixa.
   *  Derivado de state.mutuosSocios via aggregateMutuos (SSOT). */
  /** Empréstimos concedidos a sócios (mútuo PJ→PF) — saída de caixa.
   *  Derivado de state.mutuosSocios via aggregateMutuos (SSOT). */
  mutuosConcedidos: Months;
  /** Devolução de empréstimos por sócios (amortização do principal) — entrada de caixa. */
  mutuosDevolvidos: Months;
  // [SSOT] Mútuos PF→PJ foram consolidados em capital.debtContracts →
  // emprestimosCaptados/amortizacoes. Sem arrays dedicados aqui.

  /** Permutas simples — operações sem juros, contrato ou amortização
   *  (serviço por serviço, cheques, recebíveis, materiais). Afetam apenas
   *  o caixa, NÃO impactam DRE nem geram passivos/ativos próprios. */
  permutas?: PermutaLinha[];
}

/** Linha de permuta simples — crédito = entrada de caixa, débito = saída. */
export interface PermutaLinha {
  id: string;
  label: string;
  tipo: "credito" | "debito";
  values: Months;
  /** true para as 2 linhas default (não removíveis). */
  isDefault?: boolean;
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
  /** Número de colaboradores (headcount). Base para indicadores de produtividade.
   *  Mantido por compatibilidade — preferir `headcountRange` no novo cadastro. */
  numColaboradores?: number;
  /** Número de sócios/acionistas. Usado em diagnóstico de governança
   *  (concentração societária, risco-chave, plano de sucessão). */
  numSocios?: number;

  // ─── Cadastro estendido (Fase 2) ───────────────────────────────────────
  /** CNPJ (apenas dígitos ou formatado). Opcional. */
  cnpj?: string;
  /** Ramo de atuação dentro do `businessType` (ex: "saude", "construcao"). */
  /** Ramo de atuação — deve ser um `id` de SECTORS (ex: "serv-ti-saas"). */
  ramoAtuacao?: string;
  /** Benchmark personalizado (apenas P50). Quando definido, sobrescreve o setor.
   *  P25/P75 são derivados como ±20% sobre o P50. */
  benchmarkCustom?: {
    margemBruta?: number;
    margemEbitda?: number;
    margemLiquida?: number;
    giroAtivo?: number;
    endividamento?: number;
    pmr?: number;
    pmp?: number;
    evEbitda?: number;
  };
  /** Faixa de headcount — substitui o número exato para benchmarks. */
  headcountRange?: "1-9" | "10-49" | "50-99" | "100+";
  /** Período de análise em meses (6 / 12 / 24 / 36). Default 12. */
  periodoAnaliseMeses?: 6 | 12 | 24 | 36;
  /** Mês de início do exercício fiscal (1-12). Default 1 (Janeiro). */
  fiscalYearStartMonth?: number;
  /** Ano fiscal a que o AppState se refere (ex: 2025). Permite trocar de ano
   *  preservando os dados de cada um — ao carregar outro snapshot, o ano
   *  corrente é auto-arquivado sob este número. Default: ano corrente. */
  fiscalYear?: number;
  /** Margem-alvo interna do consultor (%). Benchmark adicional ao setorial. */
  margemAlvoPct?: number;
  /** Política de payout: % do lucro líquido distribuído aos sócios. Default 100. */
  payoutPolicyPct?: number;
  /** Reserva mínima mensal (R$) retida antes de calcular distribuição. Default 0. */
  reservaMinimaMensal?: number;
  /** Moeda base (default "BRL"). Preparação para i18n futura. */
  moedaBase?: string;

  revenue: Revenue;
  costs: CostLine[];
  capital: CapitalStructure;
  tax: TaxConfig;
  cashflow: CashFlowConfig;

  /** Respostas qualitativas do módulo de Análise Estratégica (opcional). */
  strategic?: StrategicAnswers;


  /** Sócios retirantes — Pró-labore × Distribuição de Lucros. Sincronizado
   *  bidirecionalmente com linhas system em `costs` via syncSociosToCosts. */
  socios?: SocioRetirada[];

  /** Empréstimos PJ→PF concedidos aos sócios (mútuo ativo). Sincronizado
   *  com cashflow.mutuosConcedidos/Devolvidos via aggregateMutuos (SSOT). */
  mutuosSocios?: MutuoSocio[];

  // [SSOT] Mútuos PF→PJ (sócio→empresa) foram consolidados em
  // `capital.debtContracts` (tipoCredor="socio"). Removido campo dedicado
  // para eliminar duplicidade contábil.


  /** Distribuição de lucros REALIZADA (12 meses). Diferente da "Previsão"
   *  (capacidade teórica calculada a partir do lucro), esta é a decisão dos
   *  sócios sobre quanto efetivamente retirar. Alimenta DRE/Balanço/DFC.
   *  `fixed=true` ⇒ um único valor replicado nos 12 meses. */
  distribuicaoRealizada?: { values: Months; fixed: boolean };
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
