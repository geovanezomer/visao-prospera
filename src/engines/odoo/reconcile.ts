// ============================================================================
// Conciliação do retrato do Odoo com o que o app exibe, conta a conta.
//
// Recalcula, de forma independente do motor (computeActuals), o saldo de cada
// conta na janela da entidade e soma por linha da DRE e grupo do balanço.
// Compara com os valores que alimentam o app e devolve as diferenças, o teste
// do balancete (débitos = créditos) e o efeito das eliminações entre empresas.
// Exportável em CSV para o contador conferir no Excel.
// ============================================================================
import { aggregateAccounts, type OdooEntity, type OdooEntityData } from "./toAppState";
import { BS_BUCKET_LABELS, PL_LINE_LABELS, bsValue, plValue } from "./mapping";
import type { BsBucket, OdooSnapshot, PlLine } from "./types";

export type ReconAccountRow = {
  code: string;
  name: string;
  type: string;
  /** "DRE: Receita bruta", "Balanço: Caixa e bancos" ou "Não usada". */
  classificacao: string;
  /** Saldos no sinal do Odoo (débito +, crédito −), já sem operações internas. */
  saldoInicial: number;
  movimento: number;
  saldoFinal: number;
  /** Valor que a conta leva para o app (DRE: movimento da janela; balanço: saldo final). */
  valorApp: number | null;
  /** Saldo final eliminado por operações com outras empresas da seleção. */
  eliminado: number;
};

export type ReconLineRow = {
  grupo: "DRE" | "Balanço";
  key: PlLine | BsBucket;
  label: string;
  contas: number;
  /** Soma das contas calculada aqui. */
  somaContas: number;
  /** Valor que o app usa (realizado do motor). */
  valorApp: number;
  diferenca: number;
};

export type Reconciliation = {
  entidade: string;
  months: string[];
  accounts: ReconAccountRow[];
  lines: ReconLineRow[];
  /** Σ dos saldos finais de todas as contas, antes das eliminações: zero = balancete fecha. */
  balanceteDiferenca: number;
  /**
   * Efeito das eliminações no resultado da janela: zero quando a receita
   * interna de uma empresa bate com o custo/despesa da outra.
   */
  eliminacaoNoResultado: number;
  naoClassificadas: { contas: number; saldo: number };
  /** Resultado da janela pelo razão (receitas − custos, despesas e tributos). */
  lucroLiquido: number;
  maiorDiferenca: number;
  ok: boolean;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const TOL = 0.05;

export function reconcile(
  snapshot: OdooSnapshot,
  entity: OdooEntity,
  data: OdooEntityData,
): Reconciliation {
  const start = snapshot.months.indexOf(data.months[0]);
  const end = snapshot.months.indexOf(data.months[data.months.length - 1]);
  if (start < 0 || end < start) throw new Error("Janela da entidade fora do retrato.");

  const saldoAte = (opening: number, monthly: number[], last: number) => {
    let s = opening;
    for (let i = 0; i <= last; i++) s += monthly[i] ?? 0;
    return s;
  };

  // Soma bruta por conta (sem eliminar), para o teste do balancete e o efeito
  // das eliminações.
  const bruto = new Map<string, { ini: number; fim: number }>();
  let balancete = 0;
  for (const cid of entity.companyIds) {
    for (const a of snapshot.perCompany[String(cid)]?.accounts ?? []) {
      const ini = start > 0 ? saldoAte(a.opening, a.monthly, start - 1) : a.opening;
      const fim = saldoAte(a.opening, a.monthly, end);
      const cur = bruto.get(a.code) ?? { ini: 0, fim: 0 };
      bruto.set(a.code, { ini: cur.ini + ini, fim: cur.fim + fim });
      balancete += fim;
    }
  }

  const plSum = new Map<PlLine, { soma: number; contas: number }>();
  const bsSum = new Map<BsBucket, { soma: number; contas: number }>();
  const add = <K>(m: Map<K, { soma: number; contas: number }>, k: K, v: number) => {
    const cur = m.get(k) ?? { soma: 0, contas: 0 };
    m.set(k, { soma: cur.soma + v, contas: cur.contas + 1 });
  };

  let resultadoAcumulado = 0;
  let resultadoJanela = 0;
  let eliminacao = 0;
  const naoClass = { contas: 0, saldo: 0 };
  const accounts: ReconAccountRow[] = [];

  for (const a of aggregateAccounts(snapshot, entity.companyIds)) {
    const saldoInicial = start > 0 ? saldoAte(a.opening, a.monthly, start - 1) : a.opening;
    const saldoFinal = saldoAte(a.opening, a.monthly, end);
    const movimento = saldoFinal - saldoInicial;
    const b = bruto.get(a.code) ?? { ini: 0, fim: 0 };
    const eliminado = b.fim - saldoFinal;
    if (a.cls.kind === "pl") eliminacao += b.fim - b.ini - movimento;

    let classificacao = "Não usada";
    let valorApp: number | null = null;
    if (a.cls.kind === "pl") {
      classificacao = `DRE: ${PL_LINE_LABELS[a.cls.line]}`;
      valorApp = plValue(a.cls.line, movimento);
      add(plSum, a.cls.line, valorApp);
      // Resultado ainda não transferido ao PL compõe lucros acumulados.
      resultadoAcumulado -= saldoFinal;
      resultadoJanela -= movimento;
    } else if (a.cls.kind === "bs") {
      classificacao = `Balanço: ${BS_BUCKET_LABELS[a.cls.bucket]}`;
      valorApp = bsValue(a.cls.bucket, saldoFinal);
      add(bsSum, a.cls.bucket, valorApp);
    } else if (Math.abs(saldoFinal) > TOL || Math.abs(movimento) > TOL) {
      naoClass.contas += 1;
      naoClass.saldo += saldoFinal;
    }
    if (
      Math.abs(saldoInicial) < 0.005 &&
      Math.abs(movimento) < 0.005 &&
      Math.abs(eliminado) < 0.005
    )
      continue;
    accounts.push({
      code: a.code,
      name: a.name,
      type: a.type,
      classificacao,
      saldoInicial: r2(saldoInicial),
      movimento: r2(movimento),
      saldoFinal: r2(saldoFinal),
      valorApp: valorApp === null ? null : r2(valorApp),
      eliminado: r2(eliminado),
    });
  }
  accounts.sort((x, y) => x.code.localeCompare(y.code, "pt-BR", { numeric: true }));

  const lines: ReconLineRow[] = [];
  for (const [line, label] of Object.entries(PL_LINE_LABELS) as [PlLine, string][]) {
    const s = plSum.get(line) ?? { soma: 0, contas: 0 };
    const app = (data.actuals.pl[line] ?? []).reduce((x, y) => x + y, 0);
    if (!s.contas && Math.abs(app) < TOL) continue;
    lines.push(row("DRE", line, label, s.contas, s.soma, app));
  }
  for (const [bucket, label] of Object.entries(BS_BUCKET_LABELS) as [BsBucket, string][]) {
    const s = bsSum.get(bucket) ?? { soma: 0, contas: 0 };
    const soma = bucket === "lucros_acumulados" ? s.soma + resultadoAcumulado : s.soma;
    const app = data.actuals.closing[bucket] ?? 0;
    if (!s.contas && Math.abs(soma) < TOL && Math.abs(app) < TOL) continue;
    lines.push(row("Balanço", bucket, label, s.contas, soma, app));
  }

  const maiorDiferenca = Math.max(0, ...lines.map((l) => Math.abs(l.diferenca)));
  return {
    entidade: entity.label,
    months: data.months,
    accounts,
    lines,
    balanceteDiferenca: r2(balancete),
    // Lucro consolidado − soma dos lucros (débito +: movimento bruto − eliminado).
    eliminacaoNoResultado: r2(eliminacao),
    naoClassificadas: { contas: naoClass.contas, saldo: r2(naoClass.saldo) },
    lucroLiquido: r2(resultadoJanela),
    maiorDiferenca: r2(maiorDiferenca),
    ok: maiorDiferenca <= TOL && Math.abs(balancete) <= TOL,
  };
}

function row(
  grupo: ReconLineRow["grupo"],
  key: PlLine | BsBucket,
  label: string,
  contas: number,
  soma: number,
  app: number,
): ReconLineRow {
  return {
    grupo,
    key,
    label,
    contas,
    somaContas: r2(soma),
    valorApp: r2(app),
    diferenca: r2(app - soma),
  };
}

// ---------------------------------------------------------------------------
// CSV (Excel pt-BR: separador ";", vírgula decimal, BOM UTF-8)
// ---------------------------------------------------------------------------
const num = (v: number | null) =>
  v === null
    ? ""
    : v
        .toFixed(2)
        .replace(".", ",")
        .replace(/^-0,00$/, "0,00");
const cell = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function reconciliationCsv(r: Reconciliation, kind: "resumo" | "contas"): string {
  const periodo = `${r.months[0]} a ${r.months[r.months.length - 1]}`;
  const head = [
    `Conciliação Odoo × FinnancePRO;${cell(r.entidade)};${periodo}`,
    `Balancete (débitos − créditos);${num(r.balanceteDiferenca)}`,
    `Efeito das eliminações no resultado;${num(r.eliminacaoNoResultado)}`,
    `Contas não usadas com saldo;${r.naoClassificadas.contas};${num(r.naoClassificadas.saldo)}`,
    "",
  ];
  const body =
    kind === "resumo"
      ? [
          "Grupo;Linha;Contas;Soma das contas;Valor no app;Diferença",
          ...r.lines.map((l) =>
            [
              l.grupo,
              cell(l.label),
              l.contas,
              num(l.somaContas),
              num(l.valorApp),
              num(l.diferenca),
            ].join(";"),
          ),
        ]
      : [
          "Código;Conta;Tipo no Odoo;Classificação no app;Saldo inicial;Movimento;Saldo final;Valor no app;Eliminado",
          ...r.accounts.map((a) =>
            [
              cell(a.code),
              cell(a.name),
              cell(a.type),
              cell(a.classificacao),
              num(a.saldoInicial),
              num(a.movimento),
              num(a.saldoFinal),
              num(a.valorApp),
              num(a.eliminado),
            ].join(";"),
          ),
        ];
  return "﻿" + [...head, ...body].join("\r\n") + "\r\n";
}
