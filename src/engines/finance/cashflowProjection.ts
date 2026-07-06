// Projeção de fluxo de caixa multi-anual com cenários (base/otim/pess) e eventos
// de captação de dívida. Reusa `buildCashFlow` como SSOT do perfil mensal e
// projeta N meses à frente aplicando deltas multiplicativos por categoria.

import type { AppState, DebtContract } from "./types";
import { buildCashFlow } from "./cashflow";
import { resolveEffectiveRegime } from "./regime";
import { fmtBRLCompact as fmtBRL } from "./format";

/**
 * Gera cronograma estendido (N meses) de juros e amortização para um contrato,
 * usado para projetar saídas de caixa além dos 12 meses do ano-base.
 * Reproduz a mesma lógica de `scheduleContract` (Price/SAC) sem o teto de 12.
 */
function scheduleContractFull(c: DebtContract, meses: number): { juros: number[]; amort: number[] } {
  const juros = new Array(meses).fill(0);
  const amort = new Array(meses).fill(0);
  const saldoIni = Math.max(0, c.saldoDevedor || 0);
  const n = Math.max(1, Math.floor(c.prazoMeses || 0));
  // Juros mensal equivalente composto (mesma convenção do SSOT em cashflow.ts):
  // im = (1 + i_a)^(1/12) - 1, evita subestimar juros ao usar taxa nominal /12.
  const iA = Math.max(0, (c.taxaAA || 0) / 100);
  const im = iA > 0 ? Math.pow(1 + iA, 1 / 12) - 1 : 0;
  if (saldoIni <= 0) return { juros, amort };

  let saldo = saldoIni;
  const parcelaPrice = im > 0 ? (saldo * im) / (1 - Math.pow(1 + im, -n)) : saldo / n;
  const amortSAC = saldo / n;
  const limite = Math.min(meses, n);
  for (let m = 0; m < limite; m++) {
    const j = saldo * im;
    let a = c.sistema === "price" ? parcelaPrice - j : amortSAC;
    if (a > saldo) a = saldo;
    if (a < 0) a = 0;
    juros[m] = j;
    amort[m] = a;
    saldo -= a;
    if (saldo <= 0) break;
  }
  return { juros, amort };
}

/**
 * Calcula o delta (mês-a-mês) entre o cronograma REAL dos contratos no
 * horizonte projetado e o que `buildCashFlow` repete ciclicamente do
 * ano-base (índice b = (i-1) % 12). Para i<=12 o delta é zero (cf já
 * contempla); para i>12 corrige o "loop" do ano-base com o vencimento real.
 */
function debtContractsDelta(contracts: DebtContract[], meses: number) {
  const deltaAmort = new Array(meses + 1).fill(0);
  const deltaJuros = new Array(meses + 1).fill(0);
  if (!contracts?.length) return { deltaAmort, deltaJuros };

  for (const c of contracts) {
    const real = scheduleContractFull(c, meses);
    // Cronograma "ano-base" (12 primeiros meses) que o engine repete ciclicamente.
    const base12Amort = real.amort.slice(0, 12);
    const base12Juros = real.juros.slice(0, 12);
    for (let i = 1; i <= meses; i++) {
      if (i <= 12) continue; // ano-base já refletido em cf
      const b = (i - 1) % 12;
      deltaAmort[i] += (real.amort[i - 1] || 0) - (base12Amort[b] || 0);
      deltaJuros[i] += (real.juros[i - 1] || 0) - (base12Juros[b] || 0);
    }
  }
  return { deltaAmort, deltaJuros };
}

/** Evento de captação de dívida no horizonte projetado. */
export interface CaptacaoDivida {
  /** Mês 1-indexado dentro do horizonte (1..meses). */
  mes: number;
  /** Valor captado (entrada de caixa em `mes`). */
  valor: number;
  /** Prazo de devolução em meses (amortização linear de principal). */
  prazoDevolucao: number;
}

export interface CenarioProjecao {
  nome: string;
  /** Variação multiplicativa sobre recebimentos/custos variáveis. Escalar (-0.10) ou array mês-a-mês. */
  receitaDelta: number | number[];
  /** Variação sobre pagamentos fixos (proxy de folha). Escalar ou array mês-a-mês. */
  folhaDelta: number | number[];
  /** Eventos de captação opcionais. */
  capturasDivida?: CaptacaoDivida[];
}

/** Resolve delta para o mês i (1-indexado). Aceita escalar ou array (último valor repetido). */
function deltaAt(d: number | number[], i: number): number {
  if (typeof d === "number") return d;
  if (d.length === 0) return 0;
  return d[Math.min(i - 1, d.length - 1)] ?? 0;
}

export interface ProjecaoMes {
  mesIdx: number; // 1..meses
  rotulo: string; // ex.: "M01", "M13", etc.
  recebimentos: number;
  pagamentos: number;
  capex: number;
  financiamento: number;
  variacao: number;
  saldoInicial: number;
  saldoFinal: number;
}

export interface ProjecaoCenarioResult {
  cenario: CenarioProjecao;
  meses: ProjecaoMes[];
  saldoFinal: number;
  piorMes: { mesIdx: number; rotulo: string; saldo: number } | null;
  primeiroMesNegativo: { mesIdx: number; rotulo: string } | null;
  primeiroMesRecuperado: { mesIdx: number; rotulo: string } | null;
}

export interface ProjecaoResult {
  meses: number;
  saldoInicial: number;
  cenarios: ProjecaoCenarioResult[];
}

/** Cenários default quando o usuário não informa. */
export function defaultCenarios(): CenarioProjecao[] {
  return [
    { nome: "Base", receitaDelta: 0, folhaDelta: 0 },
    { nome: "Otimista", receitaDelta: +0.1, folhaDelta: 0 },
    { nome: "Pessimista", receitaDelta: -0.1, folhaDelta: +0.05 },
  ];
}

function projectScenario(
  state: AppState,
  meses: number,
  cenario: CenarioProjecao,
): ProjecaoCenarioResult {
  const cf = buildCashFlow(state, resolveEffectiveRegime(state));
  // Saldo inicial da projeção = saldo final do ano-base (último mês conhecido).
  const saldoInicialProj = cf.saldoFinal[11];

  // Amortizações geradas pelas captações.
  const extraAmort = new Array(meses + 1).fill(0);
  const extraCapt = new Array(meses + 1).fill(0);
  for (const cap of cenario.capturasDivida ?? []) {
    if (cap.mes < 1 || cap.mes > meses || cap.prazoDevolucao <= 0) continue;
    extraCapt[cap.mes] += cap.valor;
    const parcela = cap.valor / cap.prazoDevolucao;
    for (let k = 1; k <= cap.prazoDevolucao; k++) {
      const m = cap.mes + k;
      if (m <= meses) extraAmort[m] += parcela;
    }
  }

  // Delta dos contratos de dívida existentes (corrige meses >12 que o ciclo de ano-base repete).
  const debtDelta = debtContractsDelta(state.capital?.debtContracts ?? [], meses);

  const meses_out: ProjecaoMes[] = [];
  let saldo = saldoInicialProj;
  for (let i = 1; i <= meses; i++) {
    const b = (i - 1) % 12;
    const rFator = 1 + deltaAt(cenario.receitaDelta, i);
    const fFator = 1 + deltaAt(cenario.folhaDelta, i);

    const recebimentos = cf.recebimentos[b] * rFator + cf.receitasFinanceiras[b];
    const pagamentos =
      cf.pagamentosFornecedores[b] * rFator +
      cf.pagamentosFixos[b] * fFator +
      cf.pagamentosVariaveis[b] * rFator +
      cf.pagamentosFinanceiros[b] +
      debtDelta.deltaJuros[i] +
      cf.pagamentosImpostos[b] * rFator;
    const capex = cf.capex[b];
    const financiamento =
      cf.aportes[b] +
      cf.emprestimosCaptados[b] +
      extraCapt[i] -
      cf.amortizacoes[b] -
      debtDelta.deltaAmort[i] -
      extraAmort[i] -
      cf.dividendos[b];

    const variacao = recebimentos - pagamentos - capex + financiamento;
    const saldoInicialMes = saldo;
    saldo = saldo + variacao;

    meses_out.push({
      mesIdx: i,
      rotulo: `M${String(i).padStart(2, "0")}`,
      recebimentos,
      pagamentos,
      capex,
      financiamento,
      variacao,
      saldoInicial: saldoInicialMes,
      saldoFinal: saldo,
    });
  }

  // Detecta pior mês e transições negativo↔positivo.
  let pior: ProjecaoCenarioResult["piorMes"] = null;
  let firstNeg: ProjecaoCenarioResult["primeiroMesNegativo"] = null;
  let firstRecov: ProjecaoCenarioResult["primeiroMesRecuperado"] = null;
  let seenNeg = false;
  for (const m of meses_out) {
    if (!pior || m.saldoFinal < pior.saldo) pior = { mesIdx: m.mesIdx, rotulo: m.rotulo, saldo: m.saldoFinal };
    if (!firstNeg && m.saldoFinal < 0) {
      firstNeg = { mesIdx: m.mesIdx, rotulo: m.rotulo };
      seenNeg = true;
    }
    if (seenNeg && !firstRecov && m.saldoFinal >= 0) {
      firstRecov = { mesIdx: m.mesIdx, rotulo: m.rotulo };
    }
  }

  return {
    cenario,
    meses: meses_out,
    saldoFinal: saldo,
    piorMes: pior,
    primeiroMesNegativo: firstNeg,
    primeiroMesRecuperado: firstRecov,
  };
}

/** Roda projeção para múltiplos cenários. */
export function projectCashflow(
  state: AppState,
  meses = 24,
  cenarios: CenarioProjecao[] = defaultCenarios(),
): ProjecaoResult {
  const cf = buildCashFlow(state, resolveEffectiveRegime(state));
  return {
    meses,
    saldoInicial: cf.saldoFinal[11],
    cenarios: cenarios.map((c) => projectScenario(state, meses, c)),
  };
}

// ============================================================
// Formatação markdown + spec finance-chart
// ============================================================


export function projectionToMarkdown(res: ProjecaoResult): string {
  const out: string[] = [];
  out.push(`## Projeção de Fluxo de Caixa — ${res.meses} meses`);
  out.push("");
  out.push(`Saldo inicial da projeção (fim do ano-base): **${fmtBRL(res.saldoInicial)}**.`);
  out.push("");

  // Tabela resumo por cenário.
  out.push("### Resumo por cenário");
  out.push("| Cenário | Saldo final | Pior mês | 1º mês negativo | Recuperação |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const c of res.cenarios) {
    out.push(
      `| ${c.cenario.nome} | ${fmtBRL(c.saldoFinal)} | ${c.piorMes ? `${c.piorMes.rotulo} (${fmtBRL(c.piorMes.saldo)})` : "—"} | ${c.primeiroMesNegativo?.rotulo ?? "—"} | ${c.primeiroMesRecuperado?.rotulo ?? "—"} |`,
    );
  }

  // Gráfico de linha (saldo por mês × cenários).
  const chart = {
    type: "line",
    title: `Saldo de caixa projetado — ${res.meses} meses`,
    labelKey: "mes",
    format: "currency",
    keys: res.cenarios.map((c) => c.cenario.nome),
    data: Array.from({ length: res.meses }, (_, i) => {
      const row: Record<string, string | number> = { mes: `M${String(i + 1).padStart(2, "0")}` };
      for (const c of res.cenarios) row[c.cenario.nome] = Number(c.meses[i].saldoFinal.toFixed(0));
      return row;
    }),
  };
  out.push("");
  out.push("```finance-chart");
  out.push(JSON.stringify(chart));
  out.push("```");

  // Alertas consolidados.
  const alertas: string[] = [];
  for (const c of res.cenarios) {
    if (c.primeiroMesNegativo)
      alertas.push(
        `🔴 **${c.cenario.nome}**: caixa fica negativo em **${c.primeiroMesNegativo.rotulo}**.`,
      );
    if (c.primeiroMesRecuperado)
      alertas.push(
        `🟢 **${c.cenario.nome}**: caixa recupera (≥ 0) em **${c.primeiroMesRecuperado.rotulo}**.`,
      );
  }
  if (alertas.length) {
    out.push("");
    out.push("### Alertas");
    for (const a of alertas) out.push(`- ${a}`);
  }

  // Tabela mensal (compacta) do cenário Base.
  const base = res.cenarios[0];
  if (base) {
    out.push("");
    out.push(`### Detalhe mensal — ${base.cenario.nome}`);
    out.push("| Mês | Recebimentos | Pagamentos | CAPEX | Financ. | Variação | Saldo final |");
    out.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const m of base.meses) {
      out.push(
        `| ${m.rotulo} | ${fmtBRL(m.recebimentos)} | ${fmtBRL(m.pagamentos)} | ${fmtBRL(m.capex)} | ${fmtBRL(m.financiamento)} | ${fmtBRL(m.variacao)} | ${fmtBRL(m.saldoFinal)} |`,
      );
    }
  }

  return out.join("\n");
}
