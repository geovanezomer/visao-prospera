import { useState } from "react";
import { toast } from "sonner";
import { fmtBRL, MESES, sum } from "@/engines/finance/format";
import { MoneyInput, HelpTip } from "../primitives";
import { Switch } from "@/components/ui/switch";
import { fixedBase, hasSazonalidade, NonOpKey } from "./tableHelpers";

type NonOpRow = {
  key: NonOpKey;
  label: string;
  hint: string;
  tone: "pos" | "neg";
  values: number[];
};

// Tabela de movimentações não-operacionais (Capex, aportes, captações, etc.)
// — toggle por linha entre modo Fixo (mesmo valor mensal) e Mensal (12 inputs).
export function NonOpTable({
  rows,
  onMonth,
  onAllMonths,
}: {
  rows: NonOpRow[];
  onMonth: (key: NonOpKey, i: number, v: number) => void;
  onAllMonths: (key: NonOpKey, v: number) => void;
}) {
  // Cada linha começa "fechada" (modo Fixo) — toggle local para abrir os 12 meses.
  const [fixedMap, setFixedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, true])),
  );
  const isFixed = (k: string) => fixedMap[k] ?? true;
  const setFixed = (k: string, v: boolean) => setFixedMap((m) => ({ ...m, [k]: v }));

  return (
    <div className="scrollbar-thin w-full overflow-x-auto overflow-y-hidden p-2">
      <table className="w-full min-w-[800px] text-[clamp(0.75rem,1vw+0.5rem,0.875rem)] md:min-w-[1000px]">
        <thead>
          <tr className="bg-card text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="sticky left-0 z-20 w-64 bg-card px-3 py-2 shadow-[1px_0_0_0_var(--border)]">
              Descrição
            </th>
            <th className="w-24 px-2 py-2 text-center">Modo</th>
            {MESES.map((m) => (
              <th key={m} className="px-1 py-2 text-right">
                {m}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Anual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const anual = sum(row.values);
            const fixed = isFixed(row.key);
            const dotColor = row.tone === "pos" ? "var(--success)" : "var(--destructive)";
            const toneClass =
              anual === 0 ? "text-muted-foreground" : row.tone === "pos" ? "text-pos" : "text-neg";
            const anualDisplay =
              anual === 0 ? "—" : row.tone === "neg" ? `(${fmtBRL(anual)})` : fmtBRL(anual);
            return (
              <tr key={row.key} className="border-t border-border/40 align-middle">
                <td className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: dotColor }}
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold">{row.label}</span>
                      <HelpTip text={row.hint} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>Fixo</span>
                    <Switch
                      checked={!fixed}
                      onCheckedChange={(v) => {
                        // Ao alternar Mensal → Fixo com sazonalidade real, avisar.
                        if (!v && hasSazonalidade(row.values)) {
                          toast.warning(`Sazonalidade de "${row.label}" será nivelada`, {
                            description:
                              "Alternar para 'Fixo' substitui os 12 meses pelo primeiro valor não-zero.",
                          });
                        }
                        setFixed(row.key, !v);
                      }}
                    />
                    <span>Mensal</span>
                  </div>
                </td>
                {fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Valor aplicado em todos os meses:
                      </span>
                      <div className="w-36">
                        <MoneyInput
                          value={fixedBase(row.values)}
                          onChange={(n) => onAllMonths(row.key, n)}
                        />
                      </div>
                    </div>
                  </td>
                ) : (
                  row.values.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => onMonth(row.key, i, n)} />
                    </td>
                  ))
                )}
                <td className={`num px-3 py-2 text-right font-semibold ${toneClass}`}>
                  {anualDisplay}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
