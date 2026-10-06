import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useAppState, useScenarios } from "@/engines/finance/store";
import { FinanceProvider, FinanceErrorBoundary } from "@/engines/finance/AppStateContext";
import { usePersistedSimParams } from "@/engines/finance/usePersistedSimParams";
import { useFinnanceFile } from "@/engines/finance/useFinnanceFile";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/lib/auth";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

// ─────────────────────────────────────────────────────────────────────────
// Lazy-load das abas — cada uma vira um chunk separado.
// Antes: TODAS as abas (Recharts, jsPDF, IA, etc.) entravam no bundle
// inicial → first paint de 15–20s no VPS. Agora só a aba ativa é baixada.
// ─────────────────────────────────────────────────────────────────────────
// Carregadores por aba: o lazy() e o pré-carregamento usam o mesmo import()
// (o navegador baixa o arquivo uma vez só).
const TAB_LOADERS = {
  receitas: () => import("@/components/sim/revenue/RevenueTab"),
  custos: () => import("@/components/sim/costs/CostsTab"),
  capital: () => import("@/components/sim/capital/CapitalTab"),
  tributos: () => import("@/components/sim/tax/TaxTab"),
  prolabore: () => import("@/components/sim/tax/ProlaboreTab"),
  dre: () => import("@/components/sim/dre/DRETab"),
  balanco: () => import("@/components/sim/balanco/BalancoTab"),
  caixa: () => import("@/components/sim/cashflow/CashflowTab"),
  resultados: () => import("@/components/sim/diagnosis/DiagnosisTab"),
  governanca: () => import("@/components/sim/strategic/StrategicTab"),
  simulador: () => import("@/components/sim/simulator/SimulatorTab"),
  valuation: () => import("@/components/sim/valuation/ValuationTab"),
  indicadores: () => import("@/components/sim/indicators/IndicatorsTab"),
  dashboard: () => import("@/components/sim/dashboard/DashboardTab"),
  cockpit: () => import("@/components/odoo/CockpitHome"),
  consolidado: () => import("@/components/odoo/ConsolidadoTab"),
  ai: () => import("@/components/ai/AIView"),
  calculadoras: () => import("@/components/calculadoras/CalculadorasTab"),
} as const;

const RevenueTab = lazy(() => TAB_LOADERS.receitas().then((m) => ({ default: m.RevenueTab })));
const CostsTab = lazy(() => TAB_LOADERS.custos().then((m) => ({ default: m.CostsTab })));
const CapitalTab = lazy(() => TAB_LOADERS.capital().then((m) => ({ default: m.CapitalTab })));
const TaxTab = lazy(() => TAB_LOADERS.tributos().then((m) => ({ default: m.TaxTab })));
const ProlaboreTab = lazy(() => TAB_LOADERS.prolabore().then((m) => ({ default: m.ProlaboreTab })));
const DRETab = lazy(() => TAB_LOADERS.dre().then((m) => ({ default: m.DRETab })));
const BalancoTab = lazy(() => TAB_LOADERS.balanco().then((m) => ({ default: m.BalancoTab })));
const CashflowTab = lazy(() => TAB_LOADERS.caixa().then((m) => ({ default: m.CashflowTab })));
const DiagnosisTab = lazy(() =>
  TAB_LOADERS.resultados().then((m) => ({ default: m.DiagnosisTab })),
);
const StrategicTab = lazy(() =>
  TAB_LOADERS.governanca().then((m) => ({ default: m.StrategicTab })),
);
const SimulatorTab = lazy(() => TAB_LOADERS.simulador().then((m) => ({ default: m.SimulatorTab })));
const ValuationTab = lazy(() => TAB_LOADERS.valuation().then((m) => ({ default: m.ValuationTab })));
const IndicatorsTab = lazy(() =>
  TAB_LOADERS.indicadores().then((m) => ({ default: m.IndicatorsTab })),
);
const DashboardTab = lazy(() => TAB_LOADERS.dashboard().then((m) => ({ default: m.DashboardTab })));
const CockpitHome = lazy(() => TAB_LOADERS.cockpit().then((m) => ({ default: m.CockpitHome })));
const ConsolidadoTab = lazy(() =>
  TAB_LOADERS.consolidado().then((m) => ({ default: m.ConsolidadoTab })),
);
const AIView = lazy(() => TAB_LOADERS.ai().then((m) => ({ default: m.AIView })));
const CalculadorasTab = lazy(() =>
  TAB_LOADERS.calculadoras().then((m) => ({ default: m.CalculadorasTab })),
);

// A aba que vai abrir começa a baixar junto com o app, e não só depois que ele
// monta (cascata que custava ~1 s em celular).
if (typeof window !== "undefined") {
  try {
    const t = window.sessionStorage.getItem("finnance:activeTab") || "dashboard";
    void (TAB_LOADERS as Record<string, () => Promise<unknown>>)[t]?.();
  } catch {
    void TAB_LOADERS.dashboard();
  }
}

import { AnosArquivadosDialogs } from "@/components/sim/shared/ScenarioBar";
import { HistoricalYearPills } from "@/components/sim/shared/HistoricalYearPills";
import { TabKey } from "@/engines/finance/types";
import {
  applySimulator,
  countActiveLevers,
  DEFAULT_SIM,
  SimulatorParams,
} from "@/engines/finance/simulator";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { NAV_ITEMS } from "@/components/layout/nav-config";
import { BillingButton } from "@/components/billing/BillingButton";
import { Button } from "@/components/ui/button";
import { FileText, Printer } from "lucide-react";
import { MaisMenu } from "@/components/layout/MaisMenu";
import { FirstStepsGuide, GuideButton } from "@/components/onboarding/FirstStepsGuide";
import { EmptyResultsNotice } from "@/components/onboarding/EmptyResultsNotice";
import { blankState, isExampleState } from "@/engines/finance/defaults";
import { useQuery } from "@tanstack/react-query";
import { getCockpitConfig } from "@/lib/odoo/odoo.functions";
import { LegalAcceptGate } from "@/components/LegalAcceptGate";
// pdfExport e buildFinancialModel são carregados via dynamic import dentro
// do handler de export — economiza ~850 KB no bundle inicial (jsPDF + autotable).
import { toast } from "sonner";
import { TaxSettingsDialog } from "@/components/sim/tax/TaxSettingsDialog";
import { Badge } from "@/components/ui/badge";
import type { BackupStatus } from "@/lib/api/cloudBackup";
import { isBackupEnabled } from "@/lib/api/cloudBackup";
import { RestoreBackupDialog } from "@/components/sim/shared/RestoreBackupDialog";
import { SaveShareDialog } from "@/components/sim/shared/SaveShareDialog";
import { OpenRestoreDialog } from "@/components/sim/shared/OpenRestoreDialog";
import { FeedbackDialog } from "@/components/sim/shared/FeedbackDialog";
import { SharedLinksDialog } from "@/components/sim/shared/SharedLinksDialog";
import { TrialBanner } from "@/components/TrialBanner";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { PaywallScreen } from "@/components/PaywallScreen";
import { useAccessStatus, daysSince, GRACE_DAYS_PAST_DUE } from "@/hooks/useAccessStatus";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";
import { OdooCockpitProvider, useOdooCockpit } from "@/components/odoo/cockpit";
import { OdooBar } from "@/components/odoo/OdooBar";
import { ActualsLock } from "@/components/odoo/ActualsLock";
import { OdooActualsView } from "@/components/odoo/OdooActualsView";
import {
  anchorOdooState,
  applyOdooOverlay,
  buildEntityData,
  suggestPremissas,
} from "@/engines/odoo/toAppState";
import { DEFAULT_STATE } from "@/engines/finance/defaults";

type Cockpit = ReturnType<typeof useOdooCockpit>;
function suggestFor(
  snapshot: Cockpit["snapshot"],
  entity: Cockpit["entity"],
  entities: Cockpit["entities"],
  data: Cockpit["data"],
  endMonth: Cockpit["endMonth"],
) {
  // Enquanto a entidade nova carrega, `data` ainda é da anterior: sugerir com
  // ela gravaria regime/setor da empresa errada no espaço da nova.
  if (!snapshot || !entity || !data || data.entity.key !== entity.key) return undefined;
  let ref = entity;
  if (entity.kind === "branch") {
    ref = entities.find((e) => e.kind === "entity" && e.rootId === entity.rootId) ?? entity;
  } else if (entity.kind === "consolidated") {
    const fiscal = entities.filter((e) => e.kind === "entity");
    const revenue = (e: typeof entity) =>
      buildEntityData(snapshot, e, null).actuals.pl.receita_bruta.reduce((a, b) => a + b, 0);
    ref = fiscal.sort((a, b) => revenue(b) - revenue(a))[0] ?? entity;
  }
  const refData = ref === entity ? data : buildEntityData(snapshot, ref, endMonth);
  return suggestPremissas(DEFAULT_STATE, refData);
}

/** Telas que só fazem sentido com faturamento lançado (aviso de vazio). */
const TELAS_DE_RESULTADO = new Set([
  "dashboard",
  "dre",
  "balanco",
  "caixa",
  "indicadores",
  "resultados",
  "valuation",
  "simulador",
  "governanca",
]);

type AppTab = TabKey | "ai" | "calculadoras" | "consolidado" | "cockpit";

// Renderiza o TrialBanner apenas se o usuário logado for um trial válido.
function TrialBannerSlot() {
  const { user } = useAuth();
  if (!user?.isTrial || !user.trialExpiresAt) return null;
  return <TrialBanner expiresAt={user.trialExpiresAt} />;
}

// Fallback enquanto o chunk da aba carrega.
function TabLoading() {
  return (
    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
      Carregando…
    </div>
  );
}

// Formata "há X" relativo para o breadcrumb do header.
function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return new Date(ts).toLocaleDateString("pt-BR");
}

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "FinnancePRO — Diagnóstico & Simulação Empresarial" },
      {
        name: "description",
        content:
          "FinnancePRO: diagnóstico financeiro, DRE simulado, regime tributário, WACC e análise de cenários para empresas brasileiras.",
      },
      {
        property: "og:title",
        content: "Painel FinnancePRO — Diagnóstico & Simulação",
      },
      {
        property: "og:description",
        content: "Painel privado de DRE, Balanço, Fluxo de Caixa, WACC e cenários.",
      },
      {
        name: "twitter:title",
        content: "Painel FinnancePRO — Diagnóstico & Simulação",
      },
      {
        name: "twitter:description",
        content: "Painel privado de DRE, Balanço, Fluxo de Caixa, WACC e cenários.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SimulaProGated,
});

// ─────────────────────────────────────────────────────────────────────────
// SubscriptionGate: bloqueia acesso ao app quando não há assinatura ativa
// nem trial válido. Grace period de 7 dias para past_due antes do bloqueio.
// ─────────────────────────────────────────────────────────────────────────
function SimulaProGated() {
  const { user, hydrated } = useAuth();
  const navigate = useNavigate();
  // Dispara já a consulta de assinatura, em paralelo com a dos termos (antes
  // ela só começava depois do aceite conferido: duas idas ao servidor em fila).
  useAccessStatus();
  useIsAdmin();
  // Idem para a configuração do cockpit (modo Odoo ou manual), usada logo
  // na primeira tela: mesma chave do useOdooCockpit, a consulta é reaproveitada.
  useQuery({
    queryKey: ["odoo", "cockpit-config"],
    queryFn: () => getCockpitConfig(),
    staleTime: 60_000,
    enabled: !!user && !user.mustChangePassword,
  });

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/login" });
  }, [hydrated, user, navigate]);

  if (!hydrated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  // Senha provisória (ex.: admin/admin): troca obrigatória antes de liberar o app.
  if (user.mustChangePassword) {
    return (
      <div className="min-h-screen bg-background">
        <ChangePasswordDialog open forced />
      </div>
    );
  }

  // LGPD: aceite da versão vigente dos termos antes de qualquer dado.
  return (
    <LegalAcceptGate>
      <SimulaProAccess />
    </LegalAcceptGate>
  );
}

function SimulaProAccess() {
  const access = useAccessStatus();
  const isAdmin = useIsAdmin();

  if (access.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  // Admins têm acesso irrestrito e vitalício — nunca veem paywall.
  if (isAdmin) {
    return <SimulaPro />;
  }

  // past_due: mantém acesso ao app por GRACE_DAYS_PAST_DUE após o vencimento;
  // depois disso troca para o paywall.
  if (access.kind === "past_due") {
    const dias = daysSince(access.currentPeriodEnd);
    if (dias > GRACE_DAYS_PAST_DUE) {
      return <PaywallScreen status={access} />;
    }
    return <SimulaPro pastDueDaysLeft={GRACE_DAYS_PAST_DUE - dias} />;
  }

  if (access.kind === "trial_expired" || access.kind === "canceled" || access.kind === "none") {
    return <PaywallScreen status={access} />;
  }

  // "active" ou "trial" → app normal.
  return <SimulaPro />;
}

function SimulaPro(_props: { pastDueDaysLeft?: number } = {}) {
  const { user, hydrated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/login" });
  }, [hydrated, user, navigate]);

  // Modo Odoo: o realizado vem do ERP e as premissas ficam num espaço próprio
  // por entidade; a "Simulação livre" usa o espaço manual de sempre.
  const cockpit = useOdooCockpit();
  const namespace =
    cockpit.active && cockpit.entity
      ? `odoo:${cockpit.instanceKey ?? "x"}:${cockpit.entity.key}`
      : undefined;
  // Premissas iniciais sugeridas pelo realizado. Filial herda da matriz (o
  // CNPJ raiz é que apura IRPJ/CSLL); o consolidado, da maior entidade.
  const initialPremissas = useMemo(
    () =>
      suggestFor(
        cockpit.snapshot,
        cockpit.entity,
        cockpit.entities,
        cockpit.data,
        cockpit.endMonth,
      ),
    [cockpit.snapshot, cockpit.entity, cockpit.entities, cockpit.data, cockpit.endMonth],
  );
  const {
    state: baseState,
    update,
    reset,
    setState,
    hydrated: stateHydrated,
    autosaveStatus,
  } = useAppState(namespace, initialPremissas);
  const overlay = cockpit.active ? cockpit.overlay : null;
  const state = useMemo(
    () => (overlay ? anchorOdooState(applyOdooOverlay(baseState, overlay)) : baseState),
    [baseState, overlay],
  );
  const { scenarios, save, remove, replaceAll: replaceScenarios } = useScenarios();
  // Persistimos a aba ativa em sessionStorage para sobreviver a qualquer
  // remontagem transitória do SimulaPro (ex.: o SubscriptionGate voltar a
  // "loading" por um instante quando o navegador reativa a aba após ficar
  // muito tempo em background). Sem isso, ao voltar de outra aba do
  // navegador o usuário era jogado de volta para o Dashboard e via "Carregando…".
  const TAB_KEY = "finnance:activeTab";
  const [activeTab, setActiveTabState] = useState<AppTab>(() => {
    if (typeof window === "undefined") return "dashboard";
    try {
      const v = window.sessionStorage.getItem(TAB_KEY);
      return (v as AppTab) || "dashboard";
    } catch {
      return "dashboard";
    }
  });
  const setActiveTab = (t: AppTab) => {
    setActiveTabState(t);
    try {
      window.sessionStorage.setItem(TAB_KEY, t);
    } catch {
      /* storage cheio / modo privado — ignora */
    }
  };
  // Parâmetros do Simulador persistidos por usuário (IndexedDB + fallback localStorage).
  const [simParams, setSimParams] = usePersistedSimParams(user?.id ?? "guest", namespace);
  const [meetingMode, setMeetingMode] = useState(false);
  // Ticker que força re-render a cada 30s para atualizar o "salvo há X" do breadcrumb.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // Bloqueio do Consultor IA por usuário (admin controla em /admin → Usuários).
  useEffect(() => {
    if (user && user.aiEnabled === false && activeTab === "ai") setActiveTab("dashboard");
  }, [user, activeTab]);
  const simulatedState = useMemo(() => applySimulator(state, simParams), [state, simParams]);
  const simActive = countActiveLevers(simParams);

  const { confirm, dialog: confirmDialog } = useConfirm();
  // Status do backup automático na nuvem (header indicator).
  const [backupStatus, setBackupStatus] = useState<BackupStatus>("idle");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [openRestoreOpen, setOpenRestoreOpen] = useState(false);
  const [saveShareOpen, setSaveShareOpen] = useState(false);
  const [anosDialog, setAnosDialog] = useState<"arquivar" | "lista" | null>(null);
  const fileApi = useFinnanceFile({
    state,
    scenarios,
    setState,
    replaceScenarios,
    resetState: reset,
    // Modo Odoo: sem rascunho de recuperação, arquivo ou backup — os números
    // são do ERP e importar/restaurar gravaria o realizado como premissa.
    hydrated: stateHydrated && !cockpit.active,
    confirm,
    userId: user?.id,
    onBackupStatus: setBackupStatus,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (meetingMode) root.classList.add("meeting-mode");
    else root.classList.remove("meeting-mode");
    return () => root.classList.remove("meeting-mode");
  }, [meetingMode]);

  useEffect(() => {
    if (!meetingMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMeetingMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meetingMode]);

  // Modo Odoo: abre o Cockpit na primeira vez da sessão; fora dele, abas
  // exclusivas do Odoo voltam ao Dashboard.
  useEffect(() => {
    if (cockpit.active) {
      try {
        if (!window.sessionStorage.getItem("finnance:cockpitShown")) {
          window.sessionStorage.setItem("finnance:cockpitShown", "1");
          setActiveTab("cockpit");
        }
      } catch {
        /* storage indisponível */
      }
    } else if (!cockpit.loading && (activeTab === "cockpit" || activeTab === "consolidado")) {
      setActiveTab("dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cockpit.active, cockpit.loading]);

  // Escuta evento ("carregar_cenario" da IA ou deep-link de DiagnosisTab → SimulatorTab).
  // Aceita Partial<SimulatorParams>; faz merge com DEFAULT_SIM para nunca corromper o estado.
  useEffect(() => {
    const onApply = (e: Event) => {
      const detail = (e as CustomEvent).detail as Partial<SimulatorParams> | null | undefined;
      if (detail && typeof detail === "object") {
        setSimParams({ ...DEFAULT_SIM, ...detail });
        setActiveTab("simulador");
      } else {
        setSimParams(DEFAULT_SIM);
      }
    };
    window.addEventListener("gz-apply-simulator-params", onApply);
    return () => window.removeEventListener("gz-apply-simulator-params", onApply);
  }, [setSimParams]); // setter estável (useCallback em usePersistedSimParams)

  // Navegação entre abas via evento (usado por outras tabs para deep-link).
  useEffect(() => {
    const onSetTab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") {
        setActiveTab(detail as AppTab);
      }
    };
    window.addEventListener("gz-set-tab", onSetTab);
    return () => window.removeEventListener("gz-set-tab", onSetTab);
  }, []);

  if (!hydrated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <SidebarProvider>
      <OdooCockpitProvider value={cockpit}>
        <FinanceProvider state={state} update={update}>
          <div className="flex min-h-screen w-full bg-background text-foreground">
            <AppSidebar
              activeTab={activeTab}
              setActiveTab={(tab) => {
                setActiveTab(tab);
                // No mobile, fecha a sidebar após selecionar
                if (window.innerWidth < 768) {
                  document.dispatchEvent(new CustomEvent("close-mobile-sidebar"));
                }
              }}
              onSave={() => setSaveShareOpen(true)}
              onOpenRestore={() => setOpenRestoreOpen(true)}
              currentFileName={fileApi.currentFileName}
              dirty={fileApi.dirty}
              showConsolidado={cockpit.active}
              fileActions={!cockpit.active}
            />

            <SidebarInset className="flex min-w-0 flex-col">
              <TrialBannerSlot />
              <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur sm:px-6">
                <div className="flex items-center gap-2 min-w-0">
                  <SidebarTrigger className="h-9 w-9" data-meeting-hide="true" />
                  <div className="flex items-center gap-2 md:gap-4 min-w-0">
                    <h2 className="min-w-0 truncate text-sm font-medium text-muted-foreground md:shrink-0 md:text-base">
                      {activeTab === "ai"
                        ? "Consultor IA"
                        : activeTab === "calculadoras"
                          ? "Calculadoras"
                          : activeTab === "consolidado"
                            ? "Consolidado & Conciliação"
                            : activeTab === "cockpit"
                              ? "Cockpit"
                              : (NAV_ITEMS.find((i) => i.value === activeTab)?.title ?? activeTab)}
                    </h2>
                    {/* Breadcrumb: empresa + status de backup na nuvem. */}
                    <div
                      className="hidden md:flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground border-l border-border/40 pl-3"
                      data-meeting-hide="true"
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate font-medium text-foreground/80">
                        {state.companyName?.trim() || "Sem empresa"}
                      </span>
                      {!cockpit.active && isExampleState(state) && (
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Começar em branco?",
                              description:
                                "Os números da empresa de exemplo serão apagados para você lançar os seus.",
                              confirmLabel: "Começar em branco",
                            });
                            if (ok) update(() => blankState());
                          }}
                          className="shrink-0 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning hover:bg-warning/20"
                          title="Os números atuais são de exemplo. Clique para começar com a sua empresa."
                        >
                          Dados de exemplo · começar em branco
                        </button>
                      )}
                      {/* Indicador de backup na nuvem — só aparece quando há userId e status ≠ idle. */}
                      {user && backupStatus !== "idle" && (
                        <>
                          <span className="opacity-40">·</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1",
                              backupStatus === "syncing" && "text-muted-foreground",
                              backupStatus === "synced" && "text-emerald-500",
                              backupStatus === "error" && "text-amber-500",
                            )}
                            title={
                              backupStatus === "syncing"
                                ? "Sincronizando com a nuvem…"
                                : backupStatus === "synced"
                                  ? "Backup salvo na nuvem"
                                  : "Backup falhou — arquivo local salvo"
                            }
                          >
                            {backupStatus === "syncing" && "↻ Sincronizando"}
                            {backupStatus === "synced" && "☁ Backup salvo"}
                            {backupStatus === "error" && "⚠ Sem backup"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pills centralizados: só aparecem em DRE / Fluxo de Caixa. */}
                {!cockpit.active && (activeTab === "dre" || activeTab === "caixa") && (
                  <div
                    className="hidden md:flex flex-1 justify-center px-4 min-w-0"
                    data-meeting-hide="true"
                  >
                    <HistoricalYearPills />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {meetingMode && (
                    <Badge
                      variant="outline"
                      className="hidden sm:inline-flex border-primary/40 bg-primary/10 text-primary text-[10px] uppercase tracking-wider"
                    >
                      Modo Reunião · ESC para sair
                    </Badge>
                  )}
                  <div data-meeting-hide="true" className="contents">
                    <TaxSettingsDialog />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 px-2"
                      onClick={async () => {
                        try {
                          toast.loading("Gerando PDF…", { id: "pdf-export" });
                          // Dynamic imports — jsPDF + autotable (~850 KB) só carregam ao clicar.
                          // Importa também `diagnose`, `buildPrescriptiveCards` e `buildBriefing` aqui
                          // porque pdfExport é render-only (não invoca lógica de domínio).
                          // Assim, o PDF e a tela compartilham EXATAMENTE o mesmo call-site dessas
                          // funções — não há risco de divergência silenciosa.
                          const [
                            { exportFinancePDF },
                            { buildFinancialModel },
                            { diagnose },
                            { buildPrescriptiveCards },
                            { buildBriefing, briefingCacheKey },
                            { loadConfig },
                            { isAIConfigured, gerarDiagnostico },
                            { PROMPT_VERSION },
                            { getCached, setCached },
                            { buildStrategicPdfInsights },
                          ] = await Promise.all([
                            import("@/engines/finance/pdfExport"),
                            import("@/engines/finance/financialModel"),
                            import("@/engines/finance/diagnose"),
                            import("@/engines/finance/prescriptive"),
                            import("@/engines/finance/briefing"),
                            import("@/engines/ai/providers"),
                            import("@/engines/ai/diagnostico"),
                            import("@/engines/ai/diagnosticoPrompt"),
                            import("@/engines/ai/diagnosticoCache"),
                            import("@/engines/finance/strategic2"),
                          ]);
                          const model = buildFinancialModel(state);
                          const { dre, ind, tax, cf } = model;
                          const diags = diagnose(state, dre, ind);
                          const prescriptive = buildPrescriptiveCards(state, { dre, tax, ind, cf });

                          // Diagnóstico IA: tenta cache primeiro, gera uma vez se ainda
                          // não houver. Preserva o comportamento histórico do exportador,
                          // mas mantém o pdfExport puro (render-only).
                          let aiDiagnostico = null as Awaited<
                            ReturnType<typeof gerarDiagnostico>
                          > | null;
                          const aiCfg = loadConfig();
                          if (isAIConfigured(aiCfg)) {
                            try {
                              const briefing = buildBriefing(state, dre, ind);
                              const key = `${PROMPT_VERSION}::${aiCfg.provider}::${aiCfg.model}::${briefingCacheKey(briefing)}`;
                              aiDiagnostico = getCached(key) ?? null;
                              if (!aiDiagnostico) {
                                aiDiagnostico = await gerarDiagnostico(briefing, aiCfg);
                                setCached(key, aiDiagnostico);
                              }
                            } catch (e) {
                              console.warn("[pdf-export] diagnóstico IA falhou:", e);
                              aiDiagnostico = null; // segue sem a página IA
                            }
                          }

                          await exportFinancePDF({
                            state,
                            model,
                            diags,
                            prescriptive,
                            aiDiagnostico,
                            insights: buildStrategicPdfInsights(state, simParams),
                          });
                          toast.success("PDF gerado com sucesso", { id: "pdf-export" });
                        } catch (err) {
                          console.error("[pdf-export] falhou:", err);
                          toast.error("Falha ao gerar PDF", { id: "pdf-export" });
                        }
                      }}
                      title="Exportar relatório em PDF"
                      aria-label="Exportar PDF"
                    >
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="hidden text-xs sm:inline">PDF</span>
                    </Button>
                    <GuideButton />
                    <SharedLinksDialog />
                    <BillingButton />
                    <FeedbackDialog />
                    <MaisMenu
                      onModoReuniao={() => setMeetingMode(true)}
                      onRestaurar={() => void fileApi.resetWithConfirm()}
                      restaurarLabel={
                        cockpit.active
                          ? "Restaurar premissas desta empresa"
                          : "Restaurar dados de exemplo"
                      }
                    />
                  </div>
                </div>
              </header>
              <OdooBar cockpit={cockpit} />

              <main className="flex-1 overflow-x-hidden overflow-y-auto">
                <div
                  className={
                    activeTab === "ai"
                      ? "h-[calc(100dvh-3.5rem)] w-full max-w-[1600px] mx-auto"
                      : "mx-auto h-full max-w-[1600px] p-2 sm:p-4 md:p-6"
                  }
                >
                  {/* Boundary garante que crash em uma aba não derruba o app inteiro
                  e que componentes consumidos fora do FinanceProvider exibam
                  fallback amigável em vez de tela branca. */}
                  {/* key: trocar de aba limpa o erro da anterior. */}
                  <FinanceErrorBoundary key={activeTab}>
                    <Suspense fallback={<TabLoading />}>
                      {activeTab === "ai" ? (
                        <AIView
                          state={state}
                          simulatedState={simulatedState}
                          simActive={simActive}
                          simParams={simParams}
                        />
                      ) : activeTab === "calculadoras" ? (
                        <div className="animate-in fade-in duration-500">
                          <CalculadorasTab />
                        </div>
                      ) : (
                        <div className="space-y-6 animate-in fade-in duration-500">
                          {!cockpit.active &&
                            TELAS_DE_RESULTADO.has(activeTab) &&
                            state.revenue.bruta.every((v) => !v) && (
                              <EmptyResultsNotice onIrPara={(aba) => setActiveTab(aba as AppTab)} />
                            )}
                          {activeTab === "receitas" &&
                            (cockpit.active ? <OdooActualsView kind="receitas" /> : <RevenueTab />)}
                          {activeTab === "custos" &&
                            (cockpit.active ? <OdooActualsView kind="despesas" /> : <CostsTab />)}
                          {activeTab === "capital" && (
                            <ActualsLock what="O balanço de abertura e as dívidas">
                              <CapitalTab />
                            </ActualsLock>
                          )}
                          {activeTab === "consolidado" && <ConsolidadoTab />}
                          {activeTab === "cockpit" && <CockpitHome />}
                          {activeTab === "tributos" && <TaxTab />}
                          {activeTab === "prolabore" && <ProlaboreTab />}
                          {activeTab === "caixa" && (
                            <ActualsLock what="O fluxo de caixa realizado">
                              <CashflowTab />
                            </ActualsLock>
                          )}
                          {activeTab === "governanca" && <StrategicTab />}
                          {activeTab === "dre" && <DRETab />}
                          {activeTab === "balanco" && <BalancoTab />}
                          {activeTab === "indicadores" && <IndicatorsTab />}
                          {activeTab === "resultados" && <DiagnosisTab />}
                          {activeTab === "dashboard" && <DashboardTab />}
                          {activeTab === "simulador" && (
                            <SimulatorTab
                              state={state}
                              apply={update}
                              params={simParams}
                              setParams={setSimParams}
                              scenarioNamespace={namespace ?? "manual"}
                            />
                          )}
                          {activeTab === "valuation" && (
                            <ValuationTab
                              baseState={state}
                              simulatedState={simulatedState}
                              simActive={simActive}
                            />
                          )}
                        </div>
                      )}
                    </Suspense>
                  </FinanceErrorBoundary>
                </div>
              </main>

              <footer className="border-t border-border/20 py-4 text-center text-[10px] text-muted-foreground">
                <p>
                  © 2026 FinnancePRO | Desenvolvido por GZ Consultoria Financeira &amp;
                  Investimentos
                </p>
                <p className="mt-1 flex items-center justify-center gap-4">
                  <Link to="/termos" className="hover:text-foreground">
                    Termos
                  </Link>
                  <Link to="/privacidade" className="hover:text-foreground">
                    Privacidade
                  </Link>
                </p>
              </footer>
            </SidebarInset>

            {/* Arquivar "ano"/cenários não se aplica ao realizado do ERP. */}
            {!cockpit.active && (
              <AnosArquivadosDialogs aberto={anosDialog} onFechar={() => setAnosDialog(null)} />
            )}
            {user && !cockpit.loading && (
              <FirstStepsGuide
                userId={user.id}
                modo={cockpit.active ? "odoo" : "manual"}
                isAdmin={user.role === "admin"}
                onIrPara={(aba) => setActiveTab(aba as AppTab)}
                onEmpresaEmBranco={
                  !cockpit.active && isExampleState(state)
                    ? () => update(() => blankState())
                    : undefined
                }
              />
            )}
            {confirmDialog}
            {user && (
              <RestoreBackupDialog
                open={restoreOpen}
                onOpenChange={setRestoreOpen}
                userId={user.id}
                currentCompanyName={state.companyName}
                currentFileName={fileApi.currentFileName}
                lastModified={fileApi.lastModified}
                hasUnsavedChanges={fileApi.dirty}
                confirm={confirm}
                setState={setState}
                replaceScenarios={replaceScenarios}
                onRestored={() => {
                  /* file foi carregado pelo setState */
                }}
              />
            )}
            <OpenRestoreDialog
              open={openRestoreOpen}
              onOpenChange={setOpenRestoreOpen}
              onOpenDisk={fileApi.open}
              onOpenCloud={user && isBackupEnabled() ? () => setRestoreOpen(true) : undefined}
              canUseCloud={!!user && isBackupEnabled()}
              onAnosArquivados={cockpit.active ? undefined : () => setAnosDialog("lista")}
            />
            <SaveShareDialog
              open={saveShareOpen}
              onOpenChange={setSaveShareOpen}
              onSaveDisk={fileApi.saveToDisk}
              onSaveCloud={user && isBackupEnabled() ? fileApi.saveToCloud : undefined}
              state={state}
              scenarios={scenarios}
              canUseCloud={!!user && isBackupEnabled()}
              onArquivarAno={cockpit.active ? undefined : () => setAnosDialog("arquivar")}
            />
            {/* AI FAB REMOVIDO POR SOLICITAÇÃO DO USUÁRIO */}
          </div>
        </FinanceProvider>
      </OdooCockpitProvider>
    </SidebarProvider>
  );
}
