// =====================================================================
// DupontTree — Decomposição do ROE renderizada com React Flow.
//
// • Foco exclusivo no ROE (sem cascata operacional separada).
// • Layout automático top-down via dagre — sem rolagem horizontal:
//   o container ocupa 100% da largura e `fitView` ajusta o zoom.
// • Conexões entre nós usam edges nativas do React Flow (sempre visíveis).
// • Nós estilizados com tokens do design system (shadcn).
// • 100% SSOT: consome `useFinanceModel` + `buildDupont`.
// =====================================================================
import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { buildDupont } from "@/engines/finance/dupont";
import { fmtBRL, fmtPct, fmtRatio, sum } from "@/engines/finance/format";
import { HelpTip } from "@/components/sim/shared/primitives";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "primary" | "pos" | "neg" | "muted" | "warn" | "source" | "accent";

interface DupontNodeData {
  label: string;
  value: string;
  sub?: string;
  tone: Tone;
  warn?: string;
  hint?: { text: string; formula?: string; calc?: string };
}

// ────────────────────────────────────────────────────────────────────
// Nó customizado (card)
// ────────────────────────────────────────────────────────────────────
const NODE_W = 210;
const NODE_H = 92;

function DupontNode({ data }: NodeProps<DupontNodeData>) {
  const { label, value, sub, tone, warn, hint } = data;
  const toneCls =
    tone === "accent"
      ? "border-primary/80 bg-primary/15 ring-2 ring-primary/30"
      : tone === "primary"
        ? "border-primary/60 bg-primary/10"
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
  return (
    <div
      className={cn(
        "rounded-xl border-2 p-2.5 shadow-sm text-left",
        toneCls,
      )}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-tight">
          {label}
        </div>
        {hint && <HelpTip text={hint.text} formula={hint.formula} calc={hint.calc} />}
      </div>
      <div className={cn("mono mt-1 text-base font-bold leading-tight", valCls)}>{value}</div>
      {sub && (
        <div className="mono mt-0.5 text-[10px] text-muted-foreground leading-snug">{sub}</div>
      )}
      {warn && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--warning)]">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {warn}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { dupont: DupontNode };

// ────────────────────────────────────────────────────────────────────
// Auto-layout com dagre (top-down)
// ────────────────────────────────────────────────────────────────────
function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 60, marginx: 12, marginy: 12 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      targetPosition: "top" as const,
      sourcePosition: "bottom" as const,
    };
  });
}

export function DupontTree({ state }: { state: AppState }) {
  const { dre, ind } = useFinanceModel(state);
  const d = useMemo(() => buildDupont(state, dre, ind), [state, dre, ind]);

  const { nodes, edges } = useMemo(() => {
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
    const baseWarn = d.ativoEstimado ? "Ativo estimado" : undefined;
    const deducoes = Math.max(0, RB - RL);

    const n = (
      id: string,
      data: DupontNodeData,
    ): Node<DupontNodeData> => ({
      id,
      type: "dupont",
      position: { x: 0, y: 0 },
      data,
    });

    const nodes: Node<DupontNodeData>[] = [
      // L0
      n("roe", {
        label: "ROE",
        value: fmtPct(d.roeEngine),
        sub: "Retorno sobre PL",
        tone: "accent",
        hint: {
          text: "Decomposição DuPont 3F: Margem Líquida × Giro × MAF.",
          formula: "ROA × MAF  =  (ML × Giro) × MAF",
          calc: `${fmtPct(d.margemLiquida)} × ${fmtRatio(d.giroAtivo)}× × ${fmtRatio(d.maf)}× = ${fmtPct(d.roeReconstruido3F)}`,
        },
      }),
      // L1
      n("roa", {
        label: "ROA",
        value: fmtPct(ind.roa),
        sub: "Margem Líq × Giro",
        tone: "primary",
        hint: {
          text: "Retorno sobre Ativo — lucro por R$ aplicado em ativos.",
          formula: "LL ÷ Ativo Médio  =  ML × Giro",
          calc: `${fmtPct(d.margemLiquida)} × ${fmtRatio(d.giroAtivo)}× = ${fmtPct(ind.roa)}`,
        },
      }),
      n("maf", {
        label: "MAF",
        value: `${fmtRatio(d.maf)}×`,
        sub: "Alavancagem Financeira",
        tone: "warn",
        warn: baseWarn,
        hint: {
          text: "Multiplicador de Alavancagem Financeira.",
          formula: "Ativo Médio ÷ PL Médio",
          calc: `${fmtBRL(d.ativoTotalMedio)} ÷ ${fmtBRL(d.plMedio)} = ${fmtRatio(d.maf)}×`,
        },
      }),
      // L2 — fatores de ROA
      n("ml", {
        label: "Margem Líquida",
        value: fmtPct(d.margemLiquida),
        tone: "pos",
        hint: {
          text: "Quanto sobra de cada R$ de receita após tudo.",
          formula: "LL ÷ RL",
          calc: `${fmtBRL(d.lucroLiquido)} ÷ ${fmtBRL(RL)} = ${fmtPct(d.margemLiquida)}`,
        },
      }),
      n("giro", {
        label: "Giro do Ativo",
        value: `${fmtRatio(d.giroAtivo)}×`,
        tone: "primary",
        warn: baseWarn,
        hint: {
          text: "Eficiência do uso dos ativos para gerar receita.",
          formula: "RL ÷ Ativo Médio",
          calc: `${fmtBRL(RL)} ÷ ${fmtBRL(d.ativoTotalMedio)} = ${fmtRatio(d.giroAtivo)}×`,
        },
      }),
      // L2 — fatores de MAF
      n("at", {
        label: "Ativo Total Médio",
        value: fmtBRL(d.ativoTotalMedio),
        sub: "AC + ANC",
        tone: "warn",
        warn: baseWarn,
      }),
      n("pl", {
        label: "PL Médio",
        value: fmtBRL(d.plMedio),
        sub: "Capital + Lucros Acum.",
        tone: "primary",
      }),
      // L3 — origens de Margem Líquida e Giro
      n("ll", {
        label: "Lucro Líquido",
        value: fmtBRL(d.lucroLiquido),
        sub: "LAIR − IR/CSLL",
        tone: "source",
      }),
      n("rl", {
        label: "Receita Líquida",
        value: fmtBRL(RL),
        sub: "RB − Deduções",
        tone: "source",
      }),
      // L3 — origens de Ativo
      n("ac", { label: "(+) Ativo Circulante", value: fmtBRL(ativoCirc), tone: "source" }),
      n("anc", { label: "(+) Ativo Não Circulante", value: fmtBRL(ativoNaoCirc), tone: "source" }),
      // L4 — abertura de RL
      n("rb", { label: "(+) Receita Bruta", value: fmtBRL(RB), tone: "source" }),
      n("ded", { label: "(−) Deduções/Tributos", value: fmtBRL(deducoes), tone: "source" }),
      // L4 — abertura de LL (cadeia operacional encadeada no LL)
      n("lair", { label: "LAIR", value: fmtBRL(d.lair), sub: "EBIT ± Res.Fin", tone: "source" }),
      n("ir", { label: "(−) IR/CSLL", value: fmtBRL(impLucro), tone: "source" }),
      // L5 — abertura de LAIR
      n("ebit", { label: "EBIT", value: fmtBRL(d.ebit), sub: "EBITDA − D&A", tone: "source" }),
      n("rf", { label: "(±) Resultado Financeiro", value: fmtBRL(resFin), tone: "source" }),
      // L6 — abertura de EBIT
      n("ebitda", {
        label: "EBITDA",
        value: fmtBRL(ebitda),
        sub: "LB − OpEx",
        tone: "source",
        hint: {
          text: "Capacidade da operação de gerar caixa antes de D&A, juros e tributos.",
          formula: "EBITDA ÷ RL",
          calc: `${fmtBRL(ebitda)} ÷ ${fmtBRL(RL)} = ${fmtPct(ind.margemEbitda)}`,
        },
      }),
      n("da", { label: "(−) Depreciação/Amort.", value: fmtBRL(depr), tone: "source" }),
      // L7 — abertura de EBITDA
      n("lb", {
        label: "Lucro Bruto",
        value: fmtBRL(lucroBruto),
        sub: "RL − CPV",
        tone: "source",
        hint: {
          text: "Eficiência produtiva e poder de precificação.",
          formula: "LB ÷ RL",
          calc: `${fmtBRL(lucroBruto)} ÷ ${fmtBRL(RL)} = ${fmtPct(ind.margemBruta)}`,
        },
      }),
      n("opex", { label: "(−) Desp. Operacionais", value: fmtBRL(despOp), tone: "source", sub: "Adm + Comercial" }),
      // L8 — abertura de LB
      n("cpv", { label: "(−) CPV/CSP/CMV", value: fmtBRL(cpv), tone: "source" }),
    ];

    const mk = (source: string, target: string, dashed = false): Edge => ({
      id: `${source}-${target}`,
      source,
      target,
      type: "smoothstep",
      animated: false,
      style: {
        stroke: dashed ? "hsl(var(--border))" : "hsl(var(--primary) / 0.55)",
        strokeWidth: 2,
        strokeDasharray: dashed ? "4 4" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: dashed ? "hsl(var(--border))" : "hsl(var(--primary) / 0.7)",
        width: 14,
        height: 14,
      },
    });

    const edges: Edge[] = [
      // ROE → ROA × MAF
      mk("roe", "roa"),
      mk("roe", "maf"),
      // ROA → ML, Giro
      mk("roa", "ml"),
      mk("roa", "giro"),
      // MAF → AT, PL
      mk("maf", "at", true),
      mk("maf", "pl", true),
      // ML → LL, RL  |  Giro → RL, AT
      mk("ml", "ll", true),
      mk("ml", "rl", true),
      mk("giro", "rl", true),
      mk("giro", "at", true),
      // AT → AC + ANC
      mk("at", "ac", true),
      mk("at", "anc", true),
      // RL → RB, Deduções
      mk("rl", "rb", true),
      mk("rl", "ded", true),
      // LL → LAIR, IR
      mk("ll", "lair", true),
      mk("ll", "ir", true),
      // LAIR → EBIT, ResFin
      mk("lair", "ebit", true),
      mk("lair", "rf", true),
      // EBIT → EBITDA, D&A
      mk("ebit", "ebitda", true),
      mk("ebit", "da", true),
      // EBITDA → LB, OpEx
      mk("ebitda", "lb", true),
      mk("ebitda", "opex", true),
      // LB → RL (reuso), CPV
      mk("lb", "cpv", true),
    ];

    return { nodes: layout(nodes, edges), edges };
  }, [state, dre, ind, d]);

  return (
    <div className="space-y-4">
      {/* Header — KPIs */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-primary">ROE</div>
          <div className="mono mt-1 text-2xl font-bold text-primary">{fmtPct(d.roeEngine)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Retorno sobre PL</div>
        </div>
        <div className="rounded-lg border-2 border-border bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Margem Líq.</div>
          <div className="mono mt-1 text-2xl font-bold">{fmtPct(d.margemLiquida)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">LL ÷ RL</div>
        </div>
        <div className="rounded-lg border-2 border-border bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Giro</div>
          <div className="mono mt-1 text-2xl font-bold">{fmtRatio(d.giroAtivo)}×</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">RL ÷ Ativo</div>
        </div>
        <div className="rounded-lg border-2 border-border bg-card p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">MAF</div>
          <div className="mono mt-1 text-2xl font-bold">{fmtRatio(d.maf)}×</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Ativo ÷ PL</div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Linhas sólidas = decomposição matemática (ROE = ROA × MAF). Linhas tracejadas = origens no DRE / Balanço.
        Arraste para mover, use a roda do mouse para zoom.
      </div>

      {/* Canvas React Flow — largura 100%, sem rolagem horizontal */}
      <div className="w-full rounded-lg border border-border/60 bg-card/30" style={{ height: 720 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>

      <ReconciliationAlert delta={Math.abs(d.roeReconstruido3F - d.roeEngine) * 100} />
    </div>
  );
}

function ReconciliationAlert({ delta }: { delta: number }) {
  if (delta <= 0.5) return null;
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-2 text-xs text-[var(--warning)]">
      <AlertTriangle className="h-3.5 w-3.5" /> Divergência de reconciliação: {delta.toFixed(2)} p.p.
      (normal quando há bases médias parciais).
    </div>
  );
}
