// =====================================================================
// INDICADORES — margens, PE, ROIC/WACC, liquidez, endividamento, FCF.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// Função única `calcIndicators`; sem extração de sub-blocos nesta fase.
// =====================================================================

import { AppState } from "./types";
import { sumContractSaldos, aggregateContracts } from "./debtContracts";
import { sum } from "./format";
import { safeDivide, safePct, safeNumber } from "./safeMath";
import { computeNetDebt, computeCapexMensal } from "./shared";
import { folhaAnual, resolveEffectiveRegime } from "./regime";
import { irShieldForRegime } from "./tax/real";
import type { DRE } from "./dre";
import { buildCashFlow } from "./cashflow";
import { mesesPreenchidos, anualizar } from "./periodUtils";
import { deriveAbertura } from "./aberturaDerivada";
import { calcPassivoCirculante, calcPassivoNaoCirculante } from "./balanco";
import { deriveBalancoFechamento, type BalancoFechamentoResult } from "./balancoFechamento";

export interface Indicators {
  /** Lucro Bruto ÷ Receita Líquida × 100 */
  margemBruta: number;
  /** EBITDA ÷ Receita Líquida × 100 */
  margemEbitda: number;
  /** EBIT ÷ Receita Líquida × 100 */
  margemEbit: number;
  /** Lucro Líquido ÷ Receita Líquida × 100 */
  margemLiquida: number;
  /** (Receita Líquida − Custos Variáveis) ÷ Receita Líquida × 100 */
  margemContribuicao: number;
  /**
   * PE TOTAL (cobertura financeira completa): (Custos Fixos + Depreciação + Juros) ÷ MC.
   * Inclui juros porque, para a PME, juros são custo fixo financeiro recorrente.
   */
  pontoEquilibrio: number;
  /**
   * PE OPERACIONAL CLÁSSICO (Garrison/Horngren): Custos Fixos Operacionais (com depreciação,
   * SEM juros) ÷ MC. Juros e impostos ficam abaixo do EBIT — não pertencem ao PE contábil.
   */
  pontoEquilibrioOperacional: number;
  /**
   * PE FINANCEIRO clássico (caixa): Custos Fixos Operacionais SEM depreciação e SEM juros ÷ MC.
   * Receita mínima para cobrir os desembolsos OPERACIONAIS.
   */
  pontoEquilibrioFinanceiro: number;
  /** Lucro Líquido ÷ PL MÉDIO (abertura + fim)/2 × 100. `null` quando PL médio ≤ 0. */
  roe: number | null;
  /** Lucro Líquido ÷ Ativo Total MÉDIO × 100 (médio quando `ativoTotalAbertura` informado; senão ponto final). */
  roa: number;

  /** NOPAT ÷ Capital Investido × 100 */
  roic: number;
  /** (Capital Próprio/V × Ke) + (Dívida/V × Kd × (1 − IR Shield)) */
  wacc: number;
  /** PMR + PME − PMP */
  cicloFinanceiro: number;
  /** PMR + PME (dias entre comprar insumo e receber do cliente). */
  cicloOperacional: number;
  /** Contas a Receber + Estoques − Fornecedores */
  ncg: number;

  /** NCG − Capital de Giro Disponível */
  gapCapitalGiro: number;
  /** Ativo Circulante ÷ Passivo Circulante */
  liquidezCorrente: number;
  /** (Ativo Circulante − Estoques) ÷ Passivo Circulante */
  liquidezSeca: number;
  /**
   * Disponibilidades (caixa + equivalentes) ÷ Passivo Circulante.
   * PODE SER NEGATIVA quando o caixa projetado fura (descoberto bancário).
   * NUNCA aplicar Math.abs — o sinal negativo é o alerta.
   */
  liquidezImediata: number;
  /** (Ativo Total − Permanente) ÷ Passivo Total. Aproximação: (AT − (AT−AC)) / (AT − PL) = AC / (AT − PL). */
  liquidezGeral: number;
  /**
   * true quando AC/PC vieram de ESTIMATIVA (fallback PMR/PMP + 30% de dívida)
   * porque nem o Balanço Detalhado nem os agregados `capital.ativoCirculante`/
   * `passivoCirculante` estavam preenchidos. UI/PDF devem exibir badge de aviso.
   */
  liquidezEstimada: boolean;
  /**
   * true quando o caixa no Balanço de Fechamento é negativo (descoberto).
   * UI/PDF devem pintar Liquidez Imediata em vermelho e rotular como
   * "descoberto" em vez de mostrar um número aparentemente OK.
   */
  caixaNegativo: boolean;
  /** Caixa efetivo usado no numerador da Liquidez Imediata (SSOT: balanço quando disponível). */
  caixaLiquidez: number;

  /** Passivo Total (operacional + oneroso) ÷ Ativo Total × 100. */
  endividamentoGeral: number;
  /**
   * true quando o Passivo Total vem do Balanço Detalhado (soma dos subcampos).
   * false quando a engine usou fallback por proxy (`Ativo Total − PL` ou (D+PNO)).
   */
  endividamentoGeralDadosCompletos: boolean;
  /**
   * Dívida ONEROSA (bancos, financiamentos, debêntures) ÷ Ativo Total × 100.
   * Exclui passivo operacional (fornecedores, impostos a pagar, folha) — é o número
   * que banco/investidor pergunta. Empresa sem dívida financeira = 0%.
   */
  endividamentoOneroso: number;
  /** Dívida Onerosa ÷ Patrimônio Líquido × 100 */
  grauEndividamento: number;
  /**
   * EBIT ÷ Juros de contratos de dívida (financiamentos, empréstimos, debêntures).
   * NÃO inclui tarifas bancárias, IOF, juros de cheque especial ou taxas de antecipação
   * — esses são custos financeiros OPERACIONAIS, não serviço de dívida.
   * `null` quando a empresa não tem dívida onerosa (nada a cobrir → N/A, não infinito).
   */
  coberturaJuros: number | null;
  /** Receita Líquida ÷ Ativo Total MÉDIO (consistente com ROA). */
  giroAtivo: number;

  /** (Dívida Total − Caixa) ÷ EBITDA */
  dividaLiqEbitda: number;
  /** (Dívida Total − Caixa) ÷ EBIT */
  dividaLiqEbit: number;
  /** (Dívida Total − Caixa) ÷ Patrimônio Líquido */
  dividaLiqPl: number;
  /**
   * Tempo (em anos) para o Lucro Líquido acumulado recuperar o Patrimônio Líquido.
   * NÃO é o payback clássico (CAPEX ÷ FCF) — é o período de amortização do PL pelo lucro
   * contábil. Mantido por compatibilidade. Para o payback clássico use `paybackCapex`.
   */
  amortizacaoPlPorLucro: number;
  /**
   * Payback clássico (anos): CAPEX inicial ÷ FCF anual. Mede tempo para o investimento
   * inicial ser recuperado pela geração de caixa. `Infinity` quando FCF ≤ 0 ou CAPEX inicial = 0.
   */
  paybackCapex: number;
  /** @deprecated Use `amortizacaoPlPorLucro` (mesma fórmula). Mantido para retrocompat. */
  payback: number;
  /** FCF Operacional antes do CAPEX: NOPAT + D&A − Δ NCG. */
  fcf: number;
  /** CAPEX anual total: plano mensal + ativações do ano. */
  capexAnual: number;
  /** FCF após CAPEX (≈ FCFF): CFO − CAPEX. Caixa livre real. */
  fcfAposCapex: number;
  /** FCF ÷ EBITDA × 100 */
  conversaoEbitdaCaixa: number;
  /** Margem de Contribuição (R$) ÷ EBIT — elasticidade do lucro à receita. */
  gao: number;
  /**
   * Grau de Alavancagem Financeira (GAF) = EBIT ÷ LAIR.
   * Mede o efeito da dívida sobre o lucro líquido: para cada 1% de variação
   * no EBIT, o LAIR (e o LL, mantida a alíquota) varia GAF%. GAF=1 → sem
   * alavancagem; >1 → dívida amplifica o resultado; <0 ou indefinido quando
   * juros ≥ EBIT (LAIR ≤ 0). Cap em ±99 para evitar explosões numéricas.
   */
  gaf: number;
  /** FCO ÷ Lucro Líquido — quanto do lucro contábil virou caixa operacional (CPC 03/IAS 7). */
  qualidadeLucro: number;
  /** Receita Líquida Anual ÷ nº de colaboradores. */
  receitaPorColaborador: number;
  /** Receita BRUTA Anual ÷ nº de colaboradores — métrica clássica de benchmarking ("Faturamento/Colab"). */
  faturamentoPorColaborador: number;
  /** EBITDA Anual ÷ nº de colaboradores. */
  ebitdaPorColaborador: number;
  /** Lucro Líquido Anual ÷ nº de colaboradores. */
  lucroPorColaborador: number;
  /**
   * Folha/Receita = Folha Total Anual ÷ Receita BRUTA Anual × 100.
   * Folha Total inclui: pró-labore + salários CLT (c/ encargos) + benefícios + PLR +
   * mão de obra terceirizada. NÃO inclui comissões (custo comercial). Ver `folhaAnual`
   * em `regime.ts` para a regra exata de classificação.
   */
  custoPessoalSobreReceita: number;
  /**
   * Margem de Segurança = (Receita Líquida − Ponto de Equilíbrio OPERACIONAL) ÷ Receita Líquida × 100.
   * Base: Receita Líquida ANUAL (receita bruta − deduções − tributos sobre venda) — mesma
   * base usada no cálculo da Margem de Contribuição e do PE (custosFixos ÷ MC%).
   * Usa o PE OPERACIONAL (sem juros) — folga genuína de OPERAÇÃO antes do prejuízo;
   * incluir juros mistura risco financeiro com risco operacional.
   */
  margemSeguranca: number;
  /**
   * EBITDA ÷ (Juros de contratos + Amortizações de principal).
   * Juros vem dos `debtContracts` (não de `custosFinanceirosTotal` da DRE, que inclui
   * tarifas, IOF, cheque especial e antecipações — custos operacionais, não serviço de dívida).
   * `null` quando não há serviço de dívida (sem contratos e sem amortizações) → N/A.
   */
  dscr: number | null;
  /**
   * true quando `state.cashflow.amortizacoes` traz algum valor > 0 no ano.
   * Se false E há contratos de dívida, o DSCR pode estar SUPERESTIMADO (só juros no denominador).
   */
  dscrAmortizacoesInformadas: boolean;
  dividaOnerosa: number;
  /** Dívida Líquida (D − caixa). Negativa = posição líquida de caixa (cash-rich). */
  dividaLiquida: number;
  passivoCirculante: number;
  ativoCirculante: number;
  /** (Impostos sobre Vendas + IRPJ/CSLL) ÷ Receita Bruta × 100 — carga tributária total sobre a receita. */
  impostosSobreReceita: number;
  /** (Impostos sobre Vendas + IRPJ/CSLL) ÷ Lucro Líquido × 100 — quanto de imposto para cada R$ de lucro. */
  impostosSobreLucro: number;
  // ─── Campos auxiliares EXPOSTOS (SSOT) ──────────────────────────────
  // Já computados internamente, expostos para evitar recálculo em UIs.
  /** EBITDA anualizado (usado em DSCR/DL-EBITDA/per-capita). */
  ebitdaAnual: number;
  /** EBIT anualizado (usado em ROIC/cobertura/per-capita). */
  ebitAnual: number;
  /** Receita bruta anualizada — fonte única para cards/listas históricas. */
  receitaBrutaAnual: number;
  /** Receita líquida anualizada — base comum de margens e giro. */
  receitaLiquidaAnual: number;
  /** Lucro líquido anualizado — fonte única para ROE/ROA e históricos. */
  lucroLiquidoAnual: number;
  /** NOPAT anualizado preservando prejuízo operacional; não é travado em zero. */
  nopat: number;
  /** Capital investido usado no ROIC. Zero = base insuficiente para cálculo confiável. */
  capitalInvestido: number;
  /**
   * EVA (Economic Value Added) — lucro econômico em R$.
   * EVA = (ROIC − WACC) × Capital Investido. ROIC e WACC em %.
   * Positivo: a operação remunera o capital acima do custo (cria valor).
   * Negativo: destrói valor mesmo havendo lucro contábil.
   */
  eva: number;
  /** Alíquota operacional usada no NOPAT, em %. */
  aliquotaNopat: number;
  /** Serviço da dívida mensal médio = (Juros Anuais + Amortizações Anuais) ÷ 12. */
  servicoDividaMensal: number;
  /** Participação do PL no financiamento total: PL ÷ (PL + D) × 100. */
  proprioPercent: number;
  /** D/PL BRUTO (Dívida Onerosa ÷ PL) — múltiplo, não a métrica líquida `dividaLiqPl`. */
  dividaPlBruto: number;
  /** FCO (Fluxo de Caixa Operacional) anualizado — mesmo total do FluxoCaixaTab. */
  fcoAnual: number;
}

// ─── Thresholds publicados (SSOT) ───────────────────────────────────
// Faixas usadas em banners/alertas/cards. Centralizadas aqui para que
// UI nunca diverja: alterar a régua em UM lugar atualiza tudo.
// Régua alinhada ao padrão bancário PME e ao systemPrompt da IA:
// <1.0× = risco real, 1.0–1.25× = default, 1.25–1.5× = alerta, ≥1.5× = safe.
export const DSCR_THRESHOLDS = {
  /** Abaixo deste valor o EBITDA NÃO cobre o serviço da dívida. */
  danger: 1.0,
  /** Piso bancário para renovar giro; abaixo disso vira alerta. */
  warn: 1.25,
  /** Covenant típico de bancos; ≥ este valor = zona confortável. */
  covenant: 1.5,
} as const;

/** Ke padrão por setor (Selic + prêmio de risco PME-BR). Sobrescrevível. */
export const KE_DEFAULT_BY_SECTOR: Record<string, number> = {
  servicos: 18,
  comercio: 17,
  industria: 16,
};

export function calcIndicators(
  state: AppState,
  dre: DRE,
  // Otimização: aceita o `cf` já computado por `buildFinancialModel` para evitar
  // recomputar `buildCashFlow(state)` (chamado em ~todo render). Quando omitido,
  // computa internamente para preservar a API antiga.
  cfPre?: ReturnType<typeof buildCashFlow>,
  /** Balanço de fechamento pré-computado (evita 2ª chamada em buildFinancialModel). */
  balancoPre?: BalancoFechamentoResult,
): Indicators {
  const { capital, revenue } = state;
  // ─── Janela efetiva preenchida (Fase 1) ──────────────────────────────
  // Indicadores que comparam fluxo (DRE) com estoque (BP) ou per-capita
  // devem usar valores ANUALIZADOS — se o consultor só preencheu 3 meses,
  // dividir por 12 subestima EBITDA/Colab, DL/EBITDA, ROIC etc.
  // Margens (ratios fluxo/fluxo do mesmo período) cancelam — não precisam,
  // mas anualizamos por consistência (resultado idêntico).
  const meses = mesesPreenchidos(
    dre.receitaBruta,
    dre.receitaLiquida,
    dre.custosVariaveis,
    dre.custosFixos,
    dre.depreciacao,
    dre.impostos,
    dre.impostosVendas,
  );
  const an = (v: number) => anualizar(v, meses);

  const receitaLiqAnual = an(sum(dre.receitaLiquida));
  const receitaBrutaAnual = an(sum(dre.receitaBruta));
  const lucroBrutoAnual = an(sum(dre.lucroBruto));
  const ebitdaAnual = an(sum(dre.ebitda));
  const ebitAnual = an(sum(dre.ebit));
  const lairAnual = an(sum(dre.lair));
  const llAnual = an(sum(dre.lucroLiquido));
  const custosVarAnual = an(sum(dre.custosVariaveis));
  const custosFixosAnual = an(sum(dre.custosFixos) + sum(dre.depreciacao));
  const jurosAnual = an(sum(dre.custosFinanceirosTotal));
  const impostosAnual = an(sum(dre.impostos));
  const impostosVendasAnual = an(sum(dre.impostosVendas));
  const cpvAnual = an(sum(dre.cpv));

  // SSOT: safeMath previne NaN/Infinity em qualquer divisão de indicador.
  const depreciacaoAnual = an(sum(dre.depreciacao));
  const custosFixosOperacionaisSemDep = custosFixosAnual - depreciacaoAnual;
  const custosFixosComJuros = custosFixosAnual + jurosAnual;
  const margemContribuicao = safePct(receitaLiqAnual - custosVarAnual, receitaLiqAnual);
  const mcFrac = margemContribuicao / 100;
  const pontoEquilibrioOperacional =
    margemContribuicao > 0 ? safeDivide(custosFixosAnual, mcFrac) : 0;
  const pontoEquilibrio = margemContribuicao > 0 ? safeDivide(custosFixosComJuros, mcFrac) : 0;
  const pontoEquilibrioFinanceiro =
    margemContribuicao > 0 ? safeDivide(custosFixosOperacionaisSemDep, mcFrac) : 0;

  // ─── SSOT: Balanço de Fechamento reconciliado ─────────────────────────
  // Derivado ANTES de PL/ROIC/ROA/Giro/WACC — assim TODOS os indicadores
  // que dependem de Patrimônio Líquido ou Ativo Total usam a MESMA base
  // que o PDF imprime, eliminando divergências entre "número do relatório"
  // e "número derivado do balanço".
  const cfLocal = cfPre ?? buildCashFlow(state);
  const balFech = balancoPre ?? deriveBalancoFechamento({ state, dre, cf: cfLocal });
  const ativoTotalBal = safeNumber(balFech.totals.ativo);
  const ativoTotalFim = ativoTotalBal > 0 ? ativoTotalBal : Math.max(0, capital.ativoTotal);

  // PL de fechamento — SSOT: soma das rubricas do PL no balanço reconciliado.
  // Fallback só quando o balanço vem vazio (retrocompat). Bug histórico corrigido:
  // `capital.patrimonioLiquido` podia ficar em 0 (apenas capital social) enquanto
  // o balanço acumulava lucros/reservas > 0 — gerando ROE inflado (PL médio pequeno)
  // e `Dívida Líq./PL` batendo no clamp ±99 (denominador ≈ 0).
  const balPL = balFech.balanco.patrimonioLiquido ?? {};
  const plBalSSOT =
    safeNumber(balPL.capitalSocial) +
    safeNumber(balPL.reservasCapital) +
    safeNumber(balPL.reservasLucros) +
    safeNumber(balPL.lucrosPrejuizosAcumulados) +
    safeNumber(balPL.resultadoExercicio) -
    safeNumber(balPL.acoesEmTesouraria);

  // ---- Estrutura de capital baseada em campos REAIS ----
  const PL = plBalSSOT > 0 ? plBalSSOT : Math.max(0, capital.patrimonioLiquido);
  const D = Math.max(0, sumContractSaldos(capital.debtContracts));
  const V = PL + D;
  // CONTRATO: `capital.proprio` é PERCENTUAL no intervalo [0, 100], NÃO fração.
  // Validado em Zod no schema do capital. Se mudar para fração, ajustar aqui também.
  const wE = V > 0 ? PL / V : capital.proprio / 100;
  const wD = V > 0 ? D / V : 1 - capital.proprio / 100;

  // SSOT: WACC usa shield do regime EFETIVO. Ke piso 8% (Selic neutra).
  // Otimização: regime resolvido uma única vez e reusado abaixo (NOPAT).
  const regimeEfetivo = resolveEffectiveRegime(state);
  const irShield = irShieldForRegime(regimeEfetivo, lairAnual);
  const keSeguro = capital.ke > 0 ? capital.ke : 8;
  const wacc = wE * keSeguro + wD * capital.kd * (1 - irShield);

  // ---- NOPAT e ROIC (auditoria CFO) ----
  // NOPAT deve partir do EBIT e preservar prejuízo operacional. O código anterior fazia
  // `Math.max(0, EBIT × (1 − t))`, escondendo ROIC negativo quando a operação dava prejuízo.
  // Também aplicava DAS do Simples novamente sobre o EBIT; no Simples o DAS já reduziu a
  // Receita Líquida/EBIT, então a alíquota adicional de NOPAT é 0 para evitar dupla contagem.
  const impostosLucroAnual = impostosAnual;
  let aliquotaNopatFrac = 0;
  if (ebitAnual > 1) {
    if (regimeEfetivo === "real") {
      aliquotaNopatFrac = irShieldForRegime(regimeEfetivo, lairAnual);
    } else if (regimeEfetivo === "presumido") {
      // Presumido calcula IRPJ/CSLL sobre receita presumida, mas para NOPAT a carga
      // não pode exceder 100% do EBIT operacional; acima disso NOPAT zera, não inverte.
      aliquotaNopatFrac = Math.max(0, Math.min(1, safeDivide(impostosLucroAnual, ebitAnual)));
    }
  }
  const nopat = ebitAnual > 1 ? ebitAnual * (1 - aliquotaNopatFrac) : ebitAnual;

  // Capital Investido — SSOT: Ativo Total vem do Balanço reconciliado.
  // Ativo Total − Passivos Não Onerosos − Caixa Ocioso. Caso contrário, usa financiamento:
  // PL + Dívida Onerosa − Caixa Ocioso. Nunca usa denominador artificial = 1, pois isso
  // produz ROIC absurdo quando o balanço está incompleto.
  const pno = Math.max(0, capital.passivosNaoOnerosos ?? capital.fornecedores ?? 0);
  const caixaOcioso = Math.max(0, capital.caixaOcioso ?? 0);
  const ciAtivo = ativoTotalFim > 0 ? Math.max(0, ativoTotalFim - pno - caixaOcioso) : 0;
  const ciFinanciamento = Math.max(0, PL + D - caixaOcioso);
  const capitalInvestido = ciAtivo > 0 ? ciAtivo : ciFinanciamento;
  const roic = capitalInvestido > 0 ? safePct(nopat, capitalInvestido) : 0;

  // [Auditoria Bloco 5 · Prompt ROE] PL de abertura via SSOT `deriveAbertura` — soma
  // capitalSocial + reservasCapital + reservasLucros + lucrosAcumulados. Nunca usa apenas
  // capitalSocial (bug histórico: ROE > 400% em empresa com estrutura sem dívida).
  // Padrão CFA/Damodaran: PL MÉDIO entre abertura e fechamento. Quando PL médio ≤ 0
  // (empresa com passivo a descoberto) retorna null — a UI deve mostrar "N/A — PL negativo".
  const plAberturaSSOT = deriveAbertura({
    state,
    impostosTotalMensais: dre.impostosTotal,
  }).totals.pl;
  const plAberturaCapital = Math.max(0, capital.patrimonioLiquidoAbertura ?? 0);
  const plAbertura = plAberturaSSOT > 0 ? plAberturaSSOT : plAberturaCapital;
  const plMedio = plAbertura > 0 ? (plAbertura + PL) / 2 : PL;
  const roe: number | null = plMedio > 0 ? safePct(llAnual, plMedio) : null;
  // ROA/Giro: Ativo MÉDIO = (abertura + fechamento do BALANÇO)/2. Fechamento
  // vem do balanço reconciliado (não de `capital.ativoTotal`), consistente com
  // o Ativo Total impresso no PDF.
  const atAbertura = Math.max(0, capital.ativoTotalAbertura ?? 0);
  const atMedio = atAbertura > 0 && ativoTotalFim > 0
    ? (atAbertura + ativoTotalFim) / 2
    : ativoTotalFim;
  const roa = atMedio > 0 ? safePct(llAnual, atMedio) : 0;


  // ---- Ciclo / NCG / Gap ----
  // PMR/PME/PMP continuam vindo da fórmula estática (métrica de DIAS,
  // complementar à NCG monetária). NÃO alimentam mais a NCG.
  const ei = Math.max(0, capital.estoqueInicial ?? 0);
  const ef = Math.max(0, capital.estoqueFinal ?? 0);
  const estoqueMedio = ei > 0 && ef > 0 ? (ei + ef) / 2 : ef > 0 ? ef : capital.estoques;
  const cpvDiario = safeDivide(cpvAnual, 360);
  const pme = estoqueMedio > 0 && cpvDiario > 0 ? safeDivide(estoqueMedio, cpvDiario) : 0;
  const cicloOperacional = revenue.pmr + pme;
  const cicloFinanceiro = cicloOperacional - revenue.pmp;

  // ─── NCG e CDG derivados do BALANÇO DE FECHAMENTO (SSOT único) ───
  // Substitui a fórmula estática (Receita×PMR/360 + Estoque − CPV×PMP/360)
  // pela leitura direta das rubricas do balanço reconciliado. Qualquer
  // divergência agora aparece na única fonte — não há mais dois números
  // brigando na mesma página. Modelo Fleuriet: passivo operacional inclui
  // fornecedores + salários/encargos + impostos a pagar.
  const bal = balFech.balanco;
  const bAc = bal.ativoCirculante ?? {};
  const bPc = bal.passivoCirculante ?? {};
  const bAnc = bal.ativoNaoCirculante ?? {};
  const bPnc = bal.passivoNaoCirculante ?? {};
  const crBal = safeNumber(bAc.contasReceberClientes) - safeNumber(bAc.pdd);
  const estBal = safeNumber(bAc.estoques);
  const fornBal = safeNumber(bPc.fornecedores);
  const salBal = safeNumber(bPc.salariosEncargos);
  const impBal = safeNumber(bPc.impostosPagar);
  const ncg = (crBal + estBal) - (fornBal + salBal + impBal);

  // CDG (Capital de Giro) via Fleuriet = (PL + PNC) − ANC.
  const plBal =
    safeNumber(bal.patrimonioLiquido?.capitalSocial) +
    safeNumber(bal.patrimonioLiquido?.reservasCapital) +
    safeNumber(bal.patrimonioLiquido?.reservasLucros) +
    safeNumber(bal.patrimonioLiquido?.lucrosPrejuizosAcumulados) +
    safeNumber(bal.patrimonioLiquido?.resultadoExercicio) -
    safeNumber(bal.patrimonioLiquido?.acoesEmTesouraria);
  const pncTotal =
    safeNumber(bPnc.emprestimosFinanciamentosLP) +
    safeNumber(bPnc.impostosParcelados) +
    safeNumber(bPnc.debentures) +
    safeNumber(bPnc.provisoesLP) +
    safeNumber((bPnc as { outrosPassivosNC?: number }).outrosPassivosNC);
  const ancTotal =
    safeNumber(bAnc.investimentos) +
    safeNumber(bAnc.imobilizado?.terrenos) +
    safeNumber(bAnc.imobilizado?.edificacoes) +
    safeNumber(bAnc.imobilizado?.maquinasEquipamentos) +
    safeNumber(bAnc.imobilizado?.veiculos) +
    safeNumber(bAnc.imobilizado?.moveisUtensilios) +
    safeNumber(bAnc.imobilizado?.outrosImobilizados) -
    safeNumber(bAnc.imobilizado?.depreciacaoAcumulada) +
    safeNumber(bAnc.intangivel?.software) +
    safeNumber(bAnc.intangivel?.marcasPatentes) +
    safeNumber(bAnc.intangivel?.goodwill) +
    safeNumber(bAnc.intangivel?.outrosIntangiveis) -
    safeNumber(bAnc.intangivel?.amortizacaoAcumulada) +
    safeNumber(bAnc.realizavelLP?.creditosLP) +
    safeNumber(bAnc.realizavelLP?.depositosJudiciais) +
    safeNumber(bAnc.realizavelLP?.impostosDiferidos) +
    safeNumber(bAnc.realizavelLP?.outros);
  const cdg = (plBal + pncTotal) - ancTotal;
  const gapCapitalGiro = ncg - cdg;

  // Estimativas legadas mantidas para consumidores de liquidez/PMR abaixo.
  const crEstimado =
    capital.contasReceber > 0 ? capital.contasReceber : (receitaBrutaAnual / 360) * revenue.pmr;
  const fornecEstimado =
    capital.fornecedores > 0 ? capital.fornecedores : (cpvAnual / 360) * revenue.pmp;

  // ---- Liquidez (SSOT via Balanço de Fechamento) ----
  // Deriva AC/PC dos mesmos subcampos que o PDF imprime no Apêndice B,
  // eliminando divergência histórica entre "indicador" e "balanço".
  // caixaBal PODE SER NEGATIVO (descoberto bancário projetado) — o sinal
  // é preservado para que Liquidez Imediata sinalize o risco real.
  const caixaBal = safeNumber(bAc.caixaEquivalentes) + safeNumber((bAc as { aplicacoesFinanceirasCP?: number }).aplicacoesFinanceirasCP);
  const impRecBal = safeNumber(bAc.impostosRecuperar);
  const acBal = caixaBal + crBal + estBal + impRecBal;
  const emprestCPBal = safeNumber((bPc as { emprestimosFinanciamentosCP?: number }).emprestimosFinanciamentosCP);
  const pcBal = fornBal + salBal + impBal + emprestCPBal;
  const temBalancoAC = Math.abs(acBal) > 0 || crBal !== 0 || estBal !== 0 || caixaBal !== 0;
  const temBalancoPC = pcBal > 0;

  // Fallback em cascata: 1º balanço, 2º agregados capital.*, 3º estimativa PMR/PMP.
  let ativoCirculante: number;
  let passivoCirculante: number;
  let caixaLiq: number;
  let estoqueLiq: number;
  let liquidezEstimada = false;
  if (temBalancoAC && temBalancoPC) {
    ativoCirculante = acBal;
    passivoCirculante = pcBal;
    caixaLiq = caixaBal;
    estoqueLiq = estBal;
  } else if (capital.ativoCirculante > 0 && capital.passivoCirculante > 0) {
    ativoCirculante = capital.ativoCirculante;
    passivoCirculante = capital.passivoCirculante;
    caixaLiq = capital.disponibilidades;
    estoqueLiq = capital.estoques;
  } else {
    // Estimativa legada — só como último recurso; UI deve avisar.
    liquidezEstimada = true;
    const dividaCpFrac = 0.3;
    ativoCirculante =
      capital.ativoCirculante > 0
        ? capital.ativoCirculante
        : capital.disponibilidades + crEstimado + capital.estoques;
    passivoCirculante =
      capital.passivoCirculante > 0
        ? capital.passivoCirculante
        : Math.max(0, fornecEstimado + D * dividaCpFrac);
    caixaLiq = capital.disponibilidades;
    estoqueLiq = capital.estoques;
  }
  const caixaNegativo = caixaLiq < 0;

  const CAP_LIQ = 99;
  // Cap SUPERIOR apenas — para caixa negativo o valor negativo é preservado
  // (deixar Math.min sem Math.max inferior). Ratio positivo é limitado.
  const capUp = (v: number) => (v > CAP_LIQ ? CAP_LIQ : v);
  const liquidezCorrente =
    passivoCirculante > 1 ? capUp(ativoCirculante / passivoCirculante) : CAP_LIQ;
  const liquidezSeca =
    passivoCirculante > 1
      ? capUp((ativoCirculante - estoqueLiq) / passivoCirculante)
      : CAP_LIQ;
  // Liquidez Imediata: sem clamp inferior — caixa negativo → ratio negativo.
  // Cap superior mantido só para evitar Infinity quando PC ≈ 0.
  const liquidezImediata =
    passivoCirculante > 1 ? capUp(caixaLiq / passivoCirculante) : caixaLiq < 0 ? -CAP_LIQ : CAP_LIQ;
  // [Auditoria Bloco 4] Liquidez Geral = (AC + Realizável LP) / (PC + PNC). Sem RLP/PNC isolados
  // no schema, aproximamos por AC / (AT − PL) — passivo total ≈ AT − PL pela equação patrimonial.
  const passivoTotalAprox = ativoTotalFim > PL ? ativoTotalFim - PL : 0;
  const liquidezGeral =
    passivoTotalAprox > 1 ? capUp(ativoCirculante / passivoTotalAprox) : CAP_LIQ;



  // ---- Endividamento ----
  // [Correção auditoria] Passivo Total vem do Balanço Detalhado (soma dos subcampos
  // de PC + PNC), NÃO do proxy `ativoTotal − PL`. O proxy inflava o passivo quando
  // o PL estava subestimado por qualquer razão (rota gerava "endividamento 95%"
  // para empresa SEM dívida onerosa). Fallback para o proxy só quando não há
  // Balanço detalhado E não há debtContracts (info mínima insuficiente).
  const passivoBalPC = calcPassivoCirculante(capital.balanco);
  const passivoBalPNC = calcPassivoNaoCirculante(capital.balanco);
  const passivoBalTotal = passivoBalPC + passivoBalPNC;
  const temBalancoPassivo = passivoBalTotal > 0;
  const passivoAgregadoLegado =
    Math.max(0, capital.passivoCirculante ?? 0) + D + Math.max(0, capital.passivosNaoOnerosos ?? 0);
  let endividamentoGeral = 0;
  let endividamentoGeralDadosCompletos = false;
  if (ativoTotalFim > 0 && temBalancoPassivo) {
    endividamentoGeral = (passivoBalTotal / ativoTotalFim) * 100;
    endividamentoGeralDadosCompletos = true;
  } else if (ativoTotalFim > 0 && passivoAgregadoLegado > 0) {
    endividamentoGeral = (passivoAgregadoLegado / ativoTotalFim) * 100;
    endividamentoGeralDadosCompletos = true;
  } else if (ativoTotalFim > 0) {
    // Último recurso: proxy contábil `AT − PL` — marca como incompleto.
    const passivoTotalEstim = Math.max(0, ativoTotalFim - PL);
    endividamentoGeral = (passivoTotalEstim / ativoTotalFim) * 100;
    endividamentoGeralDadosCompletos = false;
  } else {
    const passivoConhecido = D + pno;
    const ativoProxy = PL + D + pno;
    endividamentoGeral = ativoProxy > 0 ? (passivoConhecido / ativoProxy) * 100 : 0;
    endividamentoGeralDadosCompletos = false;
  }
  // Endividamento ONEROSO — só dívida financeira. É o que o banco pergunta.
  const endividamentoOneroso = ativoTotalFim > 0 ? (D / ativoTotalFim) * 100 : 0;
  const grauEndividamento = PL > 0 ? (D / PL) * 100 : 0;
  // [Auditoria Bloco 4] Cobertura de Juros = EBIT ÷ Juros de CONTRATOS DE DÍVIDA.
  // Denominador = juros oriundos de debtContracts (financiamentos/empréstimos/debêntures).
  // NÃO usa `custosFinanceirosTotal` da DRE (que inclui tarifas, IOF, cheque especial,
  // antecipações) — esses são custos financeiros OPERACIONAIS. Sem dívida → null (N/A).
  const contratosAgg = aggregateContracts(capital.debtContracts ?? []);
  const jurosDivida = contratosAgg.totalJurosAno; // já anual (12 meses de cronograma)
  const CAP_COB = 999;
  const CAP_DL_EBITDA = 99;
  const CAP_PAYBACK = 99;
  const coberturaJuros: number | null =
    jurosDivida > 1
      ? Math.max(-CAP_COB, Math.min(CAP_COB, safeDivide(ebitAnual, jurosDivida, CAP_COB)))
      : null;

  // [Auditoria Bloco 5] Giro do Ativo (DuPont) também usa ATIVO MÉDIO quando abertura disponível.
  const giroAtivo = atMedio > 0 ? safeDivide(receitaLiqAnual, atMedio) : 0;

  const dividaLiq = computeNetDebt(state); // SSOT-1: helper único.
  // Cash-rich (dividaLiq < 0) com base ≤ 1: usa sentinela negativa para PRESERVAR o sinal
  // (antes retornava 0 e escondia a posição líquida de caixa).
  const dividaLiqEbitda =
    ebitdaAnual > 1
      ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitdaAnual))
      : dividaLiq < 0
        ? -CAP_DL_EBITDA
        : dividaLiq === 0
          ? 0
          : CAP_DL_EBITDA;
  const dividaLiqEbit =
    ebitAnual > 1
      ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitAnual))
      : dividaLiq < 0
        ? -CAP_DL_EBITDA
        : dividaLiq === 0
          ? 0
          : CAP_DL_EBITDA;
  const dividaLiqPl =
    PL > 1
      ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / PL))
      : dividaLiq < 0
        ? -CAP_DL_EBITDA
        : dividaLiq === 0
          ? 0
          : CAP_DL_EBITDA;
  const amortizacaoPlPorLucro =
    llAnual > 1 ? Math.min(CAP_PAYBACK, PL / llAnual) : PL <= 0 ? 0 : CAP_PAYBACK;
  const payback = amortizacaoPlPorLucro; // @deprecated alias

  // [Auditoria Bloco 6] ΔNCG = NCG_atual − NCG_abertura.
  // Quando `ncgAbertura` NÃO informada, assume ΔNCG=0 (operação em regime estacionário) —
  // assunção conservadora e consistente. ANTES usava `disponibilidades` como fallback, o que
  // é conceitualmente errado: NCG ≠ Caixa (são linhas DISJUNTAS do balanço — NCG é ACO−PCO,
  // caixa é ACF). Esse fallback invertia o sinal de ΔNCG na maioria dos casos e produzia
  // FCF irreal (NOPAT + D&A − NCG_atual + Caixa).
  const ncgAbertura = capital.ncgAbertura != null && capital.ncgAbertura > 0
    ? capital.ncgAbertura
    : ncg; // sem dado de abertura → assume ΔNCG=0
  const deltaNcgAnual = ncg - ncgAbertura;

  // FCFF (Free Cash Flow to the Firm) padrão Damodaran/Koller:
  //   FCFF = NOPAT + D&A − ΔNCG − CAPEX
  // `nopat` já calculado acima com a alíquota efetiva observada do regime.
  const depAnual = depreciacaoAnual;
  const fcf = nopat + depAnual - deltaNcgAnual;
  // SSOT: mesmo CAPEX usado no FCI do buildCashFlow (manual + ativações de imobilizado).
  // Anualizado: se só 3 meses preenchidos, o CAPEX projetado para o ano também escala.
  const capexAnual = an(sum(computeCapexMensal(state)));
  const fcfAposCapex = fcf - capexAnual;
  // Auditoria #2: payback do CAPEX usa o CAPEX ANUAL TOTAL, não apenas o do mês 1.
  // CAPEX distribuído ao longo do ano (obras, implantações) era subestimado em até 10×.
  const paybackCapex =
    capexAnual > 0 && fcf > 1
      ? Math.min(CAP_PAYBACK, capexAnual / fcf)
      : capexAnual <= 0
        ? 0
        : CAP_PAYBACK;

  const mcReais = receitaLiqAnual - custosVarAnual;
  const gao = Math.abs(ebitAnual) > 1 ? Math.max(-99, Math.min(99, mcReais / ebitAnual)) : 0;
  // GAF = EBIT / LAIR. Sem juros (lairAnual ≈ ebitAnual) → GAF = 1 (sem alavancagem).
  // Quando juros ≥ EBIT (LAIR ≤ 0), o múltiplo perde sentido econômico → 0 (UI mostra "—").
  const gaf =
    Math.abs(ebitAnual) > 1 && lairAnual > 1
      ? Math.max(-99, Math.min(99, ebitAnual / lairAnual))
      : 0;
  // Qualidade do Lucro = FCO / Lucro Líquido (CPC 03/IAS 7).
  // Usa o MESMO FCO do FluxoCaixaTab (buildCashFlow.fluxoOperacional),
  // não o FCFF estimado — caixa operacional realizado vs. lucro contábil.
  // Edge cases: LL ≈ 0 → 0 (UI deve renderizar "N/A").
  // SSOT: mesma chamada do FluxoCaixaTab — `buildCashFlow(state)` resolve o regime efetivo
  // internamente. `totais.fluxoOperacional` é exatamente `sum(fluxoOperacional)`.
  // Otimização: reusa `cfPre` se passado por `buildFinancialModel` (evita 2ª chamada).
  const cfForFco = cfPre ?? buildCashFlow(state);
  const fcoAnual = an(cfForFco.totais.fluxoOperacional);
  const qualidadeLucro =
    Math.abs(llAnual) > 1 ? Math.max(-9, Math.min(9, fcoAnual / llAnual)) : 0;

  const headcount = Math.max(0, state.numColaboradores ?? 0);
  const receitaPorColaborador = headcount > 0 ? receitaLiqAnual / headcount : 0;
  const faturamentoPorColaborador = headcount > 0 ? receitaBrutaAnual / headcount : 0;
  const ebitdaPorColaborador = headcount > 0 ? ebitdaAnual / headcount : 0;
  const lucroPorColaborador = headcount > 0 ? llAnual / headcount : 0;
  // Folha/Receita: divide pela Receita BRUTA (padrão de benchmarking PME) — não a líquida.
  // folhaAnual já é total acumulado da janela preenchida → anualizar.
  const folha = an(folhaAnual(state));
  const custoPessoalSobreReceita = receitaBrutaAnual > 0 ? (folha / receitaBrutaAnual) * 100 : 0;

  // Margem de Segurança OPERACIONAL: usa o PE operacional (sem juros) sobre a Receita Líquida.
  // Mesma base do PE (custosFixos ÷ MC%, onde MC% = (RL − custosVar) ÷ RL).
  const margemSeguranca =
    receitaLiqAnual > 0 && pontoEquilibrioOperacional > 0
      ? Math.max(
          -999,
          Math.min(999, ((receitaLiqAnual - pontoEquilibrioOperacional) / receitaLiqAnual) * 100),
        )
      : 0;

  const amortizPrincipalAnual = an(sum(state.cashflow.amortizacoes ?? []));
  const dscrAmortizacoesInformadas = amortizPrincipalAnual > 0;
  // Serviço da dívida = juros de contratos + amortizações de principal.
  // Custos financeiros operacionais (tarifas, IOF, cheque especial) NÃO entram aqui.
  const servicoDivida = jurosDivida + amortizPrincipalAnual;
  const CAP_DSCR = 99;
  const dscr: number | null =
    servicoDivida > 1
      ? Math.max(-CAP_DSCR, Math.min(CAP_DSCR, ebitdaAnual / servicoDivida))
      : null;

  return {
    margemBruta: safePct(lucroBrutoAnual, receitaLiqAnual),
    margemEbitda: safePct(ebitdaAnual, receitaLiqAnual),
    margemEbit: safePct(ebitAnual, receitaLiqAnual),
    margemLiquida: safePct(llAnual, receitaLiqAnual),
    margemContribuicao,
    pontoEquilibrio,
    pontoEquilibrioOperacional,
    pontoEquilibrioFinanceiro,
    roe,
    roa,
    roic,
    wacc: safeNumber(wacc),
    cicloFinanceiro,
    cicloOperacional,
    ncg,

    gapCapitalGiro,
    liquidezCorrente,
    liquidezSeca,
    liquidezImediata,
    liquidezGeral,
    liquidezEstimada,
    caixaNegativo,
    caixaLiquidez: caixaLiq,

    endividamentoGeral,
    endividamentoGeralDadosCompletos,
    endividamentoOneroso,
    grauEndividamento,
    coberturaJuros,
    giroAtivo,
    dividaLiqEbitda,
    dividaLiqEbit,
    dividaLiqPl,
    payback,
    amortizacaoPlPorLucro,
    paybackCapex,
    fcf: safeNumber(fcf),
    capexAnual: safeNumber(capexAnual),
    fcfAposCapex: safeNumber(fcfAposCapex),
    conversaoEbitdaCaixa: ebitdaAnual > 0 ? safePct(fcf, ebitdaAnual) : 0,
    gao,
    gaf,
    qualidadeLucro,
    receitaPorColaborador,
    faturamentoPorColaborador,
    ebitdaPorColaborador,
    lucroPorColaborador,
    custoPessoalSobreReceita,
    margemSeguranca,
    dscr,
    dscrAmortizacoesInformadas,
    dividaOnerosa: D,
    dividaLiquida: dividaLiq,
    passivoCirculante,
    ativoCirculante,
    impostosSobreReceita:
      receitaBrutaAnual > 0
        ? ((impostosVendasAnual + impostosAnual) / receitaBrutaAnual) * 100
        : 0,
    impostosSobreLucro:
      llAnual > 1 ? ((impostosVendasAnual + impostosAnual) / llAnual) * 100 : 0,
    ebitdaAnual,
    ebitAnual,
    receitaBrutaAnual,
    receitaLiquidaAnual: receitaLiqAnual,
    lucroLiquidoAnual: llAnual,
    nopat: safeNumber(nopat),
    capitalInvestido: safeNumber(capitalInvestido),
    aliquotaNopat: aliquotaNopatFrac * 100,
    servicoDividaMensal: (jurosDivida + amortizPrincipalAnual) / 12,
    proprioPercent: V > 0 ? (PL / V) * 100 : Math.max(0, Math.min(100, capital.proprio)),
    eva: safeNumber(((roic - safeNumber(wacc)) / 100) * capitalInvestido),
    dividaPlBruto: PL > 0 ? D / PL : 0,
    fcoAnual: safeNumber(fcoAnual),
  };
}
