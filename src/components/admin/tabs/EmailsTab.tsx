// ============================================================================
// EmailsTab — configuração Resend + templates editáveis.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getEmailSettings,
  updateEmailSettings,
  sendTestEmail,
  listEmailTemplates,
  updateEmailTemplate,
  type TemplateKind,
} from "@/lib/admin/email.functions";

const KIND_LABEL: Record<TemplateKind, string> = {
  magic_link: "Magic Link (acesso)",
  receipt: "Recibo de pagamento",
  password_reset: "Redefinição de senha",
  refund: "Estorno",
  welcome: "Boas-vindas",
  trial_magic_link: "Acesso de Teste (Trial)",
  payment_failed: "Pagamento recusado (past_due)",
  trial_ending: "Teste terminando em breve",
  subscription_canceled: "Cancelamento de assinatura",
};
const VARS_HINT =
  "Variáveis: {{name}} {{link}} {{amount}} {{plan}} {{hours}} {{system_name}} {{portal_url}} {{plans_url}} {{trial_end}} {{access_end}}";

export function EmailsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState({
    apiKey: "",
    fromEmail: "",
    fromName: "",
    replyTo: "",
    hasApiKey: false,
    apiKeyMasked: "" as string | null,
  });
  const [testTo, setTestTo] = useState("");
  const [busyTest, setBusyTest] = useState(false);

  const [templates, setTemplates] = useState<any[]>([]);
  const [activeKind, setActiveKind] = useState<TemplateKind>("magic_link");
  const active = templates.find((t) => t.kind === activeKind);
  const [edit, setEdit] = useState({ subject: "", html: "", text: "", enabled: true });

  useEffect(() => {
    (async () => {
      try {
        const s = await getEmailSettings();
        setCfg({
          apiKey: "",
          fromEmail: s.fromEmail,
          fromName: s.fromName,
          replyTo: s.replyTo,
          hasApiKey: s.hasApiKey,
          apiKeyMasked: s.apiKeyMasked,
        });
        const t = await listEmailTemplates();
        setTemplates(t.templates);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (active)
      setEdit({
        subject: active.subject,
        html: active.html,
        text: active.text ?? "",
        enabled: active.enabled,
      });
  }, [active]);

  const saveCfg = async () => {
    setSaving(true);
    try {
      await updateEmailSettings({
        data: {
          apiKey: cfg.apiKey || undefined,
          fromEmail: cfg.fromEmail,
          fromName: cfg.fromName,
          replyTo: cfg.replyTo,
        },
      });
      toast.success("Configuração salva.");
      const s = await getEmailSettings();
      setCfg({
        apiKey: "",
        fromEmail: s.fromEmail,
        fromName: s.fromName,
        replyTo: s.replyTo,
        hasApiKey: s.hasApiKey,
        apiKeyMasked: s.apiKeyMasked,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setSaving(false);
    }
  };
  const sendTest = async () => {
    if (!testTo) return toast.error("Informe o destinatário.");
    setBusyTest(true);
    try {
      await sendTestEmail({ data: { to: testTo } });
      toast.success("Teste enviado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyTest(false);
    }
  };
  const saveTpl = async () => {
    setSaving(true);
    try {
      await updateEmailTemplate({
        data: {
          kind: activeKind,
          subject: edit.subject,
          html: edit.html,
          text: edit.text,
          enabled: edit.enabled,
        },
      });
      toast.success("Template salvo.");
      const t = await listEmailTemplates();
      setTemplates(t.templates);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="p-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Resend</h3>
          {cfg.hasApiKey && (
            <Badge variant="outline" className="text-[10px]">
              Chave atual: {cfg.apiKeyMasked}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>API Key</Label>
            <Input
              type="password"
              value={cfg.apiKey}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
              placeholder={cfg.hasApiKey ? "Manter atual (deixar vazio)" : "re_xxx…"}
            />
          </div>
          <div className="space-y-1">
            <Label>From email</Label>
            <Input
              value={cfg.fromEmail}
              onChange={(e) => setCfg({ ...cfg, fromEmail: e.target.value })}
              placeholder="no-reply@dominio.com"
            />
          </div>
          <div className="space-y-1">
            <Label>From name</Label>
            <Input
              value={cfg.fromName}
              onChange={(e) => setCfg({ ...cfg, fromName: e.target.value })}
              placeholder="Finnance"
            />
          </div>
          <div className="space-y-1">
            <Label>Reply-to</Label>
            <Input
              value={cfg.replyTo}
              onChange={(e) => setCfg({ ...cfg, replyTo: e.target.value })}
              placeholder="suporte@…"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-border/40 pt-3">
          <div className="space-y-1">
            <Label>E-mail de teste</Label>
            <Input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="voce@dominio.com"
              className="w-64"
            />
          </div>
          <Button variant="outline" onClick={sendTest} disabled={busyTest}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Enviar teste
          </Button>
          <Button onClick={saveCfg} disabled={saving} className="ml-auto">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Salvar configuração
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold">Templates</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as TemplateKind[]).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={k === activeKind ? "default" : "outline"}
              onClick={() => setActiveKind(k)}
            >
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        {active && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={edit.enabled}
                onCheckedChange={(v) => setEdit({ ...edit, enabled: v })}
              />
              <span className="text-xs text-muted-foreground">
                {edit.enabled ? "Ativo" : "Desativado"}
              </span>
            </div>
            <div className="space-y-1">
              <Label>Assunto</Label>
              <Input
                value={edit.subject}
                onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>
                HTML <span className="text-xs text-muted-foreground">— {VARS_HINT}</span>
              </Label>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                value={edit.html}
                onChange={(e) => setEdit({ ...edit, html: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Texto (fallback)</Label>
              <Textarea
                rows={4}
                value={edit.text}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveTpl} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Salvar template
              </Button>
            </div>
            <details className="rounded border border-border/40 bg-muted/20 p-2">
              <summary className="cursor-pointer text-xs font-medium">Preview HTML</summary>
              <iframe
                sandbox=""
                srcDoc={edit.html}
                className="mt-2 h-64 w-full rounded border border-border/40 bg-white"
              />
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
