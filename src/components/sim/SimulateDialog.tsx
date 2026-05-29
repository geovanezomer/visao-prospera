import { useMemo, useState } from "react";
import { AppState } from "@/lib/finance/types";
import { MetricSnapshot, PrescriptiveAction, PrescriptiveCard, snapshot } from "@/lib/finance/prescriptive";
import { fmtBRL } from "@/lib/finance/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownRight, ArrowRight, ArrowUpRight, PlayCircle, Save } from "lucide-react";

export function SimulateDialog({
  open,
  onOpenChange,
  base,
  state,
  action,
  card,
  onApply,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  base: MetricSnapshot;
  state: AppState;
  action: PrescriptiveAction;
  card: PrescriptiveCard;
  onApply: (s: AppState) => void;
  onSave: (name: string, s: AppState) => void;
}) {
  const newState = useMemo(() => action.apply(state), [action, state]);
  const after = useMemo(() => snapshot(newState), [newState]);
  const [scenName, setScenName] = useState(action.title.slice(0, 30));

  const rows: { label: string; before: number; after: number; fmt: (n: number) => string; higherIsBetter: boolean }[] = [
    { label: "Receita Bruta", before: base.receitaBruta, after: after.receitaBruta, fmt: fmtBRL, higherIsBetter: true },
    { label: "EBITDA", before: base.ebitda, after: after.ebitda, fmt: fmtBRL, higherIsBetter: true },
    { label: "Margem EBITDA", before: base.margemEbitda, after: after.margemEbitda, fmt: (n) => `${n.toFixed(1)}%`, higherIsBetter: true },
    { label: "Lucro Líquido", before: base.lucroLiquido, after: after.lucroLiquido, fmt: fmtBRL, higherIsBetter: true },
    { label: "Margem Líquida", before: base.margemLiquida, after: after.margemLiquida, fmt: (n) => `${n.toFixed(1)}%`, higherIsBetter: true },
    { label: "ROIC", before: base.roic, after: after.roic, fmt: (n) => `${n.toFixed(1)}%`, higherIsBetter: true },
    { label: "WACC (referência)", before: base.wacc, after: after.wacc, fmt: (n) => `${n.toFixed(1)}%`, higherIsBetter: false },
    { label: "Dívida Líq / EBITDA", before: base.dividaLiqEbitda, after: after.dividaLiqEbitda, fmt: (n) => (Number.isFinite(n) ? `${n.toFixed(1)}×` : "∞"), higherIsBetter: false },
    { label: "Cobertura de Juros", before: base.coberturaJuros, after: after.coberturaJuros, fmt: (n) => (Number.isFinite(n) ? `${n.toFixed(1)}×` : "∞"), higherIsBetter: true },
    { label: "Impostos no ano", before: base.impostosAno, after: after.impostosAno, fmt: fmtBRL, higherIsBetter: false },
    { label: "Saldo de caixa (Dez)", before: base.saldoCaixaFinal, after: after.saldoCaixaFinal, fmt: fmtBRL, higherIsBetter: true },
    { label: "Pior mês de caixa", before: base.piorMesCaixa, after: after.piorMesCaixa, fmt: fmtBRL, higherIsBetter: true },
    { label: "Free Cash Flow", before: base.fcf, after: after.fcf, fmt: fmtBRL, higherIsBetter: true },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" />
            Simulação: {action.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border/40 bg-background/40 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Contexto:</span> {card.problem} —{" "}
            <span className="mono">{card.metricValue}</span>
          </div>

          <div className="scrollbar-thin overflow-x-auto rounded-md border border-border/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Métrica</th>
                  <th className="px-3 py-2 text-right">Antes</th>
                  <th className="px-3 py-2 text-center">→</th>
                  <th className="px-3 py-2 text-right">Depois</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const delta = r.after - r.before;
                  const improved = r.higherIsBetter ? delta > 0 : delta < 0;
                  const same = Math.abs(delta) < 1e-6;
                  const cls = same ? "text-muted-foreground" : improved ? "text-pos" : "text-neg";
                  const icon = same ? <ArrowRight className="h-3 w-3" /> : improved ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />;
                  return (
                    <tr key={r.label} className="border-t border-border/30">
                      <td className="px-3 py-1.5 text-xs">{r.label}</td>
                      <td className="num px-3 py-1.5 text-right text-xs text-muted-foreground">{r.fmt(r.before)}</td>
                      <td className="px-3 py-1.5 text-center"><span className={cls}>{icon}</span></td>
                      <td className={`num px-3 py-1.5 text-right text-xs font-semibold ${cls}`}>{r.fmt(r.after)}</td>
                      <td className={`num px-3 py-1.5 text-right text-[11px] ${cls}`}>
                        {same ? "—" : r.label.includes("%") || r.fmt(r.after).includes("%") ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp` : `${delta > 0 ? "+" : ""}${fmtBRL(delta)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border/40 bg-background/30 p-3 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Como foi simulado:</span> {action.detail}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={scenName}
              onChange={(e) => setScenName(e.target.value)}
              className="flex-1 rounded-md border border-border/60 bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="Nome do cenário (opcional)"
              maxLength={60}
            />
            <Button variant="outline" disabled={!scenName.trim()} onClick={() => onSave(scenName.trim(), newState)}>
              <Save className="mr-2 h-4 w-4" /> Salvar como cenário
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onApply(newState)}>Aplicar ao plano atual</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
