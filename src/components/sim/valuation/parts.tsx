// Subcomponentes pequenos reutilizados pelo ValuationTab.
import { Slider } from "@/components/ui/slider";
import { MoneyInput } from "@/components/sim/shared/primitives";
import { fmtBRLCompact, fmtNum } from "@/engines/finance/format";

export function MultRow({
  label,
  base,
  value,
  onChange,
  ev,
}: {
  label: string;
  base: number;
  value: number;
  onChange: (n: number) => void;
  ev: number;
}) {
  return (
    <tr className="border-b border-border/40">
      <td className="py-2.5 text-foreground">{label}</td>
      <td className="py-2.5 text-right text-muted-foreground">{fmtNum(base, 2)}x</td>
      <td className="py-2.5">
        <div className="ml-auto w-24">
          <MoneyInput value={value} onChange={onChange} />
        </div>
      </td>
      <td className="py-2.5 text-right font-semibold text-foreground">{fmtBRLCompact(ev)}</td>
    </tr>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="mono font-semibold text-foreground">
          {fmtNum(value, step < 1 ? 2 : 0)}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="mt-2"
      />
      {hint && <p className="mt-1.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ConfidenceBadge({ grade }: { grade: string }) {
  const tone =
    grade === "A"
      ? "border-pos/40 bg-pos/10 text-pos"
      : grade === "B"
        ? "border-primary/40 bg-primary/10 text-primary"
        : grade === "C"
          ? "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
          : "border-neg/40 bg-neg/10 text-neg";
  return (
    <div className={`rounded-md border px-3 py-1 text-xs font-semibold ${tone}`}>
      Confiança: {grade}
    </div>
  );
}

export function RangeCard({
  tone,
  label,
  desc,
  value,
  base,
}: {
  tone: "neg" | "primary" | "pos";
  label: string;
  desc: string;
  value: number;
  base: number;
}) {
  const toneClasses =
    tone === "neg"
      ? "border-neg/40 bg-neg/5"
      : tone === "pos"
        ? "border-pos/40 bg-pos/5"
        : "border-primary/40 bg-primary/5";
  const textTone = tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : "text-primary";
  const delta = base !== 0 ? ((value - base) / Math.abs(base)) * 100 : 0;
  return (
    <div className={`rounded-md border p-3 ${toneClasses}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${textTone}`}>
        {label}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{desc}</div>
      <div className={`mono mt-2 text-xl font-bold ${textTone}`}>{fmtBRLCompact(value)}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {value === base
          ? "referência (100%)"
          : `${delta >= 0 ? "+" : ""}${fmtNum(delta, 0)}% vs base`}
      </div>
    </div>
  );
}

export function Reco({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border/40 bg-background/40 p-3">
      <span className="text-base leading-none">{icon}</span>
      <div className="text-xs">
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-muted-foreground">{text}</div>
      </div>
    </li>
  );
}

export function KV({
  k,
  v,
  fmt = "money",
  extra,
}: {
  k: string;
  v: number;
  fmt?: "money" | "pct" | "raw";
  extra?: string;
}) {
  const txt =
    fmt === "money" ? fmtBRLCompact(v) : fmt === "pct" ? `${fmtNum(v, 2)}%` : v.toString();
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="mono mt-0.5 font-semibold text-foreground">
        {txt}
        {extra ? ` ${extra}` : ""}
      </div>
    </div>
  );
}
