// Rota pública /privacidade — exibe o HTML configurado em Admin → Termos / Privacidade.
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { getAppSettings } from "@/lib/admin/settings.functions";

export const Route = createFileRoute("/privacidade")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 5 * 60_000,
    });
  },
  head: () => ({
    meta: [
      { title: "Política de Privacidade" },
      { name: "description", content: "Política de Privacidade e tratamento de dados (LGPD)." },
    ],
    links: [{ rel: "canonical", href: "https://visao-prospera.lovable.app/privacidade" }],
  }),
  errorComponent: () => <LegalPage kind="privacy" />,
  component: () => <LegalPage kind="privacy" />,
});
