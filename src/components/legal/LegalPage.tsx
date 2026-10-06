// ============================================================================
// LegalPage — layout público para /termos e /privacidade.
// Renderiza HTML do app_settings.legal sanitizado (defesa contra XSS
// armazenado). Quando o admin não configurou o texto, cai no template MINUTA
// LGPD (defaultLegalContent) com placeholders substituídos pelas variáveis de
// ambiente da organização.
// ============================================================================
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useBranding } from "@/hooks/useBranding";
import { BrandHeader } from "@/components/BrandHeader";
import { useLegal } from "@/hooks/useLegal";
import { sanitizeLegalHtml } from "@/lib/security/sanitizeHtml";
import {
  DEFAULT_PRIVACY_TEMPLATE,
  DEFAULT_TERMS_TEMPLATE,
  fillPlaceholders,
} from "@/components/legal/defaultLegalContent";

type Props = { kind: "terms" | "privacy" };

/** Lê valores da organização de env (VITE_* para client-safe fallback). */
function readOrgValues() {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return {
    RAZAO_SOCIAL: env.VITE_ORG_RAZAO_SOCIAL,
    CNPJ: env.VITE_ORG_CNPJ,
    EMAIL_CONTATO: env.VITE_ORG_EMAIL_CONTATO,
    EMAIL_ENCARREGADO: env.VITE_ORG_EMAIL_ENCARREGADO,
  };
}

export function LegalPage({ kind }: Props) {
  const { branding } = useBranding();
  const { legal } = useLegal();
  const dbHtml = kind === "terms" ? legal.termsHtml : legal.privacyHtml;
  const year = new Date().getFullYear();

  const cleanHtml = useMemo(() => {
    const raw = (dbHtml || "").trim();
    if (raw.length > 0) return sanitizeLegalHtml(raw);
    // Fallback: template MINUTA com placeholders preenchidos por env.
    const template = kind === "terms" ? DEFAULT_TERMS_TEMPLATE : DEFAULT_PRIVACY_TEMPLATE;
    return sanitizeLegalHtml(fillPlaceholders(template, readOrgValues()));
  }, [dbHtml, kind]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <BrandHeader size="sm" asLink />
          <nav className="flex items-center gap-5 text-xs text-muted-foreground">
            <Link to="/termos" className="hover:text-foreground">
              Termos
            </Link>
            <Link to="/privacidade" className="hover:text-foreground">
              Privacidade
            </Link>
            <Link to="/login" className="hover:text-foreground">
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          // HTML sanitizado via DOMPurify (isomorphic — SSR + client).
          dangerouslySetInnerHTML={{ __html: cleanHtml }}
        />
      </article>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-6 text-xs text-muted-foreground sm:flex-row">
          <span>
            © {year} {branding.systemName}
          </span>
          <div className="flex items-center gap-5">
            <Link to="/termos" className="hover:text-foreground">
              Termos
            </Link>
            <Link to="/privacidade" className="hover:text-foreground">
              Privacidade
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
