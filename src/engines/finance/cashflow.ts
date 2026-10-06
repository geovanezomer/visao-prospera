import { AppState, TaxRegime } from "./types";
import { buildDRE, type DRE } from "./dre";
import { resolveEffectiveRegime } from "./regime";
import { splitReceitasFinanceiras, computeCapexMensal, outrasDeducoesMensal } from "./shared";
import type { MonthlyTax } from "./tax/shared";
import { partitionMonthlyTaxByLag, LAG_DIAS_PADRAO, LAG_DIAS_SPLIT } from "./tax/impostosLag";
import { anchorCashFlow } from "./anchor";
import { MESES, sum, zeros12 } from "./format";
import { mediaMensal, mesesPreenchidos } from "./periodUtils";
import { getSplitPaymentAtivo } from "./taxDefaults";
import { getDistribuicaoRealizadaMeses } from "./socios";
import { deriveAbertura } from "./aberturaDerivada";
import { isFolhaCost, isCpvCost, effectiveMonthValues } from "./costs";

export interface CashFlow {
  saldoInicial: number[];
  recebimentos: number[];
  /** Rendimentos de aplicações financeiras realizados em caixa (operacional). */
  receitasFinanceiras: number[];
  /** Outras receitas operacionais (aluguéis recebidos, venda de ativos) —
   *  entram no EBITDA e são recebidas no mês de competência (lag 0), como as
   *  financeiras. SSOT: `splitReceitasFinanceiras(state).operacionais`. */
  outrasReceitasOperacionais: number[];
  pagamentosFornecedores: number[];
  /** Custos/despesas fixos operacionais **exceto folha** — a folha vive em
   *  `pagamentosFolha` (lag 30d). Para desembolso operacional total some
   *  fornec + fixos + variáveis + folha + impostos. */
  pagamentosFixos: number[];
  pagamentosVariaveis: number[];
  /** Folha de pessoal desembolsada (SSOT `isFolhaCost`) com lag de 30 dias
   *  (pagamento no 5º dia útil do mês seguinte) + liquidação do saldo de
   *  abertura de salários no mês 1. Já é excluída de `pagamentosFixos` e
   *  `pagamentosVariaveis` — some as três colunas para obter o desembolso
   *  operacional (ex.: fornec + fixos + variáveis + folha + impostos). */
  pagamentosFolha: number[];
  pagamentosFinanceiros: number[];
  pagamentosImpostos: number[];
  fluxoOperacional: number[];
  aportes: number[];
  emprestimosCaptados: number[];
  amortizacoes: number[];
  dividendos: number[];
  fluxoFinanciamento: number[];
  capex: number[];
  fluxoInvestimento: number[];
  /** Permutas simples (não operacionais) — entrada (crédito) − saída (débito).
   *  Soma direta à variação de caixa, sem trânsito por OP/INV/FIN. */
  permutasCredito: number[];
  permutasDebito: number[];
  permutasLiquido: number[];
  variacaoCaixa: number[];
  saldoFinal: number[];
  alertas: { mes: string; saldo: number; tipo: "negativo" | "abaixoMinimo" }[];
  contasReceberAnoSeguinte: number;
  fornecedoresAnoSeguinte: number;
  impostosAnoSeguinte: number;
  totais: {
    recebimentos: number;
    receitasFinanceiras: number;
    outrasReceitasOperacionais: number;
    pagamentosTotais: number;
    fluxoOperacional: number;
    fluxoInvestimento: number;
    fluxoFinanciamento: number;
    variacao: number;
    saldoFinal: number;
    pioresMes: { mes: string; saldo: number } | null;
  };
}

// =====================================================================
// Funções puras — cada uma testável isoladamente, sem efeito colateral.
// =====================================================================

/**
 * Desloca um array mensal por N dias (arredondando para meses inteiros).
 * O que cairia em jan/ano+1 ou depois acumula em `transbordo`.
 *
 * Exemplo: lag=30, valores=[100,...12x]
 *   → inAno=[0, 100, 100, ..., 100] (11 meses)
 *   → transbordo = 100 (mês 12 cai em jan/ano+1)
 */
export function shiftByDaysSplit(
  values: number[],
  lagDays: number,
): { inAno: number[]; transbordo: number } {
  return shiftByDaysSplitMonthly(values, Array(12).fill(lagDays));
}

/**
 * Variante por mês: cada mês `i` tem seu próprio lag (em dias).
 * Útil quando o PMR/PMP varia ao longo do ano (sazonalidade, mix de clientes etc.).
 *
 * Deslocamento FRACIONÁRIO: 45 dias = metade em i+1 e metade em i+2. Antes o
 * lag era arredondado para meses inteiros, e reduzir o PMR de 40 para 26 dias
 * não mudava o caixa em nada.
 */
export function shiftByDaysSplitMonthly(
  values: number[],
  lagDaysByMonth: number[],
): { inAno: number[]; transbordo: number } {
  const out = zeros12();
  let transbordo = 0;
  const place = (t: number, v: number) => {
    if (t < 12) out[t] += v;
    else transbordo += v;
  };
  for (let i = 0; i < 12; i++) {
    const v = values[i] || 0;
    if (!v) continue;
    const x = Math.max(0, lagDaysByMonth[i] || 0) / 30;
    const k = Math.floor(x);
    const w = x - k;
    place(i + k, v * (1 - w));
    if (w > 0) place(i + k + 1, v * w);
  }
  return { inAno: out, transbordo };
}

/**
 * True quando o array tem variação real entre meses (sazonalidade).
 * Se for constante (todos iguais), preferimos o escalar `pmr`/`pmp`
 * — assim overrides do simulador / sensibilidade no escalar continuam efetivos.
 */
function hasMonthlyVariation(arr: number[] | undefined): boolean {
  if (!Array.isArray(arr) || arr.length !== 12) return false;
  const first = arr[0];
  return arr.some((v) => v !== first);
}

/**
 * Recebível mensal (competência) — SSOT compartilhado com balancoFechamento.ts.
 * Receita Bruta reconhecida (DRE) − Inadimplência REAL do mês − outras
 * Deduções de venda (devoluções, descontos incondicionais, abatimentos etc.).
 * A inadimplência REAL (calculada de revenue.bruta × inadimp%) nunca vira
 * caixa, independentemente do modo (dedução ou PDD). As deduções também
 * NUNCA viram caixa — precisam ser abatidas aqui para preservar a identidade
 * DRE ≡ DFC (Receita Líquida = Receita Bruta − deduções − inadimp).
 */
export function buildRecebivelMensal(state: AppState, dre: DRE): number[] {
  const inadimpReal = state.revenue.bruta.map(
    (b, i) => (b || 0) * ((state.revenue.inadimplencia[i] || 0) / 100),
  );
  const deducoes = outrasDeducoesMensal(state);
  return dre.receitaBruta.map((r, i) => Math.max(0, r - inadimpReal[i] - (deducoes[i] || 0)));
}

/**
 * Recebimentos = Recebível deslocado pelo PMR (mensal quando há sazonalidade).
 * [Auditoria Bloco 6] Independente do modo (dedução ou PDD), a inadimplência REAL
 * é sempre abatida antes do shift — no modo PDD, `dre.deducoesInadimplencia=0`,
 * mas o cash flow abate a perda subjacente (via buildRecebivelMensal).
 */
export function computeRecebimentos(
  state: AppState,
  dre: DRE,
): { inAno: number[]; transbordo: number } {
  const recebivelMensal = buildRecebivelMensal(state, dre);
  if (hasMonthlyVariation(state.revenue.pmrMensal)) {
    return shiftByDaysSplitMonthly(recebivelMensal, state.revenue.pmrMensal!);
  }
  return shiftByDaysSplit(recebivelMensal, state.revenue.pmr);
}

/**
 * Compras (base de fornecedores) — SSOT compartilhado com balancoFechamento.
 * Soma mensal de CPV/CMV/CSP EXCLUINDO linhas de folha (`isFolhaCost`) — folha
 * é paga pela regra dedicada (lag 30d) e nunca transita por "fornecedores".
 * Garante conservação: Fornec_fim = Fornec_ini + Compras − PagFornec sem
 * dupla contagem de folha embutida em CPV (ex.: MOD produção).
 */
export function buildComprasMensal(state: AppState, regime?: TaxRegime): number[] {
  const out = zeros12();
  const reg = regime ?? resolveEffectiveRegime(state);
  for (const c of state.costs ?? []) {
    if (!isCpvCost(c)) continue;
    if (isFolhaCost(c)) continue;
    const v = effectiveMonthValues(c, reg);
    for (let i = 0; i < 12; i++) out[i] += v[i] || 0;
  }
  return out;
}

/**
 * Pagamentos a fornecedores = CPV-NÃO-FOLHA deslocado pelo PMP.
 * (Folha embutida em CPV vai para o bucket `pagamentosFolha` com lag 30d.)
 */
export function computeFornecedores(
  state: AppState,
  _dre?: DRE,
): { inAno: number[]; transbordo: number } {
  const compras = buildComprasMensal(state);
  if (hasMonthlyVariation(state.revenue.pmpMensal)) {
    return shiftByDaysSplitMonthly(compras, state.revenue.pmpMensal!);
  }
  return shiftByDaysSplit(compras, state.revenue.pmp);
}

/**
 * Distribui a liquidação de um saldo de abertura ao longo dos primeiros meses,
 * proporcional ao prazo médio (PMR, PMP ou similar). SSOT dos "kickstarts" da
 * DFC — contrapartida da conservação de massa do balanço de fechamento:
 * sem essa liquidação, o saldo de abertura nunca vira caixa e o CR/Fornec.
 * de fechamento ficaria inflado indefinidamente.
 *
 * Regra:
 *   • prazo ≤ 30d  → 100% no mês 1
 *   • 31 ≤ prazo ≤ 60 → proporcional entre meses 1 e 2
 *   • prazo > 60    → 1/3 em cada um dos meses 1, 2 e 3
 */
export function distributeByPrazo(saldo: number, prazoDias: number): number[] {
  const out = zeros12();
  if (!(saldo > 0)) return out;
  const p = Math.max(0, prazoDias || 0);
  if (p <= 30) {
    out[0] = saldo;
  } else if (p <= 60) {
    // prazo=30 → tudo mês 1; prazo=60 → 50/50; interpolado linear.
    const w2 = (p - 30) / 30; // 0..1
    out[0] = saldo * (1 - w2);
    out[1] = saldo * w2;
  } else {
    out[0] = saldo / 3;
    out[1] = saldo / 3;
    out[2] = saldo / 3;
  }
  return out;
}

/**
 * Pagamentos de impostos = total mensal deslocado pelos lags oficiais.
 * A PARTIÇÃO (Split lag 0 · vendas lag 30 · IRPJ/CSLL trimestral no fim do
 * trimestre + lag 30) vive em `tax/impostosLag.ts` — SSOT compartilhado com
 * balancoFechamento.ts.
 */
export function computeImpostos(
  tax: MonthlyTax,
  splitPaymentAtivo = false,
  regime: TaxRegime = "simples",
): { inAno: number[]; transbordo: number } {
  const { vendasLag30, splitZero, lucroTri } = partitionMonthlyTaxByLag(
    tax,
    splitPaymentAtivo,
    regime,
  );
  const a = shiftByDaysSplit(vendasLag30, LAG_DIAS_PADRAO);
  const b = shiftByDaysSplit(splitZero, LAG_DIAS_SPLIT);
  // Lucro trimestral: já concentrado no mar/jun/set/dez; lag 30 → DARF em
  // abr/jul/out/jan (o de janeiro vira transbordo).
  const c = shiftByDaysSplit(lucroTri, LAG_DIAS_PADRAO);
  return {
    inAno: a.inAno.map((v, i) => v + (b.inAno[i] ?? 0) + (c.inAno[i] ?? 0)),
    transbordo: a.transbordo + b.transbordo + c.transbordo,
  };
}

/**
 * Pagamentos operacionais não-fornecedor: fixos, variáveis, financeiros.
 *
 * Derivação POR LINHA (natureza × comportamento × isFolha) — única forma
 * de a partição jamais ficar negativa. Regras:
 *   • linhas financeiras   → bucket `financeiros`
 *   • linhas de folha      → EXCLUÍDAS (vão para `pagamentosFolha` com lag 30)
 *   • linhas de CPV/CMV    → EXCLUÍDAS (vão para `pagamentosFornecedores` com PMP)
 *   • demais linhas OpEx   → `fixos` ou `variaveis` conforme `comportamento`
 *
 * PDD nunca entra aqui: vive apenas na DRE (dre.pdd) e é não-caixa (a perda
 * já foi abatida em `buildRecebivelMensal` via inadimplência REAL).
 */
export function computePagamentosOperacionais(
  state: AppState,
  regime?: TaxRegime,
): {
  fixos: number[];
  variaveis: number[];
  financeiros: number[];
} {
  const reg = regime ?? resolveEffectiveRegime(state);
  const fixos = zeros12();
  const variaveis = zeros12();
  const financeiros = zeros12();

  for (const c of state.costs ?? []) {
    const v = effectiveMonthValues(c, reg);
    if (c.category === "financeiro") {
      for (let i = 0; i < 12; i++) financeiros[i] += v[i] || 0;
      continue;
    }
    if (isFolhaCost(c)) continue; // bucket folha
    if (isCpvCost(c)) continue; // bucket fornecedores
    const isOpVar = c.category === "despesa_comercial" || c.category === "variavel";
    const comportamento = c.comportamento ?? (isOpVar ? "variavel" : "fixo");
    if (comportamento === "variavel") {
      for (let i = 0; i < 12; i++) variaveis[i] += v[i] || 0;
    } else {
      for (let i = 0; i < 12; i++) fixos[i] += v[i] || 0;
    }
  }

  // Invariante — nunca deve ser negativo pela construção acima.
  if (process.env.NODE_ENV !== "production") {
    for (let i = 0; i < 12; i++) {
      console.assert(
        variaveis[i] >= -0.01,
        `pagamentosVariaveis negativo mês ${i}: ${variaveis[i]}`,
      );
      console.assert(fixos[i] >= -0.01, `pagamentosFixos negativo mês ${i}: ${fixos[i]}`);
    }
  }

  return { fixos, variaveis, financeiros };
}

/**
 * Compõe os três fluxos mensais a partir de seus componentes.
 */
export function computeFluxos(args: {
  recebimentos: number[];
  receitasFinanceiras: number[];
  outrasReceitasOperacionais: number[];
  fornecedores: number[];
  fixos: number[];
  variaveis: number[];
  financeiros: number[];
  impostos: number[];
  capex: number[];
  aportes: number[];
  emprestimosCaptados: number[];
  amortizacoes: number[];
  dividendos: number[];
  /** Empréstimos PJ→PF concedidos a sócios (saída). Opcional p/ retrocompat. */
  mutuosConcedidos?: number[];
  /** Devolução de empréstimos pelos sócios (entrada). Opcional p/ retrocompat. */
  mutuosDevolvidos?: number[];
}): {
  fluxoOperacional: number[];
  fluxoInvestimento: number[];
  fluxoFinanciamento: number[];
  variacaoCaixa: number[];
} {
  const fluxoOperacional = zeros12();
  const fluxoInvestimento = zeros12();
  const fluxoFinanciamento = zeros12();
  const variacaoCaixa = zeros12();
  const mutCon = args.mutuosConcedidos ?? zeros12();
  const mutDev = args.mutuosDevolvidos ?? zeros12();

  for (let i = 0; i < 12; i++) {
    fluxoOperacional[i] =
      args.recebimentos[i] +
      args.receitasFinanceiras[i] +
      (args.outrasReceitasOperacionais[i] ?? 0) -
      args.fornecedores[i] -
      args.fixos[i] -
      args.variaveis[i] -
      args.financeiros[i] -
      args.impostos[i];
    fluxoInvestimento[i] = -args.capex[i];
    fluxoFinanciamento[i] =
      args.aportes[i] +
      args.emprestimosCaptados[i] -
      args.amortizacoes[i] -
      args.dividendos[i] -
      (mutCon[i] ?? 0) +
      (mutDev[i] ?? 0);

    variacaoCaixa[i] = fluxoOperacional[i] + fluxoInvestimento[i] + fluxoFinanciamento[i];
  }

  return { fluxoOperacional, fluxoInvestimento, fluxoFinanciamento, variacaoCaixa };
}

/**
 * Acumula saldo mês a mês: saldoInicial[i+1] = saldoFinal[i].
 */
export function computeSaldos(
  saldoInicial0: number,
  variacaoCaixa: number[],
): {
  saldoInicial: number[];
  saldoFinal: number[];
} {
  const saldoInicial = zeros12();
  const saldoFinal = zeros12();
  let saldo = saldoInicial0;
  for (let i = 0; i < 12; i++) {
    saldoInicial[i] = saldo;
    saldo += variacaoCaixa[i];
    saldoFinal[i] = saldo;
  }
  return { saldoInicial, saldoFinal };
}

/**
 * Lista meses com saldo final < 0 (negativo) ou < caixa mínimo (abaixoMinimo).
 */
export function computeAlertas(saldoFinal: number[], caixaMinimo: number): CashFlow["alertas"] {
  const out: CashFlow["alertas"] = [];
  for (let i = 0; i < 12; i++) {
    if (saldoFinal[i] < 0) out.push({ mes: MESES[i], saldo: saldoFinal[i], tipo: "negativo" });
    else if (saldoFinal[i] < caixaMinimo)
      out.push({ mes: MESES[i], saldo: saldoFinal[i], tipo: "abaixoMinimo" });
  }
  return out;
}

/**
 * Encontra o mês com menor saldo final do ano. Retorna null se vetor vazio.
 */
export function computePiorMes(saldoFinal: number[]): { mes: string; saldo: number } | null {
  let pior: { mes: string; saldo: number } | null = null;
  for (let i = 0; i < 12; i++) {
    if (!pior || saldoFinal[i] < pior.saldo) pior = { mes: MESES[i], saldo: saldoFinal[i] };
  }
  return pior;
}

/**
 * Burn rate (consumo médio mensal de caixa pela operação) e runway estimado.
 * - burnMedio12: média do ano inteiro
 * - burnMedio3: média dos últimos 3 meses (mais sensível ao momento atual)
 * - runwayMeses: (caixa atual + recebíveis) ÷ burnMedio3, Infinity se operação gera caixa
 */
export function computeBurnRunway(args: {
  fluxoOperacional: number[];
  caixaAtual: number;
  recebiveis: number;
}): { burnMedio12: number; burnMedio3: number; runwayMeses: number; queimando: boolean } {
  const burnMensal = args.fluxoOperacional.map((v) => -v); // positivo = queima
  // Anualiza pelos meses efetivamente operados (não pelos 12 do calendário).
  // Evita subestimar burn quando consultor preencheu só parte do ano.
  const mesesOp = mesesPreenchidos(args.fluxoOperacional);
  const burnMedio12 = mediaMensal(
    burnMensal.reduce((a, b) => a + b, 0),
    mesesOp,
  );
  // burnMedio3: média APENAS dos meses efetivamente operados (até 3 últimos).
  // Antes dividia por 3 cego — empresa com 1 mês preenchido tinha 2 zeros puxando
  // a média para baixo, subestimando o burn e superestimando o runway.
  const janelaCurta = Math.min(3, mesesOp);
  const burnMedio3 =
    janelaCurta > 0 ? burnMensal.slice(-janelaCurta).reduce((a, b) => a + b, 0) / janelaCurta : 0;
  const colchao = args.caixaAtual + args.recebiveis;
  const queimando = burnMedio3 > 0;
  const runwayMeses = queimando ? colchao / burnMedio3 : Infinity;
  return { burnMedio12, burnMedio3, runwayMeses, queimando };
}

// =====================================================================
// Orquestrador — mesma assinatura e retorno do legado.
// =====================================================================
export function buildCashFlow(
  state: AppState,
  regime: TaxRegime = resolveEffectiveRegime(state),
): CashFlow {
  const eng = buildCashFlowEngine(state, regime);
  // Modo Odoo: fluxo do razão + efeito do motor (ver engines/finance/anchor.ts).
  const r = state.realizado;
  return r?.cfBase ? anchorCashFlow(r, eng, state.cashflow?.caixaMinimo ?? 0) : eng;
}

/** Fluxo de caixa reconstruído pelo motor (premissas), sem âncora no razão. */
export function buildCashFlowEngine(
  state: AppState,
  regime: TaxRegime = resolveEffectiveRegime(state),
): CashFlow {
  const { dre, tax } = buildDRE(state, regime);
  const { capital, cashflow } = state;

  const rec = computeRecebimentos(state, dre);
  const fornec = computeFornecedores(state, dre);
  const imp = computeImpostos(tax, getSplitPaymentAtivo(state.tax), regime);
  const op = computePagamentosOperacionais(state, regime);
  // B2: rendimentos de aplicações financeiras realizam-se em caixa no mês de
  // competência. `operacionais` (aluguéis, venda de ativos) idem — entram no
  // EBITDA (DRE) e agora também no fluxo operacional (BUG 2).
  // Não operacionais (alienação de ativos etc.) também viram caixa no mês;
  // na DFC ficam junto de "outras receitas" (não há coluna dedicada).
  const split = splitReceitasFinanceiras(state);
  const receitasFinanceiras = split.financeiras;
  const outrasReceitasOperacionais = split.operacionais.map((v, i) => v + split.naoOperacionais[i]);

  // ─── Liquidação dos saldos de abertura ───
  // Contrapartida da conservação de massa do balanço de fechamento: os saldos
  // de abertura precisam virar caixa dentro do horizonte, senão CR/Fornec./
  // Impostos_fim ficariam eternamente inflados. Distribui pelos primeiros meses
  // segundo o prazo médio (PMR/PMP); impostos liquidam integralmente no mês 1.
  const aberturaKick = deriveAbertura({
    state,
    impostosTotalMensais: dre.impostosTotal,
  });
  const kickRecebimentos = distributeByPrazo(
    aberturaKick.contasReceber.value,
    state.revenue?.pmr || 0,
  );
  const kickFornecedores = distributeByPrazo(
    aberturaKick.fornecedores.value,
    state.revenue?.pmp || 0,
  );
  const kickImpostos = zeros12();
  kickImpostos[0] = aberturaKick.impostosPagar.value;

  // ─── Folha: lag 30 (pagamento no 5º dia útil do mês seguinte) ───
  // `computePagamentosOperacionais` já EXCLUI folha de fixos/variáveis (bucket
  // dedicado). Aqui só somamos a folha desembolsada, sem net-out.
  const folhaMensalTotal = zeros12();
  for (const c of state.costs ?? []) {
    if (!isFolhaCost(c)) continue;
    const v = effectiveMonthValues(c, regime);
    for (let i = 0; i < 12; i++) folhaMensalTotal[i] += v[i] || 0;
  }
  const folhaShifted = shiftByDaysSplit(folhaMensalTotal, 30);
  const kickFolha = zeros12();
  kickFolha[0] = aberturaKick.salariosEncargos.value;
  const pagamentosFolha = folhaShifted.inAno.map((v, i) => v + kickFolha[i]);

  const recebimentosInAno = rec.inAno.map((v, i) => v + kickRecebimentos[i]);
  const fornecedoresInAno = fornec.inAno.map((v, i) => v + kickFornecedores[i]);
  const impostosInAno = imp.inAno.map((v, i) => v + kickImpostos[i]);

  const aportes = cashflow.aportes.slice();
  const emprestimosCaptados = cashflow.emprestimosCaptados.slice();
  const amortizacoes = cashflow.amortizacoes.map(
    (v, i) => v + (cashflow.amortizacaoExtraordinaria?.[i] ?? 0),
  );
  // [SSOT] Dividendos/distribuição saem SEMPRE de state.distribuicaoRealizada
  // (fonte única cadastrada em Pró-labore). cashflow.dividendos permanece como
  // fallback legado apenas se distribuicaoRealizada não existir.
  const dividendos = state.distribuicaoRealizada
    ? Array.from(getDistribuicaoRealizadaMeses(state))
    : cashflow.dividendos.slice();
  const mutuosConcedidos = (cashflow.mutuosConcedidos ?? zeros12()).slice();
  const mutuosDevolvidos = (cashflow.mutuosDevolvidos ?? zeros12()).slice();
  // Mútuos PF→PJ (sócio→empresa) foram consolidados em capital.debtContracts
  // → cashflow.emprestimosCaptados/amortizacoes. Nenhum array dedicado.

  // SSOT: CAPEX = manual (cashflow.capex) + ativações de imobilizado (capital.capexAtivacao).
  const capex = computeCapexMensal(state);

  // Permutas simples — agrega crédito/débito por mês. SEM impacto em DRE.
  const permutasCredito = zeros12();
  const permutasDebito = zeros12();
  for (const p of cashflow.permutas ?? []) {
    const vals = p.values ?? [];
    for (let i = 0; i < 12; i++) {
      const v = Number(vals[i]) || 0;
      if (p.tipo === "credito") permutasCredito[i] += v;
      else permutasDebito[i] += v;
    }
  }
  const permutasLiquido = permutasCredito.map((c, i) => c - permutasDebito[i]);

  const fluxos = computeFluxos({
    recebimentos: recebimentosInAno,
    receitasFinanceiras,
    outrasReceitasOperacionais,
    fornecedores: fornecedoresInAno,
    // Folha entra combinada com "fixos" no cálculo do fluxo operacional
    // (mesmo sinal, mesma equação). A separação de colunas é preservada no
    // objeto de retorno (pagamentosFolha isolado).
    fixos: op.fixos.map((v, i) => v + pagamentosFolha[i]),
    variaveis: op.variaveis,
    financeiros: op.financeiros,
    impostos: impostosInAno,
    capex,
    aportes,
    emprestimosCaptados,
    amortizacoes,
    dividendos,
    mutuosConcedidos,
    mutuosDevolvidos,
  });

  // Permutas: somam direto à variação de caixa, fora de OP/INV/FIN.
  const variacaoCaixa = fluxos.variacaoCaixa.map((v, i) => v + permutasLiquido[i]);

  // SSOT do saldo de abertura: mesma prioridade usada por deriveAbertura
  // (Balanço). Prefere `balanco.ativoCirculante.caixaEquivalentes`; se vazio,
  // cai para o campo agregado `capital.disponibilidades` editado no Card 1.
  const caixaAbertura =
    Number(capital.balanco?.ativoCirculante?.caixaEquivalentes) ||
    Number(capital.disponibilidades) ||
    0;
  const { saldoInicial, saldoFinal } = computeSaldos(caixaAbertura, variacaoCaixa);

  const alertas = computeAlertas(saldoFinal, cashflow.caixaMinimo);
  const pior = computePiorMes(saldoFinal);

  return {
    saldoInicial,
    recebimentos: recebimentosInAno,
    receitasFinanceiras,
    outrasReceitasOperacionais,
    pagamentosFornecedores: fornecedoresInAno,
    pagamentosFixos: op.fixos,
    pagamentosVariaveis: op.variaveis,
    pagamentosFolha,
    pagamentosFinanceiros: op.financeiros,
    pagamentosImpostos: impostosInAno,
    fluxoOperacional: fluxos.fluxoOperacional,
    aportes,
    emprestimosCaptados,
    amortizacoes,
    dividendos,
    fluxoFinanciamento: fluxos.fluxoFinanciamento,
    capex,
    fluxoInvestimento: fluxos.fluxoInvestimento,
    permutasCredito,
    permutasDebito,

    permutasLiquido,
    variacaoCaixa,
    saldoFinal,
    alertas,
    contasReceberAnoSeguinte: rec.transbordo,
    fornecedoresAnoSeguinte: fornec.transbordo,
    impostosAnoSeguinte: imp.transbordo,
    totais: {
      recebimentos: sum(recebimentosInAno),
      receitasFinanceiras: sum(receitasFinanceiras),
      outrasReceitasOperacionais: sum(outrasReceitasOperacionais),
      pagamentosTotais:
        sum(fornecedoresInAno) +
        sum(op.fixos) +
        sum(op.variaveis) +
        sum(pagamentosFolha) +
        sum(op.financeiros) +
        sum(impostosInAno),

      fluxoOperacional: sum(fluxos.fluxoOperacional),
      fluxoInvestimento: sum(fluxos.fluxoInvestimento),
      fluxoFinanciamento: sum(fluxos.fluxoFinanciamento),
      variacao: sum(variacaoCaixa),
      saldoFinal: saldoFinal[11],
      pioresMes: pior,
    },
  };
}
