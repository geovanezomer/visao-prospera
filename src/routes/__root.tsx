import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { TrackingInjector } from "@/components/TrackingInjector";
import { BrandingApplier } from "@/components/BrandingApplier";
import { getAppSettings, type BrandingSetting } from "@/lib/admin/settings.functions";
import { buildBrandingCss } from "@/lib/brandingCss";
import { getBaseUrl } from "@/lib/seo/baseUrl";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ir para o início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4" role="alert">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo deu errado do nosso lado. Você pode tentar novamente ou voltar ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir para o início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Pré-carrega app_settings no SSR para que cores e favicon do admin
  // estejam disponíveis ao montar o <head> — sem flash de tema padrão.
  loader: async ({ context }) => {
    try {
      const settings = await context.queryClient.ensureQueryData({
        queryKey: ["app_settings"],
        queryFn: () => getAppSettings(),
        staleTime: 60 * 60_000,
      });
      const branding = (settings?.branding ?? {}) as BrandingSetting;
      return { colors: branding.colors ?? null, faviconUrl: branding.favicon_url ?? null };
    } catch {
      return { colors: null, faviconUrl: null };
    }
  },
  head: ({ loaderData }) => {
    const css = buildBrandingCss(loaderData?.colors ?? undefined);
    const customFavicon = loaderData?.faviconUrl ?? null;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "FinnancePRO" },
        { name: "description", content: "Diagnóstico & Simulação Financeira" },
        { name: "author", content: "GZ Consultoria Financeira & Investimentos" },
        { property: "og:title", content: "FinnancePRO — Gestão Financeira para PMEs" },
        {
          property: "og:description",
          content:
            "Diagnóstico, DRE, Balanço, Fluxo de Caixa, Reforma Tributária (CBS/IBS) e +40 indicadores em um único painel.",
        },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "FinnancePRO" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: "FinnancePRO — Gestão Financeira para PMEs" },
        {
          name: "twitter:description",
          content:
            "Diagnóstico, DRE, Balanço, Fluxo de Caixa e Reforma Tributária (CBS/IBS) em um painel inteligente.",
        },
      ],
      // Estilo inline com as cores configuradas no admin — emitido no SSR,
      // chega ANTES do React montar, eliminando o flash do tema padrão.
      styles: css ? [{ id: "branding-colors", children: css }] : [],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                name: "GZ Consultoria Financeira & Investimentos",
                url: getBaseUrl(),
              },
              {
                "@type": "WebSite",
                name: "FinnancePRO",
                url: getBaseUrl(),
                publisher: {
                  "@type": "Organization",
                  name: "GZ Consultoria Financeira & Investimentos",
                },
              },
            ],
          }),
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
        },
        // Favicon: usa o configurado no admin quando disponível; senão, fallbacks padrão.
        ...(customFavicon
          ? [{ rel: "icon", href: customFavicon }]
          : [
              {
                rel: "icon",
                type: "image/png",
                sizes: "96x96",
                href: "/brand/favicon-96.png",
              },
              {
                rel: "icon",
                type: "image/png",
                sizes: "192x192",
                href: "/brand/icon-192.png",
              },
              {
                rel: "icon",
                type: "image/png",
                sizes: "512x512",
                href: "/brand/icon-512.png",
              },

              {
                rel: "apple-touch-icon",
                sizes: "180x180",
                href: "/brand/apple-touch-icon.png",
              },
            ]),
      ],
    };
  },

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthCacheInvalidator />
        <TrackingInjector />
        <BrandingApplier />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Revalida rotas e caches quando a identidade muda (login, logout, troca de usuário). */
function AuthCacheInvalidator() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuth();
  const userId = user?.id ?? null;
  // undefined = ainda não registramos a identidade da primeira hidratação.
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!hydrated) return;
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;
    if (prev === undefined || prev === userId) return;
    void router.invalidate();
    void queryClient.invalidateQueries();
  }, [hydrated, userId, router, queryClient]);
  return null;
}
