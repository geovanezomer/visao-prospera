/**
 * Aba "Calculadoras" — agrupa todas as calculadoras financeiras/trabalhistas
 * em sub-abas, renderizada dentro do shell do FinnancePRO (sidebar/header/footer).
 *
 * Cada calculadora é carregada via React.lazy (chunk separado, baixado só
 * quando a aba é ativada). Ver `src/components/common/LazyTab.tsx`.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lazyNamed } from "@/components/common/LazyTab";

const CustoFuncionarioCalc = lazyNamed(
  () => import("@/components/calculadoras/CustoFuncionarioCalc"),
  "CustoFuncionarioCalc",
);
const RescisaoCltCalc = lazyNamed(
  () => import("@/components/calculadoras/RescisaoCltCalc"),
  "RescisaoCltCalc",
);
const CltVsPjCalc = lazyNamed(() => import("@/components/calculadoras/CltVsPjCalc"), "CltVsPjCalc");
const SalarioLiquidoCalc = lazyNamed(
  () => import("@/components/calculadoras/SalarioLiquidoCalc"),
  "SalarioLiquidoCalc",
);
const FeriasCltCalc = lazyNamed(
  () => import("@/components/calculadoras/FeriasCltCalc"),
  "FeriasCltCalc",
);
const DecimoTerceiroCalc = lazyNamed(
  () => import("@/components/calculadoras/DecimoTerceiroCalc"),
  "DecimoTerceiroCalc",
);
const HorasExtrasCalc = lazyNamed(
  () => import("@/components/calculadoras/HorasExtrasCalc"),
  "HorasExtrasCalc",
);
const SacVsPriceCalc = lazyNamed(
  () => import("@/components/calculadoras/SacVsPriceCalc"),
  "SacVsPriceCalc",
);
const JurosCompostosCalc = lazyNamed(
  () => import("@/components/calculadoras/JurosCompostosCalc"),
  "JurosCompostosCalc",
);
const IndependenciaCalc = lazyNamed(
  () => import("@/components/calculadoras/IndependenciaCalc"),
  "IndependenciaCalc",
);

export function CalculadorasTab() {
  return (
    <div className="w-full">
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
          <TabsTrigger value="salario-liquido">Salário</TabsTrigger>
          <TabsTrigger value="ferias">Férias CLT</TabsTrigger>
          <TabsTrigger value="decimo-terceiro">13º Salário</TabsTrigger>
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
        <TabsContent value="ferias">
          <FeriasCltCalc />
        </TabsContent>
        <TabsContent value="decimo-terceiro">
          <DecimoTerceiroCalc />
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
