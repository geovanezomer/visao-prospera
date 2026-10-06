// ============================================================================
// BroadcastsTab — disparo segmentado de e-mails + histórico.
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, Send, Eye, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  previewBroadcastAudience,
  sendBroadcast,
  listBroadcasts,
} from "@/lib/admin/broadcast.functions";
import { TableSkeleton, EmptyState } from "@/components/admin/ui-states";

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function BroadcastsTab() {
  const [plan, setPlan] = useState<"all" | "free" | "starter" | "pro" | "lifetime">("all");
  const [status, setStatus] = useState<
    "all" | "active" | "trialing" | "past_due" | "canceled" | "none"
  >("all");
  const [emailsRaw, setEmailsRaw] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [preview, setPreview] = useState<{ total: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listBroadcasts>>["broadcasts"]>(
    [],
  );
  const [loadingHist, setLoadingHist] = useState(false);

  const segment = () => ({
    plan,
    status,
    emails: emailsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const loadHistory = async () => {
    setLoadingHist(true);
    try {
      const r = await listBroadcasts();
      setHistory(r.broadcasts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar histórico.");
    } finally {
      setLoadingHist(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const doPreview = async () => {
    setBusy(true);
    try {
      const r = await previewBroadcastAudience({ data: { segment: segment() } });
      setPreview(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao prever.");
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (!subject.trim() || !html.trim()) {
      toast.error("Assunto e corpo são obrigatórios.");
      return;
    }
    if (!preview) {
      toast.error("Faça o preview da audiência antes.");
      return;
    }
    if (!confirm(`Enviar para ${preview.total} destinatários?`)) return;
    setBusy(true);
    try {
      const r = await sendBroadcast({ data: { subject, html, segment: segment() } });
      toast.success(`Enviados: ${r.sent} · Falhas: ${r.failed}`);
      setSubject("");
      setHtml("");
      setPreview(null);
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4" />
          Novo broadcast
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Plano</Label>
            <Select
              value={plan}
              onValueChange={(v) => {
                setPlan(v as typeof plan);
                setPreview(null);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="lifetime">Lifetime</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as typeof status);
                setPreview(null);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="trialing">Trialing</SelectItem>
                <SelectItem value="past_due">Past due</SelectItem>
                <SelectItem value="canceled">Canceled</SelectItem>
                <SelectItem value="none">Sem assinatura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3">
            <Label className="text-xs">E-mails específicos (opcional — override do filtro)</Label>
            <Textarea
              rows={2}
              value={emailsRaw}
              onChange={(e) => {
                setEmailsRaw(e.target.value);
                setPreview(null);
              }}
              placeholder="alice@x.com, bob@y.com"
            />
          </div>
          <div className="sm:col-span-3">
            <Label className="text-xs">Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9" />
          </div>
          <div className="sm:col-span-3">
            <Label className="text-xs">Corpo HTML</Label>
            <Textarea
              rows={8}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="<p>Olá,</p><p>...</p>"
              className="font-mono text-xs"
            />
          </div>
        </div>
        {preview && (
          <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            <div className="font-medium">Audiência: {preview.total} destinatário(s)</div>
            {preview.sample.length > 0 && (
              <div className="mt-1 text-muted-foreground">
                Amostra: {preview.sample.join(", ")}
                {preview.total > preview.sample.length ? "…" : ""}
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={doPreview} disabled={busy} size="sm" variant="outline">
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="mr-1.5 h-3.5 w-3.5" />
            )}
            Preview audiência
          </Button>
          <Button onClick={doSend} disabled={busy || !preview} size="sm">
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Enviar
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card">
        <div className="border-b border-border/40 p-3">
          <h3 className="text-sm font-semibold">Histórico</h3>
        </div>
        {loadingHist ? (
          <div className="p-3">
            <TableSkeleton rows={4} cols={4} />
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Nenhum comunicado enviado ainda"
            description="Crie seu primeiro broadcast segmentando por plano ou status."
            action={
              <Button
                size="sm"
                onClick={() =>
                  document.querySelector<HTMLInputElement>("input[aria-label], input")?.focus()
                }
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Criar broadcast
              </Button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Quando</th>
                <th className="p-2 text-left">Assunto</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2 text-right">Enviados / Falhas / Total</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id} className="border-t border-border/40">
                  <td className="p-2 text-muted-foreground">{fmt(b.sent_at ?? b.created_at)}</td>
                  <td className="p-2">{b.subject}</td>
                  <td className="p-2 text-center">
                    <Badge
                      variant="outline"
                      className={
                        b.status === "sent"
                          ? "border-emerald-500/40 text-emerald-600"
                          : b.status === "failed"
                            ? "border-destructive/40 text-destructive"
                            : "border-border text-muted-foreground"
                      }
                    >
                      {b.status}
                    </Badge>
                  </td>
                  <td className="p-2 text-right font-mono text-xs">
                    {b.sent_count} / {b.failed_count} / {b.total_recipients}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
