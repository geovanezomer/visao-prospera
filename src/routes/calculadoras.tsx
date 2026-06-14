import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/calculadoras")({
  head: () => ({
    meta: [
      { title: "Calculadoras — GZ FinnancePRO" },
      { name: "description", content: "Calculadoras financeiras do GZ FinnancePRO." },
    ],
  }),
  component: CalculadorasPage,
});

function CalculadorasPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">Calculadoras</h1>
        <p className="mt-2 text-sm">Em breve.</p>
      </div>
    </div>
  );
}
