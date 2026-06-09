import { AppState, RevenueDeducao } from "@/lib/finance/types";
import { fmtBRL, fmtBRLCompact, fmtPct, MESES, sum, fill12, zeros12 } from "@/lib/finance/format";
import { MoneyInput, StatCard, SectionTitle } from "./primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { PrazoTable } from "./PrazoTable";

function uid(prefix = "r"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nonZero = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nonZero as number) ? (nonZero as number) : (values[0] || 0);
}

// Linha unificada — Receita Bruta, Inadimplência (R$) ou deduções customizadas
type RowKind = "bruta" | "inadimplencia" | "deducao";
type Row = {
  id: string;
  kind: RowKind;
  label: string;
  values: number[]; // sempre em R$
  fixed: boolean;
  editableLabel: boolean;
  removable: boolean;
  tone: "pos" | "neg";
  dedId?: string;
};

export function RevenueTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const r = state.revenue;
  const deducoes: RevenueDeducao[] = r.deducoes ?? [];

  // Derivações
  const inadimpBRL = r.bruta.map((b, i) => b * ((r.inadimplencia[i] || 0) / 100));
  const outras = MESES.map((_, i) => deducoes.reduce((acc, d) => acc + Math.max(0, d.valores?.[i] || 0), 0));
  const liquidas = r.bruta.map((b, i) => Math.max(0, b - inadimpBRL[i] - outras[i]));

  const brutaAnual = sum(r.bruta);
  const inadimpAnual = sum(inadimpBRL);
  const outrasAnual = sum(outras);
  const deducoesAnual = inadimpAnual + outrasAnual;
  const liqAnual = sum(liquidas);

  // Média mensal YTD — considera apenas meses com receita bruta > 0
  const monthsWithRevenue = liquidas.filter((_, i) => r.bruta[i] > 0).length;
  const mediaYTD = monthsWithRevenue > 0 ? liqAnual / monthsWithRevenue : 0;

  const ciclo = r.pmr - r.pmp;
  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);

  // ===== Construir lista unificada de linhas =====
  const rows: Row[] = [
    {
      id: "row_bruta",
      kind: "bruta",
      label: "Receita Bruta",
      values: r.bruta,
      fixed: !!r.brutaFixa,
      editableLabel: false,
      removable: false,
      tone: "pos",
    },
    {
      id: "row_inad",
      kind: "inadimplencia",
      label: "Devoluções e Cancelamentos",
      values: inadimpBRL,
      fixed: !!r.inadimplenciaFixa,
      editableLabel: false,
      removable: false,
      tone: "neg",
    },
    ...deducoes.map<Row>((d) => ({
      id: `row_${d.id}`,
      kind: "deducao",
      label: d.label || "",
      values: d.valores,
      fixed: !!d.fixed,
      editableLabel: true,
      removable: true,
      tone: "neg",
      dedId: d.id,
    })),
  ];

  // ===== Handlers =====
  const setMonth = (row: Row, i: number, v: number) => {
    const safe = Math.max(0, Number.isFinite(v) ? v : 0);
    if (row.kind === "bruta") {
      update((s) => ({ ...s, revenue: { ...s.revenue, bruta: s.revenue.bruta.map((x, j) => (j === i ? safe : x)) } }));
    } else if (row.kind === "inadimplencia") {
      update((s) => {
        const base = s.revenue.bruta[i] || 0;
        const pct = base > 0 ? (safe / base) * 100 : 0;
        return { ...s, revenue: { ...s.revenue, inadimplencia: s.revenue.inadimplencia.map((x, j) => (j === i ? pct : x)) } };
      });
    } else if (row.kind === "deducao" && row.dedId) {
      const dedId = row.dedId;
      update((s) => ({
        ...s,
        revenue: {
          ...s.revenue,
          deducoes: (s.revenue.deducoes ?? []).map((d) =>
            d.id === dedId ? { ...d, valores: d.valores.map((x, j) => (j === i ? safe : x)) } : d,
          ),
        },
      }));
    }
  };

  const setAllMonths = (row: Row, v: number) => {
    const safe = Math.max(0, Number.isFinite(v) ? v : 0);
    if (row.kind === "bruta") {
      update((s) => ({ ...s, revenue: { ...s.revenue, bruta: fill12(safe) } }));
    } else if (row.kind === "inadimplencia") {
      update((s) => {
        const base = fixedBase(s.revenue.bruta) || sum(s.revenue.bruta) / 12 || 0;
        const pct = base > 0 ? (safe / base) * 100 : 0;
        return { ...s, revenue: { ...s.revenue, inadimplencia: fill12(pct) } };
      });
    } else if (row.kind === "deducao" && row.dedId) {
      const dedId = row.dedId;
      update((s) => ({
        ...s,
        revenue: {
          ...s.revenue,
          deducoes: (s.revenue.deducoes ?? []).map((d) =>
            d.id === dedId ? { ...d, valores: fill12(safe) } : d,
          ),
        },
      }));
    }
  };

  const setFixed = (row: Row, fixed: boolean) => {
    if (row.kind === "bruta") {
      update((s) => {
        const base = fixed ? fixedBase(s.revenue.bruta) : s.revenue.bruta[0] || 0;
        return {
          ...s,
          revenue: { ...s.revenue, brutaFixa: fixed, bruta: fixed ? fill12(base) : s.revenue.bruta },
        };
      });
    } else if (row.kind === "inadimplencia") {
      update((s) => {
        const base = fixed ? fixedBase(s.revenue.inadimplencia) : s.revenue.inadimplencia[0] || 0;
        return {
          ...s,
          revenue: {
            ...s.revenue,
            inadimplenciaFixa: fixed,
            inadimplencia: fixed ? fill12(base) : s.revenue.inadimplencia,
          },
        };
      });
    } else if (row.kind === "deducao" && row.dedId) {
      const dedId = row.dedId;
      update((s) => ({
        ...s,
        revenue: {
          ...s.revenue,
          deducoes: (s.revenue.deducoes ?? []).map((d) => {
            if (d.id !== dedId) return d;
            const base = fixed ? fixedBase(d.valores) : d.valores[0] || 0;
            return { ...d, fixed, valores: fixed ? fill12(base) : d.valores };
          }),
        },
      }));
    }
  };

  const setLabel = (row: Row, label: string) => {
    if (row.kind !== "deducao" || !row.dedId) return;
    const dedId = row.dedId;
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: (s.revenue.deducoes ?? []).map((d) => (d.id === dedId ? { ...d, label } : d)),
      },
    }));
  };

  const removeRow = (row: Row) => {
    if (!row.dedId) return;
    const dedId = row.dedId;
    update((s) => ({
      ...s,
      revenue: { ...s.revenue, deducoes: (s.revenue.deducoes ?? []).filter((d) => d.id !== dedId) },
    }));
  };

  const addDeducao = () =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: [...(s.revenue.deducoes ?? []), { id: uid("ded"), label: "", valores: zeros12(), fixed: false }],
      },
    }));

  return (
    <div className="space-y-6">
      {/* Sumário */}
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard
          label="Receita Bruta Anual"
          value={fmtBRL(brutaAnual)}
          tone="pos"
          hint={{ description: "Total faturado no ano antes de qualquer dedução.", formula: "Σ Receita Bruta dos 12 meses" }}
        />
        <StatCard
          label="Deduções da Receita"
          value={fmtBRL(deducoesAnual)}
          tone="neg"
          sub={fmtPct(pctRec(deducoesAnual)) + " da receita"}
          hint={{ description: "Inadimplência + deduções customizadas (devoluções, descontos, abatimentos).", formula: "Inadimplência + Σ Deduções customizadas" }}
        />
        <StatCard
          label="Receita Líquida"
          value={fmtBRL(liqAnual)}
          tone="pos"
          sub={fmtPct(pctRec(liqAnual)) + " da receita"}
          hint={{ description: "Receita após inadimplência e deduções. Impostos sobre venda são abatidos depois, na DRE.", formula: "Receita Bruta − Deduções da Receita" }}
        />
        <StatCard
          label="Média Mensal YTD"
          value={fmtBRL(mediaYTD)}
          sub={`${monthsWithRevenue} ${monthsWithRevenue === 1 ? "mês" : "meses"} com receita`}
          hint="Média mensal da Receita Líquida considerando apenas meses com receita bruta lançada."
        />
      </div>

      {/* Receita mensal — clone visual da CostsTab */}
      <SectionBlock
        title="Receita Mensal — 12 meses"
        hint="Receita Bruta, inadimplência (R$) e deduções customizadas. Use o toggle de Modo para aplicar o mesmo valor em todos os meses."
        accentClass="border-l-[color:var(--success)]"
        onAdd={addDeducao}
      >
        <RevenueTable
          rows={rows}
          brutaAnual={brutaAnual}
          liquidas={liquidas}
          liqAnual={liqAnual}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeRow}
        />
      </SectionBlock>

      {/* Prazos médios */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <SectionTitle hint="Prazo Médio de Recebimento e de Pagamento, em dias.">Prazos médios</SectionTitle>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground">PMR — Recebimento (dias)</label>
            <NumInput integer min={0} value={r.pmr} onChange={(n) => update((s) => ({ ...s, revenue: { ...s.revenue, pmr: n } }))} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">PMP — Pagamento (dias)</label>
            <NumInput integer min={0} value={r.pmp} onChange={(n) => update((s) => ({ ...s, revenue: { ...s.revenue, pmp: n } }))} className="mt-1" />
          </div>
          <div className="rounded-md bg-accent/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Ciclo financeiro:</span>{" "}
            <span className={ciclo > 30 ? "text-warn" : ciclo > 0 ? "text-foreground" : "text-pos"}>{ciclo} dias</span> —{" "}
            {ciclo > 0 ? "empresa financia o cliente." : "fornecedor financia a empresa."}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBlock({
  title,
  hint,
  accentClass,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  accentClass: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border/60 border-l-4 bg-card/40 ${accentClass}`}>
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <Button size="sm" variant="outline" onClick={onAdd} className="h-7 text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
        </Button>
      </div>
      <div className="space-y-4 p-2">{children}</div>
    </div>
  );
}

function RevenueTable({
  rows,
  brutaAnual,
  liquidas,
  liqAnual,
  onMonth,
  onAllMonths,
  onFixed,
  onLabel,
  onRemove,
}: {
  rows: Row[];
  brutaAnual: number;
  liquidas: number[];
  liqAnual: number;
  onMonth: (row: Row, i: number, v: number) => void;
  onAllMonths: (row: Row, v: number) => void;
  onFixed: (row: Row, fixed: boolean) => void;
  onLabel: (row: Row, label: string) => void;
  onRemove: (row: Row) => void;
}) {
  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[1200px] text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-56 px-3 py-2">Rubrica</th>
            <th className="w-24 px-2 py-2 text-center">Modo</th>
            {MESES.map((m) => (
              <th key={m} className="px-1 py-2 text-right">{m}</th>
            ))}
            <th className="px-3 py-2 text-right">Anual</th>
            <th className="w-14 px-2 py-2 text-right">% Rec</th>
            <th className="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const anual = sum(row.values);
            const pct = pctRec(anual);
            const toneClass = row.tone === "pos" ? "text-pos" : anual > 0 ? "text-neg" : "text-muted-foreground";
            const anualDisplay = row.tone === "neg" && anual > 0 ? `− ${fmtBRL(anual)}` : fmtBRL(anual);
            return (
              <tr key={row.id} className="border-t border-border/40 align-middle">
                <td className="px-3 py-2">
                  {row.editableLabel ? (
                    <input
                      value={row.label}
                      onChange={(e) => onLabel(row, e.target.value)}
                      placeholder="Ex: Inadimplência"
                      className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  ) : (
                    <span className="text-xs">{row.label}</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>Fixo</span>
                    <Switch checked={!row.fixed} onCheckedChange={(v) => onFixed(row, !v)} />
                    <span>Mensal</span>
                  </div>
                </td>
                {row.fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                      <div className="w-36">
                        <MoneyInput value={fixedBase(row.values)} onChange={(n) => onAllMonths(row, n)} />
                      </div>
                    </div>
                  </td>
                ) : (
                  row.values.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => onMonth(row, i, n)} />
                    </td>
                  ))
                )}
                <td className={`num px-3 py-2 text-right ${toneClass}`}>{anualDisplay}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pct)}</td>
                <td className="px-1 py-2 text-center">
                  {row.removable && (
                    <button
                      onClick={() => onRemove(row)}
                      title="Remover linha"
                      className="text-muted-foreground transition hover:text-neg"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}

          {/* Receita Líquida */}
          <tr className="border-t border-border/40 bg-accent/20 align-middle">
            <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>Receita Líquida</td>
            {liquidas.map((v, i) => (
              <td key={i} className="num px-1 py-2 text-right text-[11px] text-pos">{fmtBRLCompact(v)}</td>
            ))}
            <td className="num px-3 py-2 text-right font-semibold text-pos">{fmtBRL(liqAnual)}</td>
            <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pctRec(liqAnual))}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
