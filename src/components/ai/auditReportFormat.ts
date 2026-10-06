// Marcadores do relatório do Modo Auditor (sem JSX: compartilhado com o chat).
export const AUDIT_OPEN = "<!--AUDIT-REPORT-->";
export const AUDIT_CLOSE = "<!--/AUDIT-REPORT-->";

/** Detecta se uma mensagem do assistente é um relatório do auditor. */
export function isAuditReport(content: string): boolean {
  return content.includes(AUDIT_OPEN);
}
