import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppState, useScenarios } from "@/lib/finance/store";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Activity, Building2, Download, RotateCcw, Factory, Store, Briefcase, Sparkles, X, LogOut } from "lucide-react";
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
import { GuidedWizard } from "@/components/sim/guided/GuidedWizard";
import { AppState, BusinessType } from "@/lib/finance/types";
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
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
          <h1 className="text-base font-semibold tracking-tight">
                GZ Finnance<span className="text-primary">PRO</span>
              </h1>
              <p className="text-[11px] text-muted-foreground">Diagnóstico &amp; Simulação Empresarial para PMEs</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-1.5">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <input
                value={state.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                className="w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Nome da empresa"
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1">
              {businessIcon}
              <Select value={state.businessType} onValueChange={(v) => update({ businessType: v as BusinessType })}>
                <SelectTrigger className="h-7 w-40 border-0 bg-transparent text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="servicos">Prestadora de serviços</SelectItem>
                  <SelectItem value="comercio">Comércio / Revenda</SelectItem>
                  <SelectItem value="industria">Indústria</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant={state.guided.enabled ? "default" : "outline"}
              onClick={toggleGuided}
              title={state.guided.completedWizard ? "Ativar/desativar Modo Guiado" : "Iniciar wizard de setup"}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Modo Guiado
            </Button>
            {state.guided.completedWizard && (
              <Button size="sm" variant="ghost" onClick={() => setWizardOpen(true)} title="Refazer wizard">
                Refazer setup
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={exportReport}><Download className="mr-2 h-4 w-4" /> Exportar</Button>
            <ConfirmDialog
              title="Restaurar dados de exemplo?"
              description="Todas as alterações feitas no plano atual serão substituídas pelos valores iniciais. Cenários salvos não são afetados."
              confirmLabel="Restaurar"
              destructive
              onConfirm={reset}
              trigger={
                <Button size="sm" variant="ghost">
                  <RotateCcw className="mr-2 h-4 w-4" /> Reset
                </Button>
              }
            />
            <div className="ml-1 flex items-center gap-2 border-l border-border/60 pl-2">
              <span className="hidden text-[11px] text-muted-foreground md:inline">
                {user.displayName}
              </span>
              <Button size="sm" variant="ghost" onClick={async () => { await logout(); navigate({ to: "/login" }); }} title="Sair">
                <LogOut className="mr-2 h-4 w-4" /> Sair
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
        <Tabs defaultValue="dre" className="w-full">
          <TabsList className="bg-card/40">
            <TabsTrigger value="receitas">1. Receitas</TabsTrigger>
            <TabsTrigger value="custos">2. Custos e Despesas</TabsTrigger>
            <TabsTrigger value="capital">3. Capital</TabsTrigger>
            <TabsTrigger value="tributos">4. Regime Tributário</TabsTrigger>
            <TabsTrigger value="caixa">5. Fluxo de Caixa</TabsTrigger>
            <TabsTrigger value="governanca">6. Governança</TabsTrigger>
            <TabsTrigger value="dre">7. DRE</TabsTrigger>
            <TabsTrigger value="resultados">8. Análises</TabsTrigger>
            <TabsTrigger value="simulador">9. Simulador</TabsTrigger>
            <TabsTrigger value="valuation">10. Valuation</TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="receitas"><RevenueTab state={state} update={update} /></TabsContent>
            <TabsContent value="custos"><CostsTab state={state} update={update} /></TabsContent>
            <TabsContent value="capital"><CapitalTab state={state} update={update} /></TabsContent>
            <TabsContent value="tributos"><TaxTab state={state} update={update} /></TabsContent>
            <TabsContent value="caixa"><CashflowTab state={state} update={update} /></TabsContent>
            <TabsContent value="governanca"><StrategicTab state={state} update={update} /></TabsContent>
            <TabsContent value="dre"><DRETab state={state} update={update} /></TabsContent>
            <TabsContent value="resultados"><DiagnosisTab state={state} scenarios={scenarios} loadScenario={setState} removeScenario={remove} /></TabsContent>
            <TabsContent value="simulador"><SimulatorTab state={state} apply={update} saveScenario={save} params={simParams} setParams={setSimParams} /></TabsContent>
            <TabsContent value="valuation"><ValuationTab baseState={state} simulatedState={simulatedState} simActive={simActive} /></TabsContent>
          </div>
        </Tabs>

        <footer className="mt-12 border-t border-border/40 py-6 text-center text-[11px] text-muted-foreground">
          <p>GZ FinnancePRO · Diagnóstico &amp; Simulação Empresarial para PMEs brasileiras · valores em R$ (pt-BR) · todos os dados ficam no seu navegador.</p>
          <p className="mt-1">Desenvolvido por Geovane Zomer | Consultor Financeiro &amp; Investimentos CVM 3354-5</p>
        </footer>
      </main>

      <ScenarioBar state={state} scenarios={scenarios} save={save} remove={remove} load={setState} />
    </div>
  );
}
