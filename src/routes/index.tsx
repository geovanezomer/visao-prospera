// Rota pública / — landing page principal do FinancePRO.
// Quando VITE_LANDING_PAGE=OFF, redireciona para /app (que faz fallback para /login se não autenticado).
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";
import { isLandingEnabled } from "@/lib/featureFlags";
import { faqPageJsonLd } from "@/lib/seo/faqs";
import { listPlansPublic } from "@/lib/admin/plans.functions";
import { getAppSettings } from "@/lib/admin/settings.functions";
import { getBaseUrl } from "@/lib/seo/baseUrl";

const CANONICAL = `${getBaseUrl()}/`;

export const Route = createFileRoute("/")({
  // Prefetch dos planos + branding no SSR — evita "flash" de logo/skeleton no cliente.
  loader: async ({ context }) => {
    if (!isLandingEnabled()) return { plans: [] as any[] };
    // ensureQueryData garante que o cache do React Query seja populado
    // tanto no SSR (dehydrated → hydrate no client) quanto em navegação SPA,
    // eliminando o "flash" do branding default antes do real ser carregado.
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 60 * 60_000,
    });
    try {
      const { plans } = await listPlansPublic();
      return { plans };
    } catch {
      return { plans: [] as any[] };
    }
  },

  staleTime: 60_000,
  head: () => ({
    meta: [
      { title: "FinancePRO — Raio-X Financeiro para PMEs | GZ Consultoria" },
      {
        name: "description",
        content:
          "DRE, Balanço, Fluxo de Caixa, Reforma Tributária (CBS/IBS) e +40 indicadores em um único painel inteligente, com IA estratégica. Construído por consultor CVM.",
      },
      {
        property: "og:title",
        content:
          "FinancePRO — O Raio-X financeiro que transforma consultor em CFO da PME",
      },
      {
        property: "og:description",
        content:
          "+40 indicadores, módulo CBS/IBS e IA estratégica para consultores financeiros brasileiros.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: CANONICAL },
      {
        name: "twitter:title",
        content:
          "FinancePRO — O Raio-X financeiro que transforma consultor em CFO da PME",
      },
      {
        name: "twitter:description",
        content:
          "+40 indicadores, módulo CBS/IBS e IA estratégica para PMEs brasileiras.",
      },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "FinancePRO",
          description:
            "Plataforma de análise financeira para PMEs brasileiras — DRE, Balanço, Fluxo de Caixa, Reforma Tributária CBS/IBS, +40 indicadores e IA estratégica.",
          brand: {
            "@type": "Organization",
            name: "GZ Consultoria Financeira & Investimentos",
          },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify(faqPageJsonLd()),
      },
    ],
  }),
  errorComponent: () => <LandingPage initialPlans={[]} />,
  notFoundComponent: () => <Navigate to="/" />,
  component: IndexRoute,
});

function IndexRoute() {
  if (!isLandingEnabled()) {
    return <Navigate to="/app" />;
  }
  const { plans } = Route.useLoaderData();
  return <LandingPage initialPlans={plans} />;
}
