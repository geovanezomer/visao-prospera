// ============================================================================
// Sanitização de HTML editável pelo admin (defesa em profundidade contra XSS
// armazenado). Usado no RENDER (LegalPage) e no SAVE (LegalTab).
// ============================================================================
import DOMPurify from "isomorphic-dompurify";

export function sanitizeLegalHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });
}
