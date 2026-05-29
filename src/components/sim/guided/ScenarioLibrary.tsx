import { useMemo, useState } from "react";
import { AppState } from "@/lib/finance/types";
import { buildSuggestedScenarios, SuggestedScenario, ParamDef } from "@/lib/finance/guided/scenarios";
import { snapshot } from "@/lib/finance/prescriptive";
import { SimulateDialog } from "../SimulateDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Sparkles, PlayCircle, TrendingUp, Receipt, Users, Wallet, Activity } from "lucide-react";

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
  const [active, setActive] = useState<SuggestedScenario | null>(null);

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-5">
      <header className="mb-3 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Simulações sugeridas</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Cenários personalizáveis: ajuste os parâmetros e veja o impacto antes/depois. Pode salvar como cenário.
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
              <PlayCircle className="mr-1 h-3.5 w-3.5" /> Personalizar e simular
            </Button>
          </div>
        ))}
      </div>

      {active && (
        <ParamScenarioDialog
          key={active.id}
          scenario={active}
          state={state}
          onClose={() => setActive(null)}
          onApply={(s) => { loadScenario(s); setActive(null); }}
          onSave={(name, s) => { saveScenario(name, s); setActive(null); }}
        />
      )}
    </section>
  );
}

// ============ Dialog com parâmetros ============

function ParamScenarioDialog({
  scenario,
  state,
  onClose,
  onApply,
  onSave,
}: {
  scenario: SuggestedScenario;
  state: AppState;
  onClose: () => void;
  onApply: (s: AppState) => void;
  onSave: (name: string, s: AppState) => void;
}) {
  const [params, setParams] = useState<Record<string, number>>(() =>
    Object.fromEntries(scenario.params.map((p) => [p.key, p.default])),
  );
  const base = useMemo(() => snapshot(state), [state]);
  const built = useMemo(() => scenario.build(state, params), [scenario, state, params]);

  const paramsSlot = (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Parâmetros do cenário</div>
      {scenario.params.map((p) => (
        <ParamControl
          key={p.key}
          def={p}
          value={params[p.key]}
          onChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))}
        />
      ))}
    </div>
  );

  return (
    <SimulateDialog
      open={true}
      onOpenChange={(o) => !o && onClose()}
      base={base}
      state={state}
      action={built.action}
      card={built.card}
      onApply={onApply}
      onSave={onSave}
      paramsSlot={paramsSlot}
    />
  );
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
  const suffix =
    def.type === "percent" || def.type === "percent_signed" ? "%" :
    def.type === "days" ? " dias" :
    def.type === "currency" ? "" : "";
  const prefix = def.type === "currency" ? "R$ " : "";
  const display = def.type === "currency"
    ? value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
    : def.type === "integer" || def.type === "days"
    ? value.toFixed(0)
    : value.toFixed(def.step < 1 ? 2 : 0);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-foreground">{def.label}</label>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{prefix}</span>
          <Input
            type="number"
            value={Number.isFinite(value) ? value : 0}
            min={def.min}
            max={def.max}
            step={def.step}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) onChange(Math.min(def.max, Math.max(def.min, v)));
            }}
            className="h-7 w-24 text-right text-xs"
          />
          <span className="text-[10px] text-muted-foreground">{suffix}</span>
        </div>
      </div>
      <Slider
        value={[value]}
        min={def.min}
        max={def.max}
        step={def.step}
        onValueChange={(vals) => onChange(vals[0])}
      />
      <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
        <span>{prefix}{def.min}{suffix}</span>
        <span className="font-mono">{prefix}{display}{suffix}</span>
        <span>{prefix}{def.max}{suffix}</span>
      </div>
      {def.hint && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{def.hint}</p>}
    </div>
  );
}
