// Rota pública /termos — exibe o HTML configurado em Admin → Termos / Privacidade.
import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";
import { getAppSettings } from "@/lib/admin/settings.functions";

export const Route = createFileRoute("/termos")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["app_settings"],
      queryFn: () => getAppSettings(),
      staleTime: 5 * 60_000,
    });
  },
  head: () => ({
    meta: [
      { title: "Termos de Uso" },
      { name: "description", content: "Termos de Uso da plataforma." },
    ],
    links: [{ rel: "canonical", href: "https://visao-prospera.lovable.app/termos" }],
  }),
  errorComponent: () => <LegalPage kind="terms" />,
  component: () => <LegalPage kind="terms" />,
});
