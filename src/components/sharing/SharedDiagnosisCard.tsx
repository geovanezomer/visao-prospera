// Diagnóstico read-only.
import type { ShareSnapshot } from "@/engines/sharing/types";

export function SharedDiagnosisCard({ snapshot }: { snapshot: ShareSnapshot }) {
  const items = snapshot.diagnostics;

  if (items.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Diagnóstico</h2>
        <p className="text-sm text-muted-foreground">
          Nenhum alerta estratégico identificado.
        </p>
      </section>
    );
  }

  const colorClass = (lvl: string) =>
    lvl === "danger"
      ? "border-destructive/40 bg-destructive/5"
      : lvl === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-emerald-500/40 bg-emerald-500/5";

  const badgeClass = (lvl: string) =>
    lvl === "danger"
      ? "bg-destructive text-destructive-foreground"
      : lvl === "warn"
        ? "bg-amber-500 text-white"
        : "bg-emerald-500 text-white";

  const badgeLabel = (lvl: string) =>
    lvl === "danger" ? "Crítico" : lvl === "warn" ? "Atenção" : "OK";

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Diagnóstico Estratégico</h2>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className={`rounded-md border p-3 ${colorClass(it.level)}`}>
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeClass(it.level)}`}>
                {badgeLabel(it.level)}
              </span>
              <div>
                <p className="text-sm font-medium">{it.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{it.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
