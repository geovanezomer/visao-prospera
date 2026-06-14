import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustoFuncionarioCalc } from "@/components/calculadoras/CustoFuncionarioCalc";

export const Route = createFileRoute("/calculadoras")({
  head: () => ({
    meta: [
      { title: "Calculadoras — GZ FinnancePRO" },
      { name: "description", content: "Calculadoras financeiras: custo de funcionário, pró-labore, rescisão e mais." },
    ],
  }),
  component: CalculadorasPage,
});

function CalculadorasPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Calculadoras</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ferramentas rápidas de cálculo para apoiar decisões financeiras e tributárias.
        </p>
      </header>

      <Tabs defaultValue="custo-funcionario" className="w-full">
        <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="custo-funcionario">Custo de Funcionário</TabsTrigger>
          <TabsTrigger value="prolabore" disabled>Pró-labore</TabsTrigger>
          <TabsTrigger value="rescisao" disabled>Rescisão CLT</TabsTrigger>
          <TabsTrigger value="regimes" disabled>Simples × Presumido × Real</TabsTrigger>
          <TabsTrigger value="markup" disabled>Markup / Precificação</TabsTrigger>
        </TabsList>

        <TabsContent value="custo-funcionario">
          <CustoFuncionarioCalc />
        </TabsContent>
      </Tabs>
    </div>
  );
}
