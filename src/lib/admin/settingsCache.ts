// ============================================================================
// settingsCache — persistência localStorage do app_settings (branding,
// textos, logo, vídeo, etc.). Usado como `initialData` em useBranding para
// que cores/textos/logo apareçam ANTES de qualquer fetch a cada navegação
// ou cold start no client, eliminando flashes entre páginas/sessões.
//
// Sincronização multi-aba: escrever no localStorage dispara nativamente o
// evento `storage` em OUTRAS abas/janelas. Para também notificar a aba que
// fez o write (mesma aba não recebe `storage`), emitimos um CustomEvent
// `app_settings:changed` no window. Consumidores (BrandingApplier) ouvem
// ambos e atualizam o React Query cache em tempo real.
// ============================================================================
export const SETTINGS_CACHE_KEY = "finance:app_settings:v1";
export const SETTINGS_CHANGE_EVENT = "app_settings:changed";

export function readSettingsCache(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* ignore quota/SSR/parse errors */
  }
  return undefined;
}

export function writeSettingsCache(data: unknown) {
  if (typeof window === "undefined" || !data) return;
  try {
    const serialized = JSON.stringify(data);
    const prev = window.localStorage.getItem(SETTINGS_CACHE_KEY);
    if (prev === serialized) return; // no-op, evita loops
    window.localStorage.setItem(SETTINGS_CACHE_KEY, serialized);
    // Notifica a própria aba (storage event nativo só dispara em outras abas)
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: data }));
  } catch {
    /* ignore */
  }
}

export function clearSettingsCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SETTINGS_CACHE_KEY);
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: null }));
  } catch {
    /* ignore */
  }
}
