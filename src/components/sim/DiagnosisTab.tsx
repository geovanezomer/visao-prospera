import { useMemo, useState } from "react";
import { AppState, Scenario } from "@/lib/finance/types";
import { buildPrescriptiveCards, MetricSnapshot, PrescriptiveAction, PrescriptiveCard, snapshot } from "@/lib/finance/prescriptive";
import { fmtBRL, fmtPct } from "@/lib/finance/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Info, PlayCircle, Save, TriangleAlert } from "lucide-react";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

export function DiagnosisTab({
  state,
  update,
  saveScenario,
}: {
  state: AppState;
  update: Updater;
  saveScenario: (name: string, s: AppState) => void;
}) {
  const cards = useMemo(() => buildPrescriptiveCards(state), [state]);
  const base = useMemo(() => snapshot(state), [state]);

  const [sim, setSim] = useState<{ action: PrescriptiveAction; card: PrescriptiveCard } | null>(null);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold text-foreground">Raio-X CFO + plano de ação</div>
            <p className="mt-1 text-xs text-muted-foreground">
              O sistema analisou seus números e listou abaixo os problemas detectados com <strong>ações recomendadas</strong> e
              <strong> impacto quantificado</strong>. Clique em "Simular esta ação" para ver o efeito antes e depois — você pode
              aplicar direto ou salvar como cenário.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((c) => (
          <CardView
            key={c.id}
            card={c}
            onSimulate={(a) => setSim({ action: a, card: c })}
          />
        ))}
      </div>

      {sim && (
        <SimulateDialog
          open={!!sim}
          onOpenChange={(o) => !o && setSim(null)}
          base={base}
          state={state}
          action={sim.action}
          card={sim.card}
          onApply={(newState) => {
            update(() => newState);
            setSim(null);
          }}
          onSave={(name, newState) => {
            saveScenario(name, newState);
            setSim(null);
          }}
        />
      )}
    </div>
  );
}

function severityStyle(s: PrescriptiveCard["severity"]) {
  switch (s) {
    case "danger":
      return { ring: "border-[var(--destructive)]/60", chip: "bg-[var(--destructive)]/15 text-neg", icon: <AlertTriangle className="h-4 w-4 text-neg" />, label: "Crítico" };
    case "warn":
      return { ring: "border-[var(--warning)]/60", chip: "bg-[var(--warning)]/15 text-[var(--warning)]", icon: <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />, label: "Atenção" };
    case "info":
      return { ring: "border-primary/40", chip: "bg-primary/15 text-primary", icon: <Info className="h-4 w-4 text-primary" />, label: "Oportunidade" };
    default:
      return { ring: "border-[var(--success)]/40", chip: "bg-[var(--success)]/15 text-pos", icon: <CheckCircle2 className="h-4 w-4 text-pos" />, label: "OK" };
  }
}

function CardView({ card, onSimulate }: { card: PrescriptiveCard; onSimulate: (a: PrescriptiveAction) => void }) {
  const st = severityStyle(card.severity);
  return (
    <div className={`rounded-lg border ${st.ring} bg-card/40`}>
      <div className="flex items-start justify-between border-b border-border/40 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{st.icon}</div>
          <div>
            <div className={`mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${st.chip}`}>{st.label}</div>
            <h4 className="text-sm font-semibold leading-tight">{card.problem}</h4>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <span className="text-foreground">{card.metricLabel}:</span>{" "}
              <span className="mono font-semibold">{card.metricValue}</span>
              {card.benchmark && <span className="ml-2 text-muted-foreground">· {card.benchmark}</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-md border border-border/40 bg-background/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-foreground">Causa provável:</span>
          <p className="mt-1">{card.cause}</p>
        </div>
        {card.actions.length > 0 && (
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ações recomendadas</div>
            <div className="space-y-2">
              {card.actions.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-background/40 p-3">
                  <div className="flex-1">
                    <div className="text-xs font-medium text-foreground">{a.title}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{a.detail}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onSimulate(a)} className="h-7 shrink-0 text-[11px]">
                    <PlayCircle className="mr-1 h-3.5 w-3.5" /> Simular
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Dialog Simular Ação ============

function SimulateDialog({
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

  const rows: { label: string; before: number; after: number; fmt: (n: number) => string; higherIsBetter: boolean; suffix?: string }[] = [
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
            <span className="font-semibold text-foreground">Contexto do problema:</span> {card.problem} —{" "}
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
                      <td className="px-3 py-1.5 text-center">
                        <span className={cls}>{icon}</span>
                      </td>
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
            <span className="font-semibold text-foreground">Como esta ação foi simulada:</span> {action.detail}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={scenName}
              onChange={(e) => setScenName(e.target.value)}
              className="flex-1 rounded-md border border-border/60 bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="Nome do cenário (opcional)"
            />
            <Button variant="outline" disabled={!scenName.trim()} onClick={() => onSave(scenName.trim(), newState)}>
              <Save className="mr-2 h-4 w-4" /> Salvar como cenário
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onApply(newState)}>Aplicar ação ao plano atual</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
