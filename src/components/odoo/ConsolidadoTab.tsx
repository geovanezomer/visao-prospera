// ============================================================================
// Consolidado do grupo + conciliação tributária (modo Odoo).
//
// Cada entidade fiscal (matriz + filiais) tem a DRE calculada pelo motor com
// o regime configurado PARA ELA (premissas salvas por entidade). O
// consolidado soma as entidades e elimina as operações entre empresas do
// grupo (receitas/custos/juros internos). Tributos não se eliminam: cada
// CNPJ recolhe os seus.
//
// A conciliação compara o que está contabilizado no Odoo com o que o motor
// calcula pelo regime — diferença relevante indica apuração ou premissa a
// revisar.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { Building2, Scale } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { buildFinancialModel } from "@/engines/finance/financialModel";
import { DEFAULT_STATE, validateAndMigrate } from "@/engines/finance/defaults";
import { loadKey } from "@/engines/finance/persistence";
import { fmtBRL } from "@/engines/finance/format";
import type { AppState } from "@/engines/finance/types";
import {
  applyOdooOverlay,
  buildEntityData,
  prepareOdooOverlay,
  suggestPremissas,
  type OdooActuals,
  type OdooEntity,
} from "@/engines/odoo/toAppState";
import type { OdooSnapshot } from "@/engines/odoo/types";
import { useOdooCockpitContext } from "./cockpit";
import { fmtMonth } from "./format";
import { cn } from "@/lib/utils";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

type Row = {
  receitaBruta: number;
  deducoes: number;
  receitaLiquida: number;
  cpv: number;
  lucroBruto: number;
  despesas: number;
  ebitda: number;
  depreciacao: number;
  financeiro: number;
  lair: number;
  impostosLucro: number;
  lucroLiquido: number;
};

const ROWS: Array<{ key: keyof Row; label: string; strong?: boolean; sign?: -1 }> = [
  { key: "receitaBruta", label: "Receita bruta", strong: true },
  { key: "deducoes", label: "(−) Deduções e impostos s/ vendas", sign: -1 },
  { key: "receitaLiquida", label: "Receita líquida", strong: true },
  { key: "cpv", label: "(−) CPV / CMV / CSP", sign: -1 },
  { key: "lucroBruto", label: "Lucro bruto", strong: true },
  { key: "despesas", label: "(−) Despesas operacionais", sign: -1 },
  { key: "ebitda", label: "EBITDA", strong: true },
  { key: "depreciacao", label: "(−) Depreciação", sign: -1 },
  { key: "financeiro", label: "Resultado financeiro" },
  { key: "lair", label: "LAIR", strong: true },
  { key: "impostosLucro", label: "(−) IRPJ / CSLL", sign: -1 },
  { key: "lucroLiquido", label: "Lucro líquido", strong: true },
];

function rowFromModel(state: AppState): {
  row: Row;
  vendas: number;
  lucro: number;
  regime: string;
} {
  const m = buildFinancialModel(state);
  const d = m.dre;
  const row: Row = {
    receitaBruta: sum(d.receitaBruta),
    deducoes: sum(d.deducoesInadimplencia) + sum(d.outrasDeducoes) + sum(d.impostosVendas),
    receitaLiquida: sum(d.receitaLiquida),
    cpv: sum(d.cpv),
    lucroBruto: sum(d.lucroBruto),
    despesas: sum(d.despesasOperacionais) - sum(d.outrasReceitasOperacionais),
    ebitda: sum(d.ebitda),
    depreciacao: sum(d.depreciacao),
    financeiro: sum(d.resultadoFinanceiro),
    lair: sum(d.lair),
    impostosLucro: sum(d.impostos),
    lucroLiquido: sum(d.lucroLiquido),
  };
  return { row, vendas: sum(d.impostosVendas), lucro: sum(d.impostos), regime: String(m.regime) };
}

/** Resultado contábil direto do Odoo (como lançado). */
function rowFromActuals(a: OdooActuals): Row {
  const p = a.pl;
  const s = (k: keyof typeof p) => sum(p[k]);
  const receitaLiquida = s("receita_bruta") - s("deducoes") - s("impostos_vendas");
  const lucroBruto = receitaLiquida - s("cpv");
  const despesas =
    s("pessoal_salarios") +
    s("pessoal_encargos") +
    s("pessoal_beneficios") +
    s("despesa_administrativa") +
    s("despesa_comercial") +
    s("outras_despesas") -
    s("outras_receitas");
  const ebitda = lucroBruto - despesas;
  const financeiro = s("receita_financeira") - s("despesa_financeira");
  const lair = ebitda - s("depreciacao") + financeiro;
  return {
    receitaBruta: s("receita_bruta"),
    deducoes: s("deducoes") + s("impostos_vendas"),
    receitaLiquida,
    cpv: s("cpv"),
    lucroBruto,
    despesas,
    ebitda,
    depreciacao: s("depreciacao"),
    financeiro,
    lair,
    impostosLucro: s("ir_csll"),
    lucroLiquido: lair - s("ir_csll"),
  };
}

const zeroRow = (): Row => Object.fromEntries(ROWS.map((r) => [r.key, 0])) as Row;
const addRows = (a: Row, b: Row): Row =>
  Object.fromEntries(ROWS.map((r) => [r.key, a[r.key] + b[r.key]])) as Row;
const subRows = (a: Row, b: Row): Row =>
  Object.fromEntries(ROWS.map((r) => [r.key, a[r.key] - b[r.key]])) as Row;

const REGIME_LABEL: Record<string, string> = {
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};

export function ConsolidadoTab() {
  const cockpit = useOdooCockpitContext();
  const { user } = useAuth();
  const liveState = useFinanceState();
  const snapshot = cockpit?.snapshot ?? null;
  const fiscal = useMemo(
    () => (cockpit?.entities ?? []).filter((e) => e.kind === "entity"),
    [cockpit?.entities],
  );
  const branches = useMemo(
    () => (cockpit?.entities ?? []).filter((e) => e.kind === "branch"),
    [cockpit?.entities],
  );
  const group = cockpit?.entities.find((e) => e.kind === "consolidated") ?? null;

  // Premissas salvas de cada entidade (regime etc.). A entidade aberta usa o
  // estado ao vivo, para refletir edições na hora.
  const [premissas, setPremissas] = useState<Record<string, AppState>>({});
  useEffect(() => {
    if (!snapshot) return;
    let alive = true;
    void (async () => {
      const out: Record<string, AppState> = {};
      for (const e of fiscal) {
        const raw = await loadKey<unknown>(
          `finnance:state:${user?.id ?? "guest"}:odoo:${cockpit?.instanceKey ?? "x"}:${e.key}`,
        );
        out[e.key] = raw
          ? validateAndMigrate(raw)
          : suggestPremissas(DEFAULT_STATE, buildEntityData(snapshot, e, null));
      }
      if (alive) setPremissas(out);
    })();
    return () => {
      alive = false;
    };
  }, [fiscal, user?.id, snapshot, cockpit?.instanceKey]);

  const endMonth = cockpit?.endMonth ?? null;
  const result = useMemo(() => {
    if (!snapshot) return null;
    // Janela comum a todas as entidades: a escolhida na barra ou, por padrão,
    // a do grupo (menor data de bloqueio entre as empresas).
    const anchor = group ?? cockpit?.entity ?? fiscal[0];
    const commonEnd =
      endMonth ?? (anchor ? buildEntityData(snapshot, anchor, null).months.at(-1) : null) ?? null;
    const perEntity = fiscal.map((e) => {
      const data = buildEntityData(snapshot, e, commonEnd);
      const base =
        e.key === cockpit?.entity?.key
          ? liveState
          : (premissas[e.key] ?? suggestPremissas(DEFAULT_STATE, data));
      const state = applyOdooOverlay(base, prepareOdooOverlay(data));
      const calc = rowFromModel(state);
      const contabil = rowFromActuals(data.actuals);
      return { entity: e, data, calc, contabil };
    });
    let elim: Row | null = null;
    let consolidated: Row | null = null;
    if (group) {
      const gData = buildEntityData(snapshot, group, commonEnd);
      const sumContabil = perEntity.reduce((acc, x) => addRows(acc, x.contabil), zeroRow());
      // Eliminações = soma das entidades − grupo (contábil). Tributos não se eliminam.
      elim = subRows(sumContabil, rowFromActuals(gData.actuals));
      elim.impostosLucro = 0;
      elim.deducoes = 0;
      const recomputed: Row = { ...elim };
      recomputed.receitaLiquida = elim.receitaBruta - elim.deducoes;
      recomputed.lucroBruto = recomputed.receitaLiquida - elim.cpv;
      recomputed.ebitda = recomputed.lucroBruto - elim.despesas;
      recomputed.lair = recomputed.ebitda - elim.depreciacao + elim.financeiro;
      recomputed.lucroLiquido = recomputed.lair;
      elim = recomputed;
      const sumCalc = perEntity.reduce((acc, x) => addRows(acc, x.calc.row), zeroRow());
      consolidated = subRows(sumCalc, elim);
    }
    const months = perEntity[0]?.data.months ?? [];
    return { perEntity, elim, consolidated, months, commonEnd };
  }, [snapshot, fiscal, group, endMonth, premissas, liveState, cockpit?.entity]);

  if (!cockpit?.active || !snapshot || !result) {
    return (
      <div className="rounded-lg border border-border/60 p-6 text-sm text-muted-foreground">
        Disponível no modo Odoo, depois da primeira sincronização.
      </div>
    );
  }

  const { perEntity, elim, consolidated, months } = result;
  const period = months.length
    ? `${fmtMonth(months[0])} a ${fmtMonth(months[months.length - 1])}`
    : "";

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border/60 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4" /> DRE por entidade e consolidado — {period}
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Tributos calculados pelo regime de cada CNPJ (defina em “Regime Tributário” com a entidade
          selecionada). Eliminações: vendas, serviços e juros entre empresas do grupo.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-border/60 text-right">
                <th className="p-2 text-left font-medium">R$ (12 meses)</th>
                {perEntity.map((x) => (
                  <th key={x.entity.key} className="p-2 font-medium">
                    <div className="truncate" title={x.entity.label}>
                      {x.entity.label.replace(" (matriz + filiais)", "")}
                    </div>
                    <div className="font-normal text-muted-foreground">
                      {REGIME_LABEL[x.calc.regime] ?? x.calc.regime}
                    </div>
                  </th>
                ))}
                {elim && <th className="p-2 font-medium text-amber-600">Eliminações</th>}
                {consolidated && <th className="p-2 font-semibold">Consolidado</th>}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr
                  key={r.key}
                  className={cn("border-b border-border/20", r.strong && "font-semibold")}
                >
                  <td className="p-2">{r.label}</td>
                  {perEntity.map((x) => (
                    <td key={x.entity.key} className="p-2 text-right tabular-nums">
                      {fmtBRL(x.calc.row[r.key])}
                    </td>
                  ))}
                  {elim && (
                    <td className="p-2 text-right tabular-nums text-amber-600">
                      {elim[r.key] ? fmtBRL(-elim[r.key]) : "—"}
                    </td>
                  )}
                  {consolidated && (
                    <td
                      className={cn(
                        "p-2 text-right tabular-nums",
                        r.key === "lucroLiquido" &&
                          (consolidated.lucroLiquido >= 0
                            ? "text-emerald-600"
                            : "text-destructive"),
                      )}
                    >
                      {fmtBRL(consolidated[r.key])}
                    </td>
                  )}
                </tr>
              ))}
              <tr className="text-muted-foreground">
                <td className="p-2">Lucro líquido contábil (Odoo)</td>
                {perEntity.map((x) => (
                  <td key={x.entity.key} className="p-2 text-right tabular-nums">
                    {fmtBRL(x.contabil.lucroLiquido)}
                  </td>
                ))}
                {elim && <td />}
                {consolidated && (
                  <td className="p-2 text-right tabular-nums">
                    {fmtBRL(
                      perEntity.reduce((s, x) => s + x.contabil.lucroLiquido, 0) -
                        (elim?.lucroLiquido ?? 0),
                    )}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4" /> Conciliação tributária — contabilizado × calculado
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Diferenças acima de 5% merecem revisão: regime ou alíquotas configurados aqui, ou a
          apuração lançada no ERP. No Presumido/Real trimestral, o IRPJ/CSLL contabilizado no fim do
          trimestre cobre o trimestre inteiro: para comparar períodos iguais, escolha um mês final
          de fim de trimestre (mar, jun, set, dez).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b border-border/60 text-right">
                <th className="p-2 text-left font-medium">Entidade</th>
                <th className="p-2 font-medium">Tributo</th>
                <th className="p-2 font-medium">Odoo</th>
                <th className="p-2 font-medium">Calculado</th>
                <th className="p-2 font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {perEntity.flatMap((x) =>
                [
                  {
                    label: "Sobre vendas",
                    odoo: x.data.taxReconciliation.impostosVendasOdoo,
                    calc: x.calc.vendas,
                  },
                  {
                    label: "IRPJ + CSLL",
                    odoo: x.data.taxReconciliation.irCsllOdoo,
                    calc: x.calc.lucro,
                  },
                ].map((t) => {
                  const diff = t.calc - t.odoo;
                  const pct = t.odoo ? diff / t.odoo : t.calc ? 1 : 0;
                  return (
                    <tr
                      key={`${x.entity.key}:${t.label}`}
                      className="border-b border-border/20 text-right"
                    >
                      <td className="p-2 text-left">
                        {x.entity.label.replace(" (matriz + filiais)", "")}
                      </td>
                      <td className="p-2">{t.label}</td>
                      <td className="p-2 tabular-nums">{fmtBRL(t.odoo)}</td>
                      <td className="p-2 tabular-nums">{fmtBRL(t.calc)}</td>
                      <td
                        className={cn(
                          "p-2 tabular-nums",
                          Math.abs(pct) > 0.05 ? "text-amber-600 font-medium" : "text-emerald-600",
                        )}
                      >
                        {fmtBRL(diff)} ({(pct * 100).toFixed(1)}%)
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {branches.length > 0 && (
        <BranchesSection branches={branches} snapshot={snapshot} endMonth={result.commonEnd} />
      )}
    </div>
  );
}

function BranchesSection({
  branches,
  snapshot,
  endMonth,
}: {
  branches: OdooEntity[];
  snapshot: OdooSnapshot;
  endMonth: string | null;
}) {
  const rows = branches.map((b) => ({
    b,
    r: rowFromActuals(buildEntityData(snapshot, b, endMonth).actuals),
  }));
  return (
    <section className="rounded-lg border border-border/60 p-4">
      <h3 className="mb-1 text-sm font-semibold">
        Filiais — visão gerencial (contábil, antes de IR/CSLL)
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Filial não é contribuinte separado de IRPJ/CSLL: o imposto sobre o lucro é apurado no CNPJ
        da matriz.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 text-right">
            <th className="p-2 text-left font-medium">Filial</th>
            <th className="p-2 font-medium">Receita bruta</th>
            <th className="p-2 font-medium">Lucro bruto</th>
            <th className="p-2 font-medium">EBITDA</th>
            <th className="p-2 font-medium">Margem EBITDA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ b, r }) => (
            <tr key={b.key} className="border-b border-border/20 text-right tabular-nums">
              <td className="p-2 text-left">
                {b.label.replace(" (filial — visão gerencial)", "")}
              </td>
              <td className="p-2">{fmtBRL(r.receitaBruta)}</td>
              <td className="p-2">{fmtBRL(r.lucroBruto)}</td>
              <td className="p-2">{fmtBRL(r.ebitda)}</td>
              <td className="p-2">
                {r.receitaBruta ? `${((r.ebitda / r.receitaBruta) * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
