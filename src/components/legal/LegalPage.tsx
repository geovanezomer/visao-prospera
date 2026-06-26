// ============================================================================
// LegalPage — layout público para /termos e /privacidade.
// Renderiza HTML do app_settings.legal (com defaults) usando classes prose.
// ============================================================================
import { Link } from "@tanstack/react-router";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { useBranding } from "@/hooks/useBranding";
import { BrandedLogo } from "@/components/BrandedLogo";
import { useLegal } from "@/hooks/useLegal";

type Props = { kind: "terms" | "privacy" };

export function LegalPage({ kind }: Props) {
  const { branding, isReady } = useBranding();
  const { legal } = useLegal();
  const html = kind === "terms" ? legal.termsHtml : legal.privacyHtml;
  const year = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            {isReady ? (
              <>
                <BrandedLogo
                  src={branding.logoUrl ?? logoAsset.url}
                  alt={branding.systemName}
                  recolor={branding.recolorLogo}
                  className="h-8 w-8 [&>svg]:h-8 [&>svg]:w-8"
                  imgProps={{ className: "h-8 w-8 rounded-md object-contain" }}
                />
                <span className="text-base font-semibold tracking-tight">{branding.systemName}</span>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            )}
          </Link>
          <nav className="flex items-center gap-5 text-xs text-muted-foreground">
            <Link to="/termos" className="hover:text-foreground">Termos</Link>
            <Link to="/privacidade" className="hover:text-foreground">Privacidade</Link>
            <Link to="/login" className="hover:text-foreground">Entrar</Link>
          </nav>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          // Conteúdo controlado pelo admin (campo HTML do editor WYSIWYG).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-6 text-xs text-muted-foreground sm:flex-row">
          <span>© {year} {branding.systemName}</span>
          <div className="flex items-center gap-5">
            <Link to="/termos" className="hover:text-foreground">Termos</Link>
            <Link to="/privacidade" className="hover:text-foreground">Privacidade</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
