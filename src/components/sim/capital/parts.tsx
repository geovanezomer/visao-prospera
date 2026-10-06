// Componentes visuais compartilhados pelos cards da aba Capital.
// API consumida por BalanceSheetCard, AberturaCard etc.
import { ReactNode } from "react";
import { Info } from "lucide-react";
import { MoneyInput } from "@/components/sim/shared/primitives";
import { cn } from "@/lib/utils";

/** Card numerado com cabeçalho colorido e área de conteúdo. */
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
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-card/50 p-4 shadow-sm"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <header className="mb-3 flex items-baseline gap-2">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-background"
          style={{ background: color }}
        >
          {step}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

/** Campo monetário com ícone, label e hint inline. */
export function SimpleField({
  icon,
  label,
  hint,
  value,
  onChange,
  placeholder,
  emphasis,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  emphasis?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 p-2.5 text-[11px]",
        emphasis && "border-primary/50 bg-primary/5",
      )}
    >
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        {icon}
        <span>{label}</span>
        {hint && (
          <span title={hint} className="ml-auto inline-flex cursor-help text-muted-foreground">
            <Info className="h-3 w-3" />
          </span>
        )}
      </span>
      <MoneyInput value={value} onChange={onChange} />
      {placeholder && <span className="text-[10px] text-muted-foreground">{placeholder}</span>}
    </label>
  );
}

/** Mini KPI tile usado nas réguas do BalanceSheetCard. */
export function MiniStat({
  label,
  value,
  highlight,
  hint,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  /** Tooltip nativo (title) — usado para explicar memória de cálculo. */
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "border-r border-border/40 px-2 py-1.5 last:border-r-0",
        highlight && "bg-primary/10",
      )}
      title={hint}
    >
      <div className="text-muted-foreground inline-flex items-center gap-1">
        {label}
        {hint && (
          <span
            aria-label="Ajuda"
            className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-muted-foreground/40 text-[8px] leading-none text-muted-foreground cursor-help"
          >
            ?
          </span>
        )}
      </div>
      <div className="num font-semibold text-foreground">{value}</div>
    </div>
  );
}
