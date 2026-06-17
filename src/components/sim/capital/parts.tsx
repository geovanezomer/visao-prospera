// Subcomponentes compartilhados do Balance Sheet / Refinamento Avançado.
// Mantidos pequenos e puros — só recebem props.
import { MoneyInput, HelpTip } from "../primitives";
import { fmtBRL } from "@/engines/finance/format";

export function StepCard({
  step,
  color,
  title,
  subtitle,
  children,
}: {
  step: number;
  color: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border bg-background/40 p-4"
      style={{ borderColor: `color-mix(in oklab, ${color} 30%, var(--border))` }}
    >
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-background"
          style={{ background: color }}
        >
          {step}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color }}>
            {title}
          </div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function SimpleField({
  icon,
  label,
  hint,
  value,
  onChange,
  placeholder,
  emphasis,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${emphasis ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background/40"}`}
    >
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="text-muted-foreground/80">{icon}</span>
        <span className="font-medium text-foreground/90">{label}</span>
        <HelpTip text={hint} />
      </label>
      <MoneyInput
        value={value}
        onChange={onChange}
        className={`mt-1.5 ${emphasis ? "text-base font-semibold" : ""}`}
      />
      {placeholder && (
        <div className="mt-1 text-[9.5px] text-muted-foreground/70">{placeholder}</div>
      )}
    </div>
  );
}

export function MiniStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-2 ${highlight ? "bg-primary/10" : "bg-background/40"} border-r border-border/30 last:border-r-0`}
    >
      <div className="num text-[11px] font-semibold">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

export function SummaryList({
  title,
  color,
  rows,
}: {
  title: string;
  color: string;
  rows: [string, number, boolean?][];
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
        {title}
      </div>
      <div className="space-y-1">
        {rows.map(([label, value, bold], i) => (
          <div
            key={i}
            className={`flex items-center justify-between text-xs ${bold ? "border-t border-border/40 pt-1.5 font-semibold" : ""}`}
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="num">{fmtBRL(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KpiTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "pos" | "warn" | "neg";
  hint: string;
}) {
  const colorCls =
    tone === "pos"
      ? "text-pos border-pos/30 bg-pos/5"
      : tone === "warn"
        ? "text-warning border-warning/30 bg-warning/5"
        : "text-neg border-neg/30 bg-neg/5";
  return (
    <div className={`rounded-md border p-2 ${colorCls}`}>
      <div className="num text-sm font-bold">{value}</div>
      <div className="flex items-center justify-center gap-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {label}
        <HelpTip text={hint} />
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        <HelpTip text={hint} />
      </label>
      <MoneyInput value={value} onChange={onChange} />
      {placeholder && (
        <div className="mt-0.5 text-[9.5px] text-muted-foreground/70">{placeholder}</div>
      )}
    </div>
  );
}
