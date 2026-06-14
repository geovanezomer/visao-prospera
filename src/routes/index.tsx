import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppState, useScenarios } from "@/lib/finance/store";
import { useAuth } from "@/lib/auth";
import { TabsContent } from "@/components/ui/tabs";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
import { IndicatorsTab } from "@/components/sim/IndicatorsTab";
import { ScenarioBar } from "@/components/sim/ScenarioBar";
import { TaxSettingsDialog } from "@/components/sim/TaxSettingsDialog";
import { AIFab } from "@/components/ai/AIFab";
import { AIView } from "@/components/ai/AIView";
import { TabKey } from "@/lib/finance/types";
import { applySimulator, countActiveLevers, DEFAULT_SIM, SimulatorParams } from "@/lib/finance/simulator";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { Download, RotateCcw, Menu, Presentation, X } from "lucide-react";
import { ConfirmDialog } from "@/components/sim/ConfirmDialog";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GZ FinnancePRO — Diagnóstico & Simulação Empresarial" },
      { name: "description", content: "GZ FinnancePRO: diagnóstico financeiro, DRE simulado, regime tributário, WACC e análise de cenários para empresas brasileiras." },
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
  const { user, hydrated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/login" });
  }, [hydrated, user, navigate]);

  const { state, update, reset, setState } = useAppState();
  const { scenarios, save, remove } = useScenarios();
  const [activeTab, setActiveTab] = useState<TabKey | "ai">("dre");
  const [simParams, setSimParams] = useState<SimulatorParams>(DEFAULT_SIM);
  const [meetingMode, setMeetingMode] = useState(false);
  const simulatedState = useMemo(() => applySimulator(state, simParams), [state, simParams]);
  const simActive = countActiveLevers(simParams);

  useEffect(() => {
    const root = document.documentElement;
    if (meetingMode) root.classList.add("meeting-mode");
    else root.classList.remove("meeting-mode");
    return () => root.classList.remove("meeting-mode");
  }, [meetingMode]);

  useEffect(() => {
    if (!meetingMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMeetingMode(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meetingMode]);

  if (!hydrated || !user) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Carregando…</div>;
  }

  const exportReport = () => {
    window.print();
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar 
          activeTab={activeTab} 
          setActiveTab={(tab) => {
            setActiveTab(tab);
            // No mobile, fecha a sidebar após selecionar
            if (window.innerWidth < 768) {
              document.dispatchEvent(new CustomEvent('close-mobile-sidebar'));
            }
          }} 
          state={state} 
          update={update}
          meetingMode={meetingMode}
          setMeetingMode={setMeetingMode}
          onExport={exportReport}
        />

        
        <SidebarInset className="flex flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9" data-meeting-hide="true" />
              <div className="flex items-center gap-2 md:gap-4">
                <h2 className="text-sm font-medium capitalize text-muted-foreground md:text-base">
                  {activeTab === "ai" ? "Consultor IA" : activeTab}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {meetingMode && (
                <Badge variant="outline" className="hidden sm:inline-flex border-primary/40 bg-primary/10 text-primary text-[10px] uppercase tracking-wider">
                  Modo Reunião · ESC para sair
                </Badge>
              )}
              <Button
                size="sm"
                variant={meetingMode ? "default" : "outline"}
                onClick={() => setMeetingMode((v) => !v)}
                className="h-8"
                title="Modo Reunião: oculta menus, amplia fontes e destaca KPIs para apresentação ao cliente"
              >
                {meetingMode ? <X className="h-3.5 w-3.5 sm:mr-2" /> : <Presentation className="h-3.5 w-3.5 sm:mr-2" />}
                <span className="hidden sm:inline">{meetingMode ? "Sair Reunião" : "Modo Reunião"}</span>
              </Button>
              <Button size="sm" variant="outline" onClick={exportReport} className="h-8" data-meeting-hide="true">
                <Download className="h-3.5 w-3.5 sm:mr-2" /> 
                <span className="hidden sm:inline">Exportar</span>
              </Button>
              <div data-meeting-hide="true" className="contents">
                <TaxSettingsDialog state={state} update={update} />
                <ConfirmDialog
                  title="Restaurar dados?"
                  description="Isso resetará todos os valores atuais."
                  confirmLabel="Restaurar"
                  destructive
                  onConfirm={reset}
                  trigger={
                    <Button size="sm" variant="ghost" className="h-8">
                      <RotateCcw className="h-3.5 w-3.5 sm:mr-2" /> 
                      <span className="hidden sm:inline">Reset</span>
                    </Button>
                  }
                />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-x-hidden overflow-y-auto">
            <div className="mx-auto h-full max-w-[1600px] p-2 sm:p-4 md:p-6">
              {activeTab === "ai" ? (
                <AIView 
                  state={state} 
                  simulatedState={simulatedState} 
                  simActive={simActive} 
                  simParams={simParams} 
                />
              ) : (
                <div className="space-y-6 animate-in fade-in duration-500">
                  {activeTab === "receitas" && <RevenueTab state={state} update={update} />}
                  {activeTab === "custos" && <CostsTab state={state} update={update} />}
                  {activeTab === "capital" && <CapitalTab state={state} update={update} />}
                  {activeTab === "tributos" && <TaxTab state={state} update={update} />}
                  {activeTab === "caixa" && <CashflowTab state={state} update={update} />}
                  {activeTab === "governanca" && <StrategicTab state={state} update={update} />}
                  {activeTab === "dre" && <DRETab state={state} update={update} />}
                  {activeTab === "indicadores" && <IndicatorsTab state={state} />}
                  {activeTab === "resultados" && <DiagnosisTab state={state} />}
                  {activeTab === "simulador" && <SimulatorTab state={state} apply={update} saveScenario={save} params={simParams} setParams={setSimParams} />}
                  {activeTab === "valuation" && <ValuationTab baseState={state} simulatedState={simulatedState} simActive={simActive} />}
                </div>
              )}
            </div>
          </main>

          <footer className="border-t border-border/20 py-4 text-center text-[10px] text-muted-foreground">
            <p>© 2026 GZ FinnancePRO | Geovane Zomer - Consultor Financeiro CVM 3354-5</p>
          </footer>
        </SidebarInset>

        <div data-meeting-hide="true" className="contents">
          <ScenarioBar state={state} scenarios={scenarios} save={save} remove={remove} load={setState} />
        </div>
        {/* AI FAB REMOVIDO POR SOLICITAÇÃO DO USUÁRIO */}
      </div>
    </SidebarProvider>
  );
}

