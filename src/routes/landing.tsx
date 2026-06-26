// Rota pública /landing — controlada por VITE_LANDING_PAGE no .env.
// Quando desligada, redireciona para /login.

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";
import { isLandingEnabled } from "@/lib/featureFlags";
import { faqPageJsonLd } from "@/lib/seo/faqs";
import { listPlansPublic } from "@/lib/admin/plans.functions";
import { getAppSettings } from "@/lib/admin/settings.functions";

const CANONICAL = "https://visao-prospera.lovable.app/landing";

export const Route = createFileRoute("/landing")({
  loader: async ({ context }) => {
    if (!isLandingEnabled()) return { plans: [] as any[] };
    // ensureQueryData hidrata o cache do React Query no SSR e em SPA nav,
    // garantindo que useBranding() leia o valor real no 1º render.
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 5 * 60_000,
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
      {
        title:
          "Tour do FinancePRO — Recursos, Planos e Demonstração | GZ Consultoria",
      },
      {
        name: "description",
        content:
          "Conheça o tour completo do FinancePRO: módulos de DRE, Balanço, Fluxo de Caixa, simulador CBS/IBS, comparação de planos e exemplos práticos para consultores e PMEs.",
      },
      {
        property: "og:title",
        content: "Tour do FinancePRO — Recursos, Planos e Demonstração",
      },
      {
        property: "og:description",
        content:
          "Veja todos os módulos do FinancePRO em detalhe: indicadores, Reforma Tributária, IA estratégica e tabela de planos.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: CANONICAL },
      {
        name: "twitter:title",
        content: "Tour do FinancePRO — Recursos, Planos e Demonstração",
      },
      {
        name: "twitter:description",
        content:
          "Tour completo do FinancePRO: módulos, indicadores, Reforma Tributária e planos.",
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
            "Tour do FinancePRO: módulos de análise financeira, Reforma Tributária CBS/IBS, indicadores e planos para PMEs brasileiras.",
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
  component: LandingRoute,
});

function LandingRoute() {
  if (!isLandingEnabled()) {
    return <Navigate to="/login" />;
  }
  const { plans } = Route.useLoaderData();
  return <LandingPage initialPlans={plans} />;
}
