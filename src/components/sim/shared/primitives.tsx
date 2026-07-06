import { ReactNode, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type HelpHint =
  | string
  | { description: string; formula?: string; calc?: string; example?: string };

export function HelpTip({
  text,
  formula,
  calc,
  example,
}: {
  text: string;
  formula?: string;
  /** Memória de cálculo: fórmula resolvida com os números atuais. */
  calc?: string;
  example?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={0}
            aria-label={`Ajuda: ${text}`}
            className="inline-flex cursor-help text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm space-y-2 bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg border border-border">
          <div className="text-foreground">{text}</div>
          {formula && (
            <div className="rounded border border-border/60 bg-muted/40 px-2 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fórmula
              </div>
              <div className="mono mt-0.5 text-[11px] text-primary">{formula}</div>
              {calc && (
                <>
                  <div className="mt-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Memória de cálculo
                  </div>
                  <div className="mono mt-0.5 text-[11px] text-foreground/90 whitespace-pre-line">
                    {calc}
                  </div>
                </>
              )}
            </div>
          )}
          {example && (
            <div className="text-[11px] italic text-muted-foreground">Ex.: {example}</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


export function renderHint(hint: HelpHint | undefined) {
  if (!hint) return null;
  if (typeof hint === "string") return <HelpTip text={hint} />;
  return (
    <HelpTip
      text={hint.description}
      formula={hint.formula}
      calc={hint.calc}
      example={hint.example}
    />
  );
}

function numToText(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  // Use dot as canonical separator; allow user to type either . or ,
  return String(n);
}

function parseLoose(s: string): number {
  if (!s) return 0;
  // Accept both Brazilian comma and dot
  const normalized = s.replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function MoneyInput({
  value,
  onChange,
  className,
  readOnly,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  readOnly?: boolean;
}) {
  const [text, setText] = useState<string>(() => numToText(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current && parseLoose(text) !== value) {
      setText(numToText(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const n = parseLoose(text);
        setText(numToText(n));
      }}
      onChange={(e) => {
        if (readOnly) return;
        const raw = e.target.value.replace(/[^0-9.,-]/g, "");
        setText(raw);
        onChange(parseLoose(raw));
      }}
      className={cn(
        "num w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm text-foreground outline-none transition focus:border-primary focus:bg-input/70",
        readOnly && "cursor-not-allowed opacity-60 focus:border-border/60 focus:bg-input/40",
        className,
      )}
    />
  );
}

export function NumInput({
  value,
  onChange,
  integer = false,
  min,
  max,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  integer?: boolean;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [text, setText] = useState<string>(() => numToText(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current && parseLoose(text) !== value) {
      setText(numToText(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const clamp = (n: number) => {
    let v = integer ? Math.trunc(n) : n;
    if (typeof min === "number" && v < min) v = min;
    if (typeof max === "number" && v > max) v = max;
    return v;
  };

  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        // Normaliza pelo texto digitado (não pela prop, que pode estar defasada).
        const n = clamp(parseLoose(text));
        if (n !== value) onChange(n);
        setText(numToText(n));
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(integer ? /[^0-9-]/g : /[^0-9.,-]/g, "");
        setText(raw);
        if (raw === "" || raw === "-") {
          onChange(0);
        } else {
          onChange(clamp(parseLoose(raw)));
        }
      }}
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
  const [text, setText] = useState<string>(() => numToText(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current && parseLoose(text) !== value) {
      setText(numToText(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn("relative", className)}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          setText(numToText(parseLoose(text)));
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.,-]/g, "");
          setText(raw);
          onChange(parseLoose(raw));
        }}
        className="num w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 pr-6 text-right text-sm outline-none transition focus:border-primary focus:bg-input/70"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        %
      </span>
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
  hint?: HelpHint;
  tone?: "default" | "pos" | "neg" | "warn";
  sub?: ReactNode;
}) {
  const toneClass =
    tone === "pos"
      ? "text-pos"
      : tone === "neg"
        ? "text-neg"
        : tone === "warn"
          ? "text-[var(--warning)]"
          : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-border/80">
      <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground sm:text-[10px]">
        {label}
        {renderHint(hint)}
      </div>
      <div
        className={cn(
          "mono mt-0.5 text-sm font-semibold leading-tight sm:text-lg lg:text-xl break-words",
          toneClass,
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: HelpHint }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
      {renderHint(hint)}
    </h3>
  );
}
