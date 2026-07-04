// Rota pública /privacidade — exibe o HTML configurado em Admin → Termos / Privacidade.
import { createFileRoute } from "@tanstack/react-router";
import { getBaseUrl } from "@/lib/seo/baseUrl";
import { LegalPage } from "@/components/legal/LegalPage";
import { getAppSettings } from "@/lib/admin/settings.functions";

export const Route = createFileRoute("/privacidade")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 60 * 60_000,
    });
  },
  head: () => ({
    meta: [
      { title: "Política de Privacidade" },
      { name: "description", content: "Política de Privacidade e tratamento de dados (LGPD)." },
    ],
    links: [{ rel: "canonical", href: `${getBaseUrl()}/privacidade` }],
  }),
  errorComponent: () => <LegalPage kind="privacy" />,
  component: () => <LegalPage kind="privacy" />,
});
