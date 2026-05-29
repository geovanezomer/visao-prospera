import { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HelpTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help text-muted-foreground hover:text-primary">
            <Info className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MoneyInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  return (
    <input
      type="number"
      step="0.01"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={cn(
        "num w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm text-foreground outline-none transition focus:border-primary focus:bg-input/70",
        className,
      )}
    />
  );
}

export function PctInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <input
        type="number"
        step="0.1"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="num w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 pr-6 text-right text-sm outline-none transition focus:border-primary focus:bg-input/70"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  sub,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "pos" | "neg" | "warn";
  sub?: ReactNode;
}) {
  const toneClass =
    tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && <HelpTip text={hint} />}
      </div>
      <div className={cn("mono mt-2 text-2xl font-semibold", toneClass)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
      {hint && <HelpTip text={hint} />}
    </h3>
  );
}
