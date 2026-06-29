// =====================================================================
// DupontTree — Organograma DuPont (3F e 5F).
// Estrutura hierárquica top-down: ROE → Fatores → Numerador/Denominador
// → Origem (linha do DRE ou Balanço). Conectores via CSS (border-trick),
// 100% SSOT (consome useFinanceModel + buildDupont).
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

type Tone = "primary" | "pos" | "neg" | "muted" | "warn" | "source";

// CSS clássico de organograma (border-trick). Escopado por .dupont-org.
const ORG_CSS = `
.dupont-org, .dupont-org * { box-sizing: border-box; }
.dupont-org { overflow-x: auto; padding: 8px 4px 16px; }
.dupont-org ul {
  position: relative; padding: 22px 0 0; margin: 0;
  display: flex; justify-content: center; gap: 0; list-style: none;
  transition: all .2s ease;
}
.dupont-org li {
  position: relative; padding: 22px 10px 0; text-align: center;
  list-style: none;
}
/* Linha vertical descendo do pai até o topo do filho */
.dupont-org li::before,
.dupont-org li::after {
  content: ''; position: absolute; top: 0; right: 50%;
  border-top: 1px solid hsl(var(--border)); width: 50%; height: 22px;
}
.dupont-org li::after {
  right: auto; left: 50%;
  border-left: 1px solid hsl(var(--border));
}
.dupont-org li:only-child::before,
.dupont-org li:only-child::after { display: none; }
.dupont-org li:only-child { padding-top: 22px; }
.dupont-org li:first-child::before,
.dupont-org li:last-child::after { border: 0 none; }
.dupont-org li:last-child::before {
  border-right: 1px solid hsl(var(--border));
  border-radius: 0 4px 0 0;
}
.dupont-org li:first-child::after { border-radius: 4px 0 0 0; }
/* Linha do conjunto de filhos até o pai */
.dupont-org ul ul::before {
  content: ''; position: absolute; top: 0; left: 50%;
  border-left: 1px solid hsl(var(--border)); width: 0; height: 22px;
}
/* Operadores entre fatores (×, =) na faixa horizontal */
.dupont-row {
  display: flex; align-items: stretch; justify-content: center;
  gap: 6px; flex-wrap: nowrap;
}
.dupont-op {
  display: flex; align-items: center; justify-content: center;
  padding: 0 2px; font-size: 20px; font-weight: 300;
  color: hsl(var(--muted-foreground)); user-select: none;
}
`;

function NodeCard({
  label,
  value,
  hint,
  tone = "muted",
  warn,
  sub,
}: {
  label: string;
  value: string;
  hint?: { text: string; formula?: string; calc?: string };
  tone?: Tone;
  warn?: string;
  sub?: string;
}) {
  const toneCls =
    tone === "primary"
      ? "border-primary/50 bg-primary/10"
      : tone === "pos"
        ? "border-[var(--success)]/50 bg-[var(--success)]/10"
        : tone === "neg"
          ? "border-destructive/50 bg-destructive/10"
          : tone === "warn"
            ? "border-[var(--warning)]/50 bg-[var(--warning)]/10"
            : tone === "source"
              ? "border-dashed border-border/70 bg-muted/30"
              : "border-border/60 bg-card/60";
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
        "inline-block min-w-[130px] max-w-[180px] rounded-lg border p-2 text-left shadow-sm",
        toneCls,
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground leading-tight">
          {label}
        </div>
        {hint && <HelpTip text={hint.text} formula={hint.formula} calc={hint.calc} />}
      </div>
      <div className={cn("mono mt-0.5 text-sm font-bold leading-tight", valCls)}>{value}</div>
      {sub && (
        <div className="mono mt-0.5 text-[10px] text-muted-foreground leading-tight">{sub}</div>
      )}
      {warn && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--warning)]">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {warn}
        </div>
      )}
    </div>
  );
}

// Branch: um fator com seu numerador/denominador e fontes.
function Branch({
  factor,
  numerator,
  denominator,
  sources,
}: {
  factor: React.ReactNode;
  numerator: React.ReactNode;
  denominator: React.ReactNode;
  sources?: { num?: React.ReactNode[]; den?: React.ReactNode[] };
}) {
  return (
    <li>
      {factor}
      <ul>
        <li>
          {numerator}
          {sources?.num && sources.num.length > 0 && (
            <ul>
              {sources.num.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </li>
        <li>
          {denominator}
          {sources?.den && sources.den.length > 0 && (
            <ul>
              {sources.den.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </li>
      </ul>
    </li>
  );
}

export function DupontTree({ state }: { state: AppState }) {
  const { dre, ind } = useFinanceModel(state);
  const d = useMemo(() => buildDupont(state, dre, ind), [state, dre, ind]);
  const [mode, setMode] = useState<"3f" | "5f">("3f");

  // Origens (linhas do DRE / Balanço) — só para visualização da fonte do dado.
  const RL = d.receitaLiquida;
  const cpv = sum(dre.cpv);
  const despOp = sum(dre.despesasOperacionais) + sum(dre.depreciacao);
  const resFin = sum(dre.resultadoFinanceiro);
  const impLucro = sum(dre.impostos);
  const ativoTotal = state.capital.ativoTotal || ind.ativoCirculante;
  const ativoCirc = ind.ativoCirculante;
  const ativoNaoCirc = Math.max(0, ativoTotal - ativoCirc);

  const baseWarn = d.ativoEstimado ? "Ativo estimado" : undefined;

  // Tooltips reutilizáveis
  const tipMargemLiq = {
    text: "Quanto sobra de cada R$ de receita líquida após todos os custos, despesas, juros e impostos.",
    formula: "LL ÷ Receita Líquida",
    calc: `${fmtBRL(d.lucroLiquido)} ÷ ${fmtBRL(RL)} = ${fmtPct(d.margemLiquida)}`,
  };
  const tipGiro = {
    text: "Eficiência do uso dos ativos para gerar receita.",
    formula: "Receita Líquida ÷ Ativo Total Médio",
    calc: `${fmtBRL(RL)} ÷ ${fmtBRL(d.ativoTotalMedio)} = ${fmtRatio(d.giroAtivo)}×`,
  };
  const tipMaf = {
    text: "Multiplicador de Alavancagem Financeira — quantos R$ de ativo cada R$ de PL sustenta.",
    formula: "Ativo Total Médio ÷ PL Médio",
    calc: `${fmtBRL(d.ativoTotalMedio)} ÷ ${fmtBRL(d.plMedio)} = ${fmtRatio(d.maf)}×`,
  };
  const tipMargemEbit = {
    text: "Margem operacional pura — antes de juros e tributos.",
    formula: "EBIT ÷ Receita Líquida",
    calc: `${fmtBRL(d.ebit)} ÷ ${fmtBRL(RL)} = ${fmtPct(d.margemEbit)}`,
  };
  const tipCFin = {
    text: "Quanto sobra do EBIT após juros (1,00 = sem despesa financeira).",
    formula: "LAIR ÷ EBIT",
    calc: `${fmtBRL(d.lair)} ÷ ${fmtBRL(d.ebit)} = ${fmtPct(d.cargaFinanceira)}`,
  };
  const tipCTrib = {
    text: "Quanto sobra do LAIR após IRPJ/CSLL.",
    formula: "LL ÷ LAIR",
    calc: `${fmtBRL(d.lucroLiquido)} ÷ ${fmtBRL(d.lair)} = ${fmtPct(d.cargaTributaria)}`,
  };

  const roeNode = (
    <NodeCard
      label="ROE"
      value={fmtPct(d.roeEngine)}
      tone="primary"
      hint={{
        text: "Retorno sobre o Patrimônio Líquido — rentabilidade do capital próprio.",
        formula: mode === "3f" ? "ML × Giro × MAF" : "ME × Giro × MAF × CF × CT",
        calc: `Reconstruído: ${fmtPct(mode === "3f" ? d.roeReconstruido3F : d.roeReconstruido5F)}`,
      }}
    />
  );

  // Origens reutilizáveis (linhas reais do DRE/Balanço).
  const srcLL = (
    <NodeCard
      label="DRE › Lucro Líquido"
      value={fmtBRL(d.lucroLiquido)}
      tone="source"
      sub={`RL ${fmtBRL(RL)} − CPV ${fmtBRL(cpv)} − OpEx ${fmtBRL(despOp)} ± Fin ${fmtBRL(resFin)} − IR ${fmtBRL(impLucro)}`}
    />
  );
  const srcRL = <NodeCard label="DRE › Receita Líquida" value={fmtBRL(RL)} tone="source" />;
  const srcEBIT = (
    <NodeCard
      label="DRE › EBIT"
      value={fmtBRL(d.ebit)}
      tone="source"
      sub={`Lucro Bruto − OpEx`}
    />
  );
  const srcLAIR = (
    <NodeCard label="DRE › LAIR" value={fmtBRL(d.lair)} tone="source" sub="EBIT ± Resultado Fin." />
  );
  const srcAT = (
    <NodeCard
      label="Balanço › Ativo Total"
      value={fmtBRL(d.ativoTotalMedio)}
      tone="source"
      sub={`AC ${fmtBRL(ativoCirc)} + ANC ${fmtBRL(ativoNaoCirc)}`}
      warn={baseWarn}
    />
  );
  const srcPL = (
    <NodeCard
      label="Balanço › PL Médio"
      value={fmtBRL(d.plMedio)}
      tone="source"
      sub="Capital + Lucros Acumulados"
    />
  );

  return (
    <div className="space-y-4">
      <style>{ORG_CSS}</style>

      {/* Header — ROE atual + fator dominante */}
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
          <div className="mt-0.5 inline-flex items-center rounded-md border border-border/60 bg-card px-2 py-1 text-xs font-semibold capitalize text-foreground">
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

        {/* =================== 3 FATORES — ORGANOGRAMA =================== */}
        <TabsContent value="3f">
          {/* Faixa horizontal: ML × Giro × MAF = ROE */}
          <div className="dupont-row mb-1 overflow-x-auto pb-1">
            <NodeCard label="Margem Líquida" value={fmtPct(d.margemLiquida)} tone="pos" hint={tipMargemLiq} />
            <div className="dupont-op">×</div>
            <NodeCard label="Giro do Ativo" value={`${fmtRatio(d.giroAtivo)}×`} tone="primary" hint={tipGiro} warn={baseWarn} />
            <div className="dupont-op">×</div>
            <NodeCard label="MAF" value={`${fmtRatio(d.maf)}×`} tone="warn" hint={tipMaf} warn={baseWarn} />
            <div className="dupont-op">=</div>
            {roeNode}
          </div>

          {/* Organograma top-down: ROE → 3 fatores → num/den → fontes */}
          <div className="dupont-org">
            <ul>
              <li>
                <NodeCard label="ROE" value={fmtPct(d.roeEngine)} tone="primary" />
                <ul>
                  <Branch
                    factor={<NodeCard label="Margem Líquida" value={fmtPct(d.margemLiquida)} tone="pos" hint={tipMargemLiq} />}
                    numerator={<NodeCard label="Lucro Líquido" value={fmtBRL(d.lucroLiquido)} tone="pos" />}
                    denominator={<NodeCard label="Receita Líquida" value={fmtBRL(RL)} tone="primary" />}
                    sources={{ num: [srcLL], den: [srcRL] }}
                  />
                  <Branch
                    factor={<NodeCard label="Giro do Ativo" value={`${fmtRatio(d.giroAtivo)}×`} tone="primary" hint={tipGiro} />}
                    numerator={<NodeCard label="Receita Líquida" value={fmtBRL(RL)} tone="primary" />}
                    denominator={<NodeCard label="Ativo Total Médio" value={fmtBRL(d.ativoTotalMedio)} tone="warn" warn={baseWarn} />}
                    sources={{ num: [srcRL], den: [srcAT] }}
                  />
                  <Branch
                    factor={<NodeCard label="MAF" value={`${fmtRatio(d.maf)}×`} tone="warn" hint={tipMaf} />}
                    numerator={<NodeCard label="Ativo Total Médio" value={fmtBRL(d.ativoTotalMedio)} tone="warn" warn={baseWarn} />}
                    denominator={<NodeCard label="PL Médio" value={fmtBRL(d.plMedio)} tone="primary" />}
                    sources={{ num: [srcAT], den: [srcPL] }}
                  />
                </ul>
              </li>
            </ul>
          </div>

          <ReconciliationAlert delta={Math.abs(d.roeReconstruido3F - d.roeEngine) * 100} />
        </TabsContent>

        {/* =================== 5 FATORES — ORGANOGRAMA =================== */}
        <TabsContent value="5f">
          <div className="dupont-row mb-1 overflow-x-auto pb-1">
            <NodeCard label="Margem EBIT" value={fmtPct(d.margemEbit)} tone="pos" hint={tipMargemEbit} />
            <div className="dupont-op">×</div>
            <NodeCard label="Giro" value={`${fmtRatio(d.giroAtivo)}×`} tone="primary" hint={tipGiro} warn={baseWarn} />
            <div className="dupont-op">×</div>
            <NodeCard label="MAF" value={`${fmtRatio(d.maf)}×`} tone="warn" hint={tipMaf} warn={baseWarn} />
            <div className="dupont-op">×</div>
            <NodeCard
              label="Carga Fin."
              value={d.ebitNegativo ? "n/d" : fmtPct(d.cargaFinanceira)}
              tone={d.ebitNegativo ? "muted" : d.cargaFinanceira < 1 ? "neg" : "pos"}
              hint={tipCFin}
            />
            <div className="dupont-op">×</div>
            <NodeCard
              label="Carga Trib."
              value={d.lairNegativo ? "n/d" : fmtPct(d.cargaTributaria)}
              tone={d.lairNegativo ? "muted" : "neg"}
              hint={tipCTrib}
            />
            <div className="dupont-op">=</div>
            {roeNode}
          </div>

          <div className="dupont-org">
            <ul>
              <li>
                <NodeCard label="ROE" value={fmtPct(d.roeEngine)} tone="primary" />
                <ul>
                  <Branch
                    factor={<NodeCard label="Margem EBIT" value={fmtPct(d.margemEbit)} tone="pos" hint={tipMargemEbit} />}
                    numerator={<NodeCard label="EBIT" value={fmtBRL(d.ebit)} tone="pos" />}
                    denominator={<NodeCard label="Receita Líquida" value={fmtBRL(RL)} tone="primary" />}
                    sources={{ num: [srcEBIT], den: [srcRL] }}
                  />
                  <Branch
                    factor={<NodeCard label="Giro" value={`${fmtRatio(d.giroAtivo)}×`} tone="primary" hint={tipGiro} />}
                    numerator={<NodeCard label="Receita Líquida" value={fmtBRL(RL)} tone="primary" />}
                    denominator={<NodeCard label="Ativo Total Médio" value={fmtBRL(d.ativoTotalMedio)} tone="warn" warn={baseWarn} />}
                    sources={{ num: [srcRL], den: [srcAT] }}
                  />
                  <Branch
                    factor={<NodeCard label="MAF" value={`${fmtRatio(d.maf)}×`} tone="warn" hint={tipMaf} />}
                    numerator={<NodeCard label="Ativo Total Médio" value={fmtBRL(d.ativoTotalMedio)} tone="warn" warn={baseWarn} />}
                    denominator={<NodeCard label="PL Médio" value={fmtBRL(d.plMedio)} tone="primary" />}
                    sources={{ num: [srcAT], den: [srcPL] }}
                  />
                  <Branch
                    factor={
                      <NodeCard
                        label="Carga Financeira"
                        value={d.ebitNegativo ? "n/d" : fmtPct(d.cargaFinanceira)}
                        tone={d.ebitNegativo ? "muted" : d.cargaFinanceira < 1 ? "neg" : "pos"}
                        hint={tipCFin}
                      />
                    }
                    numerator={<NodeCard label="LAIR" value={fmtBRL(d.lair)} tone="primary" />}
                    denominator={<NodeCard label="EBIT" value={fmtBRL(d.ebit)} tone="pos" />}
                    sources={{ num: [srcLAIR], den: [srcEBIT] }}
                  />
                  <Branch
                    factor={
                      <NodeCard
                        label="Carga Tributária"
                        value={d.lairNegativo ? "n/d" : fmtPct(d.cargaTributaria)}
                        tone={d.lairNegativo ? "muted" : "neg"}
                        hint={tipCTrib}
                      />
                    }
                    numerator={<NodeCard label="Lucro Líquido" value={fmtBRL(d.lucroLiquido)} tone="pos" />}
                    denominator={<NodeCard label="LAIR" value={fmtBRL(d.lair)} tone="primary" />}
                    sources={{ num: [srcLL], den: [srcLAIR] }}
                  />
                </ul>
              </li>
            </ul>
          </div>

          <ReconciliationAlert
            delta={
              d.ebitNegativo || d.lairNegativo
                ? 0
                : Math.abs(d.roeReconstruido5F - d.roeEngine) * 100
            }
          />
        </TabsContent>
      </Tabs>

      <div className="text-[10px] text-muted-foreground italic">
        Linhas tracejadas indicam origens (DRE / Balanço). Linhas sólidas indicam decomposição matemática do ROE.
      </div>
    </div>
  );
}

function ReconciliationAlert({ delta }: { delta: number }) {
  if (delta <= 0.5) return null;
  return (
    <div className="mt-3 flex items-center gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-2 text-xs text-[var(--warning)]">
      <AlertTriangle className="h-3.5 w-3.5" /> Divergência de reconciliação: {delta.toFixed(2)} p.p.
      (normal quando há bases médias parciais).
    </div>
  );
}
