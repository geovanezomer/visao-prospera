// ============================================================================
// useBranding — hook que lê app_settings (branding/login_texts/footer/vídeo)
// com SWR + cache persistente em localStorage.
//
// Persistência: `initialData` lê de localStorage (escrita por requests
// anteriores), então textos, logo, cores e demais personalizações aparecem
// SEM flash do default, mesmo em cold start do client, navegação SPA ou
// rotas sem loader. O write back é feito via React Query `onSuccess` em
// QueryProvider central (vide src/start.tsx) e também aqui via useEffect.
// ============================================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/admin/settings.functions";
import { readSettingsCache, writeSettingsCache } from "@/lib/admin/settingsCache";

export type Branding = {
  systemName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  authorPhotoUrl: string | null;
  /** Aplica a cor primária na logo (somente SVG). Configurado no admin. */
  recolorLogo: boolean;
};
export type LoginTexts = {
  headline: string;
  subheadline: string;
  cta: string;
};
export type Footer = { text: string };
export type LandingVideo = { enabled: boolean; url: string };

const DEFAULTS = {
  branding: { systemName: "Finnance", logoUrl: null, faviconUrl: null, authorPhotoUrl: null, recolorLogo: false } as Branding,
  login_texts: {
    headline: "Análise financeira completa para sua empresa",
    subheadline:
      "Acesse a plataforma para fazer um Raio-X do Fluxo de Caixa, DRE, Balanço, Impactos da Reforma Tributária e +40 Indicadores.",
    cta: "Entrar",
  } as LoginTexts,
  footer: { text: "Desenvolvido por GZ Consultoria Financeira & Investimentos" } as Footer,
  landing_video: { enabled: false, url: "" } as LandingVideo,
};

export function useBranding() {
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    // Settings administrativas (logo, cores, textos, vídeo) mudam raramente.
    // staleTime alto evita refetch a cada navegação SPA e elimina o "flash".
    staleTime: 60 * 60_000, // 1h
    gcTime: 24 * 60 * 60_000, // 24h
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    // initialData sincroniza com o cache localStorage da última visita,
    // evitando o flash do default em qualquer cold start client-side.
    // initialDataUpdatedAt sintetizado com Date.now() faz o React Query
    // tratar o cache como FRESH, então não há refetch em background que
    // dispare re-render com dados diferentes ("cache → real (se mudou)").
    initialData: () => readSettingsCache() as Awaited<ReturnType<typeof getAppSettings>> | undefined,
    initialDataUpdatedAt: () => (readSettingsCache() ? Date.now() : 0),
  });


  // Persiste em localStorage a cada novo payload bem-sucedido.
  useEffect(() => {
    if (data) writeSettingsCache(data);
  }, [data]);

  return {
    isLoading,
    isReady: isFetched || data !== undefined,
    branding: {
      systemName: data?.branding?.system_name ?? DEFAULTS.branding.systemName,
      logoUrl: data?.branding?.logo_url ?? null,
      faviconUrl: data?.branding?.favicon_url ?? null,
      authorPhotoUrl: data?.branding?.author_photo_url ?? null,
      recolorLogo: Boolean(data?.branding?.recolor_logo),
    } as Branding,
    loginTexts: {
      headline: data?.login_texts?.headline ?? DEFAULTS.login_texts.headline,
      subheadline: data?.login_texts?.subheadline ?? DEFAULTS.login_texts.subheadline,
      cta: data?.login_texts?.cta ?? DEFAULTS.login_texts.cta,
    } as LoginTexts,
    footer: { text: data?.footer?.text ?? DEFAULTS.footer.text } as Footer,
    landingVideo: {
      enabled: Boolean(data?.landing_video?.enabled),
      url: (data?.landing_video?.url as string) ?? "",
    } as LandingVideo,
  };
}
