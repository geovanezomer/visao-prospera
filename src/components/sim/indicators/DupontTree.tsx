// =====================================================================
// DupontTree — Card de Análise DuPont (3F e 5F) com drill-down.
// Componente puro de apresentação. Consome SSOT via useFinanceModel +
// buildDupont (pure function), sem cálculo financeiro local.
// =====================================================================
import { useMemo, useState } from "react";
import type { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { buildDupont } from "@/engines/finance/dupont";
import { fmtBRL, fmtPct, fmtRatio, sum } from "@/engines/finance/format";
import { HelpTip } from "@/components/sim/shared/primitives";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type NodeTone = "primary" | "pos" | "neg" | "muted" | "warn";

function Node({
  label,
  value,
  hint,
  tone = "muted",
  badge,
  warn,
}: {
  label: string;
  value: string;
  hint?: { text: string; formula?: string; calc?: string };
  tone?: NodeTone;
  badge?: string;
  warn?: string;
}) {
  const toneCls =
    tone === "primary"
      ? "border-primary/40 bg-primary/5"
      : tone === "pos"
        ? "border-[var(--success)]/40 bg-[var(--success)]/5"
        : tone === "neg"
          ? "border-destructive/40 bg-destructive/5"
          : tone === "warn"
            ? "border-[var(--warning)]/40 bg-[var(--warning)]/5"
            : "border-border/60 bg-card/50";
  const valCls =
    tone === "primary"
      ? "text-primary"
      : tone === "pos"
        ? "text-[var(--success)]"
        : tone === "neg"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div
      className={cn(
        "min-w-[140px] rounded-lg border p-2.5 shadow-sm transition-colors",
        toneCls,
      )}
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {hint && <HelpTip text={hint.text} formula={hint.formula} calc={hint.calc} />}
      </div>
      <div className={cn("mono mt-1 text-base font-bold leading-tight", valCls)}>{value}</div>
      {badge && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-sm bg-muted/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
          {badge}
        </div>
      )}
      {warn && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--warning)]">
          <AlertTriangle className="h-3 w-3" /> {warn}
        </div>
      )}
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-1 text-2xl font-light text-muted-foreground select-none">
      {children}
    </div>
  );
}

export function DupontTree({ state }: { state: AppState }) {
  const { dre, ind } = useFinanceModel(state);
  const d = useMemo(() => buildDupont(state, dre, ind), [state, dre, ind]);
  const [mode, setMode] = useState<"3f" | "5f">("3f");

  // Drill-downs reutilizando DRE/Balanço já calculados.
  const RL = d.receitaLiquida;
  const cpv = sum(dre.cpv);
  const lucroBruto = sum(dre.lucroBruto);
  const despOp = sum(dre.despesasOperacionais);
  const dep = sum(dre.depreciacao);
  const resFin = sum(dre.resultadoFinanceiro);
  const impLucro = sum(dre.impostos);

  const ativoTotal = state.capital.ativoTotal || ind.ativoCirculante; // fallback visual
  const ativoCirc = ind.ativoCirculante;
  const ativoNaoCirc = Math.max(0, ativoTotal - ativoCirc);

  // Identidade — diferença em pontos percentuais (relevante apenas se > 0.5 p.p.)
  const ident3F = Math.abs(d.roeReconstruido3F - d.roeEngine) * 100;
  const ident5F = Math.abs(d.roeReconstruido5F - d.roeEngine) * 100;

  const baseWarn = d.ativoEstimado ? "Ativo Total não informado" : undefined;

  return (
    <div className="space-y-5">
      {/* Header — ROE + fator dominante */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            ROE Atual (Anualizado)
          </div>
          <div className="mono mt-0.5 text-2xl font-bold text-primary">{fmtPct(d.roeEngine)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Fator dominante
          </div>
          <div className="mt-0.5 inline-flex items-center rounded-md bg-card px-2 py-1 text-xs font-semibold capitalize text-foreground border border-border/60">
            {d.fatorDominante === "operacional"
              ? "Operação (Margem × Giro)"
              : d.fatorDominante === "alavancagem"
                ? "Alavancagem Financeira"
                : d.fatorDominante === "tributario"
                  ? "Carga Tributária / Juros"
                  : "Indeterminado"}
          </div>
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "3f" | "5f")}>
        <TabsList>
          <TabsTrigger value="3f">3 Fatores (Clássica)</TabsTrigger>
          <TabsTrigger value="5f">5 Fatores (Estendida)</TabsTrigger>
        </TabsList>

        {/* ===================== 3 FATORES ===================== */}
        <TabsContent value="3f" className="space-y-4">
          <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto pb-2">
            <Node
              label="Margem Líquida"
              value={fmtPct(d.margemLiquida)}
              tone="pos"
              hint={{
                text: "Quanto sobra de cada R$ de receita líquida após todos os custos, despesas, juros e impostos.",
                formula: "LL ÷ Receita Líquida",
                calc: `${fmtBRL(d.lucroLiquido)} ÷ ${fmtBRL(RL)} = ${fmtPct(d.margemLiquida)}`,
              }}
            />
            <Op>×</Op>
            <Node
              label="Giro do Ativo"
              value={`${fmtRatio(d.giroAtivo)}×`}
              tone="primary"
              warn={baseWarn}
              hint={{
                text: "Eficiência do uso dos ativos para gerar receita. Quanto maior, mais receita por R$ investido em ativos.",
                formula: "Receita Líquida ÷ Ativo Total Médio",
                calc: `${fmtBRL(RL)} ÷ ${fmtBRL(d.ativoTotalMedio)} = ${fmtRatio(d.giroAtivo)}×`,
              }}
            />
            <Op>×</Op>
            <Node
              label="MAF (Alavancagem)"
              value={`${fmtRatio(d.maf)}×`}
              tone="warn"
              warn={baseWarn}
              hint={{
                text: "Multiplicador de Alavancagem Financeira. Mede quantos reais de ativo cada real de Patrimônio Líquido sustenta. MAF=1 → sem dívida.",
                formula: "Ativo Total Médio ÷ PL Médio",
                calc: `${fmtBRL(d.ativoTotalMedio)} ÷ ${fmtBRL(d.plMedio)} = ${fmtRatio(d.maf)}×`,
              }}
            />
            <Op>=</Op>
            <Node
              label="ROE"
              value={fmtPct(d.roeEngine)}
              tone="primary"
              hint={{
                text: "Retorno sobre o Patrimônio Líquido — rentabilidade do capital próprio investido.",
                formula: "Margem Líquida × Giro × MAF",
                calc: `${fmtPct(d.margemLiquida)} × ${fmtRatio(d.giroAtivo)} × ${fmtRatio(d.maf)} = ${fmtPct(d.roeReconstruido3F)}`,
              }}
            />
          </div>
          {ident3F > 0.5 && (
            <div className="flex items-center gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-2 text-xs text-[var(--warning)]">
              <AlertTriangle className="h-3.5 w-3.5" /> Divergência de reconciliação:{" "}
              {ident3F.toFixed(2)} p.p. (geralmente por bases médias parciais).
            </div>
          )}

          {/* Drill-down Margem Líquida */}
          <DrillCard title="Drill-down · Margem Líquida (Cascata DRE Anual)">
            <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto">
              <Node label="Receita Líquida" value={fmtBRL(RL)} tone="primary" />
              <Op>−</Op>
              <Node label="CPV/CMV/CSP" value={fmtBRL(cpv)} tone="neg" />
              <Op>=</Op>
              <Node label="Lucro Bruto" value={fmtBRL(lucroBruto)} tone="pos" />
              <Op>−</Op>
              <Node label="Desp. Operacionais" value={fmtBRL(despOp + dep)} tone="neg" />
              <Op>=</Op>
              <Node label="EBIT" value={fmtBRL(d.ebit)} tone="primary" />
              <Op>±</Op>
              <Node label="Resultado Financ." value={fmtBRL(resFin)} tone={resFin >= 0 ? "pos" : "neg"} />
              <Op>=</Op>
              <Node label="LAIR" value={fmtBRL(d.lair)} tone="primary" />
              <Op>−</Op>
              <Node label="IRPJ/CSLL" value={fmtBRL(impLucro)} tone="neg" />
              <Op>=</Op>
              <Node label="Lucro Líquido" value={fmtBRL(d.lucroLiquido)} tone="pos" />
            </div>
          </DrillCard>

          {/* Drill-down Ativo */}
          <DrillCard title="Drill-down · Composição do Ativo (Base do Giro)">
            <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto">
              <Node label="Ativo Circulante" value={fmtBRL(ativoCirc)} tone="primary" />
              <Op>+</Op>
              <Node label="Ativo Não Circulante" value={fmtBRL(ativoNaoCirc)} tone="primary" />
              <Op>=</Op>
              <Node label="Ativo Total" value={fmtBRL(ativoTotal)} tone="pos" warn={baseWarn} />
              <Op>÷</Op>
              <Node label="Receita Líquida" value={fmtBRL(RL)} tone="primary" />
              <Op>=</Op>
              <Node label="Giro" value={`${fmtRatio(d.giroAtivo)}×`} tone="primary" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
              <Mini label="Disponibilidades" v={state.capital.disponibilidades} />
              <Mini label="Contas a Receber" v={state.capital.contasReceber} />
              <Mini label="Estoques" v={state.capital.estoques} />
              <Mini label="Ativo Não Circ." v={ativoNaoCirc} />
            </div>
          </DrillCard>
        </TabsContent>

        {/* ===================== 5 FATORES ===================== */}
        <TabsContent value="5f" className="space-y-4">
          <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto pb-2">
            <Node
              label="Margem EBIT"
              value={fmtPct(d.margemEbit)}
              tone="pos"
              hint={{
                text: "Margem operacional pura — independe da estrutura de capital e da carga tributária.",
                formula: "EBIT ÷ Receita Líquida",
                calc: `${fmtBRL(d.ebit)} ÷ ${fmtBRL(RL)} = ${fmtPct(d.margemEbit)}`,
              }}
            />
            <Op>×</Op>
            <Node
              label="Giro do Ativo"
              value={`${fmtRatio(d.giroAtivo)}×`}
              tone="primary"
              warn={baseWarn}
              hint={{
                text: "Eficiência operacional dos ativos.",
                formula: "Receita Líquida ÷ Ativo Médio",
                calc: `${fmtBRL(RL)} ÷ ${fmtBRL(d.ativoTotalMedio)} = ${fmtRatio(d.giroAtivo)}×`,
              }}
            />
            <Op>×</Op>
            <Node
              label="MAF"
              value={`${fmtRatio(d.maf)}×`}
              tone="warn"
              warn={baseWarn}
              hint={{
                text: "Multiplicador de Alavancagem Financeira.",
                formula: "Ativo Médio ÷ PL Médio",
                calc: `${fmtBRL(d.ativoTotalMedio)} ÷ ${fmtBRL(d.plMedio)} = ${fmtRatio(d.maf)}×`,
              }}
            />
            <Op>×</Op>
            <Node
              label="Carga Financeira"
              value={d.ebitNegativo ? "n/d" : fmtPct(d.cargaFinanceira)}
              tone={d.ebitNegativo ? "muted" : d.cargaFinanceira < 1 ? "neg" : "pos"}
              warn={d.ebitNegativo ? "EBIT ≤ 0 — ratio sem significado" : undefined}
              hint={{
                text: "Quanto sobra do EBIT após juros. 1,00 = sem despesa financeira; <1 = juros corroem o lucro.",
                formula: "LAIR ÷ EBIT",
                calc: `${fmtBRL(d.lair)} ÷ ${fmtBRL(d.ebit)} = ${fmtPct(d.cargaFinanceira)}`,
              }}
            />
            <Op>×</Op>
            <Node
              label="Carga Tributária"
              value={d.lairNegativo ? "n/d" : fmtPct(d.cargaTributaria)}
              tone={d.lairNegativo ? "muted" : "neg"}
              warn={d.lairNegativo ? "LAIR ≤ 0 — ratio sem significado" : undefined}
              hint={{
                text: "Quanto sobra do LAIR após IRPJ/CSLL. Equivale a (1 − alíquota efetiva).",
                formula: "LL ÷ LAIR",
                calc: `${fmtBRL(d.lucroLiquido)} ÷ ${fmtBRL(d.lair)} = ${fmtPct(d.cargaTributaria)}`,
              }}
            />
            <Op>=</Op>
            <Node
              label="ROE"
              value={fmtPct(d.roeEngine)}
              tone="primary"
              hint={{
                text: "Identidade DuPont Estendida — separa operação, alavancagem, juros e tributos.",
                formula: "Margem EBIT × Giro × MAF × Carga Fin. × Carga Trib.",
                calc: `Reconstruído: ${fmtPct(d.roeReconstruido5F)}`,
              }}
            />
          </div>
          {ident5F > 0.5 && !d.ebitNegativo && !d.lairNegativo && (
            <div className="flex items-center gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-2 text-xs text-[var(--warning)]">
              <AlertTriangle className="h-3.5 w-3.5" /> Divergência de reconciliação:{" "}
              {ident5F.toFixed(2)} p.p.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Insight
              title="Eficiência Operacional"
              value={fmtPct(d.margemEbit * d.giroAtivo)}
              hint="Margem EBIT × Giro = ROA operacional (antes de financiamento e tributos)."
            />
            <Insight
              title="Efeito Alavancagem"
              value={`${fmtRatio(d.maf)}×`}
              hint="Quanto a estrutura de capital amplifica (ou comprime) o retorno operacional."
            />
            <Insight
              title="Retenção Pós Juros/IR"
              value={fmtPct(d.cargaFinanceira * d.cargaTributaria)}
              hint="Fração do EBIT que efetivamente vira Lucro Líquido após juros e impostos."
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DrillCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/30 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Mini({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border border-border/40 bg-card/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mono text-[11px] font-semibold text-foreground">{fmtBRL(v)}</div>
    </div>
  );
}

function Insight({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <HelpTip text={hint} />
      </div>
      <div className="mono mt-1 text-lg font-bold text-foreground">{value}</div>
    </div>
  );
}
