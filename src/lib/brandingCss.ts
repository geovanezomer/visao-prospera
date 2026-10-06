// ============================================================================
// CSS das cores de marca configuradas no admin.
//
// Usado no SSR (__root, <style> inline antes do primeiro paint) e no cliente
// (BrandingApplier, quando o admin muda as cores). As cores vêm do banco e
// viram texto dentro de <style>: só aceitamos formatos de cor conhecidos,
// para que um valor como `red}</style><script>…` nunca chegue ao HTML.
// ============================================================================

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]{1,60}\)$/i;

export function isSafeCssColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return HEX.test(v) || COLOR_FN.test(v);
}

/** Texto do primeiro plano (claro/escuro) com contraste sobre uma cor hex #rrggbb. */
export function contrastForeground(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.55 ? "#0b0f1a" : "#ffffff";
}

/** CSS das variáveis de tema, ou null quando não há cor válida configurada. */
export function buildBrandingCss(
  colors?: { primary?: string; accent?: string } | null,
): string | null {
  if (!isSafeCssColor(colors?.primary)) return null;
  const primary = colors.primary.trim();
  const accent = isSafeCssColor(colors.accent) ? colors.accent.trim() : primary;
  const fg = contrastForeground(primary);
  return `:root,.dark{--primary:${primary};--primary-foreground:${fg};--ring:${primary};--accent:${accent};--sidebar-primary:${primary};--sidebar-primary-foreground:${fg};--sidebar-ring:${primary};}`;
}
