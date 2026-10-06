// Barra do modo Odoo no topo do cockpit: visão (Odoo | Simulação livre),
// entidade, janela de 12 meses e status da sincronização.
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarRange,
  CheckCircle2,
  Database,
  FlaskConical,
  XCircle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { computeTrust, type TrustLevel } from "@/engines/odoo/trust";
import { cn } from "@/lib/utils";
import type { OdooCockpit } from "./cockpit";
import { fmtMonth } from "./format";

function since(iso: string | null): string {
  if (!iso) return "nunca sincronizado";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "sincronizado agora";
  if (min < 60) return `sincronizado há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `sincronizado há ${h} h`;
  return `sincronizado em ${new Date(iso).toLocaleDateString("pt-BR")}`;
}

export function OdooBar({ cockpit }: { cockpit: OdooCockpit }) {
  // Celular: uma linha (empresa + luz de saúde); o resto abre no "⋯".
  const [mais, setMais] = useState(false);
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
      className="sticky top-14 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/40 bg-background/95 px-3 py-2 text-xs backdrop-blur sm:px-6"
      data-meeting-hide="true"
    >
      <div
        className={cn(
          "order-3 w-full rounded-md border border-border bg-background p-0.5 md:order-none md:inline-flex md:w-auto [&>button]:flex-1 md:[&>button]:flex-none",
          mais || cockpit.view === "manual" ? "inline-flex" : "hidden",
        )}
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
              <label className="order-1 inline-flex min-w-0 flex-1 items-center gap-1.5 md:order-none md:flex-none">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="sr-only">Empresa</span>
                <select
                  aria-label="Empresa"
                  className="h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 md:w-auto md:max-w-[320px]"
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
              <label
                className={cn(
                  "order-4 w-full items-center gap-1.5 md:order-none md:inline-flex md:w-auto",
                  mais ? "inline-flex" : "hidden",
                )}
              >
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
                <span className="order-5 hidden text-muted-foreground md:order-none md:inline">
                  {fmtMonth(data.months[0])}–{fmtMonth(data.months[data.months.length - 1])}
                </span>
              )}
              <TrustBadge cockpit={cockpit} />
              <button
                type="button"
                className="order-2 rounded border border-border px-2 py-1 md:hidden"
                aria-expanded={mais}
                aria-label="Mais opções do Odoo"
                onClick={() => setMais((v) => !v)}
              >
                ⋯
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

const LEVEL_STYLE: Record<TrustLevel, { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-600", label: "Dados conferidos" },
  warn: { dot: "bg-amber-500", text: "text-amber-600", label: "Dados com ressalvas" },
  error: { dot: "bg-destructive", text: "text-destructive", label: "Dados com problema" },
};

/** Luz de saúde dos dados: verde/âmbar/vermelho, com o detalhe de cada conferência. */
function TrustBadge({ cockpit }: { cockpit: OdooCockpit }) {
  const { snapshot, entity, data, lastError } = cockpit;
  const report = useMemo(
    () => (snapshot && entity && data ? computeTrust(snapshot, entity, data, { lastError }) : null),
    [snapshot, entity, data, lastError],
  );
  if (!report) return null;
  const st = LEVEL_STYLE[report.level];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "order-2 inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium hover:bg-muted md:order-none md:ml-auto",
            st.text,
          )}
          aria-label={`${st.label}: ver conferências`}
        >
          <span className={cn("h-2 w-2 rounded-full", st.dot)} />
          <span className="hidden sm:inline">
            {st.label} · {since(cockpit.syncedAt)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0 text-xs">
        <div className="border-b border-border/60 p-3">
          <p className="font-semibold">Confiabilidade dos dados</p>
          <p className="text-muted-foreground">
            Conferências automáticas sobre o retrato do Odoo de{" "}
            {snapshot ? new Date(snapshot.syncedAt).toLocaleString("pt-BR") : "—"}.
          </p>
        </div>
        <ul className="max-h-[60vh] divide-y divide-border/40 overflow-auto">
          {report.checks.map((c) => (
            <li key={c.id} className="flex gap-2 p-3">
              {c.level === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : c.level === "warn" ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <div>
                <p className="font-medium">{c.title}</p>
                <p className="text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
