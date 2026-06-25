// ============================================================================
// SystemTab — branding + textos + notificações admin.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAppSettings, updateAppSetting } from "@/lib/admin/settings.functions";
import {
  getNotifSettings, updateNotifSettings, testNotification, type NotifSettings,
} from "@/lib/admin/notifications.functions";

export function SystemTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState({ system_name: "Finnance", logo_url: "", favicon_url: "" });
  const [login, setLogin] = useState({ headline: "", subheadline: "", cta: "Entrar" });
  const [footer, setFooter] = useState({ text: "" });
  const [notif, setNotif] = useState<NotifSettings | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, n] = await Promise.all([getAppSettings(), getNotifSettings()]);
        if (s.branding) setBranding({ system_name: s.branding.system_name ?? "Finnance", logo_url: s.branding.logo_url ?? "", favicon_url: s.branding.favicon_url ?? "" });
        if (s.login_texts) setLogin({ headline: s.login_texts.headline ?? "", subheadline: s.login_texts.subheadline ?? "", cta: s.login_texts.cta ?? "Entrar" });
        if (s.footer) setFooter({ text: s.footer.text ?? "" });
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

  const saveAll = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateAppSetting({ data: { key: "branding", value: branding } }),
        updateAppSetting({ data: { key: "login_texts", value: login } }),
        updateAppSetting({ data: { key: "footer", value: footer } }),
      ]);
      toast.success("Configurações salvas.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setSaving(false); }
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

      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={saveAll} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Salvar tudo
        </Button>
      </div>
    </div>
  );
}
