// Flags públicas de marketing — controladas pelo .env (build-time).
// Mantém o mesmo padrão do CLOUD_BACKUP.

/** Landing page (/landing). Default: ON. */
export function isLandingEnabled(): boolean {
  const v = import.meta.env.VITE_LANDING_PAGE;
  if (typeof v !== "string") return true;
  return v.trim().toUpperCase() !== "OFF";
}
