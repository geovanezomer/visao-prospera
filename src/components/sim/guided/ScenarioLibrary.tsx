import { useMemo, useState } from "react";
import { AppState } from "@/lib/finance/types";
import { buildSuggestedScenarios, SuggestedScenario } from "@/lib/finance/guided/scenarios";
import { snapshot } from "@/lib/finance/prescriptive";
import { SimulateDialog } from "../SimulateDialog";
import { Button } from "@/components/ui/button";
import { Sparkles, PlayCircle, TrendingUp, TrendingDown, Receipt, Users, Wallet, Activity } from "lucide-react";

const ICONS: Record<SuggestedScenario["category"], React.ReactNode> = {
  receita: <TrendingUp className="h-4 w-4" />,
  custo: <Users className="h-4 w-4" />,
  tributario: <Receipt className="h-4 w-4" />,
  capital: <Wallet className="h-4 w-4" />,
  operacional: <Activity className="h-4 w-4" />,
};

export function ScenarioLibrary({
  state,
  saveScenario,
  loadScenario,
}: {
  state: AppState;
  saveScenario: (name: string, s: AppState) => void;
  loadScenario: (s: AppState) => void;
}) {
  const scenarios = useMemo(() => buildSuggestedScenarios(state), [state]);
  const base = useMemo(() => snapshot(state), [state]);
  const [active, setActive] = useState<SuggestedScenario | null>(null);

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-5">
      <header className="mb-3 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Simulações sugeridas</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Cenários prontos para você testar com um clique. Cada um compara antes/depois e pode ser salvo.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((sc) => (
          <div key={sc.id} className="flex flex-col justify-between rounded-md border border-border/60 bg-card/60 p-3">
            <div>
              <div className="flex items-center gap-2 text-primary">
                {ICONS[sc.category]}
                <div className="text-sm font-semibold text-foreground">{sc.title}</div>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{sc.description}</p>
            </div>
            <Button size="sm" variant="outline" className="mt-3 h-7 text-[11px]" onClick={() => setActive(sc)}>
              <PlayCircle className="mr-1 h-3.5 w-3.5" /> Simular
            </Button>
          </div>
        ))}
      </div>

      {active && (
        <SimulateDialog
          open={!!active}
          onOpenChange={(o) => !o && setActive(null)}
          base={base}
          state={state}
          action={active.action}
          card={active.card}
          onApply={(s) => { loadScenario(s); setActive(null); }}
          onSave={(name, s) => { saveScenario(name, s); setActive(null); }}
        />
      )}
    </section>
  );
}
