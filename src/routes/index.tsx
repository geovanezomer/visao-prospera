import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppState, useScenarios } from "@/lib/finance/store";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Activity, Building2, Download, RotateCcw, Factory, Store, Briefcase, LogOut } from "lucide-react";
import { RevenueTab } from "@/components/sim/RevenueTab";
import { CostsTab } from "@/components/sim/CostsTab";
import { CapitalTab } from "@/components/sim/CapitalTab";
import { TaxTab } from "@/components/sim/TaxTab";
import { DRETab } from "@/components/sim/DRETab";
import { CashflowTab } from "@/components/sim/CashflowTab";
import { DiagnosisTab } from "@/components/sim/DiagnosisTab";

import { StrategicTab } from "@/components/sim/StrategicTab";
import { SimulatorTab } from "@/components/sim/SimulatorTab";
import { ValuationTab } from "@/components/sim/ValuationTab";
import { ScenarioBar } from "@/components/sim/ScenarioBar";
import { ConfirmDialog } from "@/components/sim/ConfirmDialog";
import { TaxSettingsDialog } from "@/components/sim/TaxSettingsDialog";
import { AIFab } from "@/components/ai/AIFab";
import { BusinessType, TabKey } from "@/lib/finance/types";
import { applySimulator, countActiveLevers, DEFAULT_SIM, SimulatorParams } from "@/lib/finance/simulator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GZ FinnancePRO — Diagnóstico & Simulação Empresarial" },
      { name: "description", content: "GZ FinnancePRO: diagnóstico financeiro, DRE simulado, regime tributário, WACC e análise de cenários para empresas brasileiras (Simples, Presumido, Lucro Real)." },
      { property: "og:title", content: "GZ FinnancePRO — Diagnóstico & Simulação Empresarial" },
      { property: "og:description", content: "Diagnóstico financeiro estilo terminal: DRE, WACC, ponto de equilíbrio, tributação comparada, Monte Carlo e cenários." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" },
    ],
  }),
  component: SimulaPro,
});

function SimulaPro() {
  const { user, hydrated, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/login" });
  }, [hydrated, user, navigate]);

  const { state, update, reset, setState } = useAppState();
  const { scenarios, save, remove } = useScenarios();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [simParams, setSimParams] = useState<SimulatorParams>(DEFAULT_SIM);
  const simulatedState = useMemo(() => applySimulator(state, simParams), [state, simParams]);
  const simActive = countActiveLevers(simParams);

  const businessIcon = state.businessType === "industria" ? <Factory className="h-4 w-4" /> : state.businessType === "comercio" ? <Store className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />;

  if (!hydrated || !user) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Carregando…</div>;
  }

  const exportReport = () => {
    window.print();
  };

  const toggleGuided = () => {
    if (!state.guided.completedWizard) {
      setWizardOpen(true);
    } else {
      update({ guided: { ...state.guided, enabled: !state.guided.enabled } });
    }
  };

  const handleWizardApply = (newState: AppState) => {
    setState(newState);
  };
  const dismissBanner = () => update({ guided: { ...state.guided, dismissedBanner: true } });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                GZ Finnance<span className="text-primary">PRO</span>
              </h1>
              <p className="hidden text-[11px] text-muted-foreground sm:block">Diagnóstico &amp; Simulação Empresarial para PMEs</p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-1.5 sm:flex-none">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={state.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-44"
                placeholder="Nome da empresa"
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1">
              {businessIcon}
              <Select value={state.businessType} onValueChange={(v) => update({ businessType: v as BusinessType })}>
                <SelectTrigger className="h-7 w-32 border-0 bg-transparent text-sm sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="servicos">Prestadora de serviços</SelectItem>
                  <SelectItem value="comercio">Comércio / Revenda</SelectItem>
                  <SelectItem value="industria">Indústria</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={exportReport} title="Exportar">
              <Download className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Exportar</span>
            </Button>
            <TaxSettingsDialog state={state} update={update} />
            <ConfirmDialog
              title="Restaurar dados de exemplo?"
              description="Todas as alterações feitas no plano atual serão substituídas pelos valores iniciais. Cenários salvos não são afetados."
              confirmLabel="Restaurar"
              destructive
              onConfirm={reset}
              trigger={
                <Button size="sm" variant="ghost" title="Reset">
                  <RotateCcw className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Reset</span>
                </Button>
              }
            />
            <div className="ml-1 flex items-center gap-2 border-l border-border/60 pl-2">
              <span className="hidden text-[11px] text-muted-foreground md:inline">
                {user.displayName}
              </span>
              <Button size="sm" variant="ghost" onClick={async () => { await logout(); navigate({ to: "/login" }); }} title="Sair">
                <LogOut className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {state.guided.enabled && !state.guided.dismissedBanner && (
        <div className="flex items-center justify-between gap-3 border-b border-primary/30 bg-primary/5 px-6 py-2 text-xs text-primary">
          <span>
            <Sparkles className="mr-1 inline h-3.5 w-3.5" />
            Modo Guiado ativo — siga as abas: Receitas → Custos → Capital → Regime Tributário → DRE → Caixa → Governança → Análises → Simulador.
          </span>
          <button onClick={dismissBanner} className="rounded p-1 hover:bg-primary/20" aria-label="Fechar">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <GuidedWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        baseState={state}
        onApply={handleWizardApply}
      />

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <Tabs defaultValue={"dre" satisfies TabKey} className="w-full">
          <div className="-mx-6 overflow-x-auto px-6 scrollbar-thin">
            <TabsList className="inline-flex w-max min-w-full bg-card/40">
              <TabsTrigger className="shrink-0" value={"receitas" satisfies TabKey}>1. Receitas</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"custos" satisfies TabKey}>2. Custos e Despesas</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"capital" satisfies TabKey}>3. Capital</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"tributos" satisfies TabKey}>4. Regime Tributário</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"caixa" satisfies TabKey}>5. Fluxo de Caixa</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"governanca" satisfies TabKey}>6. Governança</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"dre" satisfies TabKey}>7. DRE</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"resultados" satisfies TabKey}>8. Análises</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"simulador" satisfies TabKey}>9. Simulador</TabsTrigger>
              <TabsTrigger className="shrink-0" value={"valuation" satisfies TabKey}>10. Valuation</TabsTrigger>
            </TabsList>
          </div>

          <div className="mt-6">
            <TabsContent value={"receitas" satisfies TabKey}><RevenueTab state={state} update={update} /></TabsContent>
            <TabsContent value={"custos" satisfies TabKey}><CostsTab state={state} update={update} /></TabsContent>
            <TabsContent value={"capital" satisfies TabKey}><CapitalTab state={state} update={update} /></TabsContent>
            <TabsContent value={"tributos" satisfies TabKey}><TaxTab state={state} update={update} /></TabsContent>
            <TabsContent value={"caixa" satisfies TabKey}><CashflowTab state={state} update={update} /></TabsContent>
            <TabsContent value={"governanca" satisfies TabKey}><StrategicTab state={state} update={update} /></TabsContent>
            <TabsContent value={"dre" satisfies TabKey}><DRETab state={state} update={update} /></TabsContent>
            <TabsContent value={"resultados" satisfies TabKey}><DiagnosisTab state={state} scenarios={scenarios} loadScenario={setState} removeScenario={remove} /></TabsContent>
            <TabsContent value={"simulador" satisfies TabKey}><SimulatorTab state={state} apply={update} saveScenario={save} params={simParams} setParams={setSimParams} /></TabsContent>
            <TabsContent value={"valuation" satisfies TabKey}><ValuationTab baseState={state} simulatedState={simulatedState} simActive={simActive} /></TabsContent>
          </div>
        </Tabs>

        <footer className="mt-12 border-t border-border/40 py-6 text-center text-[11px] text-muted-foreground">
          <p>Desenvolvido por Geovane Zomer | Consultor Financeiro &amp; Investimentos CVM 3354-5</p>
        </footer>
      </main>

      <ScenarioBar state={state} scenarios={scenarios} save={save} remove={remove} load={setState} />
      <AIFab state={state} simulatedState={simulatedState} simActive={simActive} simParams={simParams} />
    </div>
  );
}
