import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { MoneyInput, PctInput } from "@/components/sim/shared/primitives";
import { MESES, sum, fmtBRL, fmtPct } from "@/engines/finance/format";

/**
 * Mobile-only card list para edição de rubricas mensais (Receitas / Custos).
 * Cada rubrica vira um cartão com:
 *  - cabeçalho: rótulo, total anual, % receita, switch Fixo/Mensal
 *  - corpo: input único (Fixo) ou grid 3 colunas com os 12 meses (Mensal, colapsável)
 *
 * Mantém todo o estado/cálculo no pai — este componente é puramente apresentacional.
 */
export type MonthlyCardRow = {
  id: string;
  label: string;
  unit?: "brl" | "pct";
  values: number[];
  brlValues: number[]; // sempre em R$ para totais
  fixed: boolean;
  tone?: "pos" | "neg";
  /** Rotulo editável (linhas custom de custo) */
  editableLabel?: boolean;
  /** Permite remover (linhas custom de custo) */
  removable?: boolean;
  /** Linha somente-leitura (ex.: lançamentos system geridos em outra tela) */
  readOnly?: boolean;
  /** Texto explicativo exibido em linhas read-only */
  readOnlyHint?: string;
};

export function MonthlyCardList({
  rows,
  receitaAnual,
  footer,
  onMonth,
  onAllMonths,
  onFixed,
  onLabel,
  onRemove,
}: {
  rows: MonthlyCardRow[];
  receitaAnual: number;
  footer?: { label: string; total: number; tone?: "pos" | "neg" };
  onMonth: (id: string, i: number, v: number) => void;
  onAllMonths: (id: string, v: number) => void;
  onFixed: (id: string, fixed: boolean) => void;
  onLabel?: (id: string, label: string) => void;
  onRemove?: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground md:hidden">
        Nenhuma rubrica nesta categoria.
      </div>
    );
  }
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((row) => (
        <MonthlyCard
          key={row.id}
          row={row}
          receitaAnual={receitaAnual}
          onMonth={(i, v) => onMonth(row.id, i, v)}
          onAllMonths={(v) => onAllMonths(row.id, v)}
          onFixed={(f) => onFixed(row.id, f)}
          onLabel={onLabel ? (l) => onLabel(row.id, l) : undefined}
          onRemove={onRemove && row.removable ? () => onRemove(row.id) : undefined}
        />
      ))}
      {footer && (
        <div
          className={`rounded-md border border-border/60 bg-accent/30 px-3 py-2 text-sm font-semibold ${
            footer.tone === "neg" ? "text-neg" : "text-pos"
          } flex items-center justify-between`}
        >
          <span>{footer.label}</span>
          <span className="num">{fmtBRL(footer.total)}</span>
        </div>
      )}
    </div>
  );
}

function MonthlyCard({
  row,
  receitaAnual,
  onMonth,
  onAllMonths,
  onFixed,
  onLabel,
  onRemove,
}: {
  row: MonthlyCardRow;
  receitaAnual: number;
  onMonth: (i: number, v: number) => void;
  onAllMonths: (v: number) => void;
  onFixed: (fixed: boolean) => void;
  onLabel?: (label: string) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anual = sum(row.brlValues);
  const pct = receitaAnual > 0 ? anual / receitaAnual : 0;
  const toneClass =
    row.tone === "pos" ? "text-pos" : anual > 0 && row.tone === "neg" ? "text-neg" : "";
  const unit = row.unit ?? "brl";
  const baseFixo = row.values.find((v) => v !== 0) ?? row.values[0] ?? 0;

  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {onLabel && !row.readOnly ? (
            <input
              value={row.label}
              onChange={(e) => onLabel(e.target.value)}
              className="w-full rounded border border-border/40 bg-input/40 px-2 py-1 text-sm font-medium outline-none focus:border-primary"
            />
          ) : (
            <div className="truncate text-sm font-medium">{row.label}</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={`num ${toneClass}`}>{fmtBRL(anual)}</span>
            <span>•</span>
            <span>{fmtPct(pct)} rec.</span>
          </div>
          {row.readOnly && row.readOnlyHint && (
            <div className="mt-1 text-[10px] italic text-muted-foreground">{row.readOnlyHint}</div>
          )}
        </div>
        {onRemove && !row.readOnly && (
          <button
            onClick={onRemove}
            className="shrink-0 text-muted-foreground hover:text-neg"
            title="Remover linha"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {!row.readOnly && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Fixo</span>
            <Switch checked={!row.fixed} onCheckedChange={(v) => onFixed(!v)} />
            <span>Mensal</span>
          </label>
          {!row.fixed && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 text-[11px] text-primary"
            >
              {open ? "Recolher" : "Editar 12 meses"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
      )}

      <div className="mt-3">
        {row.fixed ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-muted-foreground">
              {unit === "pct" ? "% aplicado:" : "Valor mensal:"}
            </span>
            <div className="flex-1">
              {unit === "pct" ? (
                <PctInput value={baseFixo} onChange={onAllMonths} />
              ) : (
                <MoneyInput value={baseFixo} onChange={onAllMonths} readOnly={row.readOnly} />
              )}
            </div>
          </div>
        ) : (
          open &&
          !row.readOnly && (
            <div className="grid grid-cols-3 gap-2">
              {row.values.map((v, i) => (
                <label key={i} className="space-y-1">
                  <span className="block text-[10px] uppercase text-muted-foreground">
                    {MESES[i]}
                  </span>
                  {unit === "pct" ? (
                    <PctInput value={v} onChange={(n) => onMonth(i, n)} />
                  ) : (
                    <MoneyInput value={v} onChange={(n) => onMonth(i, n)} />
                  )}
                </label>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
