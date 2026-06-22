// =====================================================================
// FinnancePRO — Relatório Executivo (padrão consultoria premium).
//
// Estética inspirada em McKinsey / Bain / BCG / Deloitte Insights:
// capa executiva, narrativa (Situação → Riscos → Prioridades → Plano),
// painel de KPIs, saúde financeira, recomendações em formato
// consultoria, apêndice com DRE/Balanço/DFC/indicadores completos.
//
// Visual: muito espaço em branco, tipografia hierárquica (helvetica
// como proxy de Inter/IBM Plex), paleta restrita (preto + cinzas;
// cor apenas para alertas), capa em fundo grafite.
// =====================================================================

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { sum, fmtBRL, fmtPct } from "@/engines/finance/format";
import type { AppState, BalancoDetalhado } from "@/engines/finance/types";
import type { FinancialModel } from "@/engines/finance/financialModel";
import { diagnose } from "@/engines/finance/diagnose";
import { buildPrescriptiveCards } from "@/engines/finance/prescriptive";
import { monthValues } from "@/engines/finance/costs";
import { splitReceitasFinanceiras } from "@/engines/finance/shared";

// ── Paleta (mínima, executiva) ────────────────────────────────────────
const INK = [10, 10, 10] as [number, number, number];           // preto
const CHARCOAL = [31, 41, 55] as [number, number, number];      // gray-800
const GRAY = [107, 114, 128] as [number, number, number];       // gray-500
const LIGHT = [229, 231, 235] as [number, number, number];      // gray-200
const HAIRLINE = [209, 213, 219] as [number, number, number];   // gray-300
const SUBTLE = [249, 250, 251] as [number, number, number];     // gray-50
const COVER_BG = [17, 24, 39] as [number, number, number];      // gray-900
const COVER_FG = [243, 244, 246] as [number, number, number];   // gray-100
const COVER_MUTED = [156, 163, 175] as [number, number, number];// gray-400
const OK = [5, 150, 105] as [number, number, number];           // emerald-600
const WARN = [217, 119, 6] as [number, number, number];         // amber-600
const BAD = [220, 38, 38] as [number, number, number];          // red-600

const FOOTER_TEXT = "Gerado com FinnancePRO  ·  Mais detalhes em finnancepro.com.br";
const PAGE_MARGIN = 56;
const HEADER_Y = 36;       // linha do cabeçalho topo
const CONTENT_TOP = 92;    // primeira linha de conteúdo
const FONT = "helvetica";  // proxy de Inter

// ── Utilitários ───────────────────────────────────────────────────────
async function loadImageAsDataURL(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function nowBR(): string {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function setColor(doc: jsPDF, kind: "text" | "fill" | "draw", c: readonly [number, number, number]) {
  if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
  else if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
  else doc.setDrawColor(c[0], c[1], c[2]);
}

// Cabeçalho mínimo: linha fina com nome do sistema · empresa · seção.
function drawHeader(doc: jsPDF, companyName: string, section: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  setColor(doc, "text", INK);
  doc.text("FINNANCEPRO", PAGE_MARGIN, HEADER_Y);
  doc.setFont(FONT, "normal");
  setColor(doc, "text", GRAY);
  doc.text(`${companyName}  ·  ${section}`, w - PAGE_MARGIN, HEADER_Y, { align: "right" });
  setColor(doc, "draw", LIGHT);
  doc.setLineWidth(0.5);
  doc.line(PAGE_MARGIN, HEADER_Y + 6, w - PAGE_MARGIN, HEADER_Y + 6);
}

// Rodapé mínimo.
function drawFooter(doc: jsPDF, pageNum: number, pageCount: number) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  setColor(doc, "draw", LIGHT);
  doc.setLineWidth(0.5);
  doc.line(PAGE_MARGIN, h - 40, w - PAGE_MARGIN, h - 40);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  setColor(doc, "text", GRAY);
  doc.text(FOOTER_TEXT, PAGE_MARGIN, h - 26);
  doc.text(`${String(pageNum).padStart(2, "0")} / ${String(pageCount).padStart(2, "0")}`,
    w - PAGE_MARGIN, h - 26, { align: "right" });
}

// Título de página (h1 grande, subtítulo cinza).
function pageTitle(doc: jsPDF, y: number, eyebrow: string, title: string, subtitle?: string): number {
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  setColor(doc, "text", GRAY);
  doc.text(eyebrow.toUpperCase(), PAGE_MARGIN, y);
  doc.setFont(FONT, "bold");
  doc.setFontSize(24);
  setColor(doc, "text", INK);
  doc.text(title, PAGE_MARGIN, y + 26);
  let cursor = y + 36;
  if (subtitle) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(10.5);
    setColor(doc, "text", CHARCOAL);
    const lines = doc.splitTextToSize(subtitle, doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2);
    doc.text(lines, PAGE_MARGIN, cursor + 4);
    cursor += lines.length * 14;
  }
  // régua fina sob o título
  setColor(doc, "draw", INK);
  doc.setLineWidth(1.2);
  doc.line(PAGE_MARGIN, cursor + 14, PAGE_MARGIN + 32, cursor + 14);
  return cursor + 36;
}

function newPage(doc: jsPDF, eyebrow: string, title: string, subtitle?: string): number {
  doc.addPage();
  return pageTitle(doc, CONTENT_TOP, eyebrow, title, subtitle);
}

// Texto multi-linha simples.
function paragraph(doc: jsPDF, y: number, text: string, opts?: { size?: number; color?: readonly [number, number, number]; bold?: boolean }): number {
  const size = opts?.size ?? 10.5;
  doc.setFont(FONT, opts?.bold ? "bold" : "normal");
  doc.setFontSize(size);
  setColor(doc, "text", opts?.color ?? CHARCOAL);
  const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2);
  doc.text(lines, PAGE_MARGIN, y);
  return y + lines.length * (size * 1.35);
}

// ── Capa executiva (página 1, fundo escuro) ───────────────────────────
function drawCover(
  doc: jsPDF, logoData: string | null, companyName: string,
  periodMonths: number, score: number, conceito: string, scoreTone: "ok" | "warn" | "bad",
  execMessage: string,
) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  setColor(doc, "fill", COVER_BG);
  doc.rect(0, 0, w, h, "F");

  // Logo + wordmark topo
  if (logoData) {
    try { doc.addImage(logoData, "PNG", PAGE_MARGIN, PAGE_MARGIN, 28, 28); } catch { /* noop */ }
  }
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  setColor(doc, "text", COVER_FG);
  doc.text("FINNANCEPRO", PAGE_MARGIN + (logoData ? 38 : 0), PAGE_MARGIN + 18);
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  setColor(doc, "text", COVER_MUTED);
  doc.text("Relatório Executivo de Saúde Financeira", PAGE_MARGIN + (logoData ? 38 : 0), PAGE_MARGIN + 30);

  // Bloco central
  const cy = h * 0.32;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  setColor(doc, "text", COVER_MUTED);
  doc.text("EMPRESA ANALISADA", PAGE_MARGIN, cy);

  doc.setFont(FONT, "bold");
  doc.setFontSize(32);
  setColor(doc, "text", COVER_FG);
  const nameLines = doc.splitTextToSize(companyName, w - PAGE_MARGIN * 2);
  doc.text(nameLines, PAGE_MARGIN, cy + 28);

  // Período + data
  doc.setFont(FONT, "normal");
  doc.setFontSize(10);
  setColor(doc, "text", COVER_MUTED);
  doc.text(`Horizonte de análise: ${periodMonths} meses  ·  Emitido em ${nowBR()}`,
    PAGE_MARGIN, cy + 28 + nameLines.length * 30 + 18);

  // Régua decorativa
  setColor(doc, "draw", COVER_MUTED);
  doc.setLineWidth(0.7);
  doc.line(PAGE_MARGIN, h * 0.58, PAGE_MARGIN + 80, h * 0.58);

  // Score executivo (Guardian)
  const scoreColor = scoreTone === "ok" ? OK : scoreTone === "warn" ? WARN : BAD;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  setColor(doc, "text", COVER_MUTED);
  doc.text("GUARDIAN SCORE", PAGE_MARGIN, h * 0.62);

  doc.setFont(FONT, "bold");
  doc.setFontSize(64);
  setColor(doc, "text", COVER_FG);
  doc.text(`${score.toFixed(0)}`, PAGE_MARGIN, h * 0.62 + 56);
  doc.setFontSize(20);
  setColor(doc, "text", COVER_MUTED);
  doc.text("/100", PAGE_MARGIN + 80, h * 0.62 + 56);

  doc.setFont(FONT, "bold");
  doc.setFontSize(12);
  setColor(doc, "text", scoreColor);
  doc.text(`Classificação: ${conceito.toUpperCase()}`, PAGE_MARGIN, h * 0.62 + 78);

  // Mensagem executiva (lateral direita)
  doc.setFont(FONT, "normal");
  doc.setFontSize(10.5);
  setColor(doc, "text", COVER_FG);
  const msgX = w / 2 + 10;
  const msgW = w - msgX - PAGE_MARGIN;
  const msgLines = doc.splitTextToSize(execMessage, msgW);
  doc.text(msgLines, msgX, h * 0.62 + 18);

  // Rodapé escuro
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  setColor(doc, "text", COVER_MUTED);
  doc.text(FOOTER_TEXT, PAGE_MARGIN, h - PAGE_MARGIN);
  doc.text("CONFIDENCIAL", w - PAGE_MARGIN, h - PAGE_MARGIN, { align: "right" });
}

// ── KPI Card (executivo, sem cor) ─────────────────────────────────────
type KpiCard = {
  label: string; value: string; sub?: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
};
function drawKpiCards(doc: jsPDF, yStart: number, cards: KpiCard[], cols: number): number {
  const w = doc.internal.pageSize.getWidth();
  const gap = 12;
  const cardW = (w - PAGE_MARGIN * 2 - gap * (cols - 1)) / cols;
  const cardH = 76;
  let y = yStart;
  cards.forEach((c, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) y += cardH + gap;
    const x = PAGE_MARGIN + col * (cardW + gap);
    // moldura ultra-fina
    setColor(doc, "draw", HAIRLINE);
    doc.setLineWidth(0.5);
    doc.rect(x, y, cardW, cardH, "S");
    // marcador de tom (1pt à esquerda, sutil)
    const tone = c.tone === "ok" ? OK : c.tone === "warn" ? WARN : c.tone === "bad" ? BAD : INK;
    setColor(doc, "fill", tone);
    doc.rect(x, y, 2, cardH, "F");
    // label
    doc.setFont(FONT, "bold");
    doc.setFontSize(7);
    setColor(doc, "text", GRAY);
    doc.text(c.label.toUpperCase(), x + 12, y + 16);
    // value
    doc.setFont(FONT, "bold");
    doc.setFontSize(18);
    setColor(doc, "text", INK);
    doc.text(c.value, x + 12, y + 42);
    // sub
    if (c.sub) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      setColor(doc, "text", GRAY);
      const lines = doc.splitTextToSize(c.sub, cardW - 24);
      doc.text(lines.slice(0, 2), x + 12, y + 60);
    }
  });
  return y + cardH + 16;
}

// Subtítulo de bloco dentro de uma página.
function blockHeader(doc: jsPDF, y: number, title: string, hint?: string): number {
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  setColor(doc, "text", INK);
  doc.text(title, PAGE_MARGIN, y);
  if (hint) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    setColor(doc, "text", GRAY);
    doc.text(hint, PAGE_MARGIN, y + 14);
    return y + 28;
  }
  return y + 18;
}

// Tabela executiva (clean, sem zebra agressiva).
function execTable(
  doc: jsPDF, yStart: number, head: string[], body: (string | number)[][],
  opts?: { colStyles?: Record<number, Record<string, unknown>>; firstColBold?: boolean },
): number {
  autoTable(doc, {
    startY: yStart,
    head: [head],
    body,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: CONTENT_TOP, bottom: 64 },
    theme: "plain",
    styles: {
      font: FONT, fontSize: 9.5, cellPadding: { top: 7, right: 8, bottom: 7, left: 8 },
      textColor: CHARCOAL, lineColor: LIGHT, lineWidth: 0,
      valign: "middle",
    },
    headStyles: {
      fillColor: [255, 255, 255], textColor: GRAY,
      fontStyle: "bold", fontSize: 7.5, halign: "left",
      cellPadding: { top: 4, right: 8, bottom: 8, left: 8 },
      lineColor: INK, lineWidth: 0,
    },
    bodyStyles: { lineColor: LIGHT, lineWidth: 0 },
    columnStyles: (opts?.colStyles ?? head.reduce<Record<number, { halign: "right" | "left" }>>((acc, _h, i) => {
      if (i > 0) acc[i] = { halign: "right" };
      return acc;
    }, {})) as Record<number, Partial<Record<string, unknown>>>,
    didParseCell: (data) => {
      if (data.section === "head") {
        // Linha sob o cabeçalho
        data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.8, left: 0 } as never;
        data.cell.styles.lineColor = INK;
        // converte texto do head para uppercase com letterspacing visual
        if (typeof data.cell.raw === "string") {
          data.cell.text = [String(data.cell.raw).toUpperCase()];
        }
      } else if (data.section === "body") {
        // Linha cinza-claro entre linhas
        data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.4, left: 0 } as never;
        data.cell.styles.lineColor = LIGHT;
        if (opts?.firstColBold && data.column.index === 0) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = INK;
        }
      }
    },
  });
  // @ts-expect-error — autoTable atribui lastAutoTable em runtime
  return (doc.lastAutoTable?.finalY ?? yStart) + 18;
}

// Tabela densa (apêndice).
function appendixTable(
  doc: jsPDF, yStart: number, head: string[], body: (string | number)[][],
  rowMeta: ("normal" | "section" | "total" | "highlight")[],
  colStyles: Record<number, Record<string, unknown>>,
): number {
  autoTable(doc, {
    startY: yStart,
    head: [head],
    body,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: CONTENT_TOP, bottom: 64 },
    theme: "plain",
    styles: {
      font: FONT, fontSize: 8.5, cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
      textColor: CHARCOAL, lineColor: LIGHT, lineWidth: 0, valign: "middle",
    },
    headStyles: {
      fillColor: [255, 255, 255], textColor: GRAY,
      fontStyle: "bold", fontSize: 7.5, halign: "left",
      cellPadding: { top: 4, right: 6, bottom: 8, left: 6 },
    },
    columnStyles: colStyles as Record<number, Partial<Record<string, unknown>>>,
    didParseCell: (data) => {
      if (data.section === "head") {
        data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.8, left: 0 } as never;
        data.cell.styles.lineColor = INK;
        if (typeof data.cell.raw === "string") {
          data.cell.text = [String(data.cell.raw).toUpperCase()];
        }
      } else if (data.section === "body") {
        const meta = rowMeta[data.row.index];
        data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.3, left: 0 } as never;
        data.cell.styles.lineColor = LIGHT;
        if (meta === "section") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 7.5;
          data.cell.styles.textColor = GRAY;
          data.cell.styles.fillColor = SUBTLE;
          if (data.column.index === 0 && typeof data.cell.raw === "string") {
            data.cell.text = [String(data.cell.raw).toUpperCase()];
          }
        } else if (meta === "total") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = INK;
          data.cell.styles.lineWidth = { top: 0.6, right: 0, bottom: 0.6, left: 0 } as never;
          data.cell.styles.lineColor = INK;
        } else if (meta === "highlight") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = INK;
          data.cell.styles.fillColor = SUBTLE;
        }
      }
    },
  });
  // @ts-expect-error — runtime
  return (doc.lastAutoTable?.finalY ?? yStart) + 14;
}

// Barra horizontal simples (gauge minimalista).
function drawBar(doc: jsPDF, x: number, y: number, w: number, h: number, pct: number, tone: "ok" | "warn" | "bad") {
  const color = tone === "ok" ? OK : tone === "warn" ? WARN : BAD;
  setColor(doc, "fill", LIGHT);
  doc.rect(x, y, w, h, "F");
  setColor(doc, "fill", color);
  doc.rect(x, y, Math.max(0, Math.min(1, pct)) * w, h, "F");
}

// ── Score de saúde (mesma fórmula do DashboardExtras) ─────────────────
function computeGuardianScore(ind: FinancialModel["ind"]): {
  score: number; conceito: string; tone: "ok" | "warn" | "bad";
} {
  const parts = [
    Math.min(100, Math.max(0, (ind.liquidezCorrente / 2) * 100)),
    Math.min(100, Math.max(0, 100 - ind.endividamentoGeral)),
    Math.min(100, Math.max(0, ind.margemLiquida * 5)),
    Math.min(100, Math.max(0, ind.coberturaJuros * 20)),
    Math.min(100, Math.max(0, ind.roe * 5)),
    Math.min(100, Math.max(0, ind.conversaoEbitdaCaixa)),
    Math.min(100, Math.max(0, 100 - ind.dividaLiqEbitda * 25)),
  ];
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  const conceito = score >= 80 ? "Excelente" : score >= 65 ? "Boa"
    : score >= 45 ? "Atenção" : "Crítica";
  const tone: "ok" | "warn" | "bad" = score >= 65 ? "ok" : score >= 45 ? "warn" : "bad";
  return { score, conceito, tone };
}

// =====================================================================
// EXPORT PRINCIPAL
// =====================================================================
export interface ExportPDFInput { state: AppState; model: FinancialModel; }

interface PageMeta { eyebrow: string; title: string }
const pageMeta: Record<number, PageMeta> = {}; // mapeia índice → seção (para header)

export async function exportFinancePDF({ state, model }: ExportPDFInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const logoData = await loadImageAsDataURL(logoAsset.url);
  const companyName = state.companyName?.trim() || "Empresa Cliente";
  const { dre, ind, cf, balancoFechamento, regime } = model;
  const periodoMeses = state.periodoAnaliseMeses ?? 12;
  const { score, conceito, tone } = computeGuardianScore(ind);
  const diags = diagnose(state, dre, ind);
  const prescriptive = buildPrescriptiveCards(state);

  // Mensagem executiva de capa: 2-3 frases, derivadas dos diagnósticos.
  const topRiscos = diags.filter((d) => d.level === "danger").slice(0, 2);
  const execMessage = (() => {
    if (topRiscos.length === 0 && score >= 65) {
      return "A empresa apresenta indicadores financeiros saudáveis. As recomendações deste relatório foram priorizadas para consolidar performance e ampliar geração de valor.";
    }
    if (topRiscos.length === 0) {
      return "A empresa apresenta sinais mistos. Este relatório identifica pontos de atenção e prioriza ações pragmáticas de curto prazo.";
    }
    return `Identificamos sinais relevantes que demandam atenção imediata, com destaque para: ${topRiscos.map((r) => r.title.toLowerCase()).join(" e ")}. Este documento detalha o diagnóstico, riscos e prioridades de ação.`;
  })();

  // ── PÁGINA 1 — CAPA EXECUTIVA ──────────────────────────────────────
  drawCover(doc, logoData, companyName, periodoMeses, score, conceito, tone, execMessage);
  pageMeta[1] = { eyebrow: "", title: "" }; // sem header/footer

  // ── PÁGINA 2 — RESUMO EXECUTIVO ────────────────────────────────────
  doc.addPage();
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "01", title: "Resumo Executivo" };
  let y = pageTitle(doc, CONTENT_TOP, "01  ·  Sumário",
    "Resumo Executivo",
    "Os cinco pontos a seguir sintetizam o diagnóstico financeiro. Detalhes, indicadores e recomendações nas seções seguintes.");

  const insights = buildExecutiveInsights(state, model, score, conceito);
  insights.forEach((it, i) => {
    // número
    doc.setFont(FONT, "bold");
    doc.setFontSize(28);
    setColor(doc, "text", LIGHT);
    doc.text(String(i + 1).padStart(2, "0"), PAGE_MARGIN, y + 8);
    // título
    doc.setFont(FONT, "bold");
    doc.setFontSize(12);
    setColor(doc, "text", INK);
    doc.text(it.title, PAGE_MARGIN + 44, y);
    // descrição
    doc.setFont(FONT, "normal");
    doc.setFontSize(10);
    setColor(doc, "text", CHARCOAL);
    const lines = doc.splitTextToSize(it.detail, doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2 - 44);
    doc.text(lines, PAGE_MARGIN + 44, y + 14);
    // marcador de tom (ponto)
    const tColor = it.tone === "ok" ? OK : it.tone === "warn" ? WARN : it.tone === "bad" ? BAD : GRAY;
    setColor(doc, "fill", tColor);
    doc.circle(PAGE_MARGIN + 38, y - 4, 2.5, "F");
    y += 14 + lines.length * 13 + 18;
  });

  // ── PÁGINA 3 — PAINEL EXECUTIVO ────────────────────────────────────
  doc.addPage();
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "02", title: "Painel Executivo" };
  y = pageTitle(doc, CONTENT_TOP, "02  ·  KPIs",
    "Painel Executivo",
    "Indicadores-chave de performance do período analisado.");

  const caixaAtual = state.capital.disponibilidades ?? 0;
  const dscrFmt = ind.dscr !== 0 ? `${ind.dscr.toFixed(2)}x` : "—";
  const kpiCards: KpiCard[] = [
    { label: "Receita Líquida", value: fmtBRL(ind.receitaLiquidaAnual), sub: "Últimos 12 meses" },
    { label: "EBITDA", value: fmtBRL(ind.ebitdaAnual),
      sub: `Margem ${ind.margemEbitda.toFixed(1)}%`,
      tone: ind.ebitdaAnual >= 0 ? "ok" : "bad" },
    { label: "Lucro Líquido", value: fmtBRL(ind.lucroLiquidoAnual),
      sub: `Margem ${ind.margemLiquida.toFixed(1)}%`,
      tone: ind.lucroLiquidoAnual >= 0 ? "ok" : "bad" },
    { label: "Caixa Atual", value: fmtBRL(caixaAtual),
      sub: `Saldo projetado dez: ${fmtBRL(cf.totais.saldoFinal)}` },
    { label: "ROIC", value: fmtPct(ind.roic / 100),
      sub: `WACC: ${fmtPct(ind.wacc / 100)}`,
      tone: ind.roic >= ind.wacc ? "ok" : "bad" },
    { label: "WACC", value: fmtPct(ind.wacc / 100), sub: "Custo de capital ponderado" },
    { label: "Guardian Score", value: `${score.toFixed(0)}/100`,
      sub: `Classificação: ${conceito}`, tone },
    { label: "DSCR", value: dscrFmt,
      sub: "Cobertura do serviço da dívida",
      tone: ind.dscr >= 1.5 ? "ok" : ind.dscr >= 1.25 ? "warn" : "bad" },
    { label: "Margem Líquida", value: `${ind.margemLiquida.toFixed(1)}%`,
      sub: "Lucro / Receita Bruta",
      tone: ind.margemLiquida >= 8 ? "ok" : ind.margemLiquida >= 3 ? "warn" : "bad" },
  ];
  drawKpiCards(doc, y, kpiCards, 3);

  // ── PÁGINA 4 — SAÚDE FINANCEIRA ────────────────────────────────────
  doc.addPage();
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "03", title: "Saúde Financeira" };
  y = pageTitle(doc, CONTENT_TOP, "03  ·  Diagnóstico",
    "Saúde Financeira",
    "Avaliação por dimensão: liquidez, rentabilidade, endividamento, capital de giro, geração de caixa e tributação.");

  const dimensions = buildHealthDimensions(ind, state);
  const w = doc.internal.pageSize.getWidth();
  dimensions.forEach((d) => {
    // linha base
    setColor(doc, "draw", LIGHT);
    doc.setLineWidth(0.4);
    doc.line(PAGE_MARGIN, y - 4, w - PAGE_MARGIN, y - 4);

    doc.setFont(FONT, "bold");
    doc.setFontSize(10.5);
    setColor(doc, "text", INK);
    doc.text(d.label, PAGE_MARGIN, y + 12);

    // score numérico
    doc.setFont(FONT, "bold");
    doc.setFontSize(10.5);
    const tCol = d.tone === "ok" ? OK : d.tone === "warn" ? WARN : BAD;
    setColor(doc, "text", tCol);
    const statusLabel = d.tone === "ok" ? "SAUDÁVEL" : d.tone === "warn" ? "ATENÇÃO" : "CRÍTICO";
    doc.text(statusLabel, w - PAGE_MARGIN, y + 12, { align: "right" });

    // barra
    drawBar(doc, PAGE_MARGIN, y + 22, w - PAGE_MARGIN * 2, 4, d.score / 100, d.tone);

    // comentário
    doc.setFont(FONT, "normal");
    doc.setFontSize(9.5);
    setColor(doc, "text", GRAY);
    const lines = doc.splitTextToSize(d.comment, w - PAGE_MARGIN * 2);
    doc.text(lines, PAGE_MARGIN, y + 40);

    y += 40 + lines.length * 12 + 14;
  });

  // ── PÁGINA 5 — PRINCIPAIS RISCOS ───────────────────────────────────
  doc.addPage();
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "04", title: "Principais Riscos" };
  y = pageTitle(doc, CONTENT_TOP, "04  ·  Riscos",
    "Principais Riscos",
    "Top 5 riscos identificados — ordenados por severidade e probabilidade.");

  const risks = buildTopRisks(diags, ind, prescriptive).slice(0, 5);
  if (risks.length === 0) {
    paragraph(doc, y, "Nenhum risco crítico identificado no horizonte analisado.", { color: GRAY });
  } else {
    risks.forEach((r, i) => {
      const blockH = 78;
      // Caixa
      setColor(doc, "draw", HAIRLINE);
      doc.setLineWidth(0.5);
      doc.rect(PAGE_MARGIN, y, w - PAGE_MARGIN * 2, blockH, "S");
      // tag severidade
      const sCol = r.severity === "bad" ? BAD : r.severity === "warn" ? WARN : GRAY;
      setColor(doc, "fill", sCol);
      doc.rect(PAGE_MARGIN, y, 3, blockH, "F");
      // número
      doc.setFont(FONT, "bold");
      doc.setFontSize(9);
      setColor(doc, "text", GRAY);
      doc.text(`RISCO ${String(i + 1).padStart(2, "0")}`, PAGE_MARGIN + 14, y + 14);
      // título
      doc.setFont(FONT, "bold");
      doc.setFontSize(11.5);
      setColor(doc, "text", INK);
      doc.text(r.title, PAGE_MARGIN + 14, y + 30);
      // grid: impacto / probabilidade
      const colW = (w - PAGE_MARGIN * 2 - 28) / 3;
      const labels = [
        { l: "IMPACTO", v: r.impact },
        { l: "PROBABILIDADE", v: r.probability },
        { l: "RECOMENDAÇÃO", v: r.recommendation },
      ];
      labels.forEach((it, j) => {
        const x = PAGE_MARGIN + 14 + j * colW;
        doc.setFont(FONT, "bold");
        doc.setFontSize(7);
        setColor(doc, "text", GRAY);
        doc.text(it.l, x, y + 46);
        doc.setFont(FONT, "normal");
        doc.setFontSize(8.5);
        setColor(doc, "text", CHARCOAL);
        const ls = doc.splitTextToSize(it.v, colW - 8);
        doc.text(ls.slice(0, 2), x, y + 58);
      });
      y += blockH + 10;
    });
  }

  // ── PÁGINA 6 — PRIORIDADES DO CFO ──────────────────────────────────
  doc.addPage();
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "05", title: "Prioridades do CFO" };
  y = pageTitle(doc, CONTENT_TOP, "05  ·  Plano de Ação",
    "Prioridades do CFO",
    "Top 3 prioridades — ordenadas por impacto financeiro e prazo de execução.");

  const priorities = buildPriorities(prescriptive, diags).slice(0, 3);
  if (priorities.length === 0) {
    paragraph(doc, y, "Nenhuma ação prioritária identificada — manter o monitoramento regular dos indicadores.", { color: GRAY });
  } else {
    priorities.forEach((p, i) => {
      const blockH = 110;
      // Número grande à esquerda
      doc.setFont(FONT, "bold");
      doc.setFontSize(48);
      setColor(doc, "text", LIGHT);
      doc.text(`#${i + 1}`, PAGE_MARGIN, y + 50);

      const xText = PAGE_MARGIN + 70;
      // título
      doc.setFont(FONT, "bold");
      doc.setFontSize(7);
      setColor(doc, "text", GRAY);
      doc.text("PRIORIDADE", xText, y + 14);
      doc.setFont(FONT, "bold");
      doc.setFontSize(13);
      setColor(doc, "text", INK);
      const tLines = doc.splitTextToSize(p.title, w - xText - PAGE_MARGIN);
      doc.text(tLines.slice(0, 2), xText, y + 30);
      // detalhes grid
      const metaY = y + 60;
      const metaCols = [
        { l: "BENEFÍCIO ESTIMADO", v: p.benefit },
        { l: "PRAZO", v: p.deadline },
        { l: "COMPLEXIDADE", v: p.complexity },
      ];
      const colW = (w - xText - PAGE_MARGIN) / 3;
      metaCols.forEach((m, j) => {
        const x = xText + j * colW;
        doc.setFont(FONT, "bold");
        doc.setFontSize(7);
        setColor(doc, "text", GRAY);
        doc.text(m.l, x, metaY);
        doc.setFont(FONT, "bold");
        doc.setFontSize(10);
        setColor(doc, "text", INK);
        doc.text(m.v, x, metaY + 14);
      });
      // descrição
      doc.setFont(FONT, "normal");
      doc.setFontSize(9.5);
      setColor(doc, "text", CHARCOAL);
      const dLines = doc.splitTextToSize(p.description, w - xText - PAGE_MARGIN);
      doc.text(dLines.slice(0, 2), xText, y + 90);

      // divisor
      setColor(doc, "draw", LIGHT);
      doc.setLineWidth(0.4);
      doc.line(PAGE_MARGIN, y + blockH + 6, w - PAGE_MARGIN, y + blockH + 6);

      y += blockH + 18;
    });
  }

  // ── PÁGINA 7 — RECOMENDAÇÕES (formato consultoria) ─────────────────
  if (prescriptive.length > 0) {
    doc.addPage();
    pageMeta[doc.getNumberOfPages()] = { eyebrow: "06", title: "Recomendações" };
    y = pageTitle(doc, CONTENT_TOP, "06  ·  Recomendações",
      "Recomendações Estratégicas",
      "Análise problema-diagnóstico-impacto-ação, ordenada por severidade.");

    const sevOrder: Record<string, number> = { danger: 0, warn: 1, info: 2, ok: 3 };
    const sorted = [...prescriptive].sort((a, b) =>
      (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9)).slice(0, 6);

    sorted.forEach((c) => {
      if (y > doc.internal.pageSize.getHeight() - 180) {
        doc.addPage();
        pageMeta[doc.getNumberOfPages()] = { eyebrow: "06", title: "Recomendações" };
        y = pageTitle(doc, CONTENT_TOP, "06  ·  Recomendações", "Recomendações Estratégicas (cont.)");
      }
      const sLabel = c.severity === "danger" ? "CRÍTICO" : c.severity === "warn" ? "ATENÇÃO"
        : c.severity === "info" ? "OPORTUNIDADE" : "OK";
      const sCol = c.severity === "danger" ? BAD : c.severity === "warn" ? WARN
        : c.severity === "info" ? CHARCOAL : OK;
      // tag
      doc.setFont(FONT, "bold");
      doc.setFontSize(7);
      setColor(doc, "text", sCol);
      doc.text(sLabel, PAGE_MARGIN, y);
      // problema
      doc.setFont(FONT, "bold");
      doc.setFontSize(12);
      setColor(doc, "text", INK);
      const pLines = doc.splitTextToSize(c.problem, w - PAGE_MARGIN * 2);
      doc.text(pLines, PAGE_MARGIN, y + 14);
      y += 14 + pLines.length * 14 + 4;
      // diagnóstico
      doc.setFont(FONT, "bold");
      doc.setFontSize(8);
      setColor(doc, "text", GRAY);
      doc.text("DIAGNÓSTICO", PAGE_MARGIN, y);
      y = paragraph(doc, y + 12, c.cause, { size: 9.5, color: CHARCOAL });
      y += 4;
      // ações
      if (c.actions.length > 0) {
        doc.setFont(FONT, "bold");
        doc.setFontSize(8);
        setColor(doc, "text", GRAY);
        doc.text("AÇÕES RECOMENDADAS", PAGE_MARGIN, y);
        y += 12;
        c.actions.forEach((a) => {
          doc.setFont(FONT, "normal");
          doc.setFontSize(9.5);
          setColor(doc, "text", CHARCOAL);
          const aLines = doc.splitTextToSize(`•  ${a.title}`, w - PAGE_MARGIN * 2 - 10);
          doc.text(aLines, PAGE_MARGIN + 4, y);
          y += aLines.length * 13;
        });
      }
      // divisor
      setColor(doc, "draw", LIGHT);
      doc.setLineWidth(0.4);
      doc.line(PAGE_MARGIN, y + 8, w - PAGE_MARGIN, y + 8);
      y += 22;
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // APÊNDICE
  // ════════════════════════════════════════════════════════════════════

  // Divisor de apêndice (página simples)
  doc.addPage();
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "Apêndice", title: "Demonstrações & Indicadores" };
  pageTitle(doc, doc.internal.pageSize.getHeight() / 2 - 60,
    "Apêndice", "Demonstrações & Indicadores",
    "DRE, Balanço Patrimonial, Fluxo de Caixa e quadro de indicadores essenciais, avançados e técnicos.");

  // A.1 — DRE
  y = newPage(doc, "Apêndice A", "Demonstração do Resultado",
    "Visão trimestral · estrutura fiel à tela do sistema.");
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "Apêndice A", title: "DRE" };
  renderDRE(doc, y, state, model);

  // A.2 — Balanço
  y = newPage(doc, "Apêndice B", "Balanço Patrimonial",
    "Fechamento derivado por construção · todas as rubricas.");
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "Apêndice B", title: "Balanço" };
  renderBalanco(doc, y, balancoFechamento.balanco, balancoFechamento.totals);

  // A.3 — Fluxo de Caixa
  y = newPage(doc, "Apêndice C", "Fluxo de Caixa",
    "DFC método direto · trimestral · operacional, investimento e financiamento.");
  pageMeta[doc.getNumberOfPages()] = { eyebrow: "Apêndice C", title: "Fluxo de Caixa" };
  renderDFC(doc, y, state, model);

  // A.4 — Indicadores (Essenciais / Avançados / Técnicos)
  renderIndicadoresGrouped(doc, model, (i, e, t) => {
    pageMeta[i] = { eyebrow: "Apêndice D", title: `Indicadores — ${e}` };
    return t;
  });

  // ── Cabeçalho / rodapé em todas as páginas (exceto capa) ───────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    const meta = pageMeta[i] ?? { eyebrow: "", title: "" };
    drawHeader(doc, companyName, meta.title || "—");
    drawFooter(doc, i, totalPages);
  }

  const safeName = companyName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "empresa";
  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`FinnancePRO_Relatorio_Executivo_${safeName}_${stamp}.pdf`);
}

// =====================================================================
// HELPERS DE NARRATIVA
// =====================================================================

type Insight = { title: string; detail: string; tone: "ok" | "warn" | "bad" | "neutral" };
function buildExecutiveInsights(
  state: AppState, model: FinancialModel, score: number, conceito: string,
): Insight[] {
  const { ind, dre, cf } = model;
  const insights: Insight[] = [];

  // 1. Criação/destruição de valor
  if (ind.roic < ind.wacc) {
    insights.push({
      title: "Destruição de valor econômico",
      detail: `ROIC de ${fmtPct(ind.roic / 100)} abaixo do WACC de ${fmtPct(ind.wacc / 100)} — a operação remunera capital abaixo do exigido pelos sócios e credores.`,
      tone: "bad",
    });
  } else {
    insights.push({
      title: "Criação de valor econômico",
      detail: `ROIC de ${fmtPct(ind.roic / 100)} supera o WACC de ${fmtPct(ind.wacc / 100)} — a operação remunera o capital acima do exigido.`,
      tone: "ok",
    });
  }

  // 2. Capital de giro
  if (ind.gapCapitalGiro > 0) {
    insights.push({
      title: "Capital de giro insuficiente",
      detail: `Gap de ${fmtBRL(ind.gapCapitalGiro)} entre NCG e caixa — operação financiada por dívida ou atraso a fornecedores.`,
      tone: "bad",
    });
  } else {
    insights.push({
      title: "Capital de giro adequado",
      detail: `NCG de ${fmtBRL(ind.ncg)} está coberta pelo caixa operacional — sem dependência de capital de terceiros para girar.`,
      tone: "ok",
    });
  }

  // 3. Margem / estrutura de custos
  const tag = ind.margemLiquida >= 8 ? "saudável" : ind.margemLiquida >= 3 ? "apertada" : "comprimida";
  insights.push({
    title: `Margem líquida ${tag} (${ind.margemLiquida.toFixed(1)}%)`,
    detail: ind.margemLiquida < 3
      ? "Estrutura de custos consome quase toda a receita; revisão urgente de despesas e precificação."
      : "Estrutura de custos compatível com o porte e modelo de negócio.",
    tone: ind.margemLiquida >= 8 ? "ok" : ind.margemLiquida >= 3 ? "warn" : "bad",
  });

  // 4. Liquidez
  insights.push({
    title: `Liquidez ${ind.liquidezCorrente >= 1.5 ? "confortável" : ind.liquidezCorrente >= 1 ? "ajustada" : "frágil"}`,
    detail: `Liquidez corrente de ${ind.liquidezCorrente.toFixed(2)}x — ${ind.liquidezCorrente >= 1 ? "ativo circulante cobre passivo circulante" : "passivo circulante supera o ativo circulante"}.`,
    tone: ind.liquidezCorrente >= 1.5 ? "ok" : ind.liquidezCorrente >= 1 ? "warn" : "bad",
  });

  // 5. Prioridade — depende do score
  const ult3 = cf.fluxoOperacional.slice(-3);
  const burn = -(ult3.reduce((a, b) => a + b, 0) / Math.max(1, ult3.length));
  let prio = "Manter monitoramento mensal dos indicadores e revisão trimestral do plano.";
  if (burn > 0) prio = `Operação queima ${fmtBRL(burn)}/mês em média no último trimestre — prioridade imediata é estancar o burn.`;
  else if (ind.dscr < 1.25) prio = "Renegociar prazos e taxas com credores — DSCR abaixo de 1,25× compromete acesso a novas linhas.";
  else if (ind.endividamentoGeral > 70) prio = "Alavancagem elevada — priorizar amortização e revisão do mix de capital.";
  else if (sum(dre.lucroLiquido) < 0) prio = "Resultado negativo — revisão de precificação, mix e estrutura de custos é a prioridade #1.";
  insights.push({
    title: `Prioridade #1: ${prio.split(" — ")[0]}`,
    detail: prio,
    tone: score >= 65 ? "neutral" : "warn",
  });

  // referência muda para evitar warning de "conceito" não usado
  void conceito; void state;
  return insights;
}

type HealthDim = { label: string; score: number; tone: "ok" | "warn" | "bad"; comment: string };
function buildHealthDimensions(ind: FinancialModel["ind"], state: AppState): HealthDim[] {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const dims: HealthDim[] = [
    {
      label: "Liquidez",
      score: clamp((ind.liquidezCorrente / 2) * 100),
      tone: ind.liquidezCorrente >= 1.5 ? "ok" : ind.liquidezCorrente >= 1 ? "warn" : "bad",
      comment: `Liquidez corrente ${ind.liquidezCorrente.toFixed(2)}x · seca ${ind.liquidezSeca.toFixed(2)}x · imediata ${ind.liquidezImediata.toFixed(2)}x.`,
    },
    {
      label: "Rentabilidade",
      score: clamp(ind.margemLiquida * 5),
      tone: ind.margemLiquida >= 8 ? "ok" : ind.margemLiquida >= 3 ? "warn" : "bad",
      comment: `Margem líquida ${ind.margemLiquida.toFixed(1)}% · EBITDA ${ind.margemEbitda.toFixed(1)}% · ROE ${ind.roe.toFixed(1)}% · ROIC ${ind.roic.toFixed(1)}%.`,
    },
    {
      label: "Endividamento",
      score: clamp(100 - ind.endividamentoGeral),
      tone: ind.endividamentoGeral <= 50 ? "ok" : ind.endividamentoGeral <= 70 ? "warn" : "bad",
      comment: `Endividamento geral ${ind.endividamentoGeral.toFixed(1)}% · cobertura de juros ${ind.coberturaJuros.toFixed(2)}x · Dívida Líq./EBITDA ${ind.dividaLiqEbitda.toFixed(2)}x.`,
    },
    {
      label: "Capital de Giro",
      score: ind.gapCapitalGiro <= 0 ? 90 : clamp(100 - (ind.gapCapitalGiro / Math.max(1, Math.abs(ind.ncg))) * 100),
      tone: ind.gapCapitalGiro <= 0 ? "ok" : ind.gapCapitalGiro < ind.ncg * 0.3 ? "warn" : "bad",
      comment: `NCG ${fmtBRL(ind.ncg)} · gap ${fmtBRL(ind.gapCapitalGiro)} · ciclo financeiro ${ind.cicloFinanceiro.toFixed(0)} dias.`,
    },
    {
      label: "Geração de Caixa",
      score: clamp(ind.conversaoEbitdaCaixa),
      tone: ind.conversaoEbitdaCaixa >= 70 ? "ok" : ind.conversaoEbitdaCaixa >= 40 ? "warn" : "bad",
      comment: `Conversão EBITDA→Caixa ${ind.conversaoEbitdaCaixa.toFixed(1)}% · FCF após CAPEX ${fmtBRL(ind.fcfAposCapex)} · qualidade do lucro ${ind.qualidadeLucro.toFixed(2)}x.`,
    },
    {
      label: "Tributação",
      score: clamp(100 - ind.impostosSobreReceita * 2),
      tone: ind.impostosSobreReceita <= 12 ? "ok" : ind.impostosSobreReceita <= 22 ? "warn" : "bad",
      comment: `Carga tributária total ${ind.impostosSobreReceita.toFixed(1)}% da receita · regime ${String(state.tax.regime).toUpperCase()}.`,
    },
  ];
  return dims;
}

type Risk = { title: string; impact: string; probability: string; recommendation: string; severity: "warn" | "bad" | "info" };
function buildTopRisks(
  diags: ReturnType<typeof diagnose>, ind: FinancialModel["ind"],
  prescriptive: ReturnType<typeof buildPrescriptiveCards>,
): Risk[] {
  const order: Record<string, number> = { danger: 0, warn: 1, ok: 2 };
  const ranked = [...diags].sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return ranked
    .filter((d) => d.level !== "ok")
    .map((d) => {
      const sev: Risk["severity"] = d.level === "danger" ? "bad" : "warn";
      const probability = d.level === "danger" ? "Alta" : "Média";
      const impact = d.level === "danger" ? "Alto · risco material ao caixa ou ao resultado"
        : "Médio · pode comprometer indicadores no horizonte próximo";
      // tenta achar recomendação correlata
      const rec = prescriptive.find((p) => p.problem.toLowerCase().includes(d.title.toLowerCase().slice(0, 8)));
      const recommendation = rec?.actions[0]?.title ?? d.message;
      return { title: d.title, impact, probability, recommendation, severity: sev };
    })
    .concat(
      ind.dscr > 0 && ind.dscr < 1.25 ? [{
        title: "DSCR abaixo do mínimo bancário",
        impact: `DSCR ${ind.dscr.toFixed(2)}x compromete acesso a novas linhas de crédito`,
        probability: "Alta",
        recommendation: "Renegociar prazo e taxa do principal · alongar amortizações",
        severity: "bad" as const,
      }] : []
    );
}

type Priority = { title: string; description: string; benefit: string; deadline: string; complexity: string };
function buildPriorities(
  prescriptive: ReturnType<typeof buildPrescriptiveCards>,
  diags: ReturnType<typeof diagnose>,
): Priority[] {
  const sevOrder: Record<string, number> = { danger: 0, warn: 1, info: 2, ok: 3 };
  const ranked = [...prescriptive].sort((a, b) =>
    (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
  const out: Priority[] = ranked.slice(0, 3).map((c) => ({
    title: c.problem,
    description: c.actions[0]?.title ?? c.cause,
    benefit: c.severity === "danger" ? "Alto · estabiliza caixa e resultado"
      : c.severity === "warn" ? "Médio · melhora indicadores-chave"
      : "Incremental · ganho marginal de eficiência",
    deadline: c.severity === "danger" ? "30 a 60 dias"
      : c.severity === "warn" ? "60 a 120 dias" : "Até 180 dias",
    complexity: c.actions.length > 2 ? "Alta" : c.actions.length > 0 ? "Média" : "Baixa",
  }));
  // fallback baseado em diagnose se prescriptive estiver vazio
  if (out.length === 0) {
    diags.filter((d) => d.level !== "ok").slice(0, 3).forEach((d) => {
      out.push({
        title: d.title,
        description: d.message,
        benefit: d.level === "danger" ? "Alto" : "Médio",
        deadline: d.level === "danger" ? "30 a 60 dias" : "60 a 120 dias",
        complexity: "Média",
      });
    });
  }
  return out;
}

// =====================================================================
// APÊNDICE — DRE
// =====================================================================
function renderDRE(doc: jsPDF, yStart: number, state: AppState, model: FinancialModel) {
  const { dre, regime } = model;
  const QUARTERS = ["1º Tri", "2º Tri", "3º Tri", "4º Tri", "Total"];
  const zeros12 = () => Array(12).fill(0);
  const quartersOf = (arr: number[]) => {
    const q = [0, 1, 2, 3].map((i) => (arr[i * 3] ?? 0) + (arr[i * 3 + 1] ?? 0) + (arr[i * 3 + 2] ?? 0));
    return [...q, q.reduce((a, b) => a + b, 0)];
  };
  const dedById = (id: string) => state.revenue.deducoes?.find((d) => d.id === id);
  const descIncond = dedById("desc_incond")?.valores ?? zeros12();
  const abatimentos = dedById("abatimentos")?.valores ?? zeros12();
  const outrasDedResto = dre.outrasDeducoes.map((v, i) => v - (descIncond[i] ?? 0) - (abatimentos[i] ?? 0));
  const despComerciais = zeros12();
  const despAdmin = zeros12();
  const despFinanc = zeros12();
  for (const c of state.costs) {
    const v = monthValues(c, state.tax.regime);
    if (c.category === "variavel") for (let i = 0; i < 12; i++) despComerciais[i] += v[i];
    else if (c.category === "fixo") for (let i = 0; i < 12; i++) despAdmin[i] += v[i];
    else if (c.category === "financeiro") for (let i = 0; i < 12; i++) despFinanc[i] += v[i];
  }
  const { financeiras: receitasFinMensal, operacionais: outrasReceitasOpMensal } = splitReceitasFinanceiras(state);
  const usaPDD = !!state.revenue.inadimplenciaComoPDD;
  const pddLine = usaPDD ? dre.pdd : zeros12();
  const outrasOperacionais = dre.depreciacao.map(
    (d, i) => -d - pddLine[i] + outrasReceitasOpMensal[i],
  );
  const laft = dre.ebit.map((e, i) => e + receitasFinMensal[i]);

  type Row = { label: string; vals: number[]; meta: "normal" | "total" | "highlight" };
  const rows: Row[] = [
    { label: "(+) Receita Operacional Bruta", vals: quartersOf(dre.receitaBruta), meta: "total" },
    { label: usaPDD ? "(−) Inadimplência (PDD)" : "(−) Inadimplência (estimada)",
      vals: quartersOf(dre.deducoesInadimplencia).map((v) => -v), meta: "normal" },
    { label: "(−) Descontos Incondicionais", vals: quartersOf(descIncond).map((v) => -v), meta: "normal" },
    { label: "(−) Abatimentos", vals: quartersOf(abatimentos).map((v) => -v), meta: "normal" },
    { label: "(−) Outras Deduções", vals: quartersOf(outrasDedResto).map((v) => -v), meta: "normal" },
    { label: regime === "simples" ? "(−) DAS Simples Nacional" : "(−) Tributos sobre Receita (PIS/COFINS/ICMS/ISS/CBS/IBS)",
      vals: quartersOf(dre.impostosVendas).map((v) => -v), meta: "normal" },
    { label: "(=) Receita Operacional Líquida", vals: quartersOf(dre.receitaLiquida), meta: "total" },
    { label: "(−) CPV / CMV / CSP", vals: quartersOf(dre.cpv).map((v) => -v), meta: "normal" },
    { label: "(=) Lucro Bruto", vals: quartersOf(dre.lucroBruto), meta: "total" },
    { label: "(−) Despesas Comerciais", vals: quartersOf(despComerciais).map((v) => -v), meta: "normal" },
    { label: "(−) Despesas Administrativas", vals: quartersOf(despAdmin).map((v) => -v), meta: "normal" },
    { label: "(±) Outras Despesas/Receitas Operacionais", vals: quartersOf(outrasOperacionais), meta: "normal" },
    { label: "(=) EBIT (Lucro Operacional)", vals: quartersOf(dre.ebit), meta: "total" },
    { label: "(+) Receitas Financeiras", vals: quartersOf(receitasFinMensal), meta: "normal" },
    { label: "(=) Lucro Antes do Financiamento e Tributos", vals: quartersOf(laft), meta: "total" },
    { label: "(−) Despesas Financeiras", vals: quartersOf(despFinanc).map((v) => -v), meta: "normal" },
    { label: "(=) Lucro Antes do IR/CSLL (EBT)", vals: quartersOf(dre.lair), meta: "total" },
    { label: dre.impostosLucroBase === "receita_presumida"
      ? "(−) IR / CSLL (base presumida sobre receita)" : "(−) IR / CSLL",
      vals: quartersOf(dre.impostos).map((v) => -v), meta: "normal" },
    { label: "(=) Lucro Líquido do Exercício", vals: quartersOf(dre.lucroLiquido), meta: "highlight" },
  ];

  appendixTable(doc, yStart,
    ["Conta", ...QUARTERS],
    rows.map((r) => [r.label, ...r.vals.map(fmtBRL)]),
    rows.map((r) => r.meta),
    {
      0: { halign: "left", cellWidth: 230 },
      1: { halign: "right" }, 2: { halign: "right" },
      3: { halign: "right" }, 4: { halign: "right" },
      5: { halign: "right", fontStyle: "bold" },
    },
  );
}

// =====================================================================
// APÊNDICE — Balanço
// =====================================================================
function renderBalanco(
  doc: jsPDF, yStart: number, b: BalancoDetalhado,
  totals: { ativo: number; passivo: number; pl: number; diferenca: number; fechado: boolean },
) {
  type Linha = { label: string; v: number; redutora?: boolean };
  type Grp = { titulo: string; linhas: Linha[] };
  const ac = b.ativoCirculante ?? {};
  const inv = b.ativoNaoCirculante?.investimentos ?? 0;
  const im = b.ativoNaoCirculante?.imobilizado ?? {};
  const it = b.ativoNaoCirculante?.intangivel ?? {};
  const pc = b.passivoCirculante ?? {};
  const pnc = b.passivoNaoCirculante ?? {};
  const pl = b.patrimonioLiquido ?? {};

  const ativoGrupos: Grp[] = [
    { titulo: "Ativo Circulante", linhas: [
      { label: "Caixa e equivalentes", v: ac.caixaEquivalentes ?? 0 },
      { label: "Contas a receber de clientes", v: ac.contasReceberClientes ?? 0 },
      { label: "Estoques", v: ac.estoques ?? 0 },
      { label: "Impostos a recuperar", v: ac.impostosRecuperar ?? 0 },
    ]},
    { titulo: "Ativo Não Circulante — Imobilizado", linhas: [
      { label: "Terrenos", v: im.terrenos ?? 0 },
      { label: "Edificações", v: im.edificacoes ?? 0 },
      { label: "Máquinas e equipamentos", v: im.maquinasEquipamentos ?? 0 },
      { label: "Veículos", v: im.veiculos ?? 0 },
      { label: "Móveis e utensílios", v: im.moveisUtensilios ?? 0 },
      { label: "Outros (inclui CAPEX do período)", v: im.outrosImobilizados ?? 0 },
      { label: "(−) Depreciação acumulada", v: im.depreciacaoAcumulada ?? 0, redutora: true },
    ]},
    { titulo: "Ativo Não Circulante — Intangível", linhas: [
      { label: "Marcas e patentes", v: it.marcasPatentes ?? 0 },
      { label: "(−) Amortização acumulada", v: it.amortizacaoAcumulada ?? 0, redutora: true },
    ]},
  ];
  if (inv > 0) {
    ativoGrupos.splice(1, 0, { titulo: "Ativo Não Circulante — Investimentos",
      linhas: [{ label: "Investimentos", v: inv }] });
  }
  const passivoGrupos: Grp[] = [
    { titulo: "Passivo Circulante", linhas: [
      { label: "Fornecedores", v: pc.fornecedores ?? 0 },
      { label: "Empréstimos e financiamentos CP", v: pc.emprestimosFinanciamentosCP ?? 0 },
      { label: "Impostos a pagar", v: pc.impostosPagar ?? 0 },
      { label: "Salários e encargos", v: pc.salariosEncargos ?? 0 },
    ]},
    { titulo: "Passivo Não Circulante", linhas: [
      { label: "Empréstimos e financiamentos LP", v: pnc.emprestimosFinanciamentosLP ?? 0 },
    ]},
    { titulo: "Patrimônio Líquido", linhas: [
      { label: "Capital social", v: pl.capitalSocial ?? 0 },
      { label: "Reservas de capital", v: pl.reservasCapital ?? 0 },
      { label: "Lucros/prejuízos acumulados (abertura)", v: pl.lucrosPrejuizosAcumulados ?? 0 },
      { label: "Resultado do exercício (DRE)", v: pl.resultadoExercicio ?? 0 },
    ]},
  ];

  type R = { type: "grp" | "lin" | "sub" | "tot"; label: string; v?: number };
  const buildRows = (gs: Grp[], totalLabel: string, totalVal: number): R[] => {
    const out: R[] = [];
    gs.forEach((g) => {
      out.push({ type: "grp", label: g.titulo });
      let sub = 0;
      g.linhas.forEach((l) => {
        const sign = l.redutora ? -1 : 1;
        out.push({ type: "lin", label: l.label, v: l.v * sign });
        sub += l.v * sign;
      });
      out.push({ type: "sub", label: `Subtotal — ${g.titulo}`, v: sub });
    });
    out.push({ type: "tot", label: totalLabel, v: totalVal });
    return out;
  };

  const render = (rows: R[], y0: number, secTitle: string): number => {
    const body = rows.map((r) => [r.type === "lin" ? `    ${r.label}` : r.label,
      r.v !== undefined ? fmtBRL(r.v) : ""]);
    const meta = rows.map((r): "normal" | "section" | "total" | "highlight" =>
      r.type === "grp" ? "section" : r.type === "tot" ? "total" : r.type === "sub" ? "highlight" : "normal");
    return appendixTable(doc, y0, [secTitle, "Valor"], body, meta, {
      0: { halign: "left" },
      1: { halign: "right", cellWidth: 130, fontStyle: "bold" },
    });
  };

  let y = render(buildRows(ativoGrupos, "Total do Ativo", totals.ativo), yStart, "Ativo");
  // se passar do limite, nova página
  if (y > doc.internal.pageSize.getHeight() - 200) {
    doc.addPage();
    pageMeta[doc.getNumberOfPages()] = { eyebrow: "Apêndice B", title: "Balanço (cont.)" };
    y = pageTitle(doc, CONTENT_TOP, "Apêndice B", "Balanço Patrimonial (continuação)");
  }
  y = render(buildRows(passivoGrupos, "Total do Passivo + PL", totals.passivo + totals.pl), y, "Passivo + Patrimônio Líquido");

  // Faixa de validação minimalista
  const w = doc.internal.pageSize.getWidth();
  const okStr = totals.fechado ? "Balanço fechado por construção" : "Diferença residual identificada";
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  setColor(doc, "text", totals.fechado ? OK : WARN);
  doc.text(okStr.toUpperCase(), PAGE_MARGIN, y + 4);
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  setColor(doc, "text", GRAY);
  doc.text(
    `Ativo ${fmtBRL(totals.ativo)}  ·  Passivo + PL ${fmtBRL(totals.passivo + totals.pl)}  ·  Δ ${fmtBRL(totals.diferenca)}`,
    w - PAGE_MARGIN, y + 4, { align: "right" },
  );
}

// =====================================================================
// APÊNDICE — DFC
// =====================================================================
function renderDFC(doc: jsPDF, yStart: number, state: AppState, model: FinancialModel) {
  const { cf } = model;
  const QUARTERS = ["1º Tri", "2º Tri", "3º Tri", "4º Tri", "Total"];
  const quartersOf = (arr: number[]) => {
    const q = [0, 1, 2, 3].map((i) => (arr[i * 3] ?? 0) + (arr[i * 3 + 1] ?? 0) + (arr[i * 3 + 2] ?? 0));
    return [...q, q.reduce((a, b) => a + b, 0)];
  };

  type Row = { label: string; vals?: number[]; meta: "normal" | "section" | "total" | "highlight" };
  const rows: Row[] = [
    { label: "Saldo Inicial", meta: "normal", vals: [cf.saldoInicial[0] ?? 0, cf.saldoInicial[3] ?? 0,
      cf.saldoInicial[6] ?? 0, cf.saldoInicial[9] ?? 0, cf.saldoInicial[0] ?? 0] },
    { label: "Atividades Operacionais", meta: "section" },
    { label: "(+) Recebimentos de clientes", meta: "normal", vals: quartersOf(cf.recebimentos) },
    { label: "(+) Receitas financeiras (aplicações)", meta: "normal", vals: quartersOf(cf.receitasFinanceiras) },
    { label: "(−) Pagamentos a fornecedores (CPV)", meta: "normal", vals: quartersOf(cf.pagamentosFornecedores).map((v) => -v) },
    { label: "(−) Pagamentos de custos fixos", meta: "normal", vals: quartersOf(cf.pagamentosFixos).map((v) => -v) },
    { label: "(−) Pagamentos de custos variáveis", meta: "normal", vals: quartersOf(cf.pagamentosVariaveis).map((v) => -v) },
    { label: "(−) Despesas financeiras", meta: "normal", vals: quartersOf(cf.pagamentosFinanceiros).map((v) => -v) },
    { label: "(−) Impostos pagos", meta: "normal", vals: quartersOf(cf.pagamentosImpostos).map((v) => -v) },
    { label: "(=) Fluxo das Operações", meta: "total", vals: quartersOf(cf.fluxoOperacional) },
    { label: "Atividades de Investimento", meta: "section" },
    { label: "(−) CapEx — aportes em ativo fixo", meta: "normal", vals: quartersOf(state.cashflow.capex).map((v) => -v) },
    { label: "(=) Fluxo de Investimento", meta: "total", vals: quartersOf(cf.fluxoInvestimento) },
    { label: "Atividades de Financiamento", meta: "section" },
    { label: "(+) Aportes de sócios", meta: "normal", vals: quartersOf(state.cashflow.aportes) },
    { label: "(+) Captação de empréstimos", meta: "normal", vals: quartersOf(state.cashflow.emprestimosCaptados) },
    { label: "(−) Amortização de principal", meta: "normal", vals: quartersOf(state.cashflow.amortizacoes).map((v) => -v) },
    { label: "(−) Distribuição de dividendos", meta: "normal", vals: quartersOf(state.cashflow.dividendos).map((v) => -v) },
    { label: "(=) Fluxo de Financiamento", meta: "total", vals: quartersOf(cf.fluxoFinanciamento) },
    { label: "(=) Variação de Caixa", meta: "highlight", vals: quartersOf(cf.variacaoCaixa) },
    { label: "(=) Saldo Final", meta: "highlight", vals: [cf.saldoFinal[2] ?? 0, cf.saldoFinal[5] ?? 0,
      cf.saldoFinal[8] ?? 0, cf.saldoFinal[11] ?? 0, cf.saldoFinal[11] ?? 0] },
  ];

  appendixTable(doc, yStart,
    ["Linha", ...QUARTERS],
    rows.map((r) => r.meta === "section"
      ? [r.label, "", "", "", "", ""]
      : [r.label, ...(r.vals ?? []).map(fmtBRL)]),
    rows.map((r) => r.meta),
    {
      0: { halign: "left", cellWidth: 230 },
      1: { halign: "right" }, 2: { halign: "right" },
      3: { halign: "right" }, 4: { halign: "right" },
      5: { halign: "right", fontStyle: "bold" },
    },
  );
}

// =====================================================================
// APÊNDICE — INDICADORES (essenciais / avançados / técnicos)
// =====================================================================
function renderIndicadoresGrouped(
  doc: jsPDF, model: FinancialModel,
  registerPage: (pageIdx: number, eyebrow: string, title: string) => string,
) {
  const { ind } = model;
  type Row = { nome: string; mede: string; valor: string };

  const essenciais: Row[] = [
    { nome: "Margem Bruta", mede: "Quanto sobra da receita após o custo direto.", valor: fmtPct(ind.margemBruta / 100) },
    { nome: "Margem EBITDA", mede: "Geração de caixa operacional antes de juros, impostos e depreciação.", valor: fmtPct(ind.margemEbitda / 100) },
    { nome: "Margem Líquida", mede: "Lucro que sobra para os sócios após tudo pago.", valor: fmtPct(ind.margemLiquida / 100) },
    { nome: "ROE", mede: "Retorno sobre o patrimônio dos sócios.", valor: fmtPct(ind.roe / 100) },
    { nome: "ROIC", mede: "Retorno sobre o capital investido na operação.", valor: fmtPct(ind.roic / 100) },
    { nome: "WACC", mede: "Custo médio ponderado do capital — meta mínima do ROIC.", valor: fmtPct(ind.wacc / 100) },
    { nome: "Liquidez Corrente", mede: "Capacidade de pagar dívidas de curto prazo.", valor: `${ind.liquidezCorrente.toFixed(2)}x` },
    { nome: "Endividamento Geral", mede: "% do ativo financiado por dívida.", valor: fmtPct(ind.endividamentoGeral / 100) },
    { nome: "Dívida Líq./EBITDA", mede: "Anos de EBITDA para quitar a dívida.", valor: `${ind.dividaLiqEbitda.toFixed(2)}x` },
    { nome: "DSCR", mede: "Cobertura do serviço da dívida — bancos exigem ≥ 1,25×.", valor: ind.dscr !== 0 ? `${ind.dscr.toFixed(2)}x` : "—" },
  ];
  const avancados: Row[] = [
    { nome: "Margem EBIT", mede: "Lucro operacional após depreciação.", valor: fmtPct(ind.margemEbit / 100) },
    { nome: "Margem de Contribuição", mede: "Quanto sobra para cobrir fixos e gerar lucro.", valor: fmtPct(ind.margemContribuicao / 100) },
    { nome: "ROA", mede: "Retorno sobre o ativo total.", valor: fmtPct(ind.roa / 100) },
    { nome: "Liquidez Seca", mede: "Liquidez corrente sem estoques.", valor: `${ind.liquidezSeca.toFixed(2)}x` },
    { nome: "Liquidez Imediata", mede: "Capacidade de pagar dívidas só com caixa.", valor: `${ind.liquidezImediata.toFixed(2)}x` },
    { nome: "Liquidez Geral", mede: "Honra todas as dívidas (curto + longo).", valor: `${ind.liquidezGeral.toFixed(2)}x` },
    { nome: "Cobertura de Juros", mede: "Quantas vezes o EBIT cobre os juros.", valor: `${ind.coberturaJuros.toFixed(2)}x` },
    { nome: "Ciclo Operacional", mede: "Dias entre comprar e receber.", valor: `${ind.cicloOperacional.toFixed(0)} dias` },
    { nome: "Ciclo Financeiro", mede: "Dias em que a empresa financia a operação.", valor: `${ind.cicloFinanceiro.toFixed(0)} dias` },
    { nome: "NCG", mede: "Necessidade de Capital de Giro.", valor: fmtBRL(ind.ncg) },
    { nome: "Gap de Capital de Giro", mede: "Déficit entre NCG e caixa.", valor: fmtBRL(ind.gapCapitalGiro) },
    { nome: "FCF estimado", mede: "Free Cash Flow operacional antes do CAPEX.", valor: fmtBRL(ind.fcf) },
    { nome: "FCF após CAPEX", mede: "Caixa livre após investimentos.", valor: fmtBRL(ind.fcfAposCapex) },
    { nome: "Conversão EBITDA → Caixa", mede: "Quanto do EBITDA vira caixa livre.", valor: `${ind.conversaoEbitdaCaixa.toFixed(1)}%` },
    { nome: "Margem de Segurança", mede: "Folga entre receita e ponto de equilíbrio.", valor: ind.margemSeguranca !== 0 ? fmtPct(ind.margemSeguranca / 100) : "—" },
  ];
  const tecnicos: Row[] = [
    { nome: "PE Operacional", mede: "Receita mínima para cobrir fixos operacionais.", valor: fmtBRL(ind.pontoEquilibrioOperacional) },
    { nome: "PE Financeiro", mede: "Break-even em caixa.", valor: fmtBRL(ind.pontoEquilibrioFinanceiro) },
    { nome: "PE Total", mede: "Inclui juros como custo fixo.", valor: fmtBRL(ind.pontoEquilibrio) },
    { nome: "Capital Próprio", mede: "Participação do PL no financiamento total.", valor: `${ind.proprioPercent.toFixed(1)}%` },
    { nome: "Giro do Ativo", mede: "Quantas vezes o ativo gira em vendas/ano.", valor: `${ind.giroAtivo.toFixed(2)}x` },
    { nome: "Dívida Líq./EBIT", mede: "Conservador vs. DL/EBITDA.", valor: `${ind.dividaLiqEbit.toFixed(2)}x` },
    { nome: "Dívida Líq./PL", mede: "Alavancagem sobre patrimônio próprio.", valor: `${ind.dividaLiqPl.toFixed(2)}x` },
    { nome: "Amortização do PL pelo Lucro", mede: "Anos para o lucro acumulado igualar o PL.",
      valor: Number.isFinite(ind.amortizacaoPlPorLucro) ? `${ind.amortizacaoPlPorLucro.toFixed(1)} anos` : "—" },
    { nome: "Payback (CAPEX)", mede: "Tempo para recuperar o CAPEX.",
      valor: Number.isFinite(ind.paybackCapex) && ind.paybackCapex > 0 ? `${ind.paybackCapex.toFixed(1)} anos` : "—" },
    { nome: "CAGR Receitas 12m", mede: "Crescimento anualizado da receita.",
      valor: Number.isFinite(model.cagrReceitas12m) ? fmtPct(model.cagrReceitas12m) : "—" },
    { nome: "GAO", mede: "Sensibilidade do EBIT à variação da receita.", valor: ind.gao !== 0 ? `${ind.gao.toFixed(2)}x` : "—" },
    { nome: "Qualidade do Lucro", mede: "Lucro contábil está virando caixa?", valor: ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}x` : "—" },
    { nome: "Faturamento / Colaborador", mede: "Produtividade por cabeça.", valor: fmtBRL(ind.faturamentoPorColaborador) },
    { nome: "Receita Líq. / Colaborador", mede: "Receita líquida por colaborador.", valor: fmtBRL(ind.receitaPorColaborador) },
    { nome: "EBITDA / Colaborador", mede: "Geração operacional por colaborador.", valor: fmtBRL(ind.ebitdaPorColaborador) },
    { nome: "Lucro / Colaborador", mede: "Lucro líquido por colaborador.", valor: fmtBRL(ind.lucroPorColaborador) },
    { nome: "Folha / Receita", mede: "Peso da folha sobre a receita.",
      valor: ind.custoPessoalSobreReceita > 0 ? fmtPct(ind.custoPessoalSobreReceita / 100) : "—" },
    { nome: "Impostos / Receita", mede: "Carga tributária total sobre receita.", valor: fmtPct(ind.impostosSobreReceita / 100) },
    { nome: "Impostos / Lucro Líquido", mede: "Quanto a empresa paga de imposto por R$ 1 de lucro.",
      valor: ind.impostosSobreLucro !== 0 ? fmtPct(ind.impostosSobreLucro / 100) : "—" },
  ];

  const renderGroup = (title: string, subtitle: string, rows: Row[]) => {
    const y = newPage(doc, "Apêndice D", title, subtitle);
    registerPage(doc.getNumberOfPages(), title, "");
    appendixTable(doc, y,
      ["Indicador", "O que ele mede", "Valor"],
      rows.map((r) => [r.nome, r.mede, r.valor]),
      rows.map(() => "normal"),
      {
        0: { halign: "left", fontStyle: "bold", cellWidth: 150 },
        1: { halign: "left", cellWidth: 270, textColor: GRAY, fontSize: 8 },
        2: { halign: "right", fontStyle: "bold", cellWidth: 75 },
      },
    );
  };

  renderGroup("Indicadores Essenciais", "Os 10 indicadores que todo conselho deve acompanhar.", essenciais);
  renderGroup("Indicadores Avançados", "Visão complementar de liquidez, capital de giro e geração de caixa.", avancados);
  renderGroup("Indicadores Técnicos", "Métricas adicionais para análise aprofundada.", tecnicos);
}
