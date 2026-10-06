// ============================================================================
// CookieConsent — banner de consentimento para cookies de análise/marketing
// (LGPD, art. 7º I e art. 8º). Nada de GA/Meta Pixel carrega antes do
// "Aceitar" — ver lib/analyticsConsent.ts.
// ============================================================================
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent, useAnalyticsConsent } from "@/lib/analyticsConsent";

export function CookieConsentBanner({ visible }: { visible: boolean }) {
  const consent = useAnalyticsConsent();
  if (!visible || consent !== "unknown") return null;

  return (
    <div
      role="region"
      aria-label="Consentimento de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-muted-foreground">
          Usamos cookies de análise para entender como o site é usado. Eles só são ativados com sua
          permissão.{" "}
          <Link to="/privacidade" className="underline underline-offset-2 hover:text-foreground">
            Política de privacidade
          </Link>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAnalyticsConsent("rejected")}>
            Recusar
          </Button>
          <Button size="sm" onClick={() => setAnalyticsConsent("accepted")}>
            Aceitar
          </Button>
        </div>
      </div>
    </div>
  );
}
