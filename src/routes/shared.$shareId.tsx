// Rota pública /shared/$shareId — renderiza o sistema inteiro em modo
// somente leitura a partir de um link gerado por SaveShareDialog.
//
// Carrega o payload via server fn (lido do banco no servidor), monta
// FinanceProvider com readOnly=true. O `update` global vira no-op,
// bloqueando qualquer mutação sem precisar tocar nos componentes.

import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getSharedReport } from "@/lib/api/sharedReports.functions";
import { parseFinnanceFile } from "@/engines/finance/fileFormat";
import { FinanceProvider, FinanceErrorBoundary } from "@/engines/finance/AppStateContext";
import { Eye, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TabKey } from "@/engines/finance/types";

const DRETab = lazy(() =>
  import("@/components/sim/dre/DRETab").then((m) => ({ default: m.DRETab })),
);
const BalancoTab = lazy(() =>
  import("@/components/sim/balanco/BalancoTab").then((m) => ({ default: m.BalancoTab })),
);
const CashflowTab = lazy(() =>
  import("@/components/sim/cashflow/CashflowTab").then((m) => ({ default: m.CashflowTab })),
);
const DiagnosisTab = lazy(() =>
  import("@/components/sim/diagnosis/DiagnosisTab").then((m) => ({ default: m.DiagnosisTab })),
);
const IndicatorsTab = lazy(() =>
  import("@/components/sim/indicators/IndicatorsTab").then((m) => ({ default: m.IndicatorsTab })),
);
const DashboardTab = lazy(() =>
  import("@/components/sim/dashboard/DashboardTab").then((m) => ({ default: m.DashboardTab })),
);

const sharedQuery = (shareId: string) =>
  queryOptions({
    queryKey: ["shared-report", shareId],
    queryFn: () => getSharedReport({ data: { shareId } }),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const Route = createFileRoute("/shared/$shareId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(sharedQuery(params.shareId)),
  head: ({ loaderData }) => {
    const company =
      (loaderData as { companyName?: string } | undefined)?.companyName ?? "FinnancePRO";
    return {
      meta: [
        { title: `${company} — FinnancePRO (somente leitura)` },
        {
          name: "description",
          content: `Visualização compartilhada de ${company} no FinnancePRO.`,
        },
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
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  // Timer regressivo até a expiração do link. Atualiza a cada 1s.
  const expiresAt = data.expiresAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  const remainingLabel = (() => {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return { text: "expirado", tone: "crit" as const };
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const d = Math.floor(h / 24);
    const text =
      d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${m}m` : m >= 1 ? `${m}m ${s}s` : `${s}s`;
    const tone: "ok" | "warn" | "crit" = h < 1 ? "crit" : h < 6 ? "warn" : "ok";
    return { text, tone };
  })();

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

  // Bloqueia menu de contexto e ações de copiar/recortar nesta rota,
  // reforçando a percepção de conteúdo somente leitura.
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      toast.info("Menu de contexto desabilitado nesta visualização");
    };
    const onClipboard = (e: ClipboardEvent) => {
      // Permite copiar texto selecionado naturalmente; bloqueia recorte/colagem.
      if (e.type === "cut" || e.type === "paste") {
        e.preventDefault();
        toast.info("Ação desabilitada em modo somente leitura");
      }
    };
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
    };
  }, []);

  // Abas disponíveis na visualização compartilhada (somente leitura).
  // Receitas, Custos, Capital, Tributos, Estratégico e Valuation foram
  // removidos por decisão de produto — o destinatário do link enxerga
  // apenas o resultado consolidado, não as alavancas de edição.
  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "caixa", label: "Fluxo de Caixa" },
    { key: "dre", label: "DRE" },
    { key: "balanco", label: "Balanço" },
    { key: "indicadores", label: "Indicadores" },
    { key: "resultados", label: "Diagnóstico" },
  ];

  return (
    <FinanceProvider state={parsed.state} update={noopUpdate} readOnly>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        {/* Banner fixo de modo somente leitura */}
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-primary">
            <Eye className="h-4 w-4" />
            <span className="font-medium">Visualização compartilhada</span>
            {remainingLabel && (
              <span
                className={
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold " +
                  (remainingLabel.tone === "crit"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : remainingLabel.tone === "warn"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-500")
                }
                title="Tempo até a expiração do link"
              >
                <Clock className="h-3 w-3" />
                expira em {remainingLabel.text}
              </span>
            )}
            <span className="text-muted-foreground">· {data.companyName} · somente leitura</span>
          </div>
          {/*
            Link para a tela interna do FinnancePRO foi removido nesta rota:
            o destinatário do compartilhamento não deve ser direcionado para
            o app de edição. Mantemos apenas o rótulo de contexto.
          */}
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
                <Suspense
                  fallback={<div className="p-6 text-sm text-muted-foreground">Carregando…</div>}
                >
                  {activeTab === "dashboard" && <DashboardTab />}
                  {activeTab === "caixa" && <CashflowTab />}
                  {activeTab === "dre" && <DRETab />}
                  {activeTab === "balanco" && <BalancoTab />}
                  {activeTab === "indicadores" && <IndicatorsTab />}
                  {activeTab === "resultados" && <DiagnosisTab />}
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
