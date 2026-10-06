// Barra do modo Odoo no topo do cockpit: visão (Odoo | Simulação livre),
// entidade, janela de 12 meses e status da sincronização.
import { Building2, CalendarRange, Database, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OdooCockpit } from "./cockpit";
import { fmtMonth } from "./format";

function since(iso: string | null): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function OdooBar({ cockpit }: { cockpit: OdooCockpit }) {
  if (!cockpit.available) return null;
  const { snapshot, entity, data } = cockpit;
  const lock = entity?.rootId
    ? snapshot?.companies.find((c) => c.id === entity.rootId)?.lockDate
    : null;
  const months = snapshot?.months ?? [];
  // Só meses com 12 meses de histórico antes; se o retrato for curto, todos.
  const selectable = months.slice(11);
  const options = selectable.length ? selectable : months;

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/40 bg-muted/30 px-4 py-2 text-xs sm:px-6"
      data-meeting-hide="true"
    >
      <div
        className="inline-flex rounded-md border border-border bg-background p-0.5"
        role="radiogroup"
        aria-label="Visão do cockpit"
      >
        <button
          type="button"
          role="radio"
          aria-checked={cockpit.view === "odoo"}
          onClick={() => cockpit.setView("odoo")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium",
            cockpit.view === "odoo"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Database className="h-3 w-3" /> Odoo
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={cockpit.view === "manual"}
          onClick={() => cockpit.setView("manual")}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium",
            cockpit.view === "manual"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
          title="Espaço livre para simulações com dados digitados — não altera nada do Odoo"
        >
          <FlaskConical className="h-3 w-3" /> Simulação livre
        </button>
      </div>

      {cockpit.view === "odoo" && (
        <>
          {cockpit.loading && (
            <span className="text-muted-foreground">Carregando dados do Odoo…</span>
          )}
          {!cockpit.loading && !snapshot && (
            <span className="text-amber-600">
              Nenhuma sincronização ainda — peça ao administrador para sincronizar.
            </span>
          )}
          {snapshot && (
            <>
              <label className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="sr-only">Empresa</span>
                <select
                  aria-label="Empresa"
                  className="h-7 max-w-[320px] rounded border border-border bg-background px-1.5"
                  value={entity?.key ?? ""}
                  onChange={(e) => cockpit.setEntityKey(e.target.value)}
                >
                  {cockpit.entities.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">12 meses até</span>
                <select
                  aria-label="Mês final da análise"
                  className="h-7 rounded border border-border bg-background px-1.5"
                  value={cockpit.endMonth ?? ""}
                  onChange={(e) => cockpit.setEndMonth(e.target.value || null)}
                >
                  <option value="">
                    {lock ? `último mês fechado (${fmtMonth(lock.slice(0, 7))})` : "último mês"}
                  </option>
                  {[...options].reverse().map((m) => (
                    <option key={m} value={m}>
                      {fmtMonth(m)}
                      {lock && m > lock.slice(0, 7) ? " (aberto)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {data && (
                <span className="text-muted-foreground">
                  {fmtMonth(data.months[0])}–{fmtMonth(data.months[data.months.length - 1])}
                </span>
              )}
              <span
                className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground"
                title={cockpit.syncedAt ?? ""}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Odoo sincronizado {since(cockpit.syncedAt)}
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}
