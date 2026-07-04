// ============================================================================
// useLegal — lê os textos Termos/Privacidade de app_settings (mesma query
// key usada por useBranding para aproveitar o cache hidratado do SSR).
// Aplica defaults quando o admin ainda não configurou nada.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/admin/settings.functions";

export type LegalContent = {
  /** HTML bruto do banco (pode ser string vazia). Sanitização ocorre no consumidor. */
  termsHtml: string;
  privacyHtml: string;
};

export function useLegal() {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  return {
    isLoading,
    isReady: isFetched || data !== undefined,
    legal: {
      termsHtml: ((data?.legal as unknown as { terms_html?: string } | undefined)?.terms_html) ?? "",
      privacyHtml: ((data?.legal as unknown as { privacy_html?: string } | undefined)?.privacy_html) ?? "",
    } as LegalContent,
  };
}
