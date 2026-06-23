// Rota pública /shared/$shareId — renderiza o sistema inteiro em modo
// somente leitura a partir de um link gerado por SaveShareDialog.
//
// Carrega o payload via server fn (RLS bypass com supabaseAdmin), monta
// FinanceProvider com readOnly=true. O `update` global vira no-op,
// bloqueando qualquer mutação sem precisar tocar nos componentes.

import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getSharedReport } from "@/lib/api/sharedReports.functions";
import { parseFinnanceFile } from "@/engines/finance/fileFormat";
import { FinanceProvider, FinanceErrorBoundary } from "@/engines/finance/AppStateContext";
import { Eye, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TabKey } from "@/engines/finance/types";

const RevenueTab = lazy(() => import("@/components/sim/revenue/RevenueTab").then(m => ({ default: m.RevenueTab })));
const CostsTab = lazy(() => import("@/components/sim/costs/CostsTab").then(m => ({ default: m.CostsTab })));
const CapitalTab = lazy(() => import("@/components/sim/capital/CapitalTab").then(m => ({ default: m.CapitalTab })));
const TaxTab = lazy(() => import("@/components/sim/tax/TaxTab").then(m => ({ default: m.TaxTab })));
const DRETab = lazy(() => import("@/components/sim/dre/DRETab").then(m => ({ default: m.DRETab })));
const BalancoTab = lazy(() => import("@/components/sim/balanco/BalancoTab").then(m => ({ default: m.BalancoTab })));
const CashflowTab = lazy(() => import("@/components/sim/cashflow/CashflowTab").then(m => ({ default: m.CashflowTab })));
const DiagnosisTab = lazy(() => import("@/components/sim/diagnosis/DiagnosisTab").then(m => ({ default: m.DiagnosisTab })));
const StrategicTab = lazy(() => import("@/components/sim/strategic/StrategicTab").then(m => ({ default: m.StrategicTab })));
const ValuationTab = lazy(() => import("@/components/sim/valuation/ValuationTab").then(m => ({ default: m.ValuationTab })));
const IndicatorsTab = lazy(() => import("@/components/sim/indicators/IndicatorsTab").then(m => ({ default: m.IndicatorsTab })));
const DashboardTab = lazy(() => import("@/components/sim/dashboard/DashboardTab").then(m => ({ default: m.DashboardTab })));

const sharedQuery = (shareId: string) =>
  queryOptions({
    queryKey: ["shared-report", shareId],
    queryFn: () => getSharedReport({ data: { shareId } }),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const Route = createFileRoute("/shared/$shareId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(sharedQuery(params.shareId)),
  head: ({ loaderData }) => {
    const company = (loaderData as { companyName?: string } | undefined)?.companyName ?? "FinnancePRO";
    return {
      meta: [
        { title: `${company} — FinnancePRO (somente leitura)` },
        { name: "description", content: `Visualização compartilhada de ${company} no FinnancePRO.` },
        { property: "og:title", content: `${company} — FinnancePRO` },
        { property: "og:description", content: "Relatório financeiro compartilhado." },
        { name: "robots", content: "noindex,nofollow" },
      ],
    };
  },
  errorComponent: ({ error }) => {
    const msg = error instanceof Error ? error.message : String(error);
    const label =
      msg === "LINK_NOT_FOUND"
        ? "Link não encontrado"
        : msg === "LINK_REVOKED"
          ? "Este link foi revogado pelo proprietário."
          : msg === "LINK_EXPIRED"
            ? "Este link expirou."
            : "Não foi possível carregar este relatório.";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold">{label}</h1>
        <Link to="/">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar ao FinnancePRO
          </Button>
        </Link>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Link não encontrado.
    </div>
  ),
  component: SharedReport,
});

function SharedReport() {
  const { shareId } = Route.useParams();
  const { data } = useSuspenseQuery(sharedQuery(shareId));
  // Reaproveita o parser canônico (migra schema antigo se necessário).
  const parsed = parseFinnanceFile(data.payload);
  // No-op updater — o FinanceProvider já bloqueia, mas mantemos por segurança.
  const noopUpdate = () => {};
  const [activeTab, setActiveTab] = useState<TabKey>("dre");

  // Bloqueia atalhos de edição/salvamento/impressão nesta rota.
  // Ctrl/Cmd + S/O/P/U/I/J + Ctrl+Shift+R/I/J + F2/F3 viram no-op com toast.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      // Teclas de edição inline (rename/find): sempre bloqueadas.
      if (k === "f2") {
        e.preventDefault();
        e.stopPropagation();
        toast.info("Modo somente leitura — edição desabilitada");
        return;
      }

      if (!mod) return;

      // Combinações com Ctrl/Cmd que disparam ações de aplicativo:
      // s=salvar, o=abrir, p=imprimir, u=ver código-fonte, i/j=devtools (shift),
      // r=reload (shift+r = reset no app principal).
      const blocked =
        k === "s" ||
        k === "o" ||
        k === "p" ||
        k === "u" ||
        (e.shiftKey && (k === "r" || k === "i" || k === "j"));

      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
        toast.info("Modo somente leitura — ações de edição estão desabilitadas");
      }
    };
    // Capture phase para interceptar antes de qualquer outro listener.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dre", label: "DRE" },
    { key: "balanco", label: "Balanço" },
    { key: "caixa", label: "Fluxo de Caixa" },
    { key: "receitas", label: "Receitas" },
    { key: "custos", label: "Custos" },
    { key: "capital", label: "Capital" },
    { key: "tributos", label: "Tributos" },
    { key: "indicadores", label: "Indicadores" },
    { key: "resultados", label: "Diagnóstico" },
    { key: "governanca", label: "Estratégico" },
    { key: "dashboard", label: "Dashboard" },
    { key: "valuation", label: "Valuation" },
  ];

  return (
    <FinanceProvider state={parsed.state} update={noopUpdate} readOnly>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        {/* Banner fixo de modo somente leitura */}
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs">
          <div className="flex items-center gap-2 text-primary">
            <Eye className="h-4 w-4" />
            <span className="font-medium">Visualização compartilhada</span>
            <span className="text-muted-foreground">
              · {data.companyName} · somente leitura
            </span>
          </div>
          <Link to="/">
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              Abrir FinnancePRO
            </Button>
          </Link>
        </div>

        {/* Tabs horizontais simples (sem sidebar, sem ações de edição). */}
        <nav className="flex flex-wrap gap-1 border-b border-border/40 bg-card px-4 py-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                (activeTab === t.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted")
              }
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1600px] p-2 sm:p-4 md:p-6">
            <FinanceErrorBoundary>
              {/*
                fieldset[disabled] desabilita nativamente TODOS os <input>, <select>,
                <textarea> e <button> descendentes — bloqueia edição sem precisar
                refatorar cada tab. `min-w-0` + `contents`-like reset evita
                interferência de layout (fieldset default tem border/padding).
              */}
              <fieldset
                disabled
                className="m-0 min-w-0 border-0 p-0 [&_*]:cursor-default"
                aria-label="Conteúdo somente leitura"
              >
              <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando…</div>}>
                {activeTab === "receitas" && <RevenueTab />}
                {activeTab === "custos" && <CostsTab />}
                {activeTab === "capital" && <CapitalTab />}
                {activeTab === "tributos" && <TaxTab />}
                {activeTab === "caixa" && <CashflowTab />}
                {activeTab === "governanca" && <StrategicTab />}
                {activeTab === "dre" && <DRETab />}
                {activeTab === "balanco" && <BalancoTab />}
                {activeTab === "indicadores" && <IndicatorsTab />}
                {activeTab === "resultados" && <DiagnosisTab />}
                {activeTab === "dashboard" && <DashboardTab />}
                {activeTab === "valuation" && (
                  <ValuationTab
                    baseState={parsed.state}
                    simulatedState={parsed.state}
                    simActive={0}
                  />
                )}
              </Suspense>
              </fieldset>
            </FinanceErrorBoundary>
          </div>
        </main>

        <footer className="border-t border-border/20 py-3 text-center text-[10px] text-muted-foreground">
          Relatório compartilhado via FinnancePRO · somente leitura
        </footer>
      </div>
    </FinanceProvider>
  );
}
