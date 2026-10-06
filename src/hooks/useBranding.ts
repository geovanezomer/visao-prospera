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
export type Trial = { enabled: boolean; durationHours: number };

const DEFAULTS = {
  branding: {
    systemName: "FinnancePRO",
    logoUrl: null,
    faviconUrl: null,
    authorPhotoUrl: null,
    recolorLogo: false,
  } as Branding,
  login_texts: {
    headline: "Análise financeira completa para sua empresa",
    subheadline:
      "Acesse a plataforma para fazer um Raio-X do Fluxo de Caixa, DRE, Balanço, Impactos da Reforma Tributária e +40 Indicadores.",
    cta: "Entrar",
  } as LoginTexts,
  footer: { text: "Desenvolvido por GZ Consultoria Financeira & Investimentos" } as Footer,
  landing_video: { enabled: false, url: "" } as LandingVideo,
  trial: { enabled: false, durationHours: 2 } as Trial,
};

type AppSettingsShape = {
  branding?: {
    system_name?: string;
    logo_url?: string;
    favicon_url?: string;
    author_photo_url?: string;
    recolor_logo?: boolean;
  };
  login_texts?: { headline?: string; subheadline?: string; cta?: string };
  footer?: { text?: string };
  landing_video?: { enabled?: boolean; url?: string };
  trial?: { enabled?: boolean; duration_hours?: number };
};

export function useBranding() {
  const {
    data: raw,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    initialData: () =>
      readSettingsCache() as Awaited<ReturnType<typeof getAppSettings>> | undefined,
    initialDataUpdatedAt: () => (readSettingsCache() ? Date.now() : 0),
  });

  const data = raw as AppSettingsShape | undefined;

  useEffect(() => {
    if (raw) writeSettingsCache(raw);
  }, [raw]);

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
      url: data?.landing_video?.url ?? "",
    } as LandingVideo,
    trial: {
      enabled: Boolean(data?.trial?.enabled),
      durationHours: Number(data?.trial?.duration_hours ?? DEFAULTS.trial.durationHours),
    } as Trial,
  };
}
