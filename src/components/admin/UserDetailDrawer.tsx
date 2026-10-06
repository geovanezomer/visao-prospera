// ============================================================================
// UserDetailDrawer — painel lateral com o perfil completo de um usuário.
// Abas: Resumo · Assinaturas · Webhooks · Auditoria · Ações.
// "Ações" inclui conceder plano manual (trial/ativo/lifetime) e impersonar.
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, Copy, ExternalLink, Gift, UserCog, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getUserDetail,
  grantManualPlan,
  impersonateUser,
  type UserDetail,
} from "@/lib/admin/userDetail.functions";
import { UserNotesPanel } from "./UserNotesPanel";
import { UserSessionsPanel } from "./UserSessionsPanel";
import { UserTimelinePanel } from "./UserTimelinePanel";

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function UserDetailDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const d = await getUserDetail({ data: { userId } });
      setDetail(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      setDetail(null);
      void load();
    } /* eslint-disable-next-line */
  }, [userId]);

  return (
    <Sheet open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{detail?.user.displayName ?? "Usuário"}</SheetTitle>
          <SheetDescription>{detail?.user.email ?? "—"}</SheetDescription>
        </SheetHeader>

        {loading && !detail ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : detail ? (
          <Tabs defaultValue="resumo" className="mt-4">
            <TabsList className="grid w-full grid-cols-8">
              <TabsTrigger value="resumo">Resumo</TabsTrigger>
              <TabsTrigger value="assinaturas">Assin.</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="notas">Notas</TabsTrigger>
              <TabsTrigger value="sessoes">Sessões</TabsTrigger>
              <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
              <TabsTrigger value="auditoria">Audit.</TabsTrigger>
              <TabsTrigger value="acoes">Ações</TabsTrigger>
            </TabsList>

            <TabsContent value="resumo" className="space-y-2 pt-3 text-sm">
              <Row label="ID">{detail.user.id}</Row>
              <Row label="E-mail">{detail.user.email}</Row>
              <Row label="Telefone">{detail.user.phone ?? "—"}</Row>
              <Row label="Provider login">{detail.user.provider ?? "email"}</Row>
              <Row label="E-mail confirmado">
                {detail.user.emailConfirmedAt
                  ? "Sim · " + fmt(detail.user.emailConfirmedAt)
                  : "Não"}
              </Row>
              <Row label="Criado em">{fmt(detail.user.createdAt)}</Row>
              <Row label="Último login">{fmt(detail.user.lastSignInAt)}</Row>
              <Row label="Banido até">{fmt(detail.user.bannedUntil)}</Row>
            </TabsContent>

            <TabsContent value="assinaturas" className="pt-3">
              {detail.subscriptions.length === 0 ? (
                <Empty>Sem assinaturas registradas.</Empty>
              ) : (
                <div className="space-y-2">
                  {detail.subscriptions.map((s) => (
                    <div key={s.id} className="rounded-md border border-border/60 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{s.plan ?? "—"}</Badge>
                          <Badge variant="outline">{s.status ?? "—"}</Badge>
                          <span className="text-muted-foreground">{s.provider ?? "—"}</span>
                        </div>
                        <span className="text-muted-foreground">{fmt(s.createdAt)}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-muted-foreground">
                        <div>Expira: {fmt(s.currentPeriodEnd)}</div>
                        <div>Cancel @ end: {s.cancelAtPeriodEnd ? "sim" : "não"}</div>
                        <div className="col-span-2 truncate">
                          Sub: {s.stripeSubscriptionId ?? "—"}
                        </div>
                        <div className="col-span-2 truncate">Cust: {s.customerId ?? "—"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="pt-3">
              {/* Lazy: só monta (e chama getUserTimeline) quando a aba é aberta. */}
              <UserTimelinePanel userId={detail.user.id} email={detail.user.email} />
            </TabsContent>

            <TabsContent value="notas" className="pt-3">
              <UserNotesPanel userId={detail.user.id} />
            </TabsContent>

            <TabsContent value="sessoes" className="pt-3">
              <UserSessionsPanel userId={detail.user.id} />
            </TabsContent>

            <TabsContent value="webhooks" className="pt-3">
              {detail.webhookEvents.length === 0 ? (
                <Empty>Sem eventos relacionados.</Empty>
              ) : (
                <div className="space-y-1">
                  {detail.webhookEvents.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between rounded border border-border/40 px-2 py-1 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px]">
                          {e.provider}
                        </Badge>
                        <span className="font-mono">{e.eventType}</span>
                        <Badge
                          variant={e.status === "processed" ? "default" : "destructive"}
                          className="text-[9px]"
                        >
                          {e.status}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground">{fmt(e.receivedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="auditoria" className="pt-3">
              {detail.auditEntries.length === 0 ? (
                <Empty>Sem ações registradas para este usuário.</Empty>
              ) : (
                <div className="space-y-1">
                  {detail.auditEntries.map((a) => (
                    <div key={a.id} className="rounded border border-border/40 px-2 py-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono">{a.action}</span>
                        <span className="text-muted-foreground">{fmt(a.createdAt)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        por {a.actorEmail ?? "—"} · {a.resource}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="acoes" className="space-y-4 pt-3">
              <GrantPlanForm
                userId={detail.user.id}
                onDone={() => {
                  void load();
                  onChanged?.();
                }}
              />
              <ImpersonateForm userId={detail.user.id} />
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border/30 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium break-all">{children}</span>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Conceder plano manual
// ----------------------------------------------------------------------------
function GrantPlanForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [plan, setPlan] = useState<"starter" | "pro" | "lifetime">("pro");
  const [mode, setMode] = useState<"trial" | "ativo" | "lifetime">("trial");
  const [days, setDays] = useState("14");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const durationDays = mode === "lifetime" ? undefined : Number(days);
      if (mode !== "lifetime" && (!Number.isFinite(durationDays) || durationDays! <= 0)) {
        throw new Error("Duração inválida.");
      }
      const r = await grantManualPlan({
        data: { userId, plan, mode, durationDays, reason: reason || undefined },
      });
      toast.success(`Plano concedido (${r.status}).`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Gift className="h-4 w-4 text-primary" /> Conceder plano manual
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Plano</Label>
          <Select value={plan} onValueChange={(v) => setPlan(v as any)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="lifetime">Lifetime</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Modo</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="ativo">Ativo (cortesia)</SelectItem>
              <SelectItem value="lifetime">Lifetime (sem expirar)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode !== "lifetime" && (
          <div className="col-span-2">
            <Label className="text-xs">Duração (dias)</Label>
            <Input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              className="h-9"
            />
          </div>
        )}
        <div className="col-span-2">
          <Label className="text-xs">Motivo</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cortesia de parceria"
            className="h-9"
          />
        </div>
      </div>
      <Button onClick={submit} disabled={busy} className="mt-3 w-full" size="sm">
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        Conceder
      </Button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Impersonar (gera magic link de uso único)
// ----------------------------------------------------------------------------
function ImpersonateForm({ userId }: { userId: string }) {
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await impersonateUser({ data: { userId, reason: reason || undefined } });
      setLink(r.link);
      toast.success("Link gerado. Abra em aba anônima.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <UserCog className="h-4 w-4 text-amber-600" /> Impersonar usuário
      </div>
      <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        Gera um magic link de uso único. Abra em aba anônima para não derrubar sua sessão de admin.
        A ação fica auditada.
      </div>
      <Label className="text-xs">Motivo</Label>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ex.: investigar bug reportado"
        className="h-9"
      />
      <Button onClick={submit} disabled={busy} variant="outline" className="mt-2 w-full" size="sm">
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        Gerar magic link
      </Button>
      {link && (
        <div className="mt-2 space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Link (10 min)
          </Label>
          <div className="flex gap-1">
            <Input readOnly value={link} className="h-8 font-mono text-[10px]" />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => {
                navigator.clipboard.writeText(link);
                toast.success("Copiado.");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
