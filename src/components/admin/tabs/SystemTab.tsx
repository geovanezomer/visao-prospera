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

// Tipos MIME aceitos por tipo de asset.
const LOGO_MIME = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"] as const;
const FAVICON_MIME = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"] as const;

type ImageRule = {
  label: string;
  accept: readonly string[];
  maxBytes: number;
  minSide?: number;
  maxSide?: number;
  // Razão largura/altura permitida (inclusiva). Ex.: logo quadrado a 2:1 → [1, 2].
  minAspect?: number;
  maxAspect?: number;
};

// Lê um File como data URL após validar tipo, tamanho e dimensões.
// SVG não tem dimensões intrínsecas confiáveis no FileReader; pulamos checagem de px.
function readImageAsDataUrl(file: File, rule: ImageRule): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!rule.accept.includes(file.type)) {
      reject(new Error(`${rule.label}: formato não suportado (${file.type || "desconhecido"}). Use ${rule.accept.map((m) => m.replace("image/", "")).join(", ")}.`));
      return;
    }
    if (file.size > rule.maxBytes) {
      reject(new Error(`${rule.label}: arquivo muito grande (${Math.round(file.size / 1024)} KB). Máx ${Math.round(rule.maxBytes / 1024)} KB.`));
      return;
    }
    const r = new FileReader();
    r.onerror = () => reject(new Error(`${rule.label}: falha ao ler arquivo.`));
    r.onload = () => {
      const dataUrl = String(r.result);
      if (file.type === "image/svg+xml") { resolve(dataUrl); return; }
      const img = new Image();
      img.onerror = () => reject(new Error(`${rule.label}: imagem inválida ou corrompida.`));
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (rule.minSide && (w < rule.minSide || h < rule.minSide)) {
          reject(new Error(`${rule.label}: dimensões muito pequenas (${w}×${h}). Mínimo ${rule.minSide}×${rule.minSide} px.`));
          return;
        }
        if (rule.maxSide && (w > rule.maxSide || h > rule.maxSide)) {
          reject(new Error(`${rule.label}: dimensões muito grandes (${w}×${h}). Máximo ${rule.maxSide}×${rule.maxSide} px.`));
          return;
        }
        const aspect = w / h;
        if (rule.minAspect !== undefined && aspect < rule.minAspect - 0.01) {
          reject(new Error(`${rule.label}: proporção inválida (${w}×${h}). A altura não pode ser maior que a largura.`));
          return;
        }
        if (rule.maxAspect !== undefined && aspect > rule.maxAspect + 0.01) {
          reject(new Error(`${rule.label}: proporção inválida (${w}×${h} ≈ ${aspect.toFixed(2)}:1). Largura não pode passar de ${rule.maxAspect}× a altura.`));
          return;
        }
        resolve(dataUrl);
      };
      img.src = dataUrl;
    };
    r.readAsDataURL(file);
  });
}

// Logo: quadrado (1:1) até retangular 2:1 (largura até 2× altura).
const LOGO_RULE: ImageRule = {
  label: "Logo", accept: LOGO_MIME, maxBytes: 200 * 1024,
  minSide: 64, maxSide: 1024, minAspect: 1, maxAspect: 2,
};
// Favicon: precisa ser quadrado.
const FAVICON_RULE: ImageRule = {
  label: "Favicon", accept: FAVICON_MIME, maxBytes: 50 * 1024,
  minSide: 16, maxSide: 512, minAspect: 1, maxAspect: 1,
};

export function SystemTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState({ headline: "", subheadline: "", cta: "Entrar" });
  const [footer, setFooter] = useState({ text: "" });
  const [tracking, setTracking] = useState({ head: "", body_start: "", body_end: "" });
  const [landingVideo, setLandingVideo] = useState({ enabled: false, url: "" });

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
        <div className="space-y-1">
          <Label>Nome do sistema</Label>
          <Input value={branding.system_name} onChange={(e) => setBranding({ ...branding, system_name: e.target.value })} />
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <p className="text-[11px] text-muted-foreground">PNG/SVG/WebP/JPG · quadrado a 2:1 (largura até 2× a altura) · 64–1024 px por lado · máx 200 KB. Aparece na sidebar, login e header da landing.</p>
          <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex h-12 w-32 items-center justify-center rounded bg-background ring-1 ring-border/50 overflow-hidden">
              {branding.logo_url
                ? <img src={branding.logo_url} alt="logo" className="max-h-full max-w-full object-contain" />
                : <span className="text-[10px] text-muted-foreground">sem logo</span>}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try {
                  const url = await readImageAsDataUrl(f, LOGO_RULE);
                  setBranding({ ...branding, logo_url: url });
                } catch (err) { toast.error(err instanceof Error ? err.message : "Falha"); }
                finally { if (logoInputRef.current) logoInputRef.current.value = ""; }
              }}
            />
            <Button size="sm" variant="outline" onClick={() => logoInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />Fazer upload
            </Button>
            {branding.logo_url && (
              <Button size="sm" variant="ghost" onClick={() => setBranding({ ...branding, logo_url: "" })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Favicon */}
        <div className="space-y-2">
          <Label>Favicon</Label>
          <p className="text-[11px] text-muted-foreground">PNG/ICO/SVG quadrado (1:1) · 16–512 px por lado · máx 50 KB.</p>
          <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-background ring-1 ring-border/50 overflow-hidden">
              {branding.favicon_url
                ? <img src={branding.favicon_url} alt="favicon" className="max-h-full max-w-full object-contain" />
                : <span className="text-[10px] text-muted-foreground">—</span>}
            </div>
            <input
              ref={faviconInputRef}
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try {
                  const url = await readImageAsDataUrl(f, FAVICON_RULE);
                  setBranding({ ...branding, favicon_url: url });
                } catch (err) { toast.error(err instanceof Error ? err.message : "Falha"); }
                finally { if (faviconInputRef.current) faviconInputRef.current.value = ""; }
              }}
            />
            <Button size="sm" variant="outline" onClick={() => faviconInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />Fazer upload
            </Button>
            {branding.favicon_url && (
              <Button size="sm" variant="ghost" onClick={() => setBranding({ ...branding, favicon_url: "" })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Cores principais */}
        <div className="space-y-2">
          <Label>Cores principais</Label>
          <p className="text-[11px] text-muted-foreground">
            Aplicada nos botões, destaques e elementos ativos do sistema. Escolha uma paleta ou personalize.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_PRESETS.map((p) => {
              const active = branding.colors.primary.toLowerCase() === p.primary.toLowerCase();
              return (
                <button
                  key={p.primary}
                  type="button"
                  title={p.label}
                  onClick={() => setBranding({ ...branding, colors: { primary: p.primary, accent: p.accent ?? p.primary } })}
                  className={`relative h-10 rounded-md ring-1 ring-border/50 transition hover:scale-[1.03] ${active ? "ring-2 ring-foreground" : ""}`}
                  style={{ background: `linear-gradient(135deg, ${p.primary} 60%, ${p.accent ?? p.primary})` }}
                >
                  {active && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="space-y-1">
              <Label className="text-[11px]">Primária</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.colors.primary}
                  onChange={(e) => setBranding({ ...branding, colors: { ...branding.colors, primary: e.target.value } })}
                  className="h-8 w-10 cursor-pointer rounded border border-border/50 bg-transparent"
                />
                <Input
                  className="h-8 w-24 font-mono text-xs"
                  value={branding.colors.primary}
                  onChange={(e) => setBranding({ ...branding, colors: { ...branding.colors, primary: e.target.value } })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Acento (escura)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.colors.accent}
                  onChange={(e) => setBranding({ ...branding, colors: { ...branding.colors, accent: e.target.value } })}
                  className="h-8 w-10 cursor-pointer rounded border border-border/50 bg-transparent"
                />
                <Input
                  className="h-8 w-24 font-mono text-xs"
                  value={branding.colors.accent}
                  onChange={(e) => setBranding({ ...branding, colors: { ...branding.colors, accent: e.target.value } })}
                />
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Prévia</span>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white shadow"
                style={{ background: branding.colors.primary }}
              >
                Botão
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Salve as alterações para aplicar em todo o sistema. O contraste do texto é calculado automaticamente.
          </p>
        </div>
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
