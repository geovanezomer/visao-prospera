// ============================================================================
// Constantes do módulo Admin.
//
// ADMIN_EMAIL — único e-mail considerado administrador do sistema.
// A verificação acontece TANTO no cliente (para esconder a UI) quanto no
// servidor (em toda server fn admin*, que falha com 403 caso contrário).
// ============================================================================

// Lê do .env (VITE_ADMIN_EMAIL no client / ADMIN_EMAIL no SSR). Fallback
// mantém compatibilidade com instalações antigas que não setaram a variável.
const ENV_EMAIL =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_ADMIN_EMAIL) ||
  (typeof process !== "undefined" && process.env?.ADMIN_EMAIL) ||
  "contato@geovanezomer.com.br";

export const ADMIN_EMAIL = String(ENV_EMAIL).trim();

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
