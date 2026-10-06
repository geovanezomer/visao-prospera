// ============================================================================
// Envia erros do navegador para /api/client-error (registro em error_events).
// Limite local de 5 envios por página para não inundar o servidor num laço.
// ============================================================================
let sent = 0;
const seen = new Set<string>();

export function reportClientError(error: unknown): void {
  if (typeof window === "undefined" || sent >= 5) return;
  const e = error instanceof Error ? error : new Error(String(error));
  const key = `${e.name}:${e.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  try {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        message: `${e.name}: ${e.message}`.slice(0, 500),
        stack: e.stack?.slice(0, 4000),
        path: window.location.pathname,
      }),
    }).catch(() => undefined);
  } catch {
    /* nunca propaga */
  }
}

let installed = false;

/** Escuta erros não tratados da página (uma vez por carregamento). */
export function installClientErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    // Erros de extensões e scripts de terceiros chegam sem stack útil.
    if (!ev.error) return;
    reportClientError(ev.error);
  });
  window.addEventListener("unhandledrejection", (ev) => reportClientError(ev.reason));
}
