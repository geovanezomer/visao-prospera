// =====================================================================
// DupontTree — Árvore de Rentabilidade (organograma DuPont estendido).
// Organograma top-down com linhas conectoras visíveis (CSS border-trick),
// nós maiores, espaçamento consistente e múltiplas decomposições além
// do ROE clássico: ROA, ROIC, EBITDA e composição do Lucro Líquido.
//
// 100% SSOT — consome `useFinanceModel` + `buildDupont`. Nenhum cálculo
// próprio: só leitura e arrumação visual.
// =====================================================================
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { buildDupont } from "@/engines/finance/dupont";
import { fmtBRL, fmtPct, fmtRatio, sum } from "@/engines/finance/format";
import { HelpTip } from "@/components/sim/shared/primitives";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "primary" | "pos" | "neg" | "muted" | "warn" | "source" | "accent";

// ─────────────────────────────────────────────────────────────────────
// CSS de organograma: linhas conectoras VISÍVEIS, espaçamento amplo,
// nós maiores. Border-trick clássico (sem SVG, sem libs externas).
// Cores e espessuras vinculadas aos tokens do design system.
// ─────────────────────────────────────────────────────────────────────
const ORG_CSS = `
.dupont-org, .dupont-org * { box-sizing: border-box; }
.dupont-org {
  overflow-x: auto;
  padding: 12px 8px 24px;
  /* mostra a árvore inteira mesmo em telas estreitas */
  min-width: 100%;
}
.dupont-org ul {
  position: relative;
  padding: 36px 0 0;
  margin: 0;
  display: flex;
  justify-content: center;
  gap: 14px;
  list-style: none;
}
.dupont-org li {
  position: relative;
  padding: 36px 14px 0;
  text-align: center;
  list-style: none;
}
/* Conector horizontal entre irmãos: meia-linha à direita/esquerda do nó. */
.dupont-org li::before,
.dupont-org li::after {
  content: '';
  position: absolute;
  top: 0;
  right: 50%;
  border-top: 2px solid hsl(var(--primary) / 0.45);
  width: 50%;
  height: 36px;
}
.dupont-org li::after {
  right: auto;
  left: 50%;
  border-left: 2px solid hsl(var(--primary) / 0.45);
}
/* Nó único: sem chave em T, só a haste vertical. */
.dupont-org li:only-child::before,
.dupont-org li:only-child::after { display: none; }
.dupont-org li:only-child { padding-top: 36px; }
.dupont-org li:only-child > .dupont-stem {
  position: absolute; top: 0; left: 50%;
  width: 0; height: 36px;
  border-left: 2px solid hsl(var(--primary) / 0.45);
}
/* Cantos arredondados nas pontas da chave. */
.dupont-org li:first-child::before,
.dupont-org li:last-child::after { border: 0 none; }
.dupont-org li:last-child::before {
  border-right: 2px solid hsl(var(--primary) / 0.45);
  border-radius: 0 6px 0 0;
}
.dupont-org li:first-child::after {
  border-left: 2px solid hsl(var(--primary) / 0.45);
  border-radius: 6px 0 0 0;
}
/* Haste vertical do conjunto de filhos até o pai. */
.dupont-org ul ul::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  border-left: 2px solid hsl(var(--primary) / 0.45);
  width: 0;
  height: 36px;
}
/* Operadores entre fatores (×, =, +, −) na faixa horizontal. */
.dupont-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 10px;
  flex-wrap: nowrap;
  padding-bottom: 6px;
}
.dupont-op {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  font-size: 26px;
  font-weight: 300;
  color: hsl(var(--primary) / 0.7);
  user-select: none;
}
/* Linhas "source" (origens do DRE/Balanço) — tracejadas e mais suaves. */
.dupont-org li.is-source::before,
.dupont-org li.is-source::after,
.dupont-org li.is-source > .dupont-stem,
.dupont-org ul.is-source-group::before {
  border-style: dashed !important;
  border-color: hsl(var(--border)) !important;
}
`;

function NodeCard({
  label,
  value,
  hint,
  tone = "muted",
  warn,
  sub,
  size = "md",
}: {
  label: string;
  value: string;
  hint?: { text: string; formula?: string; calc?: string };
  tone?: Tone;
  warn?: string;
  sub?: string;
  size?: "md" | "lg" | "xl";
}) {
  const toneCls =
    tone === "primary"
      ? "border-primary/60 bg-primary/10"
      : tone === "accent"
        ? "border-primary/80 bg-primary/15 ring-1 ring-primary/30"
        : tone === "pos"
          ? "border-[var(--success)]/60 bg-[var(--success)]/10"
          : tone === "neg"
            ? "border-destructive/60 bg-destructive/10"
            : tone === "warn"
              ? "border-[var(--warning)]/60 bg-[var(--warning)]/10"
              : tone === "source"
                ? "border-dashed border-border bg-muted/40"
                : "border-border bg-card";
  const valCls =
    tone === "primary" || tone === "accent"
      ? "text-primary"
      : tone === "pos"
        ? "text-[var(--success)]"
        : tone === "neg"
          ? "text-destructive"
          : "text-foreground";
  const sizeCls =
    size === "xl"
      ? "min-w-[210px] max-w-[240px] p-3"
      : size === "lg"
        ? "min-w-[180px] max-w-[210px] p-2.5"
        : "min-w-[160px] max-w-[190px] p-2.5";
  const valTextCls =
    size === "xl" ? "text-xl" : size === "lg" ? "text-base" : "text-sm";
  return (
    <div
      className={cn(
        "inline-block rounded-xl border-2 text-left shadow-sm transition-shadow hover:shadow-md",
        sizeCls,
        toneCls,
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-tight">
          {label}
        </div>
        {hint && <HelpTip text={hint.text} formula={hint.formula} calc={hint.calc} />}
      </div>
      <div className={cn("mono mt-1 font-bold leading-tight", valTextCls, valCls)}>{value}</div>
      {sub && (
        <div className="mono mt-1 text-[10px] text-muted-foreground leading-snug">{sub}</div>
      )}
      {warn && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--warning)]">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {warn}
        </div>
      )}
    </div>
  );
}

// Branch: um fator com seu numerador/denominador e fontes opcionais.
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
      <span className="dupont-stem" />
      {factor}
      <ul>
        <li>
          <span className="dupont-stem" />
          {numerator}
          {sources?.num && sources.num.length > 0 && (
            <ul className="is-source-group">
              {sources.num.map((s, i) => (
                <li key={i} className="is-source">
                  <span className="dupont-stem" />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </li>
        <li>
          <span className="dupont-stem" />
          {denominator}
          {sources?.den && sources.den.length > 0 && (
            <ul className="is-source-group">
              {sources.den.map((s, i) => (
                <li key={i} className="is-source">
                  <span className="dupont-stem" />
                  {s}
                </li>
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
  

  // ─── Origens (linhas do DRE / Balanço) — só visualização da fonte ───
  const RL = d.receitaLiquida;
  const RB = ind.receitaBrutaAnual;
  const cpv = sum(dre.cpv);
  const lucroBruto = RL - cpv;
  const despOp = sum(dre.despesasOperacionais);
  const depr = sum(dre.depreciacao);
  const ebitda = ind.ebitdaAnual;
  const resFin = sum(dre.resultadoFinanceiro);
  const impLucro = sum(dre.impostos);
  const ativoTotal = state.capital.ativoTotal || ind.ativoCirculante;
  const ativoCirc = ind.ativoCirculante;
  const ativoNaoCirc = Math.max(0, ativoTotal - ativoCirc);
  const capInv = ind.capitalInvestido;
  const nopat = ind.nopat;

  const baseWarn = d.ativoEstimado ? "Ativo estimado" : undefined;

  // ─── Tooltips reutilizáveis ──────────────────────────────────────────
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
  const tipMargemEbitda = {
    text: "Margem EBITDA — capacidade da operação de gerar caixa antes de D&A, juros e tributos.",
    formula: "EBITDA ÷ Receita Líquida",
    calc: `${fmtBRL(ebitda)} ÷ ${fmtBRL(RL)} = ${fmtPct(ind.margemEbitda)}`,
  };
  const tipMargemBruta = {
    text: "Quanto sobra após CPV/CSP/CMV — eficiência produtiva e poder de precificação.",
    formula: "Lucro Bruto ÷ Receita Líquida",
    calc: `${fmtBRL(lucroBruto)} ÷ ${fmtBRL(RL)} = ${fmtPct(ind.margemBruta)}`,
  };
  const tipCFin = {
    text: "Quanto sobra do EBIT após juros (1,00 = sem despesa financeira líquida).",
    formula: "LAIR ÷ EBIT",
    calc: `${fmtBRL(d.lair)} ÷ ${fmtBRL(d.ebit)} = ${fmtPct(d.cargaFinanceira)}`,
  };
  const tipCTrib = {
    text: "Quanto sobra do LAIR após IRPJ/CSLL.",
    formula: "LL ÷ LAIR",
    calc: `${fmtBRL(d.lucroLiquido)} ÷ ${fmtBRL(d.lair)} = ${fmtPct(d.cargaTributaria)}`,
  };
  const tipRoa = {
    text: "Retorno sobre o Ativo — quanto a empresa gera de lucro por R$ aplicado em ativos.",
    formula: "LL ÷ Ativo Total Médio  =  Margem Líquida × Giro",
    calc: `${fmtPct(d.margemLiquida)} × ${fmtRatio(d.giroAtivo)}× = ${fmtPct(ind.roa)}`,
  };
  const tipRoic = {
    text: "Retorno sobre o Capital Investido — eficiência do capital total (próprio + dívida onerosa).",
    formula: "NOPAT ÷ Capital Investido",
    calc: `${fmtBRL(nopat)} ÷ ${fmtBRL(capInv)} = ${fmtPct(ind.roic)}`,
  };
  const tipNopat = {
    text: "Lucro Operacional Líquido após Impostos — EBIT × (1 − alíquota efetiva).",
    formula: "EBIT × (1 − t)",
    calc: `${fmtBRL(d.ebit)} × (1 − ${(ind.aliquotaNopat ?? 0).toFixed(1)}%) = ${fmtBRL(nopat)}`,
  };

  // ─── Helper: nó "source" com decomposição intermediária aninhada ────
  // Renderiza o card de origem + uma sub-árvore tracejada com as partes
  // que somam/subtraem para chegar no valor (ex.: AT = AC + ANC).
  const withBreakdown = (node: ReactNode, parts: ReactNode[]): ReactNode => (
    <>
      {node}
      <ul className="is-source-group">
        {parts.map((p, i) => (
          <li key={i} className="is-source">
            <span className="dupont-stem" />
            {p}
          </li>
        ))}
      </ul>
    </>
  );

  const PL_atual = state.capital.patrimonioLiquido;
  const D_atual = state.capital.dividaOnerosa;
  const deducoes = Math.max(0, RB - RL);

  // ─── Origens reutilizáveis (cards "source") com camadas intermediárias ──
  void RB;

  const srcRL = withBreakdown(
    <NodeCard label="DRE › Receita Líquida" value={fmtBRL(RL)} tone="source" sub="RB − Deduções/Tributos" />,
    [
      <NodeCard key="rb" label="(+) Receita Bruta" value={fmtBRL(RB)} tone="source" />,
      <NodeCard key="ded" label="(−) Deduções" value={fmtBRL(deducoes)} tone="source" />,
    ],
  );
  const srcCPV = (
    <NodeCard label="DRE › CPV/CSP/CMV" value={fmtBRL(cpv)} tone="source" />
  );
  const srcOpEx = (
    <NodeCard label="DRE › Despesas Operacionais" value={fmtBRL(despOp)} tone="source" sub="Adm + Comercial" />
  );
  const srcDepr = (
    <NodeCard label="DRE › Depreciação" value={fmtBRL(depr)} tone="source" />
  );
  const srcLB = withBreakdown(
    <NodeCard label="DRE › Lucro Bruto" value={fmtBRL(lucroBruto)} tone="source" sub="RL − CPV" />,
    [
      <NodeCard key="rl" label="(+) Receita Líquida" value={fmtBRL(RL)} tone="source" />,
      <NodeCard key="cpv" label="(−) CPV/CSP/CMV" value={fmtBRL(cpv)} tone="source" />,
    ],
  );
  const srcEBITDA = withBreakdown(
    <NodeCard label="DRE › EBITDA" value={fmtBRL(ebitda)} tone="source" sub="LB − OpEx" />,
    [
      <NodeCard key="lb" label="(+) Lucro Bruto" value={fmtBRL(lucroBruto)} tone="source" />,
      <NodeCard key="op" label="(−) Desp. Operacionais" value={fmtBRL(despOp)} tone="source" />,
    ],
  );
  const srcEBIT = withBreakdown(
    <NodeCard label="DRE › EBIT" value={fmtBRL(d.ebit)} tone="source" sub="EBITDA − D&A" />,
    [
      <NodeCard key="ebd" label="(+) EBITDA" value={fmtBRL(ebitda)} tone="source" />,
      <NodeCard key="da" label="(−) Depreciação/Amort." value={fmtBRL(depr)} tone="source" />,
    ],
  );
  const srcLAIR = withBreakdown(
    <NodeCard label="DRE › LAIR" value={fmtBRL(d.lair)} tone="source" sub="EBIT ± Resultado Fin." />,
    [
      <NodeCard key="ebit" label="(+) EBIT" value={fmtBRL(d.ebit)} tone="source" />,
      <NodeCard key="rf" label="(±) Resultado Financeiro" value={fmtBRL(resFin)} tone="source" />,
    ],
  );
  const srcLL = withBreakdown(
    <NodeCard label="DRE › Lucro Líquido" value={fmtBRL(d.lucroLiquido)} tone="source" sub="LAIR − IR/CSLL" />,
    [
      <NodeCard key="lair" label="(+) LAIR" value={fmtBRL(d.lair)} tone="source" />,
      <NodeCard key="ir" label="(−) IR/CSLL" value={fmtBRL(impLucro)} tone="source" />,
    ],
  );
  const srcAT = withBreakdown(
    <NodeCard
      label="Balanço › Ativo Total"
      value={fmtBRL(d.ativoTotalMedio)}
      tone="source"
      sub="AC + ANC"
      warn={baseWarn}
    />,
    [
      <NodeCard key="ac" label="(+) Ativo Circulante" value={fmtBRL(ativoCirc)} tone="source" />,
      <NodeCard key="anc" label="(+) Ativo Não Circulante" value={fmtBRL(ativoNaoCirc)} tone="source" />,
    ],
  );
  const srcPL = (
    <NodeCard label="Balanço › PL Médio" value={fmtBRL(d.plMedio)} tone="source" sub="Capital + Lucros Acum." />
  );
  const srcCapInv = withBreakdown(
    <NodeCard label="Capital Investido" value={fmtBRL(capInv)} tone="source" sub="PL + Dívida Onerosa" />,
    [
      <NodeCard key="pl" label="(+) PL" value={fmtBRL(PL_atual)} tone="source" />,
      <NodeCard key="d" label="(+) Dívida Onerosa" value={fmtBRL(D_atual)} tone="source" />,
    ],
  );
  const srcNopat = withBreakdown(
    <NodeCard label="NOPAT" value={fmtBRL(nopat)} tone="source" hint={tipNopat} />,
    [
      <NodeCard key="ebit" label="(+) EBIT" value={fmtBRL(d.ebit)} tone="source" />,
      <NodeCard
        key="t"
        label="(×) (1 − t)"
        value={`${(100 - (ind.aliquotaNopat ?? 0)).toFixed(1)}%`}
        tone="source"
      />,
    ],
  );

  // Reconstruído (faixa-resumo)
  return (
    <div className="space-y-5">
      <style>{ORG_CSS}</style>

      {/* Header — ROE atual + fator dominante */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-primary">ROE</div>
          <div className="mono mt-1 text-2xl font-bold text-primary">{fmtPct(d.roeEngine)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Retorno sobre PL</div>
        </div>
        <div className="rounded-lg border-2 border-border bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">ROA</div>
          <div className="mono mt-1 text-2xl font-bold">{fmtPct(ind.roa)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Retorno sobre Ativo</div>
        </div>
        <div className="rounded-lg border-2 border-border bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">ROIC</div>
          <div className="mono mt-1 text-2xl font-bold">{fmtPct(ind.roic)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Cap. Investido</div>
        </div>
        <div className="rounded-lg border-2 border-border bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Fator Dominante
          </div>
          <div className="mt-1 text-sm font-semibold capitalize text-foreground">
            {d.fatorDominante === "operacional"
              ? "Operação"
              : d.fatorDominante === "alavancagem"
                ? "Alavancagem"
                : d.fatorDominante === "tributario"
                  ? "Tributos/Juros"
                  : "Indefinido"}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Maior contribuição ao ROE
          </div>
        </div>
      </div>

      {/* =================== ÁRVORE COMPLETA (única) =================== */}
      <div className="mb-3 text-xs text-muted-foreground">
        Decomposição estendida: ROE ← MAF ← ROA ← (Margem Líquida × Giro) ← Margem EBIT / EBITDA / Bruta · ROIC paralelo via NOPAT.
        Linhas tracejadas mostram as camadas intermediárias (ex.: Ativo Total = AC + ANC; Lucro Líquido = LAIR − IR/CSLL).
      </div>
      <div className="dupont-org">
        <ul>
          <li>
            {/* RAIZ: Rentabilidade do Acionista */}
            <NodeCard label="ROE" value={fmtPct(d.roeEngine)} tone="accent" size="xl" />
            <ul>
              {/* Trunk 1 — ROA × MAF */}
              <Branch
                factor={<NodeCard label="ROA" value={fmtPct(ind.roa)} tone="primary" hint={tipRoa} size="lg" />}
                numerator={
                  <NodeCard label="Margem Líquida" value={fmtPct(d.margemLiquida)} tone="pos" hint={tipMargemLiq} />
                }
                denominator={
                  <NodeCard label="Giro do Ativo" value={`${fmtRatio(d.giroAtivo)}×`} tone="primary" hint={tipGiro} warn={baseWarn} />
                }
                sources={{
                  num: [srcLL, srcRL],
                  den: [srcRL, srcAT],
                }}
              />
              <Branch
                factor={<NodeCard label="MAF" value={`${fmtRatio(d.maf)}×`} tone="warn" hint={tipMaf} warn={baseWarn} size="lg" />}
                numerator={<NodeCard label="Ativo Total Médio" value={fmtBRL(d.ativoTotalMedio)} tone="warn" warn={baseWarn} />}
                denominator={<NodeCard label="PL Médio" value={fmtBRL(d.plMedio)} tone="primary" />}
                sources={{ num: [srcAT], den: [srcPL] }}
              />
              {/* Trunk 2 — ROIC paralelo */}
              <Branch
                factor={<NodeCard label="ROIC" value={fmtPct(ind.roic)} tone="primary" hint={tipRoic} size="lg" />}
                numerator={<NodeCard label="NOPAT" value={fmtBRL(nopat)} tone="pos" hint={tipNopat} />}
                denominator={<NodeCard label="Capital Investido" value={fmtBRL(capInv)} tone="warn" />}
                sources={{
                  num: [srcNopat, srcEBIT],
                  den: [srcCapInv],
                }}
              />
            </ul>
          </li>
        </ul>
      </div>

      {/* Decomposição operacional vertical (Receita → EBITDA → EBIT → LAIR → LL) */}
      <div className="mt-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Cascata Operacional (do Faturamento ao Lucro Líquido)
        </div>
        <div className="dupont-org">
          <ul>
            <li>
              <NodeCard label="Receita Bruta" value={fmtBRL(RB)} tone="primary" size="lg" />
              <ul>
                <li>
                  <span className="dupont-stem" />
                  <NodeCard label="Receita Líquida" value={fmtBRL(RL)} tone="primary" size="lg" sub={`Deduções: ${fmtBRL(RB - RL)}`} />
                  <ul>
                    <li>
                      <span className="dupont-stem" />
                      <NodeCard label="Lucro Bruto" value={fmtBRL(lucroBruto)} tone="pos" size="lg" hint={tipMargemBruta} sub={`CPV: ${fmtBRL(cpv)}`} />
                      <ul>
                        <li>
                          <span className="dupont-stem" />
                          <NodeCard label="EBITDA" value={fmtBRL(ebitda)} tone="pos" size="lg" hint={tipMargemEbitda} sub={`OpEx: ${fmtBRL(despOp)}`} />
                          <ul>
                            <li>
                              <span className="dupont-stem" />
                              <NodeCard label="EBIT" value={fmtBRL(d.ebit)} tone="pos" size="lg" hint={tipMargemEbit} sub={`D&A: ${fmtBRL(depr)}`} />
                              <ul>
                                <li>
                                  <span className="dupont-stem" />
                                  <NodeCard label="LAIR" value={fmtBRL(d.lair)} tone="primary" size="lg" sub={`Res.Fin: ${fmtBRL(resFin)}`} />
                                  <ul>
                                    <li>
                                      <span className="dupont-stem" />
                                      <NodeCard label="Lucro Líquido" value={fmtBRL(d.lucroLiquido)} tone="accent" size="lg" hint={tipCTrib} sub={`IR/CSLL: ${fmtBRL(impLucro)}`} />
                                    </li>
                                  </ul>
                                </li>
                              </ul>
                            </li>
                          </ul>
                        </li>
                        <li className="is-source">
                          <span className="dupont-stem" />
                          {srcCPV}
                        </li>
                      </ul>
                    </li>
                    <li className="is-source">
                      <span className="dupont-stem" />
                      {srcOpEx}
                    </li>
                    <li className="is-source">
                      <span className="dupont-stem" />
                      {srcDepr}
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>

      <ReconciliationAlert delta={Math.abs(d.roeReconstruido3F - d.roeEngine) * 100} />


      <div className="text-[10px] text-muted-foreground italic">
        Linhas sólidas (azul) = decomposição matemática. Linhas tracejadas (cinza) = origens no DRE / Balanço.
        Bases médias quando informadas (AT e PL médios); senão, ponto final.
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
