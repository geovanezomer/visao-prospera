import { fill12 } from "@/engines/finance/format";
import { usePeriodLabels } from "@/components/odoo/usePeriodLabels";
import { NumInput, SectionTitle } from "@/components/sim/shared/primitives";
import { Switch } from "@/components/ui/switch";

function avg(values: number[]): number {
  if (!values?.length) return 0;
  const s = values.reduce((a, b) => a + (Number(b) || 0), 0);
  return Math.round(s / values.length);
}

function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nz = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nz as number) ? (nz as number) : values[0] || 0;
}

/**
 * Tabela de Prazo (PMR ou PMP) — visual idêntico às tabelas de Receita/Custos,
 * com 1 única linha (rubrica), toggle Fixo/Mensal e coluna resumo (PMR/PMP em dias).
 */
export function PrazoTable({
  title,
  hint,
  accentClass,
  rubrica,
  summaryLabel,
  values,
  fixed,
  onMonth,
  onAllMonths,
  onFixed,
}: {
  title: string;
  hint?: string;
  accentClass: string;
  rubrica: string;
  summaryLabel: string; // ex.: "PMR" ou "PMP"
  values: number[];
  fixed: boolean;
  onMonth: (i: number, v: number) => void;
  onAllMonths: (v: number) => void;
  onFixed: (fixed: boolean) => void;
}) {
  const MESES = usePeriodLabels();
  const vals = values?.length === 12 ? values : fill12(values?.[0] || 0);
  const media = avg(vals);

  return (
    <div className={`rounded-lg border border-border/60 border-l-4 bg-card/40 ${accentClass}`}>
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={hint}>{title}</SectionTitle>
      </div>
      <div className="p-2">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="bg-card text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="sticky left-0 z-20 w-56 bg-card px-3 py-2 shadow-[1px_0_0_0_var(--border)]">
                  Descrição
                </th>
                <th className="w-24 px-2 py-2 text-center">Modo</th>
                {MESES.map((m) => (
                  <th key={m} className="px-1 py-2 text-right">
                    {m}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">{summaryLabel}</th>
                <th className="w-14 px-2 py-2 text-right">—</th>
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/40 bg-card align-middle">
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 shadow-[1px_0_0_0_var(--border)]">
                  <span className="text-xs">{rubrica}</span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>Fixo</span>
                    <Switch checked={!fixed} onCheckedChange={(v) => onFixed(!v)} />
                    <span>Mensal</span>
                  </div>
                </td>
                {fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Dias aplicados em todos os meses:
                      </span>
                      <div className="w-36">
                        <NumInput
                          integer
                          min={0}
                          value={fixedBase(vals)}
                          onChange={(n) => onAllMonths(n)}
                        />
                      </div>
                    </div>
                  </td>
                ) : (
                  vals.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <NumInput integer min={0} value={v} onChange={(n) => onMonth(i, n)} />
                    </td>
                  ))
                )}
                <td className="num px-3 py-2 text-right font-semibold">{media} d</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">—</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
