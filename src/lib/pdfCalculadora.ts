// =====================================================================
// FinnancePRO — PDF de relatório de Calculadora individual.
//
// Reaproveita a IDENTIDADE VISUAL do relatório executivo principal
// (src/lib/pdfExport.ts): mesma tipografia helvetica, paleta preto/cinza,
// cabeçalho minimalista "FINNANCEPRO · {seção}", rodapé padrão,
// cards de KPI executivos e tabelas em estilo consultoria.
//
// API pública: `exportCalculadoraPDF(payload)` — recebe um payload
// declarativo (inputs + KPIs + seções opcionais) e gera o PDF.
// Cada calculadora monta seu próprio payload a partir do seu `sim`.
// =====================================================================

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Paleta (idêntica ao pdfExport.ts) ─────────────────────────────────
const INK = [10, 10, 10] as [number, number, number];
const CHARCOAL = [31, 41, 55] as [number, number, number];
const GRAY = [107, 114, 128] as [number, number, number];
const LIGHT = [229, 231, 235] as [number, number, number];
const HAIRLINE = [209, 213, 219] as [number, number, number];
const SUBTLE = [249, 250, 251] as [number, number, number];
const OK = [5, 150, 105] as [number, number, number];
const WARN = [217, 119, 6] as [number, number, number];
const BAD = [220, 38, 38] as [number, number, number];

const FOOTER_TEXT = "Gerado com FinnancePRO  ·  Mais detalhes em finnancepro.com.br";
const PAGE_MARGIN = 56;
const HEADER_Y = 36;
const CONTENT_TOP = 92;
const FONT = "helvetica";

export type KpiTone = "ok" | "warn" | "bad" | "neutral";
export interface CalcKpi {
  label: string;
  value: string;
  sub?: string;
  tone?: KpiTone;
}
export interface CalcInput {
  label: string;
  value: string;
}
export type CalcSection =
  | { kind: "table"; title?: string; head: string[]; body: (string | number)[][] }
  | { kind: "kv"; title?: string; rows: { label: string; value: string; strong?: boolean }[] }
  | { kind: "text"; title?: string; body: string };

export interface CalcReportPayload {
  /** Título da calculadora (ex.: "Juros Compostos"). */
  title: string;
  /** Subtítulo curto (ex.: "Simulação de patrimônio com aportes mensais"). */
  subtitle?: string;
  /** Inputs do usuário (renderizados como KV no topo). */
  inputs: CalcInput[];
  /** Indicadores-chave (cards executivos). */
  kpis: CalcKpi[];
  /** Seções adicionais (tabelas detalhadas, KV extras, texto). */
  sections?: CalcSection[];
  /** Slug para o nome do arquivo (default: derivado do título). */
  filenameSlug?: string;
}

// ── Utilitários ───────────────────────────────────────────────────────

function nowBR(): string {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function todayFileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function setColor(
  doc: jsPDF,
  kind: "text" | "fill" | "draw",
  c: readonly [number, number, number],
) {
  if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
  else if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
  else doc.setDrawColor(c[0], c[1], c[2]);
}

function drawHeader(doc: jsPDF, section: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  setColor(doc, "text", INK);
  doc.text("FINNANCEPRO", PAGE_MARGIN, HEADER_Y);
  doc.setFont(FONT, "normal");
  setColor(doc, "text", GRAY);
  doc.text(`Calculadora · ${section}`, w - PAGE_MARGIN, HEADER_Y, { align: "right" });
  setColor(doc, "draw", LIGHT);
  doc.setLineWidth(0.5);
  doc.line(PAGE_MARGIN, HEADER_Y + 6, w - PAGE_MARGIN, HEADER_Y + 6);
}

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
  doc.text(
    `${String(pageNum).padStart(2, "0")} / ${String(pageCount).padStart(2, "0")}`,
    w - PAGE_MARGIN,
    h - 26,
    { align: "right" },
  );
}

function pageTitle(
  doc: jsPDF,
  y: number,
  eyebrow: string,
  title: string,
  subtitle?: string,
): number {
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
  setColor(doc, "draw", INK);
  doc.setLineWidth(1.2);
  doc.line(PAGE_MARGIN, cursor + 14, PAGE_MARGIN + 32, cursor + 14);
  return cursor + 36;
}

function blockHeader(doc: jsPDF, y: number, title: string): number {
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  setColor(doc, "text", INK);
  doc.text(title.toUpperCase(), PAGE_MARGIN, y);
  setColor(doc, "draw", HAIRLINE);
  doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, y + 4, doc.internal.pageSize.getWidth() - PAGE_MARGIN, y + 4);
  return y + 18;
}

function drawKpiCards(doc: jsPDF, yStart: number, cards: CalcKpi[]): number {
  if (cards.length === 0) return yStart;
  const cols = Math.min(3, cards.length);
  const w = doc.internal.pageSize.getWidth();
  const gap = 12;
  const cardW = (w - PAGE_MARGIN * 2 - gap * (cols - 1)) / cols;
  const cardH = 76;
  let y = yStart;
  cards.forEach((c, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) y += cardH + gap;
    const x = PAGE_MARGIN + col * (cardW + gap);
    setColor(doc, "draw", HAIRLINE);
    doc.setLineWidth(0.5);
    doc.rect(x, y, cardW, cardH, "S");
    const tone = c.tone === "ok" ? OK : c.tone === "warn" ? WARN : c.tone === "bad" ? BAD : INK;
    setColor(doc, "fill", tone);
    doc.rect(x, y, 2, cardH, "F");
    doc.setFont(FONT, "bold");
    doc.setFontSize(7);
    setColor(doc, "text", GRAY);
    doc.text(c.label.toUpperCase(), x + 12, y + 16);
    doc.setFont(FONT, "bold");
    doc.setFontSize(16);
    setColor(doc, "text", INK);
    const valueLines = doc.splitTextToSize(c.value, cardW - 24);
    doc.text(valueLines.slice(0, 1), x + 12, y + 42);
    if (c.sub) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      setColor(doc, "text", GRAY);
      const lines = doc.splitTextToSize(c.sub, cardW - 24);
      doc.text(lines.slice(0, 2), x + 12, y + 60);
    }
  });
  return y + cardH + 18;
}

/**
 * Trunca um texto com reticências para caber em `maxWidth` na fonte/tamanho atuais.
 */
function ellipsize(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ell;
    if (doc.getTextWidth(candidate) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

function drawKv(
  doc: jsPDF,
  yStart: number,
  rows: { label: string; value: string; strong?: boolean }[],
): number {
  if (rows.length === 0) return yStart;
  const w = doc.internal.pageSize.getWidth();
  const innerW = w - PAGE_MARGIN * 2;
  const colW = innerW / 2;
  const cellW = colW - 8; // respiro entre colunas
  const gap = 10; // espaço mínimo entre label e value
  const rowH = 18;

  // Pré-calcula a largura necessária para cada valor (na fonte do value: 10pt).
  // Decide para cada linha se cabe lado-a-lado ou precisa quebrar.
  const layouts = rows.map((r) => {
    doc.setFont(FONT, r.strong ? "bold" : "normal");
    doc.setFontSize(10);
    const valueW = Math.min(doc.getTextWidth(r.value), cellW);
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    const labelW = doc.getTextWidth(r.label);
    const fits = labelW + gap + valueW <= cellW;
    return { valueW, labelW, fits };
  });

  let y = yStart;
  rows.forEach((r, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) y += rowH;
    const x = PAGE_MARGIN + col * colW;
    const { valueW, fits } = layouts[i];

    // Linha-base inferior
    setColor(doc, "draw", LIGHT);
    doc.setLineWidth(0.3);
    doc.line(x, y + rowH - 4, x + cellW, y + rowH - 4);

    // Label (cinza, 8pt) — truncado se o value couber ao lado;
    // se não couber, o value cai numa segunda linha e o label pode ocupar tudo.
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    setColor(doc, "text", GRAY);
    const labelMax = fits ? cellW - valueW - gap : cellW;
    doc.text(ellipsize(doc, r.label, labelMax), x, y + 4);

    // Value (10pt) — alinhado à direita. Se coube, na mesma linha;
    // caso contrário, logo abaixo do label, encurtado se necessário.
    doc.setFont(FONT, r.strong ? "bold" : "normal");
    doc.setFontSize(10);
    setColor(doc, "text", r.strong ? INK : CHARCOAL);
    const valueText = ellipsize(doc, r.value, cellW);
    const valueY = fits ? y + 4 : y + 14;
    doc.text(valueText, x + cellW, valueY, { align: "right" });
  });
  return y + rowH + 12;
}

function drawTable(
  doc: jsPDF,
  yStart: number,
  head: string[],
  body: (string | number)[][],
): number {
  autoTable(doc, {
    startY: yStart,
    head: [head],
    body,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: CONTENT_TOP, bottom: 64 },
    theme: "plain",
    styles: {
      font: FONT,
      fontSize: 9,
      cellPadding: { top: 6, right: 8, bottom: 6, left: 8 },
      textColor: CHARCOAL,
      lineColor: LIGHT,
      lineWidth: 0,
      valign: "middle",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: GRAY,
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "left",
      cellPadding: { top: 4, right: 8, bottom: 8, left: 8 },
    },
    columnStyles: head.reduce<Record<number, { halign: "right" | "left" }>>((acc, _h, i) => {
      if (i > 0) acc[i] = { halign: "right" };
      return acc;
    }, {}),
    didParseCell: (data) => {
      if (data.section === "head") {
        data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.8, left: 0 } as never;
        data.cell.styles.lineColor = INK;
        if (typeof data.cell.raw === "string") {
          data.cell.text = [String(data.cell.raw).toUpperCase()];
        }
      } else {
        data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.3, left: 0 } as never;
        data.cell.styles.lineColor = LIGHT;
        if (data.row.index % 2 === 1) {
          data.cell.styles.fillColor = SUBTLE;
        }
      }
    },
  });
  // @ts-expect-error — autoTable atribui lastAutoTable em runtime
  return (doc.lastAutoTable?.finalY ?? yStart) + 16;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, section: string): number {
  const h = doc.internal.pageSize.getHeight();
  if (y + needed > h - 64) {
    doc.addPage();
    drawHeader(doc, section);
    return CONTENT_TOP;
  }
  return y;
}

// ── API pública ───────────────────────────────────────────────────────
export async function exportCalculadoraPDF(payload: CalcReportPayload): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  // ── Capa simples (mesma estética: linha fina + título grande) ──────
  drawHeader(doc, payload.title);
  let y = CONTENT_TOP;

  y = pageTitle(
    doc,
    y,
    "CALCULADORA",
    payload.title,
    payload.subtitle ?? `Relatório de cálculo emitido em ${nowBR()}.`,
  );

  // ── Inputs do usuário ───────────────────────────────────────────────
  if (payload.inputs.length > 0) {
    y = ensureSpace(doc, y, 60, payload.title);
    y = blockHeader(doc, y, "Parâmetros utilizados");
    y = drawKv(
      doc,
      y,
      payload.inputs.map((i) => ({ label: i.label, value: i.value })),
    );
  }

  // ── KPIs principais ─────────────────────────────────────────────────
  if (payload.kpis.length > 0) {
    y = ensureSpace(doc, y, 110, payload.title);
    y = blockHeader(doc, y, "Resultado");
    y = drawKpiCards(doc, y, payload.kpis);
  }

  // ── Seções adicionais ───────────────────────────────────────────────
  for (const sec of payload.sections ?? []) {
    y = ensureSpace(doc, y, 80, payload.title);
    if (sec.title) y = blockHeader(doc, y, sec.title);
    if (sec.kind === "kv") {
      y = drawKv(doc, y, sec.rows);
    } else if (sec.kind === "table") {
      y = drawTable(doc, y, sec.head, sec.body);
    } else {
      doc.setFont(FONT, "normal");
      doc.setFontSize(10);
      setColor(doc, "text", CHARCOAL);
      const w = doc.internal.pageSize.getWidth();
      const lines = doc.splitTextToSize(sec.body, w - PAGE_MARGIN * 2);
      doc.text(lines, PAGE_MARGIN, y);
      y += lines.length * 14 + 8;
    }
  }

  // ── Rodapés em todas as páginas ─────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(doc, p, totalPages);
  }

  const slug = payload.filenameSlug ?? slugify(payload.title);
  doc.save(`FinnancePRO_${slug}_${todayFileStamp()}.pdf`);
}
