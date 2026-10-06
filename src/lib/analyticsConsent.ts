// ============================================================================
// Consentimento de cookies de análise (LGPD) e páginas onde scripts de
// rastreamento podem rodar. Usado por CookieConsent e TrackingInjector.
//
// A escolha fica no localStorage do navegador. Sem acesso ao storage (aba
// privada, bloqueio), tratamos como "sem resposta": o banner aparece e os
// scripts não carregam.
// ============================================================================
import { useSyncExternalStore } from "react";

export type AnalyticsConsent = "accepted" | "rejected" | "unknown";

const STORAGE_KEY = "cookie_consent_v1";
const listeners = new Set<() => void>();
// Fallback em memória para quando o storage falha na escrita.
let memory: AnalyticsConsent | null = null;

function read(): AnalyticsConsent {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "accepted" || v === "rejected" ? v : "unknown";
  } catch {
    return "unknown";
  }
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, "unknown">): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage indisponível — vale só para esta visita */
  }
  memory = value;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAnalyticsConsent(): AnalyticsConsent {
  return useSyncExternalStore(
    subscribe,
    () => memory ?? read(),
    () => "unknown",
  );
}

/** Páginas onde scripts de rastreamento podem rodar. */
export const TRACKED_PATHS = new Set([
  "/",
  "/landing",
  "/privacidade",
  "/termos",
  "/checkout/sucesso",
]);

export function isTrackedPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TRACKED_PATHS.has(normalized);
}
