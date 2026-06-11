import { AppState, RevenueDeducao } from "@/lib/finance/types";
import { fmtBRL, fmtBRLCompact, fmtPct, MESES, sum, fill12 } from "@/lib/finance/format";
import { MoneyInput, StatCard, SectionTitle } from "./primitives";
import { Switch } from "@/components/ui/switch";
import { PrazoTable } from "./PrazoTable";

function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nonZero = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nonZero as number) ? (nonZero as number) : (values[0] || 0);
}

type RowKind = "bruta" | "inadimplencia" | "deducao" | "financeira";
type Row = {
  id: string;
  kind: RowKind;
  /** id da dedução em revenue.deducoes (quando kind = "deducao") */
  dedId?: string;
  /** id da receita financeira em revenue.receitasFinanceiras (quando kind = "financeira") */
  finId?: string;
  label: string;
  values: number[];
  fixed: boolean;
  tone: "pos" | "neg";
};

export function RevenueTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const r = state.revenue;

  const inadimpBRL = r.bruta.map((b, i) => b * ((r.inadimplencia[i] || 0) / 100));
  const findDed = (id: string): RevenueDeducao | undefined => r.deducoes?.find((d) => d.id === id);
  const descDed = findDed("desc_incond") ?? { id: "desc_incond", label: "Descontos Incondicionais", valores: fill12(0), fixed: true };
  const abatDed = findDed("abatimentos") ?? { id: "abatimentos", label: "Abatimentos", valores: fill12(0), fixed: true };

  const usaPDD = !!r.inadimplenciaComoPDD;
  const liquidas = r.bruta.map((b, i) => {
    const dedNormal = (descDed.valores[i] || 0) + (abatDed.valores[i] || 0);
    // Se PDD, a inadimplência não reduz a Receita Líquida (vira despesa operacional na DRE)
    const inad = usaPDD ? 0 : inadimpBRL[i];
    return Math.max(0, b - inad - dedNormal);
  });

  const brutaAnual = sum(r.bruta);
  const inadimpAnual = sum(inadimpBRL);
  const descAnual = sum(descDed.valores);
  const abatAnual = sum(abatDed.valores);
  const deducoesAnual = (usaPDD ? 0 : inadimpAnual) + descAnual + abatAnual;
  const liqAnual = sum(liquidas);

  const monthsWithRevenue = liquidas.filter((_, i) => r.bruta[i] > 0).length;
  const mediaYTD = monthsWithRevenue > 0 ? liqAnual / monthsWithRevenue : 0;

  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);

  const rows: Row[] = [
    { id: "row_bruta", kind: "bruta", label: "Receita Bruta", values: r.bruta, fixed: !!r.brutaFixa, tone: "pos" },
    { id: "row_inad", kind: "inadimplencia", label: "Devoluções e Cancelamentos", values: inadimpBRL, fixed: !!r.inadimplenciaFixa, tone: "neg" },
    { id: "row_desc", kind: "deducao", dedId: "desc_incond", label: "Descontos Incondicionais", values: descDed.valores, fixed: !!descDed.fixed, tone: "neg" },
    { id: "row_abat", kind: "deducao", dedId: "abatimentos", label: "Abatimentos", values: abatDed.valores, fixed: !!abatDed.fixed, tone: "neg" },
  ];

  if (usaPDD) {
    const pddRec = r.pddReversaoMensal ?? fill12(0);
    rows.push({
      id: "row_pdd_rec",
      kind: "deducao", // Reuso do kind deducao para simplificar update
      dedId: "pdd_rec",
      label: "Recuperação de Inadimplência (+)",
      values: pddRec,
      fixed: false, // Pode ser customizado
      tone: "pos"
    });
  }

  const updateDed = (id: string, label: string, mut: (d: RevenueDeducao) => RevenueDeducao) =>
    update((s) => {
      const list = s.revenue.deducoes ?? [];
      const exists = list.find((d) => d.id === id);
      const base: RevenueDeducao = exists ?? { id, label, valores: fill12(0), fixed: true };
      const next = mut(base);
      const newList = exists ? list.map((d) => (d.id === id ? next : d)) : [...list, next];
      return { ...s, revenue: { ...s.revenue, deducoes: newList } };
    });

  const updateFin = (id: string, label: string, mut: (d: RevenueDeducao) => RevenueDeducao) =>
    update((s) => {
      const list = s.revenue.receitasFinanceiras ?? [];
      const exists = list.find((d) => d.id === id);
      const base: RevenueDeducao = exists ?? { id, label, valores: fill12(0), fixed: true };
      const next = mut(base);
      const newList = exists ? list.map((d) => (d.id === id ? next : d)) : [...list, next];
      return { ...s, revenue: { ...s.revenue, receitasFinanceiras: newList } };
    });

  const finList = r.receitasFinanceiras ?? [];
  const findFin = (id: string, label: string): RevenueDeducao =>
    finList.find((d) => d.id === id) ?? { id, label, valores: fill12(0), fixed: true };
  const rendAplic = findFin("rend_aplic", "Rendimento de aplicações");
  const alugueis = findFin("alugueis", "Aluguéis Recebidos");
  const vendaAtivos = findFin("venda_ativos", "Venda de Ativos");
  const finRows: Row[] = [
    { id: "row_rend", kind: "financeira", finId: "rend_aplic", label: "Rendimento de aplicações", values: rendAplic.valores, fixed: !!rendAplic.fixed, tone: "pos" },
    { id: "row_alug", kind: "financeira", finId: "alugueis", label: "Aluguéis Recebidos", values: alugueis.valores, fixed: !!alugueis.fixed, tone: "pos" },
    { id: "row_vatv", kind: "financeira", finId: "venda_ativos", label: "Venda de Ativos", values: vendaAtivos.valores, fixed: !!vendaAtivos.fixed, tone: "pos" },
  ];

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
      if (row.dedId === "pdd_rec") {
        update((s) => ({ ...s, revenue: { ...s.revenue, pddReversaoMensal: (s.revenue.pddReversaoMensal || fill12(0)).map((x, j) => (j === i ? safe : x)) } }));
      } else {
        updateDed(row.dedId, row.label, (d) => ({ ...d, valores: d.valores.map((x, j) => (j === i ? safe : x)) }));
      }
    } else if (row.kind === "financeira" && row.finId) {
      updateFin(row.finId, row.label, (d) => ({ ...d, valores: d.valores.map((x, j) => (j === i ? safe : x)) }));
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
      updateDed(row.dedId, row.label, (d) => ({ ...d, valores: fill12(safe) }));
    } else if (row.kind === "financeira" && row.finId) {
      updateFin(row.finId, row.label, (d) => ({ ...d, valores: fill12(safe) }));
    }
  };

  const setFixed = (row: Row, fixed: boolean) => {
    if (row.kind === "bruta") {
      update((s) => {
        const base = fixed ? fixedBase(s.revenue.bruta) : s.revenue.bruta[0] || 0;
        return { ...s, revenue: { ...s.revenue, brutaFixa: fixed, bruta: fixed ? fill12(base) : s.revenue.bruta } };
      });
    } else if (row.kind === "inadimplencia") {
      update((s) => {
        const base = fixed ? fixedBase(s.revenue.inadimplencia) : s.revenue.inadimplencia[0] || 0;
        return {
          ...s,
          revenue: { ...s.revenue, inadimplenciaFixa: fixed, inadimplencia: fixed ? fill12(base) : s.revenue.inadimplencia },
        };
      });
    } else if (row.kind === "deducao" && row.dedId) {
      updateDed(row.dedId, row.label, (d) => {
        const base = fixed ? fixedBase(d.valores) : d.valores[0] || 0;
        return { ...d, fixed, valores: fixed ? fill12(base) : d.valores };
      });
    } else if (row.kind === "financeira" && row.finId) {
      updateFin(row.finId, row.label, (d) => {
        const base = fixed ? fixedBase(d.valores) : d.valores[0] || 0;
        return { ...d, fixed, valores: fixed ? fill12(base) : d.valores };
      });
    }
  };

  return (
    <div className="space-y-6">
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
          hint={{ description: "Devoluções, cancelamentos, descontos incondicionais e abatimentos.", formula: "Devoluções + Descontos Incondicionais + Abatimentos" }}
        />
        <StatCard
          label="Receita Operacional"
          value={fmtBRL(liqAnual)}
          tone="pos"
          sub={fmtPct(pctRec(liqAnual)) + " da receita"}
          hint={{ description: "Receita após deduções (devoluções, cancelamentos, descontos e abatimentos). Os impostos sobre venda são abatidos depois, na DRE — só então temos a Receita Líquida contábil.", formula: "Receita Bruta − Deduções da Receita" }}
        />
        <StatCard
          label="Média Mensal YTD"
          value={fmtBRL(mediaYTD)}
          sub={`${monthsWithRevenue} ${monthsWithRevenue === 1 ? "mês" : "meses"} com receita`}
          hint="Média mensal da Receita Operacional considerando apenas meses com receita bruta lançada."
        />
      </div>

      <SectionBlock
        title="Receita Mensal — 12 meses"
        hint="Receita Bruta e deduções (em R$). Use o toggle de Modo para aplicar o mesmo valor em todos os meses."
        accentClass="border-l-[color:var(--success)]"
      >
        <RevenueTable
          rows={rows}
          brutaAnual={brutaAnual}
          footer={{ label: "Receita Operacional", values: liquidas, total: liqAnual, tone: "pos" }}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
        />
      </SectionBlock>

      <SectionBlock
        title="Receitas Financeiras — 12 meses"
        hint="Rendimentos de aplicações, aluguéis recebidos e venda de ativos. Não compõem a Receita Operacional."
        accentClass="border-l-[color:var(--success)]"
      >
        <RevenueTable
          rows={finRows}
          brutaAnual={brutaAnual}
          footer={{
            label: "Total Receitas Financeiras",
            values: MESES.map((_, i) => finRows.reduce((a, r) => a + (r.values[i] || 0), 0)),
            total: finRows.reduce((a, r) => a + sum(r.values), 0),
            tone: "pos",
          }}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
        />
      </SectionBlock>

      <PrazoTable
        title="Prazo Médio de Recebimento (PMR) — 12 meses"
        hint="Dias entre faturar e receber do cliente. Pode variar por mês conforme sazonalidade, mix de clientes ou política comercial."
        accentClass="border-l-[color:var(--success)]"
        rubrica="PMR — Recebimento (dias)"
        summaryLabel="PMR"
        values={r.pmrMensal ?? fill12(r.pmr || 0)}
        fixed={!!r.pmrFixo}
        onMonth={(i, v) =>
          update((s) => {
            const base = s.revenue.pmrMensal ?? fill12(s.revenue.pmr || 0);
            const next = base.map((x, j) => (j === i ? v : x));
            const media = Math.round(next.reduce((a, b) => a + (b || 0), 0) / 12);
            return { ...s, revenue: { ...s.revenue, pmrMensal: next, pmr: media } };
          })
        }
        onAllMonths={(v) =>
          update((s) => ({ ...s, revenue: { ...s.revenue, pmrMensal: fill12(v), pmr: v } }))
        }
        onFixed={(fixed) =>
          update((s) => {
            const base = s.revenue.pmrMensal ?? fill12(s.revenue.pmr || 0);
            if (fixed) {
              const ref = base.find((x) => x !== 0) ?? base[0] ?? 0;
              return { ...s, revenue: { ...s.revenue, pmrFixo: true, pmrMensal: fill12(ref), pmr: ref } };
            }
            return { ...s, revenue: { ...s.revenue, pmrFixo: false } };
          })
        }
      />
    </div>
  );
}

function SectionBlock({
  title,
  hint,
  accentClass,
  children,
}: {
  title: string;
  hint?: string;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border/60 border-l-4 bg-card/40 ${accentClass}`}>
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={hint}>{title}</SectionTitle>
      </div>
      <div className="space-y-4 p-2">{children}</div>
    </div>
  );
}

function RevenueTable({
  rows,
  brutaAnual,
  footer,
  onMonth,
  onAllMonths,
  onFixed,
}: {
  rows: Row[];
  brutaAnual: number;
  footer?: { label: string; values: number[]; total: number; tone?: "pos" | "neg" };
  onMonth: (row: Row, i: number, v: number) => void;
  onAllMonths: (row: Row, v: number) => void;
  onFixed: (row: Row, fixed: boolean) => void;
}) {
  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);
  const footerToneClass = footer?.tone === "neg" ? "text-neg" : "text-pos";

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
                  <span className="text-xs">{row.label}</span>
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
                <td />
              </tr>
            );
          })}

          {footer && (
            <tr className="border-t border-border/40 bg-accent/20 align-middle">
              <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>{footer.label}</td>
              {footer.values.map((v, i) => (
                <td key={i} className={`num px-1 py-2 text-right text-[11px] ${footerToneClass}`}>{fmtBRLCompact(v)}</td>
              ))}
              <td className={`num px-3 py-2 text-right font-semibold ${footerToneClass}`}>{fmtBRL(footer.total)}</td>
              <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pctRec(footer.total))}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
