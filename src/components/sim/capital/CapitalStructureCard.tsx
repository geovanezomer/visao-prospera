import { AppState } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { Slider } from "@/components/ui/slider";
import { Wallet, Landmark } from "lucide-react";
import { PctInput, SectionTitle, HelpTip } from "../primitives";

// Card "De onde vem o dinheiro" — slider de proporção + custos Ke/Kd com presets.
export function CapitalStructureCard({
  proprio,
  terceiros,
  ke,
  kd,
  patrimonioLiquido,
  dividaOnerosa,
  derived,
  onChange,
}: {
  proprio: number;
  terceiros: number;
  ke: number;
  kd: number;
  patrimonioLiquido: number;
  dividaOnerosa: number;
  /** true quando proprio% é derivado de PL/D reais — slider vira leitura. */
  derived: boolean;
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  const PL = Math.max(0, patrimonioLiquido);
  const D = Math.max(0, dividaOnerosa);
  const totalFinanc = PL + D;
  const hasAbs = totalFinanc > 0;
  const valSocios = hasAbs ? PL : 0;
  const valBancos = hasAbs ? D : 0;

  // Diagnóstico de alavancagem — usa PL/D não-negativos.
  const dpl = PL > 0 ? D / PL : 0;
  let alavMsg = "";
  let alavTone: "pos" | "warn" | "neg" | "muted" = "muted";
  if (hasAbs) {
    if (patrimonioLiquido < 0) {
      alavMsg = "Patrimônio líquido negativo — passivo a descoberto. D/PL perde sentido.";
      alavTone = "neg";
    } else if (dpl > 2) {
      alavMsg = `Endividamento alto: D/PL = ${dpl.toFixed(1)}× (saudável ≤ 2×)`;
      alavTone = "neg";
    } else if (dpl >= 0.5) {
      alavMsg = `Alavancagem equilibrada: D/PL = ${dpl.toFixed(1)}×`;
      alavTone = "pos";
    } else if (dpl > 0) {
      alavMsg = `Pouco alavancada: D/PL = ${dpl.toFixed(1)}× — espaço para usar mais dívida`;
      alavTone = "warn";
    } else {
      alavMsg = "Sem dívida onerosa: empresa 100% financiada pelos sócios";
      alavTone = "pos";
    }
  }
  const toneCls =
    alavTone === "neg"
      ? "text-neg"
      : alavTone === "warn"
        ? "text-warning"
        : alavTone === "pos"
          ? "text-pos"
          : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
      <div>
        <SectionTitle hint="Proporção entre capital dos sócios e dívida com terceiros. Define a 'mistura' do combustível da empresa.">
          De onde vem o dinheiro da empresa
        </SectionTitle>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Estrutura de Capital
        </div>
      </div>

      <div>
        <div className="relative flex h-12 w-full overflow-hidden rounded-md border border-border/40">
          <div
            className="flex items-center justify-start bg-pos/80 px-3 text-[11px] font-semibold text-background transition-all"
            style={{ width: `${proprio}%` }}
          >
            {proprio >= 12 && (
              <span className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                Sócios {proprio.toFixed(0)}%
              </span>
            )}
          </div>
          <div
            className="flex items-center justify-end bg-warning/80 px-3 text-[11px] font-semibold text-background transition-all"
            style={{ width: `${terceiros}%` }}
          >
            {terceiros >= 12 && (
              <span className="flex items-center gap-1.5">
                Bancos {terceiros.toFixed(0)}%
                <Landmark className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </div>
        <Slider
          value={[proprio]}
          min={0}
          max={100}
          step={1}
          disabled={derived}
          onValueChange={([v]) => !derived && onChange({ proprio: v })}
          className="mt-3"
        />
        {derived && (
          <p className="mt-1 text-[10px] text-muted-foreground/80 italic">
            Proporção calculada automaticamente a partir do Patrimônio Líquido e da Dívida Onerosa
            informados abaixo. Ajuste pelos campos em R$ para alterar.
          </p>
        )}
        {hasAbs && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Sua empresa é financiada por{" "}
            <span className="font-semibold text-pos">{fmtBRL(valSocios)}</span> dos sócios e{" "}
            <span className="font-semibold text-warning">{fmtBRL(valBancos)}</span> de bancos.
          </p>
        )}
        {alavMsg && <p className={`mt-1 text-[11px] font-medium ${toneCls}`}>{alavMsg}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Ke — Quanto os sócios querem ganhar (a.a.)
            <HelpTip
              text="Retorno mínimo exigido pelos sócios para aceitar o risco do negócio. Quem investe em empresa precisa ganhar mais do que na renda fixa."
              formula="CAPM: Rf + β × (Rm − Rf)"
              example="Selic 10% + Prêmio de risco 8% = 18%"
            />
          </label>
          <PctInput value={ke} onChange={(n) => onChange({ ke: n })} />
          <PresetRow
            label="Sugestões:"
            presets={[
              { label: "Estável 12%", value: 12 },
              { label: "Crescimento 18%", value: 18 },
              { label: "Alto risco 25%", value: 25 },
            ]}
            onPick={(v) => onChange({ ke: v })}
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Kd — Juros dos bancos (a.a.)
            <HelpTip
              text="Taxa média anual paga em empréstimos e financiamentos, ANTES do benefício fiscal (juros são dedutíveis do IR)."
              formula="Custo efetivo = Kd × (1 − Alíquota IR)"
            />
          </label>
          <PctInput value={kd} onChange={(n) => onChange({ kd: n })} />
          <PresetRow
            label="Selic ≈ 11% · spread PJ +6 a +12%:"
            presets={[
              { label: "Capital giro 18%", value: 18 },
              { label: "BNDES 14%", value: 14 },
              { label: "Cartão/cheque 25%", value: 25 },
            ]}
            onPick={(v) => onChange({ kd: v })}
          />
        </div>
      </div>
    </div>
  );
}

function PresetRow({
  label,
  presets,
  onPick,
}: {
  label: string;
  presets: { label: string; value: number }[];
  onPick: (n: number) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p.value)}
          className="rounded-full border border-border/40 bg-background/40 px-2 py-0.5 text-foreground transition hover:border-primary/60 hover:text-primary"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
