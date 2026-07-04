// Agregadores do Balanço Detalhado (Fase 1).
//
// Funções PURAS que percorrem `BalancoDetalhado` e devolvem sub-totais e
// totais. Quando o objeto não está preenchido, retornam 0 (UI/engine usam
// fallback nos campos agregados legados de `CapitalStructure`).
//
// IMPORTANTE: depreciação acumulada, amortização acumulada, PDD e ações em
// tesouraria entram como POSITIVOS no input e são SUBTRAÍDAS aqui.
import type { AppState, BalancoDetalhado, CostLine } from "./types";
import { aggregateMutuos } from "./mutuosSocios";
import { safeNumber as n } from "./safeMath";

const sumObj = (o: Record<string, number | undefined> | undefined): number =>
  o ? Object.values(o).reduce<number>((a, b) => a + n(b), 0) : 0;

export interface BalancoTotals {
  ativoCirculante: number;
  realizavelLP: number;
  investimentos: number;
  imobilizadoLiquido: number;
  intangivelLiquido: number;
  ativoNaoCirculante: number;
  ativoTotal: number;

  passivoCirculante: number;
  passivoNaoCirculante: number;
  passivoTotal: number;

  patrimonioLiquido: number;

  /** Dívida onerosa total = empréstimos CP + empréstimos LP + debêntures. */
  dividaOnerosa: number;
  /** Passivos não-onerosos = PC + PNC − dívida onerosa. */
  passivosNaoOnerosos: number;

  /** Diferença Ativo − (Passivo + PL). Ideal: 0. */
  diferenca: number;
}

export function calcAtivoCirculante(b?: BalancoDetalhado): number {
  const ac = b?.ativoCirculante;
  if (!ac) return 0;
  // PDD subtrai
  return sumObj({ ...ac, pdd: undefined }) - n(ac.pdd);
}

export function calcImobilizadoLiquido(b?: BalancoDetalhado): number {
  const im = b?.ativoNaoCirculante?.imobilizado;
  if (!im) return 0;
  return sumObj({ ...im, depreciacaoAcumulada: undefined }) - n(im.depreciacaoAcumulada);
}

export function calcIntangivelLiquido(b?: BalancoDetalhado): number {
  const it = b?.ativoNaoCirculante?.intangivel;
  if (!it) return 0;
  return sumObj({ ...it, amortizacaoAcumulada: undefined }) - n(it.amortizacaoAcumulada);
}

export function calcRealizavelLP(b?: BalancoDetalhado): number {
  return sumObj(b?.ativoNaoCirculante?.realizavelLP);
}

export function calcAtivoNaoCirculante(b?: BalancoDetalhado): number {
  return (
    calcRealizavelLP(b) +
    n(b?.ativoNaoCirculante?.investimentos) +
    calcImobilizadoLiquido(b) +
    calcIntangivelLiquido(b)
  );
}

export function calcPassivoCirculante(b?: BalancoDetalhado): number {
  return sumObj(b?.passivoCirculante);
}

export function calcPassivoNaoCirculante(b?: BalancoDetalhado): number {
  return sumObj(b?.passivoNaoCirculante);
}

export function calcDividaOnerosa(b?: BalancoDetalhado): number {
  return (
    n(b?.passivoCirculante?.emprestimosFinanciamentosCP) +
    n(b?.passivoNaoCirculante?.emprestimosFinanciamentosLP) +
    n(b?.passivoNaoCirculante?.debentures)
  );
}

export function calcPatrimonioLiquido(b?: BalancoDetalhado): number {
  const pl = b?.patrimonioLiquido;
  if (!pl) return 0;
  return sumObj({ ...pl, acoesEmTesouraria: undefined }) - n(pl.acoesEmTesouraria);
}

/** Calcula todos os totais e checa fechamento Ativo = Passivo + PL. */
export function calcBalancoTotals(b?: BalancoDetalhado): BalancoTotals {
  const ativoCirculante = calcAtivoCirculante(b);
  const realizavelLP = calcRealizavelLP(b);
  const investimentos = n(b?.ativoNaoCirculante?.investimentos);
  const imobilizadoLiquido = calcImobilizadoLiquido(b);
  const intangivelLiquido = calcIntangivelLiquido(b);
  const ativoNaoCirculante = realizavelLP + investimentos + imobilizadoLiquido + intangivelLiquido;
  const ativoTotal = ativoCirculante + ativoNaoCirculante;

  const passivoCirculante = calcPassivoCirculante(b);
  const passivoNaoCirculante = calcPassivoNaoCirculante(b);
  const passivoTotal = passivoCirculante + passivoNaoCirculante;
  const patrimonioLiquido = calcPatrimonioLiquido(b);

  const dividaOnerosa = calcDividaOnerosa(b);
  const passivosNaoOnerosos = Math.max(0, passivoTotal - dividaOnerosa);

  const diferenca = ativoTotal - (passivoTotal + patrimonioLiquido);

  return {
    ativoCirculante,
    realizavelLP,
    investimentos,
    imobilizadoLiquido,
    intangivelLiquido,
    ativoNaoCirculante,
    ativoTotal,
    passivoCirculante,
    passivoNaoCirculante,
    passivoTotal,
    patrimonioLiquido,
    dividaOnerosa,
    passivosNaoOnerosos,
    diferenca,
  };
}

/** True quando o objeto detalhado contém algum valor > 0 (está em uso). */
export function isBalancoPreenchido(b?: BalancoDetalhado): boolean {
  if (!b) return false;
  const t = calcBalancoTotals(b);
  return t.ativoTotal > 0 || t.passivoTotal > 0 || t.patrimonioLiquido !== 0;
}

// =========================================================================
// PROPAGAÇÃO BALANÇO DETALHADO → AGREGADOS DE CAPITAL (SSOT)
// =========================================================================
//
// Quando `state.capital.balanco` está preenchido, ele vira a fonte da verdade
// e SOBRESCREVE os campos agregados legados antes do `buildFinancialModel`
// rodar. Assim, ROE/ROA/ROIC/WACC/liquidez/NCG passam a refletir as rubricas
// detalhadas sem precisar mexer em cada cálculo individualmente.
//
// Quando `balanco` está vazio, devolve o state inalterado (modo legado).

const nn = (v: number | undefined): number => (typeof v === "number" && isFinite(v) ? v : 0);

/** Aplica o balanço detalhado sobre os agregados de `capital`. Pure. */
export function normalizeStateFromBalanco(state: AppState): AppState {
  const b = state.capital.balanco;
  if (!isBalancoPreenchido(b)) return state;

  const t = calcBalancoTotals(b);
  const ac = b!.ativoCirculante ?? {};
  const pc = b!.passivoCirculante ?? {};

  // Campos do Card 1 continuam válidos quando o balanço detalhado está só
  // parcialmente preenchido. Antes, qualquer rubrica em `balanco` acionava a
  // normalização e zerava caixa/CR/estoques/fornecedores não detalhados,
  // fazendo o DFC perder o saldo inicial digitado em "Dinheiro em caixa e bancos".
  const disponibilidadeDetalhada = nn(ac.caixaEquivalentes) + nn(ac.aplicacoesFinanceirasCP);
  const contasReceberDetalhado = Math.max(0, nn(ac.contasReceberClientes) - nn(ac.pdd));
  const estoquesDetalhado = nn(ac.estoques);
  const fornecedoresDetalhado = nn(pc.fornecedores);

  const disponibilidades = disponibilidadeDetalhada || nn(state.capital.disponibilidades);
  const contasReceber = contasReceberDetalhado || nn(state.capital.contasReceber);
  const estoques = estoquesDetalhado || nn(state.capital.estoques);
  const fornecedores = fornecedoresDetalhado || nn(state.capital.fornecedores);

  return {
    ...state,
    capital: {
      ...state.capital,
      ativoTotal: t.ativoTotal,
      ativoCirculante: t.ativoCirculante,
      passivoCirculante: t.passivoCirculante,
      dividaOnerosa: t.dividaOnerosa,
      patrimonioLiquido: t.patrimonioLiquido,
      passivosNaoOnerosos: t.passivosNaoOnerosos,
      disponibilidades,
      contasReceber,
      estoques,
      fornecedores,
    },
  };
}

// =========================================================================
// PRÉ-PREENCHIMENTO E SNAPSHOT (Fase 2.3)
// =========================================================================
//
// `suggestBalancoFromState` deriva rubricas do balanço a partir das páginas
// Receitas, Custos e Capital. `mergeBalancoPreservandoUsuario` aplica as
// sugestões SOMENTE em campos vazios (= 0) — nunca sobrescreve digitação.
// `snapshotAnterior` congela o N atual em `anterior` (N-1) para comparativo.

const sumCostByCat = (lines: CostLine[] | undefined, cats: string[]): number =>
  (lines ?? [])
    .filter((l) => cats.includes(l.category))
    .reduce((a, l) => a + (l.values ?? []).reduce((x, y) => x + (y || 0), 0), 0);

export interface SuggestOpts {
  /** Soma do Lucro Líquido (12m) do DRE. */
  dreLucroLiquido: number;
  /** Soma dos impostos sobre lucro (12m) — proxy para "Impostos a pagar" (≈ 1 mês). */
  dreImpostosLucroAnual?: number;
}

/** Constrói uma sugestão de Balanço a partir do state operacional. Pure. */
export function suggestBalancoFromState(
  state: AppState,
  opts: SuggestOpts,
): BalancoDetalhado {
  const cap = state.capital;
  const rev = state.revenue;
  const receitaBrutaAnual = (rev?.bruta ?? []).reduce((a, b) => a + (b || 0), 0);
  const cpvAnual = sumCostByCat(state.costs, ["custo_vendas", "direto_venda"]);
  const folhaAnual = sumCostByCat(state.costs, ["fixo", "variavel"]);

  // CR: usa capital, senão deriva do PMR (receitaBruta × pmr/360).
  const ar =
    cap.contasReceber > 0
      ? cap.contasReceber
      : (receitaBrutaAnual * (rev?.pmr || 0)) / 360;
  // Fornecedores: usa capital, senão deriva do PMP (CPV × pmp/360).
  const ap =
    cap.fornecedores > 0
      ? cap.fornecedores
      : (cpvAnual * (rev?.pmp || 0)) / 360;

  // CAPEX → imobilizado (proxy). Depreciação acumulada: (depMensal×12) +
  // acumulado de cada ativação até dezembro.
  const capexTotal = (cap.capexAtivacao ?? []).reduce(
    (a, c) => a + (c.valor || 0),
    0,
  );
  const depAcumCapex = (cap.capexAtivacao ?? []).reduce((a, c) => {
    const meses = Math.max(0, 13 - (c.mes || 1));
    const vu = c.vidaUtilMeses > 0 ? c.vidaUtilMeses : 60;
    return a + (c.valor / vu) * meses;
  }, 0);
  const depAcum = (cap.depreciacaoMensal || 0) * 12 + depAcumCapex;

  // Split dívida onerosa CP/LP — SSOT: contratos por maturidade.
  const _split = splitDebtCPLPFromContracts(state);
  const dividaCP = _split.cp;
  const dividaLP = _split.lp;

  // Caixa: separa ocioso (≈ aplicações CP) do operacional.
  const caixaOcioso = cap.caixaOcioso || 0;
  const caixaOper = Math.max(0, (cap.disponibilidades || 0) - caixaOcioso);

  // Mútuos ativos (PJ→PF, empresa emprestou ao sócio): saldo devedor
  // remanescente ao fim do horizonte compõe o Realizável a Longo Prazo
  // (créditos com partes relacionadas — CPC 05).
  const msAgg = aggregateMutuos(state.mutuosSocios);
  const mutuosAtivosSaldoAReceber = Math.max(0, msAgg.saldoFinal);


  // Provisões ~ 1 mês.
  const salariosPagar = folhaAnual > 0 ? folhaAnual / 12 : 0;
  const impostosPagar =
    opts.dreImpostosLucroAnual && opts.dreImpostosLucroAnual > 0
      ? opts.dreImpostosLucroAnual / 12
      : 0;

  return {
    ativoCirculante: {
      caixaEquivalentes: caixaOper,
      aplicacoesFinanceirasCP: caixaOcioso,
      contasReceberClientes: ar,
      estoques: cap.estoques || 0,
    },
    ativoNaoCirculante: {
      realizavelLP: {
        // Créditos com sócios (mútuos ativos PJ→PF) — saldo devedor
        // remanescente ao fim de 12m. SSOT: aggregateMutuos(state.mutuosSocios).
        creditosLP: mutuosAtivosSaldoAReceber,
      },
      imobilizado: {
        outrosImobilizados: capexTotal,
        depreciacaoAcumulada: depAcum,
      },
    },
    passivoCirculante: {
      fornecedores: ap,
      emprestimosFinanciamentosCP: dividaCP,
      impostosPagar,
      salariosEncargos: salariosPagar,
    },
    passivoNaoCirculante: {
      // Toda dívida onerosa (bancos + mútuos PF→PJ cadastrados como
      // debtContracts com tipoCredor="socio") entra pelo split CP/LP a partir
      // de `capital.dividaOnerosa`. SSOT único, sem duplicidade.
      emprestimosFinanciamentosLP: dividaLP,
    },

    patrimonioLiquido: {
      resultadoExercicio: opts.dreLucroLiquido,
    },
  };
}

/** Mescla sugestões em `current` SOMENTE onde o valor atual é 0/ausente. Pure. */
export function mergeBalancoPreservandoUsuario(
  current: BalancoDetalhado | undefined,
  suggested: BalancoDetalhado,
): BalancoDetalhado {
  const rec = (c: unknown, s: unknown): unknown => {
    if (s === undefined || s === null) return c;
    if (typeof s === "number") {
      const cur = typeof c === "number" ? c : 0;
      return cur === 0 ? s : cur;
    }
    if (typeof s === "object") {
      const out: Record<string, unknown> = {
        ...((c as Record<string, unknown>) ?? {}),
      };
      for (const k of Object.keys(s as Record<string, unknown>)) {
        out[k] = rec(out[k], (s as Record<string, unknown>)[k]);
      }
      return out;
    }
    return c;
  };
  return rec(current ?? {}, suggested) as BalancoDetalhado;
}

/** Copia o N atual (sem `anterior`) para `balanco.anterior` (snapshot N-1). */
export function snapshotAnterior(b: BalancoDetalhado): BalancoDetalhado {
  const { anterior: _drop, ...rest } = b;
  void _drop;
  return { ...b, anterior: JSON.parse(JSON.stringify(rest)) };
}
