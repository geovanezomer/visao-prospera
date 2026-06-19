// Toggle Mensal/Trimestral/Anual — visual idêntico ao usado no simulador.
import { Button } from "@/components/ui/button";
import type { PeriodView } from "@/engines/sharing/periodAggregation";

export function PeriodToggle({
  view,
  onChange,
}: {
  view: PeriodView;
  onChange: (v: PeriodView) => void;
}) {
  const opts: { id: PeriodView; label: string }[] = [
    { id: "mensal", label: "Mensal" },
    { id: "trimestral", label: "Trimestral" },
    { id: "anual", label: "Anual" },
  ];
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5">
      {opts.map((o) => (
        <Button
          key={o.id}
          variant={view === o.id ? "default" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
