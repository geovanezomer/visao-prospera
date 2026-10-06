// ============================================================================
// BrandingApplier — mantém em sincronia o <style id="branding-colors"> e o
// <link rel="icon"> com app_settings.branding em runtime (após o admin salvar).
//
// O paint inicial NÃO depende deste componente: o SSR já injeta o <style>
// e o <link rel="icon"> no <head> via loader/head() de __root.tsx, evitando
// qualquer "flash" do tema padrão. Aqui só atualizamos quando o cache muda
// (ex.: admin salva novas cores e invalida a query).
// ============================================================================
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAppSettings, type BrandingSetting } from "@/lib/admin/settings.functions";
import { buildBrandingCss } from "@/lib/brandingCss";
import {
  readSettingsCache,
  writeSettingsCache,
  SETTINGS_CACHE_KEY,
  SETTINGS_CHANGE_EVENT,
} from "@/lib/admin/settingsCache";

export function BrandingApplier() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    // Cache localStorage como initialData — branding aparece imediatamente
    // em qualquer navegação client-side, sem aguardar o fetch.
    initialData: readSettingsCache,
    initialDataUpdatedAt: 0,
  });

  // Persiste cada novo payload em localStorage para o próximo cold start.
  useEffect(() => {
    if (data) writeSettingsCache(data);
  }, [data]);

  // Sincronização multi-aba: quando outra aba salva novas configurações
  // (cores, textos, logo, vídeo, etc.), o evento `storage` dispara aqui
  // e nós atualizamos o React Query cache — os effects abaixo reagem na
  // sequência e re-pintam tema/favicon em tempo real, sem reload.
  useEffect(() => {
    const apply = (next: unknown) => {
      if (next && typeof next === "object") {
        queryClient.setQueryData(["app_settings"], next);
      } else {
        queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SETTINGS_CACHE_KEY) return;
      try {
        apply(e.newValue ? JSON.parse(e.newValue) : null);
      } catch {
        /* ignore */
      }
    };
    const onLocal = (e: Event) => {
      apply((e as CustomEvent).detail);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SETTINGS_CHANGE_EVENT, onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SETTINGS_CHANGE_EVENT, onLocal as EventListener);
    };
  }, [queryClient]);

  // Favicon — atualiza apenas o href do <link rel="icon"> já emitido no SSR.
  // NÃO criamos/removemos o nó: o React controla o <head>, e qualquer
  // appendChild/removeChild aqui causa "Failed to execute 'removeChild' on
  // 'Node': The node to be removed is not a child of this node" na próxima
  // reconciliação do head (erro reportado em produção no VPS).
  useEffect(() => {
    const url = (data?.branding as BrandingSetting | undefined)?.favicon_url;
    if (!url) return;
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (link && link.href !== url) link.href = url;
  }, [data]);

  // Cores — atualiza apenas o textContent do <style id="branding-colors">
  // emitido no SSR. Mesmo motivo do favicon: nunca remover/criar o nó.
  // Quando não há cor custom, esvaziamos o conteúdo (volta ao tema padrão).
  useEffect(() => {
    const colors = (data?.branding as BrandingSetting | undefined)?.colors;
    const existing = document.getElementById("branding-colors") as HTMLStyleElement | null;
    if (!existing) return; // SSR garante a presença; se faltar, não forçamos.

    const css = buildBrandingCss(colors) ?? "";
    if (existing.textContent !== css) existing.textContent = css;
  }, [data]);

  return null;
}
