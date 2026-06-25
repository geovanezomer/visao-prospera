// ============================================================================
// SystemTab — branding + textos + notificações admin.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Send, Upload, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAppSettings, updateAppSetting } from "@/lib/admin/settings.functions";
import {
  getNotifSettings, updateNotifSettings, testNotification, type NotifSettings,
} from "@/lib/admin/notifications.functions";

// Paletas pré-definidas (cor primária). O sistema deriva foreground/ring automaticamente.
const COLOR_PRESETS: { label: string; primary: string; accent?: string }[] = [
  { label: "Verde Esmeralda (padrão)", primary: "#10b981", accent: "#0f3a2e" },
  { label: "Azul Profissional",        primary: "#2563eb", accent: "#0c2340" },
  { label: "Roxo Premium",             primary: "#7c3aed", accent: "#2e1065" },
  { label: "Laranja Energia",          primary: "#f97316", accent: "#3b1f0a" },
  { label: "Rosa Moderno",             primary: "#ec4899", accent: "#3d0f29" },
  { label: "Ciano Tech",               primary: "#06b6d4", accent: "#0b3a44" },
  { label: "Âmbar Premium",            primary: "#d4a017", accent: "#3a2e0b" },
  { label: "Vermelho Bold",            primary: "#ef4444", accent: "#3a0e0e" },
];

type Branding = {
  system_name: string;
  logo_url: string;
  favicon_url: string;
  colors: { primary: string; accent: string };
};
const DEFAULT_BRANDING: Branding = {
  system_name: "Finnance",
  logo_url: "",
  favicon_url: "",
  colors: { primary: "#10b981", accent: "#0f3a2e" },
};

// Lê um File como data URL com limite de tamanho.
function readAsDataUrl(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`Arquivo muito grande (máx ${Math.round(maxBytes / 1024)} KB).`));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Falha ao ler arquivo."));
    r.readAsDataURL(file);
  });
}

export function SystemTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState({ headline: "", subheadline: "", cta: "Entrar" });
  const [footer, setFooter] = useState({ text: "" });
  const [tracking, setTracking] = useState({ head: "", body_start: "", body_end: "" });
  const [notif, setNotif] = useState<NotifSettings | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, n] = await Promise.all([getAppSettings(), getNotifSettings()]);
        if (s.branding) setBranding({
          system_name: s.branding.system_name ?? DEFAULT_BRANDING.system_name,
          logo_url: s.branding.logo_url ?? "",
          favicon_url: s.branding.favicon_url ?? "",
          colors: {
            primary: s.branding.colors?.primary ?? DEFAULT_BRANDING.colors.primary,
            accent:  s.branding.colors?.accent  ?? DEFAULT_BRANDING.colors.accent,
          },
        });
        if (s.login_texts) setLogin({ headline: s.login_texts.headline ?? "", subheadline: s.login_texts.subheadline ?? "", cta: s.login_texts.cta ?? "Entrar" });
        if (s.footer) setFooter({ text: s.footer.text ?? "" });
        if ((s as any).tracking) {
          const t = (s as any).tracking;
          setTracking({ head: t.head ?? "", body_start: t.body_start ?? "", body_end: t.body_end ?? "" });
        }
        setNotif(n);
      } finally { setLoading(false); }
    })();
  }, []);

  const saveAll = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateAppSetting({ data: { key: "branding", value: branding } }),
        updateAppSetting({ data: { key: "login_texts", value: login } }),
        updateAppSetting({ data: { key: "footer", value: footer } }),
        updateAppSetting({ data: { key: "tracking", value: tracking } }),
        notif ? updateNotifSettings({ data: notif }) : Promise.resolve(),
      ]);
      toast.success("Configurações salvas.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setSaving(false); }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await testNotification();
      toast.success(r.sent ? "Notificação enviada." : `Não enviou: ${r.reason ?? "config incompleta"}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
    finally { setTesting(false); }
  };


  if (loading) return <div className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold">Marca</h3>
        <div className="space-y-1"><Label>Nome do sistema</Label><Input value={branding.system_name} onChange={(e) => setBranding({ ...branding, system_name: e.target.value })} /></div>
        <div className="space-y-1"><Label>URL do logo</Label><Input value={branding.logo_url} onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })} placeholder="https://…/logo.png" /></div>
        <div className="space-y-1"><Label>URL do favicon</Label><Input value={branding.favicon_url} onChange={(e) => setBranding({ ...branding, favicon_url: e.target.value })} placeholder="https://…/favicon.ico" /></div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold">Tela de Login</h3>
        <div className="space-y-1"><Label>Headline</Label><Input value={login.headline} onChange={(e) => setLogin({ ...login, headline: e.target.value })} /></div>
        <div className="space-y-1"><Label>Subheadline</Label><Textarea rows={3} value={login.subheadline} onChange={(e) => setLogin({ ...login, subheadline: e.target.value })} /></div>
        <div className="space-y-1"><Label>CTA</Label><Input value={login.cta} onChange={(e) => setLogin({ ...login, cta: e.target.value })} /></div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold">Rodapé</h3>
        <div className="space-y-1"><Label>Texto</Label><Input value={footer.text} onChange={(e) => setFooter({ text: e.target.value })} /></div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
        <div>
          <h3 className="text-sm font-semibold">Scripts de rastreamento</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cole aqui os snippets de <strong>Google Analytics (GA4)</strong>, <strong>Google Tag Manager</strong> e <strong>Meta Pixel</strong>.
            Inclua as tags <code className="rounded bg-muted px-1">&lt;script&gt;…&lt;/script&gt;</code> completas.
            Os snippets são injetados em todas as páginas após a carga inicial.
          </p>
        </div>

        <div className="space-y-1">
          <Label>JavaScript Head <span className="text-muted-foreground">(antes de &lt;/head&gt;)</span></Label>
          <Textarea
            rows={6}
            className="font-mono text-[11px]"
            value={tracking.head}
            onChange={(e) => setTracking({ ...tracking, head: e.target.value })}
            placeholder={`<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){…})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>\n\n<!-- Meta Pixel -->\n<script>!function(f,b,e,v,n,t,s){…}(window,…);fbq('init','XXXXXXXXXX');fbq('track','PageView');</script>`}
          />
          <p className="text-[11px] text-muted-foreground">Recomendado para: GA4 (gtag.js), GTM principal, Meta Pixel (fbq).</p>
        </div>

        <div className="space-y-1">
          <Label>JavaScript Body Start <span className="text-muted-foreground">(logo após &lt;body&gt;)</span></Label>
          <Textarea
            rows={4}
            className="font-mono text-[11px]"
            value={tracking.body_start}
            onChange={(e) => setTracking({ ...tracking, body_start: e.target.value })}
            placeholder={`<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`}
          />
          <p className="text-[11px] text-muted-foreground">Obrigatório para o fallback &lt;noscript&gt; do GTM.</p>
        </div>

        <div className="space-y-1">
          <Label>JavaScript Footer <span className="text-muted-foreground">(antes de &lt;/body&gt;)</span></Label>
          <Textarea
            rows={4}
            className="font-mono text-[11px]"
            value={tracking.body_end}
            onChange={(e) => setTracking({ ...tracking, body_end: e.target.value })}
            placeholder={`<!-- Scripts diferidos: chat, hotjar, fallbacks <noscript>, etc. -->`}
          />
          <p className="text-[11px] text-muted-foreground">Para scripts pesados/diferidos e fallback &lt;noscript&gt; do Meta Pixel.</p>
        </div>
      </section>

      {notif && (
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Notificações do administrador</h3>
            <Button size="sm" variant="outline" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Testar
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Slack webhook URL</Label>
              <Input value={notif.slackWebhookUrl ?? ""} onChange={(e) => setNotif({ ...notif, slackWebhookUrl: e.target.value || null })} placeholder="https://hooks.slack.com/services/…" />
            </div>
            <div className="space-y-1">
              <Label>E-mail destino</Label>
              <Input type="email" value={notif.emailTo ?? ""} onChange={(e) => setNotif({ ...notif, emailTo: e.target.value || null })} placeholder="admin@empresa.com" />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(["signup", "churn", "past_due", "webhook_failure"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 rounded border border-border/40 px-2 py-1.5 text-xs">
                <Switch checked={notif.events[k]} onCheckedChange={(c) => setNotif({ ...notif, events: { ...notif.events, [k]: c } })} />
                <span>{k}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={saveAll} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Salvar tudo
        </Button>
      </div>
    </div>
  );
}
