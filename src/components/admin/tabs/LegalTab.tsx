// ============================================================================
// LegalTab — admin edita Termos de Uso e Política de Privacidade (WYSIWYG).
// Os textos são publicados nas rotas públicas /termos e /privacidade.
// ============================================================================
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { getAppSettings, updateAppSetting } from "@/lib/admin/settings.functions";
import { DEFAULT_PRIVACY_HTML, DEFAULT_TERMS_HTML } from "@/lib/admin/legalDefaults";
import { sanitizeLegalHtml } from "@/lib/security/sanitizeHtml";

export function LegalTab() {
  const qc = useQueryClient();
  const [terms, setTerms] = useState<string>("");
  const [privacy, setPrivacy] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingTerms, setSavingTerms] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  useEffect(() => {
    (async () => {
      const all = await getAppSettings();
      const legal = (all?.legal ?? {}) as { terms_html?: string; privacy_html?: string };
      setTerms(legal.terms_html || DEFAULT_TERMS_HTML);
      setPrivacy(legal.privacy_html || DEFAULT_PRIVACY_HTML);
      setLoading(false);
    })();
  }, []);

  const save = async (which: "terms" | "privacy") => {
    const set = which === "terms" ? setSavingTerms : setSavingPrivacy;
    set(true);
    try {
      // Defesa em profundidade: sanitiza no SAVE também, não só no render.
      const cleanTerms = sanitizeLegalHtml(terms);
      const cleanPrivacy = sanitizeLegalHtml(privacy);
      const value = { terms_html: cleanTerms, privacy_html: cleanPrivacy };
      await updateAppSetting({ data: { key: "legal", value } });
      await qc.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success(which === "terms" ? "Termos atualizados." : "Política atualizada.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      set(false);
    }
  };

  const restoreDefault = (which: "terms" | "privacy") => {
    if (!window.confirm("Restaurar o texto padrão? Suas alterações serão sobrescritas no editor (só são publicadas após salvar).")) return;
    if (which === "terms") setTerms(DEFAULT_TERMS_HTML);
    else setPrivacy(DEFAULT_PRIVACY_HTML);
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Termos & Privacidade</h2>
        <p className="text-sm text-muted-foreground">
          Edite os textos exibidos nas páginas públicas <code className="rounded bg-muted px-1">/termos</code> e <code className="rounded bg-muted px-1">/privacidade</code>. As alterações são aplicadas imediatamente.
        </p>
      </div>

      <Tabs defaultValue="terms" className="w-full">
        <TabsList>
          <TabsTrigger value="terms">Termos de Uso</TabsTrigger>
          <TabsTrigger value="privacy">Política de Privacidade</TabsTrigger>
        </TabsList>

        <TabsContent value="terms" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Conteúdo dos Termos</Label>
            <a href="/termos" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Ver página publicada
            </a>
          </div>
          <RichTextEditor value={terms} onChange={setTerms} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => restoreDefault("terms")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restaurar padrão
            </Button>
            <Button type="button" onClick={() => save("terms")} disabled={savingTerms}>
              {savingTerms ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Salvar Termos
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="privacy" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Conteúdo da Política de Privacidade</Label>
            <a href="/privacidade" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Ver página publicada
            </a>
          </div>
          <RichTextEditor value={privacy} onChange={setPrivacy} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => restoreDefault("privacy")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restaurar padrão
            </Button>
            <Button type="button" onClick={() => save("privacy")} disabled={savingPrivacy}>
              {savingPrivacy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Salvar Política
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
