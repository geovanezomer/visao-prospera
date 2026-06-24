// Rota pública / — landing page principal do FinancePRO.
// Quando VITE_LANDING_PAGE=OFF, redireciona para /app (que faz fallback para /login se não autenticado).
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";
import { isLandingEnabled } from "@/lib/featureFlags";

const CANONICAL = "https://visao-prospera.lovable.app/";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title:
          "FinancePRO — Raio-X Financeiro para PMEs | GZ Consultoria",
      },
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
    ],
  }),
  component: IndexRoute,
});

function IndexRoute() {
  if (!isLandingEnabled()) {
    return <Navigate to="/app" />;
  }
  return <LandingPage />;
}
