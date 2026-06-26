// ============================================================================
// useBranding — hook que lê app_settings (branding/login_texts/footer) com SWR.
// Defaults garantem que nada quebre antes do admin configurar.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/admin/settings.functions";

export type Branding = {
  systemName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
};
export type LoginTexts = {
  headline: string;
  subheadline: string;
  cta: string;
};
export type Footer = { text: string };

const DEFAULTS = {
  branding: { systemName: "Finnance", logoUrl: null, faviconUrl: null } as Branding,
  login_texts: {
    headline: "Análise financeira completa para sua empresa",
    subheadline:
      "Acesse a plataforma para fazer um Raio-X do Fluxo de Caixa, DRE, Balanço, Impactos da Reforma Tributária e +40 Indicadores.",
    cta: "Entrar",
  } as LoginTexts,
  footer: { text: "Desenvolvido por GZ Consultoria Financeira & Investimentos" } as Footer,
};

export function useBranding() {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
  });
  return {
    isLoading,
    isReady: isFetched,
    branding: {
      systemName: data?.branding?.system_name ?? DEFAULTS.branding.systemName,
      logoUrl: data?.branding?.logo_url ?? null,
      faviconUrl: data?.branding?.favicon_url ?? null,
    } as Branding,
    loginTexts: {
      headline: data?.login_texts?.headline ?? DEFAULTS.login_texts.headline,
      subheadline: data?.login_texts?.subheadline ?? DEFAULTS.login_texts.subheadline,
      cta: data?.login_texts?.cta ?? DEFAULTS.login_texts.cta,
    } as LoginTexts,
    footer: { text: data?.footer?.text ?? DEFAULTS.footer.text } as Footer,
  };
}

