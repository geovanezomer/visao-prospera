// ============================================================================
// Constantes do módulo Admin.
//
// ADMIN_EMAIL — único e-mail considerado administrador do sistema.
// A verificação acontece TANTO no cliente (para esconder a UI) quanto no
// servidor (em toda server fn admin*, que falha com 403 caso contrário).
// ============================================================================

export const ADMIN_EMAIL = "contato@geovanezomer.com.br";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
