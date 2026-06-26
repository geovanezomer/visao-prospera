// ============================================================================
// settingsCache — persistência localStorage do app_settings (branding,
// textos, logo, vídeo, etc.). Usado como `initialData` em useBranding para
// que cores/textos/logo apareçam ANTES de qualquer fetch a cada navegação
// ou cold start no client, eliminando flashes entre páginas/sessões.
// ============================================================================
const KEY = "finance:app_settings:v1";

export function readSettingsCache(): any | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    // sanity: precisa ser objeto
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* ignore quota/SSR/parse errors */
  }
  return undefined;
}

export function writeSettingsCache(data: unknown) {
  if (typeof window === "undefined" || !data) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function clearSettingsCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
