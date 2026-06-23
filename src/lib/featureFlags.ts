// Flags públicas de marketing — controladas pelo .env (build-time).
// Mantém o mesmo padrão do SUPABASE_BACKUP.

/** Landing page (/landing). Default: ON. */
export function isLandingEnabled(): boolean {
  const v = import.meta.env.VITE_LANDING_PAGE;
  if (typeof v !== "string") return true;
  return v.trim().toUpperCase() !== "OFF";
}

/** Página de planos (/planos). Default: OFF. */
export function isPlanosEnabled(): boolean {
  const v = import.meta.env.VITE_PLANOS_PAGE;
  if (typeof v !== "string") return false;
  return v.trim().toUpperCase() === "ON";
}
