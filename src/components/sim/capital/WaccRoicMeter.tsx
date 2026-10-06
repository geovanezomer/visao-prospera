import { memo } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { HelpTip } from "@/components/sim/shared/primitives";
import { fmtNum } from "@/engines/finance/format";

// Termômetro WACC × ROIC — visualiza se a empresa cria ou destrói valor.
// `memo`: props são números primitivos → comparação shallow é eficaz e evita
// re-render quando o estado pai muda sem afetar wacc/roic.
function WaccRoicMeterImpl({ wacc, roic }: { wacc: number; roic: number }) {
  const creating = roic >= wacc;
  const delta = roic - wacc;
  const max = Math.max(wacc, roic, 1) * 1.3;
  const waccPct = Math.min(100, (wacc / max) * 100);
  const roicPct = Math.min(100, (Math.max(0, roic) / max) * 100);
  const ringColor = creating ? "var(--success)" : "var(--destructive)";

  return (
    <div
      className="rounded-lg border bg-card/40 p-5"
      style={{ borderColor: `color-mix(in oklab, ${ringColor} 35%, var(--border))` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Termômetro de Valor
            <HelpTip
              text="Compara o que o capital CUSTA (WACC) com o que ele RENDE (ROIC). Se rende mais do que custa, a empresa cria valor."
              formula="ROIC vs. WACC · Spread = ROIC − WACC"
            />
          </div>
          <h3 className="mt-1 text-lg font-semibold flex items-center gap-2">
            {creating ? (
              <>
                <TrendingUp className="h-5 w-5 text-pos" />{" "}
                <span className="text-pos">Criando valor</span>
              </>
            ) : (
              <>
                <TrendingDown className="h-5 w-5 text-neg" />{" "}
                <span className="text-neg">Destruindo valor</span>
              </>
            )}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {creating ? (
              <>
                Cada R$ investido rende{" "}
                <strong className="text-pos">+{fmtNum(delta, 2)} p.p.</strong> acima do custo do
                capital. Mantenha o ritmo e reinvista nas alavancas que sustentam esse spread.
              </>
            ) : (
              <>
                Cada R$ investido rende{" "}
                <strong className="text-neg">{fmtNum(delta, 2)} p.p.</strong> abaixo do custo do
                capital. Para corrigir: melhore margem, gire mais o capital ou reduza o custo da
                dívida.
              </>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spread</div>
          <div className={`mono text-3xl font-bold ${creating ? "text-pos" : "text-neg"}`}>
            {delta >= 0 ? "+" : ""}
            {fmtNum(delta, 2)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">p.p.</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <MeterBar
          label="WACC"
          subLabel="custo do capital"
          value={wacc}
          pct={waccPct}
          color="var(--warning)"
        />
        <MeterBar
          label="ROIC"
          subLabel="retorno entregue"
          value={roic}
          pct={roicPct}
          color={creating ? "var(--success)" : "var(--destructive)"}
        />
      </div>
    </div>
  );
}

function MeterBar({
  label,
  subLabel,
  value,
  pct,
  color,
}: {
  label: string;
  subLabel: string;
  value: number;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span>
          <span className="font-semibold">{label}</span>
          <span className="ml-1.5 text-[10px] text-muted-foreground">{subLabel}</span>
        </span>
        <span className="mono font-semibold" style={{ color }}>
          {fmtNum(value, 2)}%
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-border/30">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export const WaccRoicMeter = memo(WaccRoicMeterImpl);
