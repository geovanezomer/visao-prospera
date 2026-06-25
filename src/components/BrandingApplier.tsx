// ============================================================================
// BrandingApplier — aplica cores e favicon configurados no admin em runtime.
// Lê app_settings.branding (cores + favicon_url) e injeta:
//  - <link rel="icon"> dinâmico
//  - CSS vars --primary / --primary-foreground / --ring no :root
// Não altera nada se o admin não tiver configurado (mantém defaults do tema).
// ============================================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/admin/settings.functions";

// Heurística simples de contraste: retorna preto ou branco para o foreground.
function contrastForeground(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Luminância perceptual (Rec. 709).
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.55 ? "#0b0f1a" : "#ffffff";
}

export function BrandingApplier() {
  const { data } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
  });

  // Favicon dinâmico.
  useEffect(() => {
    const url = (data?.branding as any)?.favicon_url as string | undefined;
    if (!url) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [data]);

  // Cores principais.
  useEffect(() => {
    const colors = (data?.branding as any)?.colors as
      | { primary?: string; accent?: string }
      | undefined;
    const root = document.documentElement;
    const styleId = "branding-colors";
    const old = document.getElementById(styleId);
    if (old) old.remove();
    if (!colors?.primary) return;

    const fg = contrastForeground(colors.primary);
    const accent = colors.accent ?? colors.primary;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `:root, .dark {
      --primary: ${colors.primary};
      --primary-foreground: ${fg};
      --ring: ${colors.primary};
      --accent: ${accent};
      --sidebar-primary: ${colors.primary};
      --sidebar-primary-foreground: ${fg};
      --sidebar-ring: ${colors.primary};
    }`;
    document.head.appendChild(style);
    // Cleanup defensivo
    return () => style.remove();
  }, [data]);

  return null;
}
