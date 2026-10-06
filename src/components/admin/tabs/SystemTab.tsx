// ============================================================================
// SystemTab — branding + textos + notificações admin.
// ============================================================================
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Send, Upload, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAppSettings, updateAppSetting } from "@/lib/admin/settings.functions";
import {
  getNotifSettings,
  updateNotifSettings,
  testNotification,
  type NotifSettings,
} from "@/lib/admin/notifications.functions";
import {
  SETTINGS_CACHE_KEY,
  SETTINGS_CHANGE_EVENT,
  writeSettingsCache,
} from "@/lib/admin/settingsCache";
import { BrandedLogo } from "@/components/BrandedLogo";

// Paletas pré-definidas (cor primária). O sistema deriva foreground/ring automaticamente.
const COLOR_PRESETS: { label: string; primary: string; accent?: string }[] = [
  { label: "Verde Esmeralda (padrão)", primary: "#10b981", accent: "#0f3a2e" },
  { label: "Azul Profissional", primary: "#2563eb", accent: "#0c2340" },
  { label: "Roxo Premium", primary: "#7c3aed", accent: "#2e1065" },
  { label: "Laranja Energia", primary: "#f97316", accent: "#3b1f0a" },
  { label: "Rosa Moderno", primary: "#ec4899", accent: "#3d0f29" },
  { label: "Ciano Tech", primary: "#06b6d4", accent: "#0b3a44" },
  { label: "Âmbar Premium", primary: "#d4a017", accent: "#3a2e0b" },
  { label: "Vermelho Bold", primary: "#ef4444", accent: "#3a0e0e" },
];

type Branding = {
  system_name: string;
  logo_url: string;
  favicon_url: string;
  author_photo_url: string;
  recolor_logo: boolean;
  colors: { primary: string; accent: string };
};
const DEFAULT_BRANDING: Branding = {
  system_name: "Finnance",
  logo_url: "",
  favicon_url: "",
  author_photo_url: "",
  recolor_logo: false,
  colors: { primary: "#10b981", accent: "#0f3a2e" },
};

// Tipos MIME aceitos por tipo de asset.
const LOGO_MIME = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"] as const;
const FAVICON_MIME = [
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
] as const;

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
      reject(
        new Error(
          `${rule.label}: formato não suportado (${file.type || "desconhecido"}). Use ${rule.accept.map((m) => m.replace("image/", "")).join(", ")}.`,
        ),
      );
      return;
    }
    if (file.size > rule.maxBytes) {
      reject(
        new Error(
          `${rule.label}: arquivo muito grande (${Math.round(file.size / 1024)} KB). Máx ${Math.round(rule.maxBytes / 1024)} KB.`,
        ),
      );
      return;
    }
    const r = new FileReader();
    r.onerror = () => reject(new Error(`${rule.label}: falha ao ler arquivo.`));
    r.onload = () => {
      const dataUrl = String(r.result);
      if (file.type === "image/svg+xml") {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error(`${rule.label}: imagem inválida ou corrompida.`));
      img.onload = () => {
        const w = img.naturalWidth,
          h = img.naturalHeight;
        if (rule.minSide && (w < rule.minSide || h < rule.minSide)) {
          reject(
            new Error(
              `${rule.label}: dimensões muito pequenas (${w}×${h}). Mínimo ${rule.minSide}×${rule.minSide} px.`,
            ),
          );
          return;
        }
        if (rule.maxSide && (w > rule.maxSide || h > rule.maxSide)) {
          reject(
            new Error(
              `${rule.label}: dimensões muito grandes (${w}×${h}). Máximo ${rule.maxSide}×${rule.maxSide} px.`,
            ),
          );
          return;
        }
        const aspect = w / h;
        if (rule.minAspect !== undefined && aspect < rule.minAspect - 0.01) {
          reject(
            new Error(
              `${rule.label}: proporção inválida (${w}×${h}). A altura não pode ser maior que a largura.`,
            ),
          );
          return;
        }
        if (rule.maxAspect !== undefined && aspect > rule.maxAspect + 0.01) {
          reject(
            new Error(
              `${rule.label}: proporção inválida (${w}×${h} ≈ ${aspect.toFixed(2)}:1). Largura não pode passar de ${rule.maxAspect}× a altura.`,
            ),
          );
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
  label: "Logo",
  accept: LOGO_MIME,
  maxBytes: 200 * 1024,
  minSide: 64,
  maxSide: 1024,
  minAspect: 1,
  maxAspect: 2,
};
// Favicon: precisa ser quadrado.
const FAVICON_RULE: ImageRule = {
  label: "Favicon",
  accept: FAVICON_MIME,
  maxBytes: 50 * 1024,
  minSide: 16,
  maxSide: 512,
  minAspect: 1,
  maxAspect: 1,
};
// Foto do autor: quadrada, ideal 512×512.
const AUTHOR_PHOTO_RULE: ImageRule = {
  label: "Foto do autor",
  accept: ["image/png", "image/jpeg", "image/webp"] as const,
  maxBytes: 500 * 1024,
  minSide: 128,
  maxSide: 1024,
  minAspect: 1,
  maxAspect: 1,
};

export function SystemTab() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const authorInputRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState({ headline: "", subheadline: "", cta: "Entrar" });
  const [footer, setFooter] = useState({ text: "" });
  const [tracking, setTracking] = useState({ head: "", body_start: "", body_end: "" });
  const [landingVideo, setLandingVideo] = useState({ enabled: false, url: "" });
  const [trial, setTrial] = useState({ enabled: false, duration_hours: 2 });

  const [notif, setNotif] = useState<NotifSettings | null>(null);
  const [testing, setTesting] = useState(false);

  // Hidrata o estado local a partir do payload completo do app_settings.
  // Usado no mount inicial e em eventos de sincronização multi-aba.
  const hydrateFromSettings = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const s = raw as {
      branding?: {
        system_name?: string;
        logo_url?: string;
        favicon_url?: string;
        author_photo_url?: string;
        recolor_logo?: boolean;
        colors?: { primary?: string; accent?: string };
      };
      login_texts?: { headline?: string; subheadline?: string; cta?: string };
      footer?: { text?: string };
      tracking?: { head?: string; body_start?: string; body_end?: string };
      landing_video?: { enabled?: boolean; url?: string };
      trial?: { enabled?: boolean; duration_hours?: number };
    };
    if (s.branding)
      setBranding({
        system_name: s.branding.system_name ?? DEFAULT_BRANDING.system_name,
        logo_url: s.branding.logo_url ?? "",
        favicon_url: s.branding.favicon_url ?? "",
        author_photo_url: s.branding.author_photo_url ?? "",
        recolor_logo: Boolean(s.branding.recolor_logo),
        colors: {
          primary: s.branding.colors?.primary ?? DEFAULT_BRANDING.colors.primary,
          accent: s.branding.colors?.accent ?? DEFAULT_BRANDING.colors.accent,
        },
      });
    if (s.login_texts)
      setLogin({
        headline: s.login_texts.headline ?? "",
        subheadline: s.login_texts.subheadline ?? "",
        cta: s.login_texts.cta ?? "Entrar",
      });
    if (s.footer) setFooter({ text: s.footer.text ?? "" });
    if (s.tracking)
      setTracking({
        head: s.tracking.head ?? "",
        body_start: s.tracking.body_start ?? "",
        body_end: s.tracking.body_end ?? "",
      });
    if (s.landing_video)
      setLandingVideo({
        enabled: Boolean(s.landing_video.enabled),
        url: s.landing_video.url ?? "",
      });
    if (s.trial)
      setTrial({
        enabled: Boolean(s.trial.enabled),
        duration_hours: Math.min(72, Math.max(1, Number(s.trial.duration_hours ?? 2))),
      });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [s, n] = await Promise.all([getAppSettings(), getNotifSettings()]);
        hydrateFromSettings(s);
        setNotif(n);
      } finally {
        setLoading(false);
      }
    })();
  }, [hydrateFromSettings]);

  // Sincronização multi-aba: quando outra aba salva app_settings, atualiza
  // o preview do admin (foto do autor, cores, logo, textos) em tempo real.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SETTINGS_CACHE_KEY || !e.newValue) return;
      try {
        hydrateFromSettings(JSON.parse(e.newValue));
      } catch {
        /* ignore */
      }
    };
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) hydrateFromSettings(detail);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SETTINGS_CHANGE_EVENT, onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SETTINGS_CHANGE_EVENT, onLocal as EventListener);
    };
  }, [hydrateFromSettings]);

  const saveAll = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateAppSetting({ data: { key: "branding", value: branding } }),
        updateAppSetting({ data: { key: "login_texts", value: login } }),
        updateAppSetting({ data: { key: "footer", value: footer } }),
        updateAppSetting({ data: { key: "tracking", value: tracking } }),
        updateAppSetting({ data: { key: "landing_video", value: landingVideo } }),
        updateAppSetting({ data: { key: "trial", value: trial } }),

        notif ? updateNotifSettings({ data: notif }) : Promise.resolve(),
      ]);
      // Atualiza o cache do React Query + localStorage imediatamente para
      // que LandingPage, login, sidebar, etc. reflitam sem aguardar refetch,
      // e dispara storage event para sincronizar todas as abas abertas.
      const fresh = await getAppSettings();
      queryClient.setQueryData(["app_settings"], fresh);
      writeSettingsCache(fresh);
      toast.success("Configurações salvas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await testNotification();
      toast.success(
        r.sent ? "Notificação enviada." : `Não enviou: ${r.reason ?? "config incompleta"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setTesting(false);
    }
  };

  if (loading)
    return (
      <div className="p-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold">Marca</h3>
        <div className="space-y-1">
          <Label>Nome do sistema</Label>
          <Input
            value={branding.system_name}
            onChange={(e) => setBranding({ ...branding, system_name: e.target.value })}
          />
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <p className="text-[11px] text-muted-foreground">
            PNG/SVG/WebP/JPG · quadrado a 2:1 (largura até 2× a altura) · 64–1024 px por lado · máx
            200 KB. Aparece na sidebar, login e header da landing.
          </p>
          <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex h-12 w-32 items-center justify-center rounded bg-background ring-1 ring-border/50 overflow-hidden">
              {branding.logo_url ? (
                <BrandedLogo
                  src={branding.logo_url}
                  alt="logo"
                  recolor={branding.recolor_logo}
                  color={branding.colors.primary}
                  className="max-h-full max-w-full [&>svg]:max-h-12 [&>svg]:max-w-[128px] [&>svg]:h-auto [&>svg]:w-auto"
                  imgProps={{ className: "max-h-full max-w-full object-contain" }}
                />
              ) : (
                <span className="text-[10px] text-muted-foreground">sem logo</span>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await readImageAsDataUrl(f, LOGO_RULE);
                  setBranding({ ...branding, logo_url: url });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha");
                } finally {
                  if (logoInputRef.current) logoInputRef.current.value = "";
                }
              }}
            />
            <Button size="sm" variant="outline" onClick={() => logoInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Fazer upload
            </Button>
            {branding.logo_url && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBranding({ ...branding, logo_url: "" })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {/* Toggle: aplicar cor primária em logos SVG */}
          <div className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
            <div className="space-y-0.5">
              <Label className="text-xs">Aplicar cor do sistema na logo (SVG)</Label>
              <p className="text-[11px] text-muted-foreground">
                Substitui as cores do SVG por <code>currentColor</code> e usa a cor primária do
                branding. Funciona apenas para arquivos <strong>.svg</strong>. PNG/JPG/WebP
                permanecem inalterados.
              </p>
            </div>
            <Switch
              checked={branding.recolor_logo}
              onCheckedChange={(v) => setBranding({ ...branding, recolor_logo: v })}
            />
          </div>
        </div>

        {/* Favicon */}
        <div className="space-y-2">
          <Label>Favicon</Label>
          <p className="text-[11px] text-muted-foreground">
            PNG/ICO/SVG quadrado (1:1) · 16–512 px por lado · máx 50 KB.
          </p>
          <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-background ring-1 ring-border/50 overflow-hidden">
              {branding.favicon_url ? (
                <img
                  src={branding.favicon_url}
                  alt="favicon"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[10px] text-muted-foreground">—</span>
              )}
            </div>
            <input
              ref={faviconInputRef}
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await readImageAsDataUrl(f, FAVICON_RULE);
                  setBranding({ ...branding, favicon_url: url });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha");
                } finally {
                  if (faviconInputRef.current) faviconInputRef.current.value = "";
                }
              }}
            />
            <Button size="sm" variant="outline" onClick={() => faviconInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Fazer upload
            </Button>
            {branding.favicon_url && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBranding({ ...branding, favicon_url: "" })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Foto do autor (Landing — bloco "Construído por quem vive isso") */}
        <div className="space-y-2">
          <Label>Foto do autor (Landing Page)</Label>
          <p className="text-[11px] text-muted-foreground">
            PNG/JPG/WebP quadrado (1:1) · recomendado <strong>512×512 px</strong> (mín 128, máx
            1024) · máx 500 KB. Substitui o avatar "GZ" do bloco de autoridade na landing.
          </p>
          <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-background ring-1 ring-border/50">
              {branding.author_photo_url ? (
                <img
                  src={branding.author_photo_url}
                  alt="foto"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs font-semibold text-muted-foreground">GZ</span>
              )}
            </div>
            <input
              ref={authorInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await readImageAsDataUrl(f, AUTHOR_PHOTO_RULE);
                  setBranding({ ...branding, author_photo_url: url });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha");
                } finally {
                  if (authorInputRef.current) authorInputRef.current.value = "";
                }
              }}
            />
            <Button size="sm" variant="outline" onClick={() => authorInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Fazer upload
            </Button>
            {branding.author_photo_url && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBranding({ ...branding, author_photo_url: "" })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Cores principais */}
        <div className="space-y-2">
          <Label>Cores principais</Label>
          <p className="text-[11px] text-muted-foreground">
            Aplicada nos botões, destaques e elementos ativos do sistema. Escolha uma paleta ou
            personalize.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_PRESETS.map((p) => {
              const active = branding.colors.primary.toLowerCase() === p.primary.toLowerCase();
              return (
                <button
                  key={p.primary}
                  type="button"
                  title={p.label}
                  onClick={() =>
                    setBranding({
                      ...branding,
                      colors: { primary: p.primary, accent: p.accent ?? p.primary },
                    })
                  }
                  className={`relative h-10 rounded-md ring-1 ring-border/50 transition hover:scale-[1.03] ${active ? "ring-2 ring-foreground" : ""}`}
                  style={{
                    background: `linear-gradient(135deg, ${p.primary} 60%, ${p.accent ?? p.primary})`,
                  }}
                >
                  {active && (
                    <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                  )}
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
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      colors: { ...branding.colors, primary: e.target.value },
                    })
                  }
                  className="h-8 w-10 cursor-pointer rounded border border-border/50 bg-transparent"
                />
                <Input
                  className="h-8 w-24 font-mono text-xs"
                  value={branding.colors.primary}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      colors: { ...branding.colors, primary: e.target.value },
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Acento (escura)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.colors.accent}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      colors: { ...branding.colors, accent: e.target.value },
                    })
                  }
                  className="h-8 w-10 cursor-pointer rounded border border-border/50 bg-transparent"
                />
                <Input
                  className="h-8 w-24 font-mono text-xs"
                  value={branding.colors.accent}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      colors: { ...branding.colors, accent: e.target.value },
                    })
                  }
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
            Salve as alterações para aplicar em todo o sistema. O contraste do texto é calculado
            automaticamente.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold">Tela de Login</h3>
        <div className="space-y-1">
          <Label>Headline</Label>
          <Input
            value={login.headline}
            onChange={(e) => setLogin({ ...login, headline: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Subheadline</Label>
          <Textarea
            rows={3}
            value={login.subheadline}
            onChange={(e) => setLogin({ ...login, subheadline: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>CTA</Label>
          <Input value={login.cta} onChange={(e) => setLogin({ ...login, cta: e.target.value })} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold">Rodapé</h3>
        <div className="space-y-1">
          <Label>Texto</Label>
          <Input value={footer.text} onChange={(e) => setFooter({ text: e.target.value })} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
        <div>
          <h3 className="text-sm font-semibold">Scripts de rastreamento</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cole aqui os snippets de <strong>Google Analytics (GA4)</strong>,{" "}
            <strong>Google Tag Manager</strong> e <strong>Meta Pixel</strong>. Inclua as tags{" "}
            <code className="rounded bg-muted px-1">&lt;script&gt;…&lt;/script&gt;</code> completas.
            Os snippets são injetados em todas as páginas após a carga inicial.
          </p>
        </div>

        <div className="space-y-1">
          <Label>
            JavaScript Head <span className="text-muted-foreground">(antes de &lt;/head&gt;)</span>
          </Label>
          <Textarea
            rows={6}
            className="font-mono text-[11px]"
            value={tracking.head}
            onChange={(e) => setTracking({ ...tracking, head: e.target.value })}
            placeholder={`<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){…})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>\n\n<!-- Meta Pixel -->\n<script>!function(f,b,e,v,n,t,s){…}(window,…);fbq('init','XXXXXXXXXX');fbq('track','PageView');</script>`}
          />
          <p className="text-[11px] text-muted-foreground">
            Recomendado para: GA4 (gtag.js), GTM principal, Meta Pixel (fbq).
          </p>
        </div>

        <div className="space-y-1">
          <Label>
            JavaScript Body Start{" "}
            <span className="text-muted-foreground">(logo após &lt;body&gt;)</span>
          </Label>
          <Textarea
            rows={4}
            className="font-mono text-[11px]"
            value={tracking.body_start}
            onChange={(e) => setTracking({ ...tracking, body_start: e.target.value })}
            placeholder={`<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`}
          />
          <p className="text-[11px] text-muted-foreground">
            Obrigatório para o fallback &lt;noscript&gt; do GTM.
          </p>
        </div>

        <div className="space-y-1">
          <Label>
            JavaScript Footer{" "}
            <span className="text-muted-foreground">(antes de &lt;/body&gt;)</span>
          </Label>
          <Textarea
            rows={4}
            className="font-mono text-[11px]"
            value={tracking.body_end}
            onChange={(e) => setTracking({ ...tracking, body_end: e.target.value })}
            placeholder={`<!-- Scripts diferidos: chat, hotjar, fallbacks <noscript>, etc. -->`}
          />
          <p className="text-[11px] text-muted-foreground">
            Para scripts pesados/diferidos e fallback &lt;noscript&gt; do Meta Pixel.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Vídeo "Como Funciona" — Landing Page</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Exibe um botão <strong>"Assista ao Vídeo"</strong> abaixo dos cards da seção "Como
              funciona" na landing page. Ao clicar, abre um lightbox com o vídeo do YouTube embebed.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={landingVideo.enabled}
              onCheckedChange={(c) => setLandingVideo({ ...landingVideo, enabled: c })}
            />
            <span>{landingVideo.enabled ? "Ativo" : "Desativado"}</span>
          </label>
        </div>
        <div className="space-y-1">
          <Label>URL do vídeo (YouTube)</Label>
          <Input
            value={landingVideo.url}
            onChange={(e) => setLandingVideo({ ...landingVideo, url: e.target.value })}
            placeholder="https://www.youtube.com/watch?v=XXXXXXXXXXX"
          />
          <p className="text-[11px] text-muted-foreground">
            Cole o link completo do YouTube (watch, youtu.be ou /embed/). Controles padrão do player
            do YouTube.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Teste gratuito (Trial) — Landing Page</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando ativo, exibe o botão <strong>"Solicitar teste"</strong> na landing. O usuário
              recebe um link mágico por e-mail (Resend) e tem acesso completo pelo período definido.
              Após o término, a sessão é encerrada automaticamente e ele é direcionado para a seção
              de planos. Um e-mail só pode solicitar teste uma única vez.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={trial.enabled}
              onCheckedChange={(c) => setTrial({ ...trial, enabled: c })}
            />
            <span>{trial.enabled ? "Ativo" : "Desativado"}</span>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Duração do teste (horas)</Label>
            <Input
              type="number"
              min={1}
              max={72}
              step={1}
              value={trial.duration_hours}
              onChange={(e) =>
                setTrial({
                  ...trial,
                  duration_hours: Math.min(72, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Entre 1 e 72 horas. Recomendado: 2h.
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-[11px] text-muted-foreground">
            Requer template <strong>"Acesso de Teste (Trial)"</strong> ativo na aba{" "}
            <strong>E-mails</strong> e credenciais Resend configuradas (chave e remetente).
          </div>
        </div>
      </section>

      {notif && (
        <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Notificações do administrador</h3>
            <Button size="sm" variant="outline" onClick={runTest} disabled={testing}>
              {testing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Testar
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Slack webhook URL</Label>
              <Input
                value={notif.slackWebhookUrl ?? ""}
                onChange={(e) => setNotif({ ...notif, slackWebhookUrl: e.target.value || null })}
                placeholder="https://hooks.slack.com/services/…"
              />
            </div>
            <div className="space-y-1">
              <Label>E-mail destino</Label>
              <Input
                type="email"
                value={notif.emailTo ?? ""}
                onChange={(e) => setNotif({ ...notif, emailTo: e.target.value || null })}
                placeholder="admin@empresa.com"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(["signup", "churn", "past_due", "webhook_failure"] as const).map((k) => (
              <label
                key={k}
                className="flex items-center gap-2 rounded border border-border/40 px-2 py-1.5 text-xs"
              >
                <Switch
                  checked={notif.events[k]}
                  onCheckedChange={(c) =>
                    setNotif({ ...notif, events: { ...notif.events, [k]: c } })
                  }
                />
                <span>{k}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={saveAll} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          Salvar tudo
        </Button>
      </div>
    </div>
  );
}
