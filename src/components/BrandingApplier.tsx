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
import { useQuery } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/admin/settings.functions";

function contrastForeground(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.55 ? "#0b0f1a" : "#ffffff";
}

export function BrandingApplier() {
  const { data } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
  });

  // Favicon — substitui o href do <link rel="icon"> existente (SSR ou default).
  useEffect(() => {
    const url = (data?.branding as any)?.favicon_url as string | undefined;
    if (!url) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (link.href !== url) link.href = url;
  }, [data]);

  // Cores — reusa/atualiza o <style id="branding-colors"> emitido no SSR.
  // Como o id é o mesmo, não há duplicação e não há flash em saves do admin.
  useEffect(() => {
    const colors = (data?.branding as any)?.colors as
      | { primary?: string; accent?: string }
      | undefined;
    const styleId = "branding-colors";
    const existing = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!colors?.primary) {
      // Admin removeu as cores customizadas — remove o override.
      if (existing) existing.remove();
      return;
    }

    const fg = contrastForeground(colors.primary);
    const accent = colors.accent ?? colors.primary;
    const css = `:root,.dark{--primary:${colors.primary};--primary-foreground:${fg};--ring:${colors.primary};--accent:${accent};--sidebar-primary:${colors.primary};--sidebar-primary-foreground:${fg};--sidebar-ring:${colors.primary};}`;

    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
    } else {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }, [data]);

  return null;
}
