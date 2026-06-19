// Shell da página pública read-only: 4 abas, header sem ações editáveis.
// NÃO importa AppStateContext, useFinance, nem componentes de components/sim/*.
// Esse isolamento estrutural é o que garante "somente leitura".
import { useState } from "react";
import type { ShareSnapshot } from "@/engines/sharing/types";
import { SharedDRECard } from "./SharedDRECard";
import { SharedCashflowCard } from "./SharedCashflowCard";
import { SharedIndicatorsCard } from "./SharedIndicatorsCard";
import { SharedDiagnosisCard } from "./SharedDiagnosisCard";

const TABS = [
  { id: "dre", label: "DRE" },
  { id: "cashflow", label: "Fluxo de Caixa" },
  { id: "indicators", label: "Indicadores" },
  { id: "diagnosis", label: "Diagnóstico" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SharedReportView({ snapshot }: { snapshot: ShareSnapshot }) {
  const [tab, setTab] = useState<TabId>("dre");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 border-b pb-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{snapshot.companyName}</h1>
            {snapshot.ramoAtuacao && (
              <p className="text-xs text-muted-foreground">{snapshot.ramoAtuacao}</p>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Relatório gerado em{" "}
            {new Date(snapshot.generatedAt).toLocaleDateString("pt-BR")}
            {snapshot.fiscalYear ? ` · Exercício ${snapshot.fiscalYear}` : ""} · Somente leitura
          </p>
        </div>
      </header>

      <nav className="mb-6 flex gap-1 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-2 text-sm transition-colors ${
              tab === t.id
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "dre" && <SharedDRECard snapshot={snapshot} />}
      {tab === "cashflow" && <SharedCashflowCard snapshot={snapshot} />}
      {tab === "indicators" && <SharedIndicatorsCard snapshot={snapshot} />}
      {tab === "diagnosis" && <SharedDiagnosisCard snapshot={snapshot} />}

      <footer className="mt-10 border-t pt-4 text-center text-[11px] text-muted-foreground">
        Análise gerada pelo FinancePRO
      </footer>
    </div>
  );
}
