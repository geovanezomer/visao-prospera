// ============================================================================
// useLegal — lê os textos Termos/Privacidade de app_settings (mesma query
// key usada por useBranding para aproveitar o cache hidratado do SSR).
// Aplica defaults quando o admin ainda não configurou nada.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/admin/settings.functions";
import { DEFAULT_PRIVACY_HTML, DEFAULT_TERMS_HTML } from "@/lib/admin/legalDefaults";

export type LegalContent = {
  termsHtml: string;
  privacyHtml: string;
};

export function useLegal() {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
  });
  return {
    isLoading,
    isReady: isFetched || data !== undefined,
    legal: {
      termsHtml: ((data?.legal as { terms_html?: string } | undefined)?.terms_html) || DEFAULT_TERMS_HTML,
      privacyHtml: ((data?.legal as { privacy_html?: string } | undefined)?.privacy_html) || DEFAULT_PRIVACY_HTML,
    } as LegalContent,
  };
}
