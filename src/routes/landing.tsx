// Rota pública /landing — controlada por VITE_LANDING_PAGE no .env.
// Quando desligada, redireciona para /login.

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";
import { isLandingEnabled } from "@/lib/featureFlags";
import { faqPageJsonLd } from "@/lib/seo/faqs";
import { getAppSettings } from "@/lib/admin/settings.functions";
import { getLandingPlans } from "@/components/landing/loadLandingPlans.functions";
import { PLANS_FALLBACK } from "@/components/landing/plansFallback";
import { getBaseUrl } from "@/lib/seo/baseUrl";

const CANONICAL = `${getBaseUrl()}/landing`;

export const Route = createFileRoute("/landing")({
  loader: async ({ context }) => {
    if (!isLandingEnabled()) {
      return { plans: [] as typeof PLANS_FALLBACK, source: "db" as const };
    }
    // ensureQueryData hidrata o cache do React Query no SSR e em SPA nav,
    // garantindo que useBranding() leia o valor real no 1º render.
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 60 * 60_000,
    });
    // loadLandingPlans nunca lança — em erro/vazio devolve PLANS_FALLBACK
    // e dispara notifyAdmin (dedupe 1h) para acordar o admin.
    return await getLandingPlans();
  },

  staleTime: 60_000,
  head: () => ({
    meta: [
      {
        title: "Tour do FinnancePRO — Recursos, Planos e Demonstração | GZ Consultoria",
      },
      {
        name: "description",
        content:
          "Conheça o tour completo do FinnancePRO: módulos de DRE, Balanço, Fluxo de Caixa, simulador CBS/IBS, comparação de planos e exemplos práticos para consultores e PMEs.",
      },
      {
        property: "og:title",
        content: "Tour do FinnancePRO — Recursos, Planos e Demonstração",
      },
      {
        property: "og:description",
        content:
          "Veja todos os módulos do FinnancePRO em detalhe: indicadores, Reforma Tributária, IA estratégica e tabela de planos.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: CANONICAL },
      {
        name: "twitter:title",
        content: "Tour do FinnancePRO — Recursos, Planos e Demonstração",
      },
      {
        name: "twitter:description",
        content: "Tour completo do FinnancePRO: módulos, indicadores, Reforma Tributária e planos.",
      },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "FinnancePRO",
          description:
            "Tour do FinnancePRO: módulos de análise financeira, Reforma Tributária CBS/IBS, indicadores e planos para PMEs brasileiras.",
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
  errorComponent: () => <LandingPage initialPlans={PLANS_FALLBACK} plansSource="fallback" />,
  notFoundComponent: () => <Navigate to="/" />,
  component: LandingRoute,
});

function LandingRoute() {
  const { plans, source } = Route.useLoaderData();
  if (!isLandingEnabled()) {
    return <Navigate to="/login" />;
  }
  return <LandingPage initialPlans={plans} plansSource={source} />;
}
