// =====================================================================
// SSOT — Memória de cálculo dos indicadores financeiros (pt-BR).
// Recebe (state, dre, ind) e devolve um Record de strings prontas para
// exibição abaixo da Fórmula no tooltip de cada card.
//
// Regras:
//  - Quando o denominador é 0 / base insuficiente → "Base insuficiente — cálculo indisponível".
//  - Reusa SOMENTE valores anualizados já expostos em `Indicators` ou
//    derivados diretos de `dre`/`state` — NENHUM novo cálculo financeiro.
//  - Formatação 100% pt-BR via helpers de `format.ts`.
// =====================================================================
import { sumContractSaldos, aggregateContracts } from "./debtContracts";
import type { AppState } from "./types";
import type { DRE } from "./dre";
import type { Indicators } from "./indicators";
import { deriveAbertura } from "./aberturaDerivada";
import { fmtBRL, fmtPct, fmtRatio, fmtAnos, fmtDays, fmtNum, sum } from "./format";

const NA = "Base insuficiente — cálculo indisponível";

/** Divisão segura para formatação: devolve null quando denominador inviável. */
const safe = (num: number, den: number): number | null =>
  den > 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : null;

const line = (lhs: string, rhs: string) => `${lhs}\n= ${rhs}`;

export interface IndicatorCalcs {
  // Margens
  margemBruta: string;
  margemEbitda: string;
  eva: string;
  margemLiquida: string;
  margemContribuicao: string;
  // Ponto de equilíbrio
  pontoEquilibrioOperacional: string;
  pontoEquilibrioFinanceiro: string;
  pontoEquilibrioTotal: string;
  // Retornos
  roe: string;
  roa: string;
  roic: string;
  wacc: string;
  // Liquidez
  liquidezCorrente: string;
  liquidezSeca: string;
  liquidezImediata: string;
  liquidezGeral: string;
  // Estrutura
  endividamentoGeral: string;
  capitalProprio: string;
  coberturaJuros: string;
  giroAtivo: string;
  // Alavancagem
  dividaLiqEbitda: string;
  dividaLiqEbit: string;
  dividaLiqPl: string;
  amortizacaoPlPorLucro: string;
  paybackCapex: string;
  // Caixa / operação
  fcf: string;
  cagrReceitas12m: string;
  gao: string;
  gaf: string;
  qualidadeLucro: string;
  conversaoEbitdaCaixa: string;
  cicloFinanceiro: string;
  ncg: string;
  gapCapitalGiro: string;
  // RH / produtividade
  faturamentoPorColaborador: string;
  receitaPorColaborador: string;
  ebitdaPorColaborador: string;
  lucroPorColaborador: string;
  folhaSobreReceita: string;
  // Risco
  margemSeguranca: string;
  dscr: string;
  // Fiscal
  impostosSobreReceita: string;
  impostosSobreLucro: string;
  // Topo de páginas
  receitaLiquida12m: string;
  ebitda12m: string;
  lucroLiquido12m: string;
}

export function buildIndicatorCalcs(
  state: AppState,
  dre: DRE,
  ind: Indicators,
  cagrReceitas12m = NaN,
): IndicatorCalcs {
  const { capital } = state;

  // --- Bases anualizadas (já normalizadas pela engine) ---
  const RL = ind.receitaLiquidaAnual;
  const RB = ind.receitaBrutaAnual;
  const EBITDA = ind.ebitdaAnual;
  const EBIT = ind.ebitAnual;
  const LL = ind.lucroLiquidoAnual;
  const LB = sum(dre.lucroBruto);
  const cv = sum(dre.custosVariaveis);
  // `juros` para DSCR / Cobertura de Juros = juros de CONTRATOS de dívida (SSOT com indicators.ts).
  // NÃO usa `custosFinanceirosTotal` da DRE (que inclui tarifas, IOF, cheque especial etc.).
  const juros = aggregateContracts(capital.debtContracts ?? []).totalJurosAno;
  const impVendas = sum(dre.impostosVendas);
  const impLucro = sum(dre.impostos);
  const cf = sum(dre.custosFixos);
  const dep = sum(dre.depreciacao);

  // --- Estoque, AC, PC etc. ---
  const PL = Math.max(0, capital.patrimonioLiquido);
  const D = Math.max(0, sumContractSaldos(capital.debtContracts));
  // SSOT do PL de abertura (mesma fonte que `indicators.ts`): soma completa do PL, não capital social sozinho.
  const PLabSSOT = deriveAbertura({ state, impostosTotalMensais: dre.impostosTotal }).totals.pl;
  const PLab = PLabSSOT > 0 ? PLabSSOT : Math.max(0, capital.patrimonioLiquidoAbertura ?? 0);
  const PLmedio = PLab > 0 ? (PLab + PL) / 2 : PL;
  const ATab = Math.max(0, capital.ativoTotalAbertura ?? 0);
  const AT = capital.ativoTotal;
  const ATmedio = ATab > 0 && AT > 0 ? (ATab + AT) / 2 : AT;
  const AC = ind.ativoCirculante;
  const PC = ind.passivoCirculante;
  const disp = ind.caixaLiquidez; // SSOT: caixa do balanço; pode ser negativo (descoberto).
  const estoques = capital.estoques;
  const dl = ind.dividaLiquida;
  const headcount = Math.max(0, state.numColaboradores ?? 0);

  // ----- Margens -----
  const margemBruta = (() => {
    const r = safe(LB, RL);
    return r == null ? NA : line(`${fmtBRL(LB)} ÷ ${fmtBRL(RL)} × 100`, fmtPct(r));
  })();
  const margemEbitda = (() => {
    const r = safe(EBITDA, RL);
    return r == null ? NA : line(`${fmtBRL(EBITDA)} ÷ ${fmtBRL(RL)} × 100`, fmtPct(r));
  })();
  // EVA = (ROIC − WACC) × Capital Investido. ROIC/WACC em % → divide por 100.
  const evaStr =
    ind.capitalInvestido > 0
      ? line(
          `(${fmtPct(ind.roic / 100)} − ${fmtPct(ind.wacc / 100)}) × ${fmtBRL(ind.capitalInvestido)}`,
          fmtBRL(ind.eva),
        )
      : NA;
  const margemLiquida = (() => {
    const r = safe(LL, RL);
    return r == null ? NA : line(`${fmtBRL(LL)} ÷ ${fmtBRL(RL)} × 100`, fmtPct(r));
  })();
  const margemContribuicao = (() => {
    const mc = RL - cv;
    const r = safe(mc, RL);
    return r == null
      ? NA
      : line(`(${fmtBRL(RL)} − ${fmtBRL(cv)}) ÷ ${fmtBRL(RL)} × 100`, fmtPct(r));
  })();

  // ----- Ponto de equilíbrio -----
  const mcFrac = RL > 0 ? (RL - cv) / RL : 0;
  const peOp = (() => {
    if (mcFrac <= 0) return NA;
    return line(
      `(${fmtBRL(cf)} + ${fmtBRL(dep)}) ÷ ${fmtPct(mcFrac)}`,
      fmtBRL(ind.pontoEquilibrioOperacional),
    );
  })();
  const peFin = (() => {
    if (mcFrac <= 0) return NA;
    return line(`${fmtBRL(cf)} ÷ ${fmtPct(mcFrac)}`, fmtBRL(ind.pontoEquilibrioFinanceiro));
  })();
  const peTot = (() => {
    if (mcFrac <= 0) return NA;
    return line(
      `(${fmtBRL(cf)} + ${fmtBRL(dep)} + ${fmtBRL(juros)}) ÷ ${fmtPct(mcFrac)}`,
      fmtBRL(ind.pontoEquilibrio),
    );
  })();

  // ----- Retornos -----
  const roe =
    PLmedio > 0 ? line(`${fmtBRL(LL)} ÷ ${fmtBRL(PLmedio)} × 100`, fmtPct(LL / PLmedio)) : NA;
  const roa =
    ATmedio > 0 ? line(`${fmtBRL(LL)} ÷ ${fmtBRL(ATmedio)} × 100`, fmtPct(LL / ATmedio)) : NA;
  const roic =
    ind.capitalInvestido > 0
      ? line(
          `${fmtBRL(ind.nopat)} ÷ ${fmtBRL(ind.capitalInvestido)} × 100  (IR efetivo: ${fmtNum(ind.aliquotaNopat, 1)}%)`,
          fmtPct(ind.nopat / ind.capitalInvestido),
        )
      : NA;
  const wacc = (() => {
    const V = PL + D;
    if (V <= 0) return NA;
    const wE = PL / V;
    const wD = D / V;
    return line(
      `(${fmtPct(wE)} × ${fmtNum(capital.ke, 1)}%) + (${fmtPct(wD)} × ${fmtNum(capital.kd, 1)}% × (1 − IR))`,
      `${fmtNum(ind.wacc, 1)}%`,
    );
  })();

  // ----- Liquidez -----
  const liquidezCorrente = PC > 1 ? line(`${fmtBRL(AC)} ÷ ${fmtBRL(PC)}`, fmtRatio(AC / PC)) : NA;
  const liquidezSeca =
    PC > 1
      ? line(
          `(${fmtBRL(AC)} − ${fmtBRL(estoques)}) ÷ ${fmtBRL(PC)}`,
          fmtRatio((AC - estoques) / PC),
        )
      : NA;
  const liquidezImediata =
    PC > 1 ? line(`${fmtBRL(disp)} ÷ ${fmtBRL(PC)}`, fmtRatio(disp / PC)) : NA;
  const liquidezGeral = (() => {
    const passivoTotal = AT > PL ? AT - PL : 0;
    return passivoTotal > 1
      ? line(`${fmtBRL(AC)} ÷ (${fmtBRL(AT)} − ${fmtBRL(PL)})`, fmtRatio(AC / passivoTotal))
      : NA;
  })();

  // ----- Estrutura -----
  const endividamentoGeral = (() => {
    if (AT > 0) {
      // Passivo total agora vem da engine (soma real do Balanço Detalhado quando
      // disponível — vide `indicators.ts`). Mostra o percentual conforme calculado
      // e destaca o pedaço ONEROSO (dívida financeira), o número que o banco lê.
      const passivo = (ind.endividamentoGeral / 100) * AT;
      const oneroso = (ind.endividamentoOneroso / 100) * AT;
      return line(
        `${fmtBRL(passivo)} ÷ ${fmtBRL(AT)} × 100  (oneroso: ${fmtBRL(oneroso)} = ${fmtPct(ind.endividamentoOneroso / 100)})`,
        fmtPct(ind.endividamentoGeral / 100),
      );
    }
    return NA;
  })();
  const capitalProprio = (() => {
    const V = PL + D;
    return V > 0
      ? line(`${fmtBRL(PL)} ÷ (${fmtBRL(PL)} + ${fmtBRL(D)}) × 100`, fmtPct(PL / V))
      : NA;
  })();
  const coberturaJuros =
    juros > 1
      ? line(`${fmtBRL(EBIT)} ÷ ${fmtBRL(juros)}`, `${fmtRatio(EBIT / juros)}×`)
      : "Sem dívida onerosa — indicador não aplicável (N/A)";
  const giroAtivo =
    ATmedio > 0 ? line(`${fmtBRL(RL)} ÷ ${fmtBRL(ATmedio)}`, `${fmtRatio(RL / ATmedio)}×`) : NA;

  // ----- Alavancagem -----
  const dividaLiqEbitda =
    EBITDA > 1 ? line(`${fmtBRL(dl)} ÷ ${fmtBRL(EBITDA)}`, `${fmtRatio(dl / EBITDA)}×`) : NA;
  const dividaLiqEbit =
    EBIT > 1 ? line(`${fmtBRL(dl)} ÷ ${fmtBRL(EBIT)}`, `${fmtRatio(dl / EBIT)}×`) : NA;
  const dividaLiqPl = PL > 1 ? line(`${fmtBRL(dl)} ÷ ${fmtBRL(PL)}`, `${fmtRatio(dl / PL)}×`) : NA;

  const amortizacaoPlPorLucro =
    LL > 1 && PL > 0 ? line(`${fmtBRL(PL)} ÷ ${fmtBRL(LL)}`, fmtAnos(PL / LL)) : NA;
  const paybackCapex =
    ind.capexAnual > 0 && ind.fcf > 1
      ? line(`${fmtBRL(ind.capexAnual)} ÷ ${fmtBRL(ind.fcf)}`, fmtAnos(ind.capexAnual / ind.fcf))
      : NA;

  // ----- Caixa / operação -----
  const fcfStr = line(`${fmtBRL(ind.nopat)} + Depreciação − Δ NCG`, fmtBRL(ind.fcf));
  const cagrStr = Number.isFinite(cagrReceitas12m)
    ? line(`Receita_fim ÷ Receita_início, anualizado em 12 meses`, fmtPct(cagrReceitas12m))
    : NA;
  const gaoStr =
    Math.abs(EBIT) > 1 ? line(`${fmtBRL(RL - cv)} ÷ ${fmtBRL(EBIT)}`, `${fmtRatio(ind.gao)}×`) : NA;
  // M2: LAIR usado na fórmula do GAF deve ser o LAIR da DRE (EBIT − juros +
  // receitas financeiras + outras), não apenas EBIT − juros. Isso mantém o
  // tooltip alinhado ao cálculo de `indicators.ts` (que usa sum(dre.lair)).
  const LAIR = sum(dre.lair);
  const gafStr =
    Math.abs(EBIT) > 1 && LAIR > 1
      ? line(`${fmtBRL(EBIT)} ÷ ${fmtBRL(LAIR)}`, `${fmtRatio(ind.gaf)}×`)
      : NA;
  const qualidadeLucro =
    Math.abs(LL) > 1 ? line(`FCO ÷ ${fmtBRL(LL)}`, `${fmtRatio(ind.qualidadeLucro)}×`) : NA;
  const conversaoEbitdaCaixa =
    EBITDA > 0
      ? line(`${fmtBRL(ind.fcf)} ÷ ${fmtBRL(EBITDA)} × 100`, fmtPct(ind.fcf / EBITDA))
      : NA;
  const cicloFinanceiroStr = line(
    `${fmtDays(state.revenue.pmr)} + PME − ${fmtDays(state.revenue.pmp)}`,
    fmtDays(ind.cicloFinanceiro, 1),
  );
  const ncgStr = line(`Contas a Receber + Estoques − Fornecedores`, fmtBRL(ind.ncg));
  const acGap = capital.ativoCirculante > 0 ? capital.ativoCirculante : disp;
  const pcGap = capital.passivoCirculante > 0 ? capital.passivoCirculante : 0;
  const cdgVal = acGap - pcGap;
  const gapCgStr = line(
    `NCG − CDG = ${fmtBRL(ind.ncg)} − (${fmtBRL(acGap)} − ${fmtBRL(pcGap)}) = ${fmtBRL(ind.ncg)} − ${fmtBRL(cdgVal)}`,
    fmtBRL(ind.gapCapitalGiro),
  );

  // ----- RH -----
  const fmtColab = (v: number) =>
    headcount > 0
      ? line(`${fmtBRL(v * headcount)} ÷ ${headcount} colaborador(es)`, fmtBRL(v))
      : "Informe o nº de colaboradores em Configurações Rápidas";
  const faturamentoPorColaborador = fmtColab(ind.faturamentoPorColaborador);
  const receitaPorColaborador = fmtColab(ind.receitaPorColaborador);
  const ebitdaPorColaborador = fmtColab(ind.ebitdaPorColaborador);
  const lucroPorColaborador = fmtColab(ind.lucroPorColaborador);
  const folhaSobreReceita =
    RB > 0 && ind.custoPessoalSobreReceita > 0
      ? line(
          `${fmtBRL((ind.custoPessoalSobreReceita / 100) * RB)} ÷ ${fmtBRL(RB)} × 100`,
          `${fmtNum(ind.custoPessoalSobreReceita, 1)}%`,
        )
      : NA;

  // ----- Risco -----
  const margemSeguranca =
    RL > 0 && ind.pontoEquilibrioOperacional > 0
      ? line(
          `(${fmtBRL(RL)} − ${fmtBRL(ind.pontoEquilibrioOperacional)}) ÷ ${fmtBRL(RL)} × 100`,
          `${fmtNum(ind.margemSeguranca, 1)}%`,
        )
      : NA;
  const dscr = (() => {
    const amort = sum(state.cashflow.amortizacoes ?? []);
    const serv = juros + amort;
    return serv > 1
      ? line(
          `${fmtBRL(EBITDA)} ÷ (${fmtBRL(juros)} + ${fmtBRL(amort)})`,
          `${fmtRatio(EBITDA / serv)}×`,
        )
      : "Sem serviço da dívida no período — indicador não aplicável (N/A)";
  })();

  // ----- Fiscal -----
  const impostosSobreReceita =
    RB > 0
      ? line(
          `(${fmtBRL(impVendas)} + ${fmtBRL(impLucro)}) ÷ ${fmtBRL(RB)} × 100`,
          `${fmtNum(ind.impostosSobreReceita, 1)}%`,
        )
      : NA;
  const impostosSobreLucro =
    LL > 1
      ? line(
          `(${fmtBRL(impVendas)} + ${fmtBRL(impLucro)}) ÷ ${fmtBRL(LL)} × 100`,
          `${fmtNum(ind.impostosSobreLucro, 1)}%`,
        )
      : NA;

  // ----- Topo de páginas (Dashboard) -----
  const receitaLiquida12m = line(
    `${fmtBRL(RB)} − ${fmtBRL(impVendas)} (− devoluções/abatimentos)`,
    fmtBRL(RL),
  );
  const ebitda12m = line(`${fmtBRL(EBIT)} + ${fmtBRL(dep)}`, fmtBRL(EBITDA));
  const lucroLiquido12m = line(
    `${fmtBRL(EBIT)} − ${fmtBRL(juros)} − ${fmtBRL(impLucro)}`,
    fmtBRL(LL),
  );

  return {
    margemBruta,
    margemEbitda,
    eva: evaStr,
    margemLiquida,
    margemContribuicao,
    pontoEquilibrioOperacional: peOp,
    pontoEquilibrioFinanceiro: peFin,
    pontoEquilibrioTotal: peTot,
    roe,
    roa,
    roic,
    wacc,
    liquidezCorrente,
    liquidezSeca,
    liquidezImediata,
    liquidezGeral,
    endividamentoGeral,
    capitalProprio,
    coberturaJuros,
    giroAtivo,
    dividaLiqEbitda,
    dividaLiqEbit,
    dividaLiqPl,
    amortizacaoPlPorLucro,
    paybackCapex,
    fcf: fcfStr,
    cagrReceitas12m: cagrStr,
    gao: gaoStr,
    gaf: gafStr,
    qualidadeLucro,
    conversaoEbitdaCaixa,
    cicloFinanceiro: cicloFinanceiroStr,
    ncg: ncgStr,
    gapCapitalGiro: gapCgStr,
    faturamentoPorColaborador,
    receitaPorColaborador,
    ebitdaPorColaborador,
    lucroPorColaborador,
    folhaSobreReceita,
    margemSeguranca,
    dscr,
    impostosSobreReceita,
    impostosSobreLucro,
    receitaLiquida12m,
    ebitda12m,
    lucroLiquido12m,
  };
}
