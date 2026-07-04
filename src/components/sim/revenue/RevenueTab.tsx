import { useMemo } from "react";
import { useFinance, usePatchRevenue } from "@/engines/finance/AppStateContext";
import { AppState, RevenueDeducao } from "@/engines/finance/types";
import { fmtBRL, fmtBRLCompact, fmtPct, MESES, sum, fill12 } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { MoneyInput, PctInput, StatCard, SectionTitle, HelpTip } from "@/components/sim/shared/primitives";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { PrazoTable } from "@/components/sim/shared/PrazoTable";
import { MonthlyCardList } from "@/components/sim/shared/MonthlyCardList";
import { MutuosSociosCard } from "@/components/sim/tax/MutuosSociosCard";

function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nonZero = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nonZero as number) ? (nonZero as number) : values[0] || 0;
}

/** Saneamento mínimo de inputs financeiros (substitui Zod inline). */
function sanitize(v: number, opts: { min?: number; max?: number } = {}): number {
  let n = Number.isFinite(v) ? v : 0;
  const min = opts.min ?? 0;
  if (n < min) n = min;
  if (typeof opts.max === "number" && n > opts.max) n = opts.max;
  return n;
}

type RowKind = "bruta" | "inadimplencia" | "deducao" | "financeira";
type RowUnit = "brl" | "pct";
type Row = {
  id: string;
  kind: RowKind;
  unit: RowUnit;
  /** id da dedução em revenue.deducoes (quando kind = "deducao") */
  dedId?: string;
  /** id da receita financeira em revenue.receitasFinanceiras (quando kind = "financeira") */
  finId?: string;
  label: string;
  /** Valores na unidade de input (R$ para brl, % para pct). */
  values: number[];
  /** Valores em R$ para exibição/total anual (igual a values quando unit=brl). */
  brlValues: number[];
  fixed: boolean;
  tone: "pos" | "neg";
};

export function RevenueTab() {
  const { state } = useFinance();
  const patchRevenue = usePatchRevenue();
  const r = state.revenue;

  // SSOT: modelo financeiro memoizado (WeakMap por ref do state).
  const { dre } = useFinanceModel(state);

  // -------- Derivados memoizados --------
  const derived = useMemo(() => {
    const inadimpBRL = r.bruta.map((b, i) => b * ((r.inadimplencia[i] || 0) / 100));
    const findDed = (id: string): RevenueDeducao | undefined =>
      r.deducoes?.find((d) => d.id === id);
    const descDed = findDed("desc_incond") ?? {
      id: "desc_incond",
      label: "Descontos Incondicionais",
      valores: fill12(0),
      fixed: true,
    };
    const abatDed = findDed("abatimentos") ?? {
      id: "abatimentos",
      label: "Abatimentos",
      valores: fill12(0),
      fixed: true,
    };
    const usaPDD = !!r.inadimplenciaComoPDD;

    // VERDADE ABSOLUTA: Receita Operacional = Receita Líquida + Impostos sobre Venda
    // (Receita antes da carga tributária), derivada da DRE central via useFinanceModel.
    const liquidas = dre.receitaLiquida.map((rl, i) => rl + (dre.impostosVendas[i] || 0));

    const brutaAnual = sum(r.bruta);
    const inadimpAnual = sum(inadimpBRL);
    const descAnual = sum(descDed.valores);
    const abatAnual = sum(abatDed.valores);
    const deducoesAnual = (usaPDD ? 0 : inadimpAnual) + descAnual + abatAnual;
    const liqAnual = sum(liquidas);
    const monthsWithRevenue = liquidas.filter((_, i) => r.bruta[i] > 0).length;
    const mediaYTD = monthsWithRevenue > 0 ? liqAnual / monthsWithRevenue : 0;

    return {
      inadimpBRL,
      descDed,
      abatDed,
      usaPDD,
      liquidas,
      brutaAnual,
      deducoesAnual,
      liqAnual,
      monthsWithRevenue,
      mediaYTD,
    };
  }, [state, r]);

  const {
    inadimpBRL,
    descDed,
    abatDed,
    usaPDD,
    liquidas,
    brutaAnual,
    deducoesAnual,
    liqAnual,
    monthsWithRevenue,
    mediaYTD,
  } = derived;
  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);

  const inadimpModo: "pct" | "brl" = r.inadimplenciaModo ?? "pct";
  const inadimpEmBRL = inadimpModo === "brl";

  const rows: Row[] = [
    {
      id: "row_bruta",
      kind: "bruta",
      unit: "brl",
      label: "Receita Bruta",
      values: r.bruta,
      brlValues: r.bruta,
      fixed: !!r.brutaFixa,
      tone: "pos",
    },
    // Inadimplência pode ser editada em % (padrão) ou em R$ (convertido para % usando a Bruta do mês).
    {
      id: "row_inad",
      kind: "inadimplencia",
      unit: inadimpEmBRL ? "brl" : "pct",
      label: inadimpEmBRL ? "Inadimplência (R$)" : "Inadimplência (%)",
      values: inadimpEmBRL ? inadimpBRL : r.inadimplencia,
      brlValues: inadimpBRL,
      fixed: !!r.inadimplenciaFixa,
      tone: "neg",
    },
    {
      id: "row_desc",
      kind: "deducao",
      unit: "brl",
      dedId: "desc_incond",
      label: "Descontos Incondicionais",
      values: descDed.valores,
      brlValues: descDed.valores,
      fixed: !!descDed.fixed,
      tone: "neg",
    },
    {
      id: "row_abat",
      kind: "deducao",
      unit: "brl",
      dedId: "abatimentos",
      label: "Abatimentos",
      values: abatDed.valores,
      brlValues: abatDed.valores,
      fixed: !!abatDed.fixed,
      tone: "neg",
    },
  ];

  if (usaPDD) {
    const pddRec = r.pddReversaoMensal ?? fill12(0);
    // Deriva o estado "Fixo" a partir da uniformidade dos valores — não há
    // flag persistida para pddReversaoMensal (é um number[] plano no state).
    const pddFixedDerived = pddRec.every((v) => v === pddRec[0]);
    rows.push({
      id: "row_pdd_rec",
      kind: "deducao",
      unit: "brl",
      dedId: "pdd_rec",
      label: "Recuperação de Inadimplência (+)",
      values: pddRec,
      brlValues: pddRec,
      fixed: pddFixedDerived,
      tone: "pos",
    });
  }

  const updateDed = (id: string, label: string, mut: (d: RevenueDeducao) => RevenueDeducao) =>
    patchRevenue((rev) => {
      const list = rev.deducoes ?? [];
      const exists = list.find((d) => d.id === id);
      const base: RevenueDeducao = exists ?? { id, label, valores: fill12(0), fixed: true };
      const next = mut(base);
      const newList = exists ? list.map((d) => (d.id === id ? next : d)) : [...list, next];
      return { deducoes: newList };
    });

  const updateFin = (id: string, label: string, mut: (d: RevenueDeducao) => RevenueDeducao) =>
    patchRevenue((rev) => {
      const list = rev.receitasFinanceiras ?? [];
      const exists = list.find((d) => d.id === id);
      const base: RevenueDeducao = exists ?? { id, label, valores: fill12(0), fixed: true };
      const next = mut(base);
      const newList = exists ? list.map((d) => (d.id === id ? next : d)) : [...list, next];
      return { receitasFinanceiras: newList };
    });

  const finList = r.receitasFinanceiras ?? [];

  // Classificação SSOT (alinhada com splitReceitasFinanceiras):
  // `tipo` explícito quando presente; fallback p/ id em snapshots antigos.
  const isOperacional = (d: RevenueDeducao): boolean =>
    d.tipo === "operacional" ||
    (d.tipo === undefined && (d.id === "alugueis" || d.id === "venda_ativos"));

  const toRow = (d: RevenueDeducao): Row => ({
    id: `row_${d.id}`,
    kind: "financeira",
    unit: "brl",
    finId: d.id,
    label: d.label,
    values: d.valores,
    brlValues: d.valores,
    fixed: !!d.fixed,
    tone: "pos",
  });

  // "Outras Receitas" (operacionais — entram no EBITDA)
  const outrasRows: Row[] = finList.filter(isOperacional).map(toRow);
  // "Receitas Financeiras" (entram no Resultado Financeiro pós-EBIT)
  const finRows: Row[] = finList.filter((d) => !isOperacional(d)).map(toRow);

  const addFinLine = (tipo: "financeira" | "operacional") => {
    const id = `${tipo === "financeira" ? "fin" : "op"}_${Date.now().toString(36)}`;
    const label = tipo === "financeira" ? "Nova receita financeira" : "Nova outra receita";
    patchRevenue((rev) => ({
      receitasFinanceiras: [
        ...(rev.receitasFinanceiras ?? []),
        { id, label, valores: fill12(0), fixed: true, tipo, custom: true },
      ],
    }));
  };

  const removeFinLine = (id: string) =>
    patchRevenue((rev) => ({
      receitasFinanceiras: (rev.receitasFinanceiras ?? []).filter((d) => d.id !== id),
    }));

  const renameFinLine = (id: string, label: string) =>
    patchRevenue((rev) => ({
      receitasFinanceiras: (rev.receitasFinanceiras ?? []).map((d) =>
        d.id === id ? { ...d, label } : d,
      ),
    }));

  const isCustomFin = (id: string): boolean =>
    !!finList.find((d) => d.id === id)?.custom;


  const setMonth = (row: Row, i: number, v: number) => {
    if (row.kind === "bruta") {
      const safe = sanitize(v);
      patchRevenue((rev) => ({ bruta: rev.bruta.map((x, j) => (j === i ? safe : x)) }));
    } else if (row.kind === "inadimplencia") {
      // Em modo %, v é o percentual digitado. Em modo R$, converte R$→% usando a Bruta do mês.
      if (inadimpEmBRL) {
        const brl = sanitize(v);
        patchRevenue((rev) => {
          const bruta = rev.bruta[i] || 0;
          const pct = bruta > 0 ? Math.min(100, (brl / bruta) * 100) : 0;
          return { inadimplencia: rev.inadimplencia.map((x, j) => (j === i ? pct : x)) };
        });
      } else {
        const pct = sanitize(v, { min: 0, max: 100 });
        patchRevenue((rev) => ({
          inadimplencia: rev.inadimplencia.map((x, j) => (j === i ? pct : x)),
        }));
      }
    } else if (row.kind === "deducao" && row.dedId) {
      const safe = sanitize(v);
      if (row.dedId === "pdd_rec") {
        patchRevenue((rev) => ({
          pddReversaoMensal: (rev.pddReversaoMensal || fill12(0)).map((x, j) =>
            j === i ? safe : x,
          ),
        }));
      } else {
        updateDed(row.dedId, row.label, (d) => ({
          ...d,
          valores: d.valores.map((x, j) => (j === i ? safe : x)),
        }));
      }
    } else if (row.kind === "financeira" && row.finId) {
      const safe = sanitize(v);
      updateFin(row.finId, row.label, (d) => ({
        ...d,
        valores: d.valores.map((x, j) => (j === i ? safe : x)),
      }));
    }
  };

  const setAllMonths = (row: Row, v: number) => {
    if (row.kind === "bruta") {
      const safe = sanitize(v);
      patchRevenue({ bruta: fill12(safe) });
    } else if (row.kind === "inadimplencia") {
      // Em modo R$: aplica o mesmo valor R$ em todos os meses, recalculando o % conforme a Bruta de cada mês.
      if (inadimpEmBRL) {
        const brl = sanitize(v);
        patchRevenue((rev) => ({
          inadimplencia: rev.bruta.map((b) => (b > 0 ? Math.min(100, (brl / b) * 100) : 0)),
        }));
      } else {
        const pct = sanitize(v, { min: 0, max: 100 });
        patchRevenue({ inadimplencia: fill12(pct) });
      }
    } else if (row.kind === "deducao" && row.dedId) {
      const safe = sanitize(v);
      if (row.dedId === "pdd_rec") {
        patchRevenue({ pddReversaoMensal: fill12(safe) });
      } else {
        updateDed(row.dedId, row.label, (d) => ({ ...d, valores: fill12(safe) }));
      }
    } else if (row.kind === "financeira" && row.finId) {
      const safe = sanitize(v);
      updateFin(row.finId, row.label, (d) => ({ ...d, valores: fill12(safe) }));
    }
  };

  const setFixed = (row: Row, fixed: boolean) => {
    if (row.kind === "bruta") {
      patchRevenue((rev) => {
        const base = fixed ? fixedBase(rev.bruta) : rev.bruta[0] || 0;
        return { brutaFixa: fixed, bruta: fixed ? fill12(base) : rev.bruta };
      });
    } else if (row.kind === "inadimplencia") {
      patchRevenue((rev) => {
        const base = fixed ? fixedBase(rev.inadimplencia) : rev.inadimplencia[0] || 0;
        return {
          inadimplenciaFixa: fixed,
          inadimplencia: fixed ? fill12(base) : rev.inadimplencia,
        };
      });
    } else if (row.kind === "deducao" && row.dedId) {
      if (row.dedId === "pdd_rec") {
        // Fixo: achata para o primeiro valor não-zero. Mensal: preserva os
        // valores atuais (não sobrescreve o que o usuário digitou por mês).
        patchRevenue((rev) => {
          const cur = rev.pddReversaoMensal ?? fill12(0);
          if (fixed) {
            const base = fixedBase(cur);
            return { pddReversaoMensal: fill12(base) };
          }
          return { pddReversaoMensal: cur };
        });
      } else {
        updateDed(row.dedId, row.label, (d) => {
          const base = fixed ? fixedBase(d.valores) : d.valores[0] || 0;
          return { ...d, fixed, valores: fixed ? fill12(base) : d.valores };
        });
      }
    } else if (row.kind === "financeira" && row.finId) {
      updateFin(row.finId, row.label, (d) => {
        const base = fixed ? fixedBase(d.valores) : d.valores[0] || 0;
        return { ...d, fixed, valores: fixed ? fill12(base) : d.valores };
      });
    }
  };


  return (
    <div className="space-y-4 md:space-y-6">
      {(() => {
        const recFinAnual =
          r.receitasFinanceiras?.reduce((acc, f) => acc + sum(f.valores), 0) || 0;
        const totalReceitas = brutaAnual + recFinAnual;
        return (
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Receita Bruta Anual"
          value={fmtBRL(brutaAnual)}
          tone="pos"
          hint={{
            description: "Total faturado no ano antes de qualquer dedução.",
            formula: "Σ Receita Bruta dos 12 meses",
            calc: `Σ 12 meses = ${fmtBRL(brutaAnual)}`,
          }}
        />
        <StatCard
          label="Deduções da Receita"
          value={fmtBRL(deducoesAnual)}
          tone="neg"
          sub={fmtPct(pctRec(deducoesAnual)) + " da receita"}
          hint={{
            description: "Devoluções, cancelamentos, descontos incondicionais e abatimentos.",
            formula: "Devoluções + Descontos Incondicionais + Abatimentos",
            calc: `${fmtBRL(deducoesAnual)} ÷ ${fmtBRL(brutaAnual)} × 100 = ${fmtPct(pctRec(deducoesAnual))}`,
          }}
        />
        <StatCard
          label="Receita Operacional"
          value={fmtBRL(liqAnual)}
          tone="pos"
          sub={fmtPct(pctRec(liqAnual)) + " da receita"}
          hint={{
            description:
              "Receita após deduções (devoluções, cancelamentos, descontos e abatimentos). Os impostos sobre venda são abatidos depois, na DRE — só então temos a Receita Líquida contábil.",
            formula: "Receita Bruta − Deduções da Receita",
            calc: `${fmtBRL(brutaAnual)} − ${fmtBRL(deducoesAnual)} = ${fmtBRL(liqAnual)}`,
          }}
        />
        <StatCard
          label="Média Mensal YTD"
          value={fmtBRL(mediaYTD)}
          sub={`${monthsWithRevenue} ${monthsWithRevenue === 1 ? "mês" : "meses"} com receita`}
          hint={{
            description:
              "Média mensal da Receita Operacional considerando apenas meses com receita bruta lançada.",
            formula: "Receita Operacional ÷ Meses com receita",
            calc: `${fmtBRL(liqAnual)} ÷ ${monthsWithRevenue || 1} = ${fmtBRL(mediaYTD)}`,
          }}
        />
        <StatCard
          label="Total de Receitas"
          value={fmtBRL(totalReceitas)}
          tone="pos"
          hint={{
            description:
              "Soma da Receita Operacional Bruta com as Receitas Financeiras e demais entradas (aluguéis, venda de ativos).",
            formula: "Receita Bruta + Receitas Financeiras",
            calc: `${fmtBRL(brutaAnual)} + ${fmtBRL(recFinAnual)} = ${fmtBRL(totalReceitas)}`,
          }}
        />
      </div>
        );
      })()}

      <SectionBlock
        title="Receita Mensal — 12 meses"
        hint="Receita Bruta e deduções. A inadimplência pode ser digitada em % ou em R$ — internamente é armazenada como % da Bruta para manter consistência com a engine financeira."
        accentClass="border-l-[color:var(--success)]"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 bg-accent/20 rounded-md mb-4 mx-2">
          <label className="text-[11px] text-muted-foreground flex items-center gap-2 cursor-pointer">
            <Switch
              checked={usaPDD}
              onCheckedChange={(v) => patchRevenue({ inadimplenciaComoPDD: v })}
            />
            Contabilizar inadimplência como PDD (Despesa Operacional)
            <HelpTip
              text="Quando ATIVO: a inadimplência esperada não reduz a Receita Líquida — vira PDD (despesa operacional, abaixo do Lucro Bruto), seguindo CPC 47/IFRS 9. Quando DESATIVO: a inadimplência é deduzida diretamente da Receita Bruta. Em ambos os casos, a base de PIS/COFINS/ISS continua sendo a Receita Bruta — o toggle muda apenas a classificação na DRE."
              formula="PDD líquida = Inadimplência − Recuperação"
            />
          </label>
          <label className="text-[11px] text-muted-foreground flex items-center gap-2 cursor-pointer">
            <Switch
              checked={inadimpEmBRL}
              onCheckedChange={(v) => patchRevenue({ inadimplenciaModo: v ? "brl" : "pct" })}
            />

            Digitar inadimplência em R$
            <HelpTip
              text="Quando ATIVO: você informa o valor da inadimplência em reais por mês — o sistema converte automaticamente para % da Receita Bruta do mês (storage interno permanece em %). Quando DESATIVO (padrão): edição direta em %. Não há impacto em cálculos da DRE, fluxo de caixa, impostos ou indicadores — apenas muda a forma de entrada."
              formula="% mês = R$ inadimplência ÷ Receita Bruta do mês × 100"
            />
          </label>
        </div>
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
        title="Outras Receitas — 12 meses"
        hint="Receitas operacionais não recorrentes do negócio (aluguéis recebidos, venda de ativos etc.). Entram no EBITDA como Outras Receitas Operacionais — não no Resultado Financeiro."
        accentClass="border-l-[color:var(--success)]"
      >
        <RevenueTable
          rows={outrasRows}
          brutaAnual={brutaAnual}
          footer={{
            label: "Total Outras Receitas",
            values: MESES.map((_, i) => outrasRows.reduce((a, r) => a + (r.values[i] || 0), 0)),
            total: outrasRows.reduce((a, r) => a + sum(r.values), 0),
            tone: "pos",
          }}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          isCustom={isCustomFin}
          onRename={renameFinLine}
          onRemove={removeFinLine}
        />
        <div className="px-3 pb-3 pt-1">
          <Button size="sm" variant="outline" onClick={() => addFinLine("operacional")} className="h-7 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
          </Button>
        </div>
      </SectionBlock>

      <SectionBlock
        title="Receitas Financeiras — 12 meses"
        hint="Rendimentos de aplicações financeiras, juros recebidos e demais receitas não-operacionais. Entram no Resultado Financeiro (pós-EBIT) e são tributadas conforme o regime (Real: PIS 0,65% + COFINS 4%; Presumido: 100% na base de IRPJ/CSLL, exceto se marcadas como tributação exclusiva na fonte)."
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
          isCustom={isCustomFin}
          onRename={renameFinLine}
          onRemove={removeFinLine}
        />
        <div className="px-3 pb-3 pt-1">
          <Button size="sm" variant="outline" onClick={() => addFinLine("financeira")} className="h-7 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
          </Button>
        </div>
      </SectionBlock>

      {/* Empréstimos PJ→PF (mútuo ativo aos sócios) — receita financeira
          de juros; cadastro dos contratos aqui, sincroniza com Fluxo de
          Caixa e Balanço via SSOT. */}
      <MutuosSociosCard />

      <PrazoTable
        title="Prazo Médio de Recebimento (PMR) — 12 meses"
        hint="Dias entre faturar e receber do cliente. A variação mensal é refletida no Fluxo de Caixa."
        accentClass="border-l-[color:var(--success)]"
        rubrica="PMR — Recebimento (dias)"
        summaryLabel="PMR"
        values={r.pmrMensal ?? fill12(r.pmr || 0)}
        fixed={!!r.pmrFixo}
        onMonth={(i, v) =>
          patchRevenue((rev) => {
            const base = rev.pmrMensal ?? fill12(rev.pmr || 0);
            const next = base.map((x, j) => (j === i ? v : x));
            const media = Math.round(next.reduce((a, b) => a + (b || 0), 0) / 12);
            return { pmrMensal: next, pmr: media };
          })
        }
        onAllMonths={(v) => patchRevenue({ pmrMensal: fill12(v), pmr: v })}
        onFixed={(fixed) =>
          patchRevenue((rev) => {
            const base = rev.pmrMensal ?? fill12(rev.pmr || 0);
            if (fixed) {
              const ref = base.find((x) => x !== 0) ?? base[0] ?? 0;
              return { pmrFixo: true, pmrMensal: fill12(ref), pmr: ref };
            }
            return { pmrFixo: false };
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
  isCustom,
  onRename,
  onRemove,
}: {
  rows: Row[];
  brutaAnual: number;
  footer?: { label: string; values: number[]; total: number; tone?: "pos" | "neg" };
  onMonth: (row: Row, i: number, v: number) => void;
  onAllMonths: (row: Row, v: number) => void;
  onFixed: (row: Row, fixed: boolean) => void;
  /** Quando fornecido, identifica linhas custom (rótulo editável + remover). Usa o `finId`. */
  isCustom?: (finId: string) => boolean;
  onRename?: (finId: string, label: string) => void;
  onRemove?: (finId: string) => void;
}) {
  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);
  const footerToneClass = footer?.tone === "neg" ? "text-neg" : "text-pos";

  const rowIsCustom = (row: Row): boolean =>
    !!(isCustom && row.finId && isCustom(row.finId));

  const renderCellInput = (row: Row, v: number, onChange: (n: number) => void) =>
    row.unit === "pct" ? (
      <PctInput value={v} onChange={onChange} />
    ) : (
      <MoneyInput value={v} onChange={onChange} />
    );

  return (
    <>
      <MonthlyCardList
        rows={rows.map((r) => ({
          id: r.id,
          label: r.label,
          unit: r.unit,
          values: r.values,
          brlValues: r.brlValues,
          fixed: r.fixed,
          tone: r.tone,
          editableLabel: rowIsCustom(r),
          removable: rowIsCustom(r),
        }))}
        receitaAnual={brutaAnual}
        footer={
          footer
            ? { label: footer.label, total: footer.total, tone: footer.tone }
            : undefined
        }
        onMonth={(id, i, v) => {
          const row = rows.find((r) => r.id === id);
          if (row) onMonth(row, i, v);
        }}
        onAllMonths={(id, v) => {
          const row = rows.find((r) => r.id === id);
          if (row) onAllMonths(row, v);
        }}
        onFixed={(id, f) => {
          const row = rows.find((r) => r.id === id);
          if (row) onFixed(row, f);
        }}
        onLabel={(id, label) => {
          const row = rows.find((r) => r.id === id);
          if (row?.finId && onRename) onRename(row.finId, label);
        }}
        onRemove={(id) => {
          const row = rows.find((r) => r.id === id);
          if (row?.finId && onRemove) onRemove(row.finId);
        }}
      />
    <div className="scrollbar-thin hidden md:block w-full overflow-x-auto overflow-y-hidden">
      <table className="w-full min-w-[800px] text-[clamp(0.75rem,1vw+0.5rem,0.875rem)] md:min-w-[1000px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-56 px-3 py-2">Descrição</th>
            <th className="w-24 px-2 py-2 text-center">Modo</th>
            {MESES.map((m) => (
              <th key={m} className="px-1 py-2 text-right">
                {m}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Anual</th>
            <th className="w-14 px-2 py-2 text-right">% Rec</th>
            <th className="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Total ANUAL exibido sempre em R$ (mesmo quando input é %).
            const anual = sum(row.brlValues);
            const pct = pctRec(anual);
            const toneClass =
              row.tone === "pos" ? "text-pos" : anual > 0 ? "text-neg" : "text-muted-foreground";
            const anualDisplay =
              row.tone === "neg" && anual > 0 ? `− ${fmtBRL(anual)}` : fmtBRL(anual);
            return (
              <tr key={row.id} className="border-t border-border/40 align-middle">
                <td className="px-3 py-2">
                  {rowIsCustom(row) && onRename ? (
                    <input
                      className="w-full bg-transparent text-xs outline-none focus:bg-accent/30 rounded px-1"
                      value={row.label}
                      onChange={(e) => row.finId && onRename(row.finId, e.target.value)}
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
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {row.unit === "pct"
                          ? "% aplicado em todos os meses:"
                          : "Valor aplicado em todos os meses:"}
                      </span>
                      <div className="w-36">
                        {renderCellInput(row, fixedBase(row.values), (n) => onAllMonths(row, n))}
                      </div>
                    </div>
                  </td>
                ) : (
                  row.values.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      {renderCellInput(row, v, (n) => onMonth(row, i, n))}
                    </td>
                  ))
                )}
                <td className={`num px-3 py-2 text-right ${toneClass}`}>{anualDisplay}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                  {fmtPct(pct)}
                </td>
                <td className="px-1 py-2 text-right">
                  {rowIsCustom(row) && onRemove ? (
                    <button
                      type="button"
                      onClick={() => row.finId && onRemove(row.finId)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remover linha"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}

          {footer && (
            <tr className="border-t border-border/40 bg-accent/20 align-middle">
              <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>
                {footer.label}
              </td>
              {footer.values.map((v, i) => (
                <td key={i} className={`num px-1 py-2 text-right text-[11px] ${footerToneClass}`}>
                  {fmtBRLCompact(v)}
                </td>
              ))}
              <td className={`num px-3 py-2 text-right font-semibold ${footerToneClass}`}>
                {fmtBRL(footer.total)}
              </td>
              <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                {fmtPct(pctRec(footer.total))}
              </td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
