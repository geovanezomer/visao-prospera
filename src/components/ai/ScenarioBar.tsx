// Barra de Cenários & Alavancas rápidas — fica acima do input do chat.
// 1) Chips de cenários salvos (clique = carrega; ×= soft delete) com badge da data.
// 2) "Salvar atual" captura o simParams ativo.
// 3) Painel colapsável de sliders das alavancas mais impactantes —
//    cada arraste dispara `gz-apply-simulator-params` em tempo real, e o
//    `routes/index.tsx` já aplica no simulador (simulatedState recalcula).

import { useMemo, useState } from "react";
import { Bookmark, Plus, Sliders, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScenarios, saveScenario, deleteScenario } from "@/engines/scenarios/store";
import { DEFAULT_SIM, countActiveLevers, type SimulatorParams } from "@/engines/finance/simulator";
import { toast } from "sonner";

interface Props {
  company: string;
  simParams?: SimulatorParams;
}

// Dispara o evento global que routes/index.tsx escuta.
function applyParams(params: Partial<SimulatorParams> | null) {
  try {
    window.dispatchEvent(new CustomEvent("gz-apply-simulator-params", { detail: params }));
  } catch {
    /* SSR */
  }
}

function relativeDate(ts: number): string {
  const diffH = (Date.now() - ts) / 3_600_000;
  if (diffH < 1) return "agora";
  if (diffH < 24) return `${Math.round(diffH)}h atrás`;
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ScenarioBar({ company, simParams }: Props) {
  const scenarios = useScenarios(company || "default");
  const whatif = scenarios.filter((s) => s.kind !== "historical");
  const [openSliders, setOpenSliders] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [openSave, setOpenSave] = useState(false);

  const active = useMemo(() => simParams ?? DEFAULT_SIM, [simParams]);
  const activeLevers = useMemo(() => countActiveLevers(active), [active]);

  const handleSave = () => {
    const name = saveName.trim() || `Cenário ${new Date().toLocaleString("pt-BR")}`;
    saveScenario(company || "default", {
      name,
      params: activeLevers > 0 ? active : undefined,
    });
    toast.success(`Cenário "${name}" salvo`);
    setSaveName("");
    setOpenSave(false);
  };

  // Setter parcial que mescla com os params ativos e propaga ao simulador.
  const set = (patch: Partial<SimulatorParams>) => applyParams({ ...active, ...patch });

  if (whatif.length === 0 && activeLevers === 0) {
    // Render mínimo: só o botão de alavancas (mantém descoberta da feature).
    return (
      <div className="flex items-center justify-end px-1">
        <SlidersButton
          open={openSliders}
          setOpen={setOpenSliders}
          active={active}
          set={set}
          onReset={() => applyParams(null)}
          activeLevers={activeLevers}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {/* Chips de cenários salvos */}
      {whatif.slice(0, 6).map((s) => (
        <div
          key={s.id}
          className="group inline-flex items-center gap-1 rounded-full border border-border/60 bg-background pl-2.5 pr-1 py-0.5 text-[11px] hover:border-primary/60 transition-colors"
        >
          <Bookmark className="h-3 w-3 text-primary" />
          <button
            onClick={() => applyParams(s.params ?? null)}
            className="font-medium hover:text-primary"
            title={`Carregar "${s.name}" (salvo ${relativeDate(s.updatedAt)})`}
          >
            {s.name}
          </button>
          <span className="text-[10px] text-muted-foreground">· {relativeDate(s.updatedAt)}</span>
          <button
            onClick={() => {
              deleteScenario(company || "default", s.id);
              toast.message(`Cenário "${s.name}" removido`);
            }}
            className="ml-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition"
            title="Excluir cenário"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {/* Salvar cenário atual */}
      <Popover open={openSave} onOpenChange={setOpenSave}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-primary"
          >
            <Plus className="h-3 w-3 mr-1" /> salvar
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <p className="text-xs font-medium mb-2">
            Salvar {activeLevers > 0 ? `${activeLevers} alavanca(s) ativa(s)` : "cenário base"}
          </p>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Nome do cenário"
            className="h-8 text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button size="sm" className="w-full mt-2 h-7 text-xs" onClick={handleSave}>
            Salvar
          </Button>
        </PopoverContent>
      </Popover>

      <div className="ml-auto" />

      <SlidersButton
        open={openSliders}
        setOpen={setOpenSliders}
        active={active}
        set={set}
        onReset={() => applyParams(null)}
        activeLevers={activeLevers}
      />
    </div>
  );
}

// ─── Popover com sliders das alavancas mais impactantes ─────────────────

interface SlidersButtonProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  active: SimulatorParams;
  set: (patch: Partial<SimulatorParams>) => void;
  onReset: () => void;
  activeLevers: number;
}

function SlidersButton({ open, setOpen, active, set, onReset, activeLevers }: SlidersButtonProps) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={activeLevers > 0 ? "default" : "outline"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          title="Alavancas rápidas (arraste para simular em tempo real)"
        >
          <Sliders className="h-3 w-3 mr-1" />
          alavancas{activeLevers > 0 ? ` (${activeLevers})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-3" align="end">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Simulação em tempo real</p>
          {activeLevers > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground"
              onClick={onReset}
            >
              <Trash2 className="h-3 w-3 mr-1" /> zerar
            </Button>
          )}
        </div>

        <SliderRow
          label="Preço de venda"
          unit="%"
          min={-30}
          max={30}
          value={active.priceDeltaPct}
          onChange={(v) => set({ priceDeltaPct: v })}
        />
        <SliderRow
          label="Volume"
          unit="%"
          min={-50}
          max={50}
          value={active.volumeDeltaPct}
          onChange={(v) => set({ volumeDeltaPct: v })}
        />
        <SliderRow
          label="Folha (encargos)"
          unit="%"
          min={-30}
          max={30}
          value={active.payrollDeltaPct}
          onChange={(v) => set({ payrollDeltaPct: v })}
          invertColor
        />
        <SliderRow
          label="Corte custos fixos (top 3)"
          unit="%"
          min={0}
          max={50}
          value={active.fixedCutPct}
          onChange={(v) => set({ fixedCutPct: v })}
          positiveIsGood
        />
        <SliderRow
          label="PMP (prazo fornecedor)"
          unit="d"
          min={0}
          max={60}
          value={active.pmpDeltaDays}
          onChange={(v) => set({ pmpDeltaDays: v })}
          positiveIsGood
        />
        <SliderRow
          label="PMR (prazo recebimento)"
          unit="d"
          min={-60}
          max={0}
          value={active.pmrDeltaDays}
          onChange={(v) => set({ pmrDeltaDays: v })}
          positiveIsGood
        />

        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          Arraste para ver o impacto na DRE, indicadores e fluxo de caixa em tempo real.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SliderRow({
  label,
  unit,
  min,
  max,
  value,
  onChange,
  invertColor,
  positiveIsGood,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  invertColor?: boolean;
  positiveIsGood?: boolean;
}) {
  // Cor do badge: corte de folha negativa = ruim para os funcionários mas bom p/ EBITDA.
  // positiveIsGood: valores >0 são "bons"; invertColor: inverte a lógica padrão.
  const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
  const good = positiveIsGood ? sign > 0 : invertColor ? sign < 0 : sign !== 0;
  const color = sign === 0 ? "text-muted-foreground" : good ? "text-emerald-500" : "text-amber-500";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-foreground/80">{label}</span>
        <span className={`font-mono font-semibold ${color}`}>
          {value > 0 ? "+" : ""}
          {value}
          {unit}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? 0)}
      />
    </div>
  );
}
