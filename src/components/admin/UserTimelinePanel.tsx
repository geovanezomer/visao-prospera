// ============================================================================
// UserTimelinePanel — linha do tempo unificada de eventos do cliente.
// Carrega sob demanda (quando a aba é aberta) para não penalizar o drawer.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getUserTimeline,
  type TimelineItem,
  type TimelineKind,
} from "@/lib/admin/timeline.functions";
import { replayWebhookEvent } from "@/lib/admin/webhooks.functions";

type FilterKind = "all" | "webhook" | "email" | "admin" | "checkout" | "assinatura";

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "checkout", label: "Pagamentos" },
  { id: "webhook", label: "Webhooks" },
  { id: "email", label: "E-mails" },
  { id: "admin", label: "Admin" },
  { id: "assinatura", label: "Assinatura" },
];

const TONE_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-slate-400",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function absTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

export function UserTimelinePanel({ userId, email }: { userId: string; email: string | null }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [replaying, setReplaying] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getUserTimeline({ data: { userId, email } });
      setItems(r.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar linha do tempo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [userId]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return filter === "all" ? items : items.filter((i) => i.kind === filter);
  }, [items, filter]);

  const onReplay = async (id: string) => {
    setReplaying(id);
    try {
      await replayWebhookEvent({ data: { id, force: true } });
      toast.success("Webhook reprocessado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar.");
    } finally {
      setReplaying(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                filter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading && !items ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
          Nenhum evento registrado para este cliente
        </div>
      ) : (
        <ol className="relative space-y-2 border-l border-border/40 pl-4">
          {filtered.map((it) => (
            <TimelineRow
              key={it.id}
              item={it}
              onReplay={onReplay}
              replaying={replaying === it.refId}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineRow({
  item,
  onReplay,
  replaying,
}: {
  item: TimelineItem;
  onReplay: (id: string) => void;
  replaying: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dot = TONE_DOT[item.tone] ?? TONE_DOT.neutral;
  const isFailedWebhook =
    item.kind === "webhook" && (item.tone === "bad" || /failed|dead_letter/.test(item.title));

  return (
    <li className="relative">
      <span
        className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${dot}`}
      />
      <div className="rounded-md border border-border/50 bg-card/50 p-2 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[9px] uppercase">
                {kindLabel(item.kind)}
              </Badge>
              <span className="font-medium">{item.title}</span>
            </div>
            {item.detail && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {open ? "▾ ocultar detalhe" : "▸ detalhe"}
              </button>
            )}
            {open && item.detail && (
              <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-muted/40 p-1.5 text-[10px] text-muted-foreground">
                {item.detail}
              </pre>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[10px] text-muted-foreground" title={absTime(item.at)}>
              {timeAgo(item.at)}
            </span>
            {isFailedWebhook && item.refId && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={() => onReplay(item.refId!)}
                disabled={replaying}
              >
                {replaying ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reprocessar"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function kindLabel(k: TimelineKind): string {
  switch (k) {
    case "webhook":
      return "webhook";
    case "email":
      return "e-mail";
    case "admin":
      return "admin";
    case "checkout":
      return "checkout";
    case "assinatura":
      return "assinatura";
  }
}
