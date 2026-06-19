// Rota pública read-only. SSR off — usa loader client-side via server fn.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { getSharedSnapshot } from "@/lib/sharedReport.functions";
import { SharedReportView } from "@/components/sharing/SharedReportView";

export const Route = createFileRoute("/compartilhado/$shareId")({
  ssr: false,
  loader: async ({ params }) => {
    const snapshot = await getSharedSnapshot({ data: { shareId: params.shareId } });
    if (!snapshot) throw notFound();
    return snapshot;
  },
  component: SharedPage,
  errorComponent: () => (
    <div className="flex h-screen items-center justify-center px-4 text-center">
      <p className="text-muted-foreground">
        Não foi possível carregar este relatório. Tente novamente em instantes.
      </p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex h-screen items-center justify-center px-4 text-center">
      <p className="text-muted-foreground">
        Este link não existe, expirou ou foi revogado pelo consultor.
      </p>
    </div>
  ),
});

function SharedPage() {
  const snapshot = Route.useLoaderData();
  return <SharedReportView snapshot={snapshot} />;
}
