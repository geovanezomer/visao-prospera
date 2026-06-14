import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustoFuncionarioCalc } from "@/components/calculadoras/CustoFuncionarioCalc";
import { RescisaoCltCalc } from "@/components/calculadoras/RescisaoCltCalc";
import { CltVsPjCalc } from "@/components/calculadoras/CltVsPjCalc";
import { SalarioLiquidoCalc } from "@/components/calculadoras/SalarioLiquidoCalc";
import { HorasExtrasCalc } from "@/components/calculadoras/HorasExtrasCalc";
import { SacVsPriceCalc } from "@/components/calculadoras/SacVsPriceCalc";
import { JurosCompostosCalc } from "@/components/calculadoras/JurosCompostosCalc";
import { IndependenciaCalc } from "@/components/calculadoras/IndependenciaCalc";

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
          <TabsTrigger value="rescisao">Rescisão CLT</TabsTrigger>
          <TabsTrigger value="clt-vs-pj">CLT vs PJ</TabsTrigger>
          <TabsTrigger value="salario-liquido">Salário Líquido</TabsTrigger>
          <TabsTrigger value="horas-extras">Horas Extras</TabsTrigger>
          <TabsTrigger value="sac-vs-price">SAC vs PRICE</TabsTrigger>
          <TabsTrigger value="juros-compostos">Juros Compostos</TabsTrigger>
          <TabsTrigger value="independencia">Independência</TabsTrigger>
        </TabsList>

        <TabsContent value="custo-funcionario">
          <CustoFuncionarioCalc />
        </TabsContent>
        <TabsContent value="rescisao">
          <RescisaoCltCalc />
        </TabsContent>
        <TabsContent value="clt-vs-pj">
          <CltVsPjCalc />
        </TabsContent>
        <TabsContent value="salario-liquido">
          <SalarioLiquidoCalc />
        </TabsContent>
        <TabsContent value="horas-extras">
          <HorasExtrasCalc />
        </TabsContent>
        <TabsContent value="sac-vs-price">
          <SacVsPriceCalc />
        </TabsContent>
        <TabsContent value="juros-compostos">
          <JurosCompostosCalc />
        </TabsContent>
        <TabsContent value="independencia">
          <IndependenciaCalc />
        </TabsContent>
      </Tabs>
    </div>
  );
}
