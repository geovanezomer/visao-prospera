// =====================================================================
// Exportação de relatório em PDF (jsPDF + autoTable).
//
// Estrutura: 1 tópico por página — capa/empresa, dashboard, fluxo de caixa,
// DRE, balanço, indicadores e diagnóstico. Cabeçalho/rodapé escuros em
// todas as páginas; conteúdo claro (impressora-friendly).
// =====================================================================

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { sum, fmtBRL, fmtPct } from "@/engines/finance/format";
import type { AppState, BalancoDetalhado } from "@/engines/finance/types";
import type { FinancialModel } from "@/engines/finance/financialModel";
import { diagnose } from "@/engines/finance/diagnose";
import { buildPrescriptiveCards } from "@/engines/finance/prescriptive";
import { aggregateContracts } from "@/engines/finance/debtContracts";

// ── Paleta — cabeçalho/rodapé escuros; conteúdo branco. ───────────────
const COLOR = {
  headerBg: [15, 23, 42] as [number, number, number], // slate-900
  headerFg: [248, 250, 252] as [number, number, number],
  accent: [59, 130, 246] as [number, number, number], // blue-500
  textDark: [15, 23, 42] as [number, number, number],
  textMuted: [100, 116, 139] as [number, number, number],
  formula: [148, 163, 184] as [number, number, number], // cinza claro p/ fórmulas
  rule: [226, 232, 240] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  ok: [16, 185, 129] as [number, number, number],
  warn: [234, 179, 8] as [number, number, number],
  danger: [239, 68, 68] as [number, number, number],
  totalBg: [241, 245, 249] as [number, number, number],
};

const FOOTER_TEXT = "Gerado com FinnancePRO. Mais detalhes em finnancepro.com.br";
const MARGIN_X = 40;
const CONTENT_TOP = 88; // abaixo do cabeçalho (64 + 2 + margem)
const QUARTERS = ["1º Tri", "2º Tri", "3º Tri", "4º Tri", "Total"];

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
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Agrupa 12 valores mensais em 4 trimestres + total.
function quartersOf(arr: number[]): number[] {
  const q = [0, 1, 2, 3].map((i) => (arr[i * 3] ?? 0) + (arr[i * 3 + 1] ?? 0) + (arr[i * 3 + 2] ?? 0));
  return [...q, q.reduce((a, b) => a + b, 0)];
}

// Cabeçalho escuro com logo + nome.
function drawHeader(doc: jsPDF, logoData: string | null, companyName: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...COLOR.headerBg);
  doc.rect(0, 0, w, 64, "F");
  doc.setFillColor(...COLOR.accent);
  doc.rect(0, 64, w, 2, "F");

  if (logoData) {
    try { doc.addImage(logoData, "PNG", MARGIN_X, 16, 32, 32); } catch { /* noop */ }
  }
  doc.setTextColor(...COLOR.headerFg);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("FinnancePRO", 82, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text("Diagnóstico & Simulação Empresarial", 82, 46);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR.headerFg);
  doc.text(companyName || "—", w - MARGIN_X, 32, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(`Emitido em ${nowBR()}`, w - MARGIN_X, 46, { align: "right" });
}

function drawFooter(doc: jsPDF, pageNum: number, pageCount: number) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFillColor(...COLOR.headerBg);
  doc.rect(0, h - 32, w, 32, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.headerFg);
  doc.text(FOOTER_TEXT, w / 2, h - 12, { align: "center" });
  doc.setTextColor(148, 163, 184);
  doc.text(`Página ${pageNum} / ${pageCount}`, w - MARGIN_X, h - 12, { align: "right" });
}

// Título de seção — usado no topo de cada tópico.
function sectionTitle(doc: jsPDF, y: number, title: string, subtitle?: string): number {
  doc.setFillColor(...COLOR.accent);
  doc.rect(MARGIN_X, y - 12, 4, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...COLOR.textDark);
  doc.text(title, MARGIN_X + 12, y);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR.textMuted);
    doc.text(subtitle, MARGIN_X + 12, y + 14);
  }
  doc.setDrawColor(...COLOR.rule);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 22, doc.internal.pageSize.getWidth() - MARGIN_X, y + 22);
  return y + 38;
}

// Inicia novo tópico: nova página + título.
function newTopic(doc: jsPDF, title: string, subtitle?: string): number {
  doc.addPage();
  return sectionTitle(doc, CONTENT_TOP, title, subtitle);
}

// Cards de KPI horizontais.
type Card = { label: string; value: string; tone?: "ok" | "warn" | "danger" | "neutral"; sub?: string };
function drawKpiGrid(doc: jsPDF, yStart: number, cards: Card[], cols = 3): number {
  const pageW = doc.internal.pageSize.getWidth();
  const gap = 10;
  const cardW = (pageW - MARGIN_X * 2 - gap * (cols - 1)) / cols;
  const cardH = 58;
  let y = yStart;
  cards.forEach((c, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) y += cardH + gap;
    const x = MARGIN_X + col * (cardW + gap);
    doc.setDrawColor(...COLOR.rule);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, cardH, 4, 4, "FD");
    const tone = c.tone === "ok" ? COLOR.ok : c.tone === "warn" ? COLOR.warn
      : c.tone === "danger" ? COLOR.danger : COLOR.accent;
    doc.setFillColor(...tone);
    doc.rect(x, y, 3, cardH, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR.textMuted);
    doc.text(c.label.toUpperCase(), x + 10, y + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...COLOR.textDark);
    doc.text(c.value, x + 10, y + 33);
    if (c.sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR.textMuted);
      doc.text(c.sub, x + 10, y + 48);
    }
  });
  return y + cardH + 16;
}

// Tabela genérica.
function drawTable(
  doc: jsPDF, yStart: number, head: string[], body: (string | number)[][],
  opts?: { colStyles?: Record<number, Record<string, unknown>> },
): number {
  autoTable(doc, {
    startY: yStart,
    head: [head],
    body,
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: {
      font: "helvetica", fontSize: 9, cellPadding: 4,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3,
    },
    headStyles: {
      fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "center",
    },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: (opts?.colStyles ?? head.reduce<Record<number, { halign: "right" | "left" }>>((acc, _h, i) => {
      if (i > 0) acc[i] = { halign: "right" };
      return acc;
    }, {})) as Record<number, Partial<Record<string, unknown>>>,
  });
  // @ts-expect-error — autoTable atribui lastAutoTable em runtime.
  return (doc.lastAutoTable?.finalY ?? yStart) + 14;
}

// Pequena caixa de texto (semáforo, alerta).
function drawBadgeRow(
  doc: jsPDF, y: number, items: { label: string; status: "ok" | "warn" | "bad"; desc: string }[],
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - MARGIN_X * 2 - 8) / 2;
  const rowH = 32;
  items.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN_X + col * (colW + 8);
    const yy = y + row * (rowH + 4);
    const color = it.status === "ok" ? COLOR.ok : it.status === "warn" ? COLOR.warn : COLOR.danger;
    doc.setDrawColor(...COLOR.rule);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, yy, colW, rowH, 3, 3, "FD");
    doc.setFillColor(...color);
    doc.rect(x, yy, 3, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLOR.textDark);
    doc.text(it.label, x + 10, yy + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...color);
    const lbl = it.status === "ok" ? "SAUDÁVEL" : it.status === "warn" ? "ATENÇÃO" : "CRÍTICO";
    doc.text(lbl, x + colW - 8, yy + 12, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.textMuted);
    doc.text(doc.splitTextToSize(it.desc, colW - 16), x + 10, yy + 24);
  });
  const rows = Math.ceil(items.length / 2);
  return y + rows * (rowH + 4) + 8;
}

// =====================================================================
// EXPORT PRINCIPAL
// =====================================================================
export interface ExportPDFInput { state: AppState; model: FinancialModel; }

export async function exportFinancePDF({ state, model }: ExportPDFInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const logoData = await loadImageAsDataURL(logoAsset.url);
  const companyName = state.companyName?.trim() || "Sem empresa";
  const { dre, ind, cf, balancoFechamento, regime } = model;

  // ── 1. CAPA / DADOS DA EMPRESA ─────────────────────────────────────
  let y = sectionTitle(doc, CONTENT_TOP, "Dados da Empresa", "Identificação e parâmetros de análise");
  const periodoMeses = state.periodoAnaliseMeses ?? 12;
  y = drawTable(doc, y, ["Campo", "Valor"], [
    ["Razão social / nome", companyName],
    ["CNPJ", state.cnpj?.trim() || "—"],
    ["Tipo de negócio", state.businessType ?? "—"],
    ["Ramo de atuação", state.ramoAtuacao ?? "—"],
    ["Colaboradores", state.numColaboradores ?? state.headcountRange ?? "—"],
    ["Período de análise", `${periodoMeses} meses`],
    ["Ano fiscal", state.fiscalYear ?? new Date().getFullYear()],
    ["Regime tributário efetivo", String(regime).toUpperCase()],
  ]);

  // ── 2. DASHBOARD ───────────────────────────────────────────────────
  y = newTopic(doc, "Dashboard Executivo", "KPIs, runway, saúde financeira e composição de despesas");

  // 2.1 KPIs principais
  y = drawKpiGrid(doc, y, [
    { label: "Receita Líquida (12m)", value: fmtBRL(ind.receitaLiquidaAnual) },
    { label: "EBITDA (12m)", value: fmtBRL(ind.ebitdaAnual),
      tone: ind.ebitdaAnual >= 0 ? "ok" : "danger" },
    { label: "Lucro Líquido (12m)", value: fmtBRL(ind.lucroLiquidoAnual),
      tone: ind.lucroLiquidoAnual >= 0 ? "ok" : "danger" },
    { label: "Margem EBITDA", value: fmtPct(ind.margemEbitda / 100),
      tone: ind.margemEbitda >= 10 ? "ok" : ind.margemEbitda >= 0 ? "warn" : "danger" },
    { label: "Margem Líquida", value: fmtPct(ind.margemLiquida / 100),
      tone: ind.margemLiquida >= 5 ? "ok" : ind.margemLiquida >= 0 ? "warn" : "danger" },
    { label: "ROIC vs WACC", value: `${fmtPct(ind.roic / 100)} / ${fmtPct(ind.wacc / 100)}`,
      tone: ind.roic >= ind.wacc ? "ok" : "danger" },
  ], 3);

  // 2.2 Pista de Caixa (Runway) & Saldo Projetado
  const caixaAtual = state.capital.disponibilidades ?? 0;
  const recebiveis = state.capital.contasReceber ?? 0;
  const ult3 = cf.fluxoOperacional.slice(-3);
  const burnMedio3 = -(ult3.reduce((a, b) => a + b, 0) / Math.max(1, ult3.length));
  const queimando = burnMedio3 > 0;
  const colchao = caixaAtual + recebiveis;
  const runwayMeses = queimando ? colchao / burnMedio3 : Infinity;
  const runwayLabel = !Number.isFinite(runwayMeses)
    ? "∞ (gerando caixa)" : `${runwayMeses.toFixed(1)} meses`;
  const runwayTone: Card["tone"] = !queimando ? "ok"
    : runwayMeses >= 12 ? "ok" : runwayMeses >= 6 ? "warn" : "danger";
  const saldoDez = cf.totais.saldoFinal;
  const saldoMin = Math.min(...cf.saldoFinal);

  y = drawKpiGrid(doc, y, [
    { label: "Caixa atual", value: fmtBRL(caixaAtual), sub: "Disponibilidades hoje" },
    { label: "Pista de caixa (Runway)", value: runwayLabel, tone: runwayTone,
      sub: queimando ? `Queima ${fmtBRL(burnMedio3)}/mês` : "Operação gera caixa" },
    { label: "Saldo projetado (Dez)", value: fmtBRL(saldoDez),
      tone: saldoDez >= 0 ? "ok" : "danger", sub: `Mín. do ano: ${fmtBRL(saldoMin)}` },
  ], 3);

  // 2.3 Score de Saúde Financeira (mesma fórmula do DashboardExtras)
  const scoreNorms = [
    Math.min(100, Math.max(0, (ind.liquidezCorrente / 2) * 100)),
    Math.min(100, Math.max(0, 100 - ind.endividamentoGeral)),
    Math.min(100, Math.max(0, ind.margemLiquida * 5)),
    Math.min(100, Math.max(0, ind.coberturaJuros * 20)),
    Math.min(100, Math.max(0, ind.roe * 5)),
    Math.min(100, Math.max(0, ind.conversaoEbitdaCaixa)),
    Math.min(100, Math.max(0, 100 - ind.dividaLiqEbitda * 25)),
  ];
  const score = scoreNorms.reduce((a, b) => a + b, 0) / scoreNorms.length;
  const conceito = score >= 80 ? "Excelente" : score >= 65 ? "Boa"
    : score >= 45 ? "Regular" : score >= 30 ? "Frágil" : "Crítica";
  const scoreTone: Card["tone"] = score >= 70 ? "ok" : score >= 40 ? "warn" : "danger";
  y = drawKpiGrid(doc, y, [
    { label: "Score de Saúde Financeira", value: `${score.toFixed(0)} / 100  ·  ${conceito}`,
      tone: scoreTone, sub: "Média de 7 indicadores normalizados" },
  ], 1);

  // 2.4 Painel de Saúde Financeira — Semáforos
  type S = "ok" | "warn" | "bad";
  const semaforos: { label: string; status: S; desc: string }[] = [
    { label: "Liquidez Corrente",
      status: ind.liquidezCorrente >= 1.5 ? "ok" : ind.liquidezCorrente >= 1 ? "warn" : "bad",
      desc: `${ind.liquidezCorrente.toFixed(2)}x — capacidade de honrar dívidas de curto prazo` },
    { label: "Endividamento Geral",
      status: ind.endividamentoGeral <= 50 ? "ok" : ind.endividamentoGeral <= 70 ? "warn" : "bad",
      desc: `${ind.endividamentoGeral.toFixed(1)}% — quanto do ativo é dívida` },
    { label: "Margem Líquida",
      status: ind.margemLiquida >= 10 ? "ok" : ind.margemLiquida >= 3 ? "warn" : "bad",
      desc: `${ind.margemLiquida.toFixed(1)}% — lucro a cada R$ de receita` },
    { label: "Cobertura de Juros",
      status: ind.coberturaJuros >= 3 ? "ok" : ind.coberturaJuros >= 1.5 ? "warn" : "bad",
      desc: `${ind.coberturaJuros.toFixed(1)}x — EBIT cobre os juros` },
    { label: "Dívida Líq./EBITDA",
      status: ind.dividaLiqEbitda <= 2 ? "ok" : ind.dividaLiqEbitda <= 3.5 ? "warn" : "bad",
      desc: `${ind.dividaLiqEbitda.toFixed(2)}x — anos de EBITDA p/ zerar dívida` },
    { label: "Conversão de Caixa",
      status: ind.conversaoEbitdaCaixa >= 70 ? "ok" : ind.conversaoEbitdaCaixa >= 40 ? "warn" : "bad",
      desc: `${ind.conversaoEbitdaCaixa.toFixed(0)}% — quanto do EBITDA vira caixa` },
    { label: "ROE",
      status: ind.roe >= 15 ? "ok" : ind.roe >= 8 ? "warn" : "bad",
      desc: `${ind.roe.toFixed(1)}% — retorno sobre capital dos sócios` },
    { label: "Ciclo Financeiro",
      status: ind.cicloFinanceiro <= 30 ? "ok" : ind.cicloFinanceiro <= 60 ? "warn" : "bad",
      desc: `${ind.cicloFinanceiro.toFixed(0)} dias entre pagar e receber` },
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR.textDark);
  doc.text("Painel de Saúde Financeira — Semáforos", MARGIN_X, y);
  y = drawBadgeRow(doc, y + 8, semaforos);

  // 2.5 Top 5 Despesas
  const top5 = Object.entries(dre.despesasPorCategoria)
    .map(([k, v]) => ({ name: k, value: sum(v) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const totalTop5 = top5.reduce((a, b) => a + b.value, 0);
  y = newTopic(doc, "Top 5 Despesas — Onde o dinheiro vai",
    "Maiores categorias de despesas no horizonte de 12 meses");
  if (top5.length === 0) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.setTextColor(...COLOR.textMuted);
    doc.text("Sem despesas cadastradas.", MARGIN_X, y);
  } else {
    y = drawTable(doc, y,
      ["#", "Categoria", "Valor (12m)", "% do top 5"],
      top5.map((d, i) => [
        String(i + 1), d.name, fmtBRL(d.value),
        totalTop5 > 0 ? `${((d.value / totalTop5) * 100).toFixed(1)}%` : "—",
      ]),
      { colStyles: { 0: { halign: "center", cellWidth: 30 }, 1: { halign: "left" },
        2: { halign: "right" }, 3: { halign: "right", cellWidth: 80 } } });
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.setTextColor(...COLOR.textDark);
    doc.text(`Total das 5 maiores: ${fmtBRL(totalTop5)}`, MARGIN_X, y + 4);
  }

  // ── 3. FLUXO DE CAIXA ──────────────────────────────────────────────
  y = newTopic(doc, "Fluxo de Caixa", "Visão trimestral — DFC completa + Burn Rate & Runway");

  // 3.1 Burn Rate & Runway (cards)
  const burnMedio12 = -(cf.fluxoOperacional.reduce((a, b) => a + b, 0) / 12);
  y = drawKpiGrid(doc, y, [
    { label: "Burn rate médio (12m)",
      value: `${burnMedio12 > 0 ? fmtBRL(burnMedio12) : "+" + fmtBRL(-burnMedio12)}/mês`,
      tone: burnMedio12 > 0 ? "danger" : "ok",
      sub: burnMedio12 > 0 ? "Caixa consumido por mês" : "Operação gerou caixa" },
    { label: "Burn rate (últ. 3m)",
      value: `${burnMedio3 > 0 ? fmtBRL(burnMedio3) : "+" + fmtBRL(-burnMedio3)}/mês`,
      tone: burnMedio3 > 0 ? "danger" : "ok", sub: "Base do runway" },
    { label: "Runway", value: runwayLabel, tone: runwayTone,
      sub: `Caixa ${fmtBRL(caixaAtual)} + CR ${fmtBRL(recebiveis)}` },
  ], 3);

  // 3.2 DFC trimestral — todas as linhas
  const cfRows: { label: string; vals: number[]; bold?: boolean; sign?: 1 | -1 }[] = [
    { label: "Saldo Inicial", vals: [cf.saldoInicial[0] ?? 0, cf.saldoInicial[3] ?? 0,
      cf.saldoInicial[6] ?? 0, cf.saldoInicial[9] ?? 0, cf.saldoInicial[0] ?? 0] },
    { label: "(+) Recebimentos de vendas", vals: quartersOf(cf.recebimentos) },
    { label: "(+) Receitas financeiras", vals: quartersOf(cf.receitasFinanceiras) },
    { label: "(−) Pagamentos a fornecedores", vals: quartersOf(cf.pagamentosFornecedores).map((v) => -v) },
    { label: "(−) Pagamentos fixos", vals: quartersOf(cf.pagamentosFixos).map((v) => -v) },
    { label: "(−) Pagamentos variáveis", vals: quartersOf(cf.pagamentosVariaveis).map((v) => -v) },
    { label: "(−) Pagamentos financeiros (juros)", vals: quartersOf(cf.pagamentosFinanceiros).map((v) => -v) },
    { label: "(−) Pagamentos de impostos", vals: quartersOf(cf.pagamentosImpostos).map((v) => -v) },
    { label: "(=) Fluxo Operacional", vals: quartersOf(cf.fluxoOperacional), bold: true },
    { label: "(−) CAPEX", vals: quartersOf(cf.capex).map((v) => -v) },
    { label: "(=) Fluxo de Investimento", vals: quartersOf(cf.fluxoInvestimento), bold: true },
    { label: "(+) Aportes de sócios", vals: quartersOf(cf.aportes) },
    { label: "(+) Captação de empréstimos", vals: quartersOf(cf.emprestimosCaptados) },
    { label: "(−) Amortizações", vals: quartersOf(cf.amortizacoes).map((v) => -v) },
    { label: "(−) Dividendos", vals: quartersOf(cf.dividendos).map((v) => -v) },
    { label: "(=) Fluxo de Financiamento", vals: quartersOf(cf.fluxoFinanciamento), bold: true },
    { label: "(=) Variação de Caixa", vals: quartersOf(cf.variacaoCaixa), bold: true },
    { label: "Saldo Final", vals: [cf.saldoFinal[2] ?? 0, cf.saldoFinal[5] ?? 0,
      cf.saldoFinal[8] ?? 0, cf.saldoFinal[11] ?? 0, cf.saldoFinal[11] ?? 0], bold: true },
  ];

  autoTable(doc, {
    startY: y,
    head: [["Linha", ...QUARTERS]],
    body: cfRows.map((r) => [r.label, ...r.vals.map(fmtBRL)]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3.5,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3 },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "center" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: { 0: { halign: "left", cellWidth: 200 },
      1: { halign: "right" }, 2: { halign: "right" },
      3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section === "body" && cfRows[data.row.index]?.bold) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = COLOR.totalBg;
      }
    },
  });

  // ── 4. DRE ─────────────────────────────────────────────────────────
  y = newTopic(doc, "DRE — Demonstração do Resultado do Exercício", "Visão trimestral · Regime de Competência");

  // 4.1 Cards do topo (5)
  y = drawKpiGrid(doc, y, [
    { label: "Faturamento", value: fmtBRL(sum(dre.receitaBruta)) },
    { label: "EBITDA", value: fmtBRL(sum(dre.ebitda)),
      sub: `${ind.margemEbitda.toFixed(1)}%`,
      tone: sum(dre.ebitda) >= 0 ? "ok" : "danger" },
    { label: "EBIT", value: fmtBRL(sum(dre.ebit)),
      sub: `${ind.margemEbit.toFixed(1)}%`,
      tone: sum(dre.ebit) >= 0 ? "ok" : "danger" },
    { label: "Lucro Líquido", value: fmtBRL(sum(dre.lucroLiquido)),
      sub: `${ind.margemLiquida.toFixed(1)}%`,
      tone: sum(dre.lucroLiquido) >= 0 ? "ok" : "danger" },
    { label: "Impostos", value: fmtBRL(sum(dre.impostosTotal)),
      tone: "warn", sub: `${ind.impostosSobreReceita.toFixed(1)}% / receita` },
  ], 5);

  // 4.2 DRE trimestral — todas as linhas
  const dreRows: { label: string; vals: number[]; bold?: boolean }[] = [
    { label: "(+) Receita Bruta", vals: quartersOf(dre.receitaBruta), bold: true },
    { label: "(−) Inadimplência", vals: quartersOf(dre.deducoesInadimplencia).map((v) => -v) },
    { label: "(−) Outras Deduções", vals: quartersOf(dre.outrasDeducoes).map((v) => -v) },
    { label: "(−) Impostos sobre Vendas", vals: quartersOf(dre.impostosVendas).map((v) => -v) },
    { label: "(=) Receita Líquida", vals: quartersOf(dre.receitaLiquida), bold: true },
    { label: "(−) CPV / CMV / CSP", vals: quartersOf(dre.cpv).map((v) => -v) },
    { label: "(=) Lucro Bruto", vals: quartersOf(dre.lucroBruto), bold: true },
    { label: "(−) Despesas Operacionais", vals: quartersOf(dre.despesasOperacionais).map((v) => -v) },
    { label: "(+) Outras Receitas Operacionais", vals: quartersOf(dre.outrasReceitasOperacionais) },
    { label: "(=) EBITDA", vals: quartersOf(dre.ebitda), bold: true },
    { label: "(−) Depreciação / Amortização", vals: quartersOf(dre.depreciacao).map((v) => -v) },
    { label: "(=) EBIT", vals: quartersOf(dre.ebit), bold: true },
    { label: "(±) Resultado Financeiro", vals: quartersOf(dre.resultadoFinanceiro) },
    { label: "(=) LAIR — Lucro Antes do IR/CSLL", vals: quartersOf(dre.lair), bold: true },
    { label: "(−) IR / CSLL", vals: quartersOf(dre.impostos).map((v) => -v) },
    { label: "(=) Lucro Líquido", vals: quartersOf(dre.lucroLiquido), bold: true },
  ];
  autoTable(doc, {
    startY: y,
    head: [["Conta", ...QUARTERS]],
    body: dreRows.map((r) => [r.label, ...r.vals.map(fmtBRL)]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3.5,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3 },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "center" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: { 0: { halign: "left", cellWidth: 220 },
      1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" },
      4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section === "body" && dreRows[data.row.index]?.bold) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = COLOR.totalBg;
      }
    },
  });

  // ── 5. BALANÇO PATRIMONIAL ─────────────────────────────────────────
  y = newTopic(doc, "Balanço Patrimonial", "Versão padrão · Fechamento derivado por construção");
  y = renderBalancoPadrao(doc, y, balancoFechamento.balanco, balancoFechamento.totals);

  // ── 6. INDICADORES ─────────────────────────────────────────────────
  y = newTopic(doc, "Indicadores Financeiros",
    "Lista completa com fórmula de cálculo (cinza) e valor apurado");
  renderIndicadores(doc, y, model);

  // ── 7. DIAGNÓSTICO ─────────────────────────────────────────────────
  renderDiagnostico(doc, state, model);

  // ── Cabeçalho / rodapé em todas as páginas ─────────────────────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawHeader(doc, logoData, companyName);
    drawFooter(doc, i, total);
  }

  const safeName = companyName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "empresa";
  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`FinnancePRO_${safeName}_${stamp}.pdf`);
}

// =====================================================================
// BALANÇO PADRÃO
// =====================================================================
function renderBalancoPadrao(
  doc: jsPDF, yStart: number, b: BalancoDetalhado, totals: { ativo: number; passivo: number; pl: number; diferenca: number; fechado: boolean },
): number {
  type Linha = { label: string; v: number; redutora?: boolean };
  type Grp = { titulo: string; linhas: Linha[] };

  const ac = b.ativoCirculante ?? {};
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

  // Monta corpo achatado: cabeçalho de grupo (linha cinza) + linhas + subtotal.
  type Row = { type: "grp" | "lin" | "sub" | "tot"; label: string; v?: number };
  const buildRows = (grupos: Grp[], totalLabel: string, totalVal: number): Row[] => {
    const out: Row[] = [];
    grupos.forEach((g) => {
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

  const ativoRows = buildRows(ativoGrupos, "TOTAL DO ATIVO", totals.ativo);
  const passivoRows = buildRows(passivoGrupos, "TOTAL DO PASSIVO + PL", totals.passivo + totals.pl);

  // Duas colunas lado a lado: ATIVO | PASSIVO + PL
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - MARGIN_X * 2 - 8) / 2;

  const renderCol = (rows: Row[], x: number, title: string, accent: [number, number, number]) => {
    autoTable(doc, {
      startY: yStart,
      head: [[title]],
      body: rows.map((r) => [
        r.type === "grp" ? r.label : `  ${r.label}`,
        r.v !== undefined ? fmtBRL(r.v) : "",
      ]),
      margin: { left: x, right: pageW - x - colW, top: CONTENT_TOP, bottom: 50 },
      tableWidth: colW,
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3,
        textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3 },
      headStyles: { fillColor: accent, textColor: [255, 255, 255],
        fontStyle: "bold", fontSize: 10, halign: "left" },
      columnStyles: { 0: { halign: "left" }, 1: { halign: "right", cellWidth: 80 } },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const r = rows[data.row.index];
        if (!r) return;
        if (r.type === "grp") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = COLOR.totalBg;
          data.cell.styles.textColor = COLOR.textDark;
        } else if (r.type === "sub") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [248, 250, 252];
        } else if (r.type === "tot") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = COLOR.headerBg;
          data.cell.styles.textColor = COLOR.headerFg;
          data.cell.styles.fontSize = 10;
        }
      },
    });
    // @ts-expect-error — runtime
    return doc.lastAutoTable?.finalY ?? yStart;
  };

  const yAtivo = renderCol(ativoRows, MARGIN_X, "ATIVO", COLOR.ok);
  const yPassivo = renderCol(passivoRows, MARGIN_X + colW + 8, "PASSIVO + PATRIMÔNIO LÍQUIDO", COLOR.danger);
  let y = Math.max(yAtivo, yPassivo) + 12;

  // Validação de fechamento
  const okStr = totals.fechado ? "BALANÇO FECHADO POR CONSTRUÇÃO" : "DIFERENÇA RESIDUAL";
  const color = totals.fechado ? COLOR.ok : COLOR.warn;
  doc.setFillColor(...color);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.roundedRect(MARGIN_X, y, pageW - MARGIN_X * 2, 22, 3, 3, "F");
  doc.text(
    `${okStr}  ·  Ativo: ${fmtBRL(totals.ativo)}  ·  Passivo + PL: ${fmtBRL(totals.passivo + totals.pl)}  ·  Δ ${fmtBRL(totals.diferenca)}`,
    pageW / 2, y + 14, { align: "center" },
  );
  return y + 30;
}

// =====================================================================
// INDICADORES — lista completa com fórmula em cinza
// =====================================================================
function renderIndicadores(doc: jsPDF, yStart: number, model: FinancialModel): void {
  const { ind } = model;
  type Row = { nome: string; formula: string; valor: string };

  const rows: Row[] = [
    { nome: "Margem Bruta", formula: "Lucro Bruto ÷ Receita Líquida × 100", valor: fmtPct(ind.margemBruta / 100) },
    { nome: "Margem EBITDA", formula: "EBITDA ÷ Receita Líquida × 100", valor: fmtPct(ind.margemEbitda / 100) },
    { nome: "Margem EBIT", formula: "EBIT ÷ Receita Líquida × 100", valor: fmtPct(ind.margemEbit / 100) },
    { nome: "Margem Líquida", formula: "Lucro Líquido ÷ Receita Líquida × 100", valor: fmtPct(ind.margemLiquida / 100) },
    { nome: "Margem de Contribuição", formula: "(Receita − Custos Variáveis) ÷ Receita × 100", valor: fmtPct(ind.margemContribuicao / 100) },
    { nome: "PE Operacional", formula: "(Custos Fixos Op. + Deprec.) ÷ MC", valor: fmtBRL(ind.pontoEquilibrioOperacional) },
    { nome: "PE Financeiro (caixa)", formula: "Custos Fixos Op. (sem D&A) ÷ MC", valor: fmtBRL(ind.pontoEquilibrioFinanceiro) },
    { nome: "PE Total (c/ juros)", formula: "(Custos Fixos + Deprec. + Juros) ÷ MC", valor: fmtBRL(ind.pontoEquilibrio) },
    { nome: "ROE", formula: "Lucro Líquido ÷ PL Médio × 100", valor: fmtPct(ind.roe / 100) },
    { nome: "ROA", formula: "Lucro Líquido ÷ Ativo Total Médio × 100", valor: fmtPct(ind.roa / 100) },
    { nome: "ROIC", formula: "NOPAT ÷ Capital Investido × 100", valor: fmtPct(ind.roic / 100) },
    { nome: "WACC", formula: "(E/V × Ke) + (D/V × Kd × (1−IR))", valor: fmtPct(ind.wacc / 100) },
    { nome: "Liquidez Corrente", formula: "Ativo Circulante ÷ Passivo Circulante", valor: `${ind.liquidezCorrente.toFixed(2)}x` },
    { nome: "Liquidez Seca", formula: "(AC − Estoques) ÷ Passivo Circulante", valor: `${ind.liquidezSeca.toFixed(2)}x` },
    { nome: "Liquidez Imediata", formula: "Disponibilidades ÷ Passivo Circulante", valor: `${ind.liquidezImediata.toFixed(2)}x` },
    { nome: "Liquidez Geral", formula: "Ativo Circulante ÷ (Ativo Total − PL)", valor: `${ind.liquidezGeral.toFixed(2)}x` },
    { nome: "Endividamento Geral", formula: "Passivo Total ÷ Ativo Total × 100", valor: fmtPct(ind.endividamentoGeral / 100) },
    { nome: "Capital Próprio", formula: "PL ÷ (PL + Dívida Onerosa) × 100", valor: `${ind.proprioPercent.toFixed(1)}%` },
    { nome: "Cobertura de Juros", formula: "EBIT ÷ Despesas Financeiras", valor: `${ind.coberturaJuros.toFixed(2)}x` },
    { nome: "Giro do Ativo", formula: "Receita Líquida ÷ Ativo Total Médio", valor: `${ind.giroAtivo.toFixed(2)}x` },
    { nome: "Dívida Líq. / EBITDA", formula: "(Dívida Onerosa − Disponibilidades) ÷ EBITDA", valor: `${ind.dividaLiqEbitda.toFixed(2)}x` },
    { nome: "Dívida Líq. / EBIT", formula: "(Dívida Onerosa − Disponibilidades) ÷ EBIT", valor: `${ind.dividaLiqEbit.toFixed(2)}x` },
    { nome: "Dívida Líq. / PL", formula: "(Dívida Onerosa − Disponibilidades) ÷ PL", valor: `${ind.dividaLiqPl.toFixed(2)}x` },
    { nome: "Ciclo Operacional", formula: "PMR + PME (dias)", valor: `${ind.cicloOperacional.toFixed(0)} dias` },
    { nome: "Ciclo Financeiro", formula: "PMR + PME − PMP (dias)", valor: `${ind.cicloFinanceiro.toFixed(0)} dias` },
    { nome: "NCG", formula: "CR + Estoques − Fornecedores", valor: fmtBRL(ind.ncg) },
    { nome: "Gap de Capital de Giro", formula: "NCG − Caixa Disponível", valor: fmtBRL(ind.gapCapitalGiro) },
    { nome: "Amortização do PL pelo Lucro", formula: "PL ÷ Lucro Líquido Anual",
      valor: Number.isFinite(ind.amortizacaoPlPorLucro) ? `${ind.amortizacaoPlPorLucro.toFixed(1)} anos` : "—" },
    { nome: "Payback (CAPEX)", formula: "CAPEX Anual ÷ FCF Operacional",
      valor: Number.isFinite(ind.paybackCapex) && ind.paybackCapex > 0 ? `${ind.paybackCapex.toFixed(1)} anos` : "—" },
    { nome: "FCF estimado", formula: "NOPAT + D&A − Δ NCG", valor: fmtBRL(ind.fcf) },
    { nome: "FCF após CAPEX", formula: "FCF − CAPEX", valor: fmtBRL(ind.fcfAposCapex) },
    { nome: "CAGR Receitas 12m", formula: "(Rec_fim ÷ Rec_início)^(12÷meses) − 1",
      valor: Number.isFinite(model.cagrReceitas12m) ? fmtPct(model.cagrReceitas12m) : "—" },
    { nome: "GAO", formula: "Margem de Contribuição ÷ EBIT",
      valor: ind.gao !== 0 ? `${ind.gao.toFixed(2)}x` : "—" },
    { nome: "Qualidade do Lucro", formula: "FCO ÷ Lucro Líquido",
      valor: ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}x` : "—" },
    { nome: "Margem de Segurança", formula: "(Receita − PE Op.) ÷ Receita × 100",
      valor: ind.margemSeguranca !== 0 ? fmtPct(ind.margemSeguranca / 100) : "—" },
    { nome: "DSCR — Serviço da Dívida", formula: "EBITDA ÷ (Juros + Amortizações)",
      valor: ind.dscr !== 0 ? `${ind.dscr.toFixed(2)}x` : "—" },
    { nome: "Conversão EBITDA → Caixa", formula: "FCF ÷ EBITDA × 100", valor: `${ind.conversaoEbitdaCaixa.toFixed(1)}%` },
    { nome: "Faturamento / Colaborador", formula: "Receita Bruta ÷ Nº Colaboradores", valor: fmtBRL(ind.faturamentoPorColaborador) },
    { nome: "Receita Líq. / Colaborador", formula: "Receita Líquida ÷ Nº Colaboradores", valor: fmtBRL(ind.receitaPorColaborador) },
    { nome: "EBITDA / Colaborador", formula: "EBITDA ÷ Nº Colaboradores", valor: fmtBRL(ind.ebitdaPorColaborador) },
    { nome: "Lucro / Colaborador", formula: "Lucro Líquido ÷ Nº Colaboradores", valor: fmtBRL(ind.lucroPorColaborador) },
    { nome: "Folha / Receita", formula: "Folha Total Anual ÷ Receita Bruta × 100",
      valor: ind.custoPessoalSobreReceita > 0 ? fmtPct(ind.custoPessoalSobreReceita / 100) : "—" },
    { nome: "Impostos / Receita", formula: "(Imp. Vendas + IRPJ/CSLL) ÷ Receita Bruta × 100",
      valor: fmtPct(ind.impostosSobreReceita / 100) },
    { nome: "Impostos / Lucro Líquido", formula: "(Imp. Vendas + IRPJ/CSLL) ÷ Lucro Líquido × 100",
      valor: ind.impostosSobreLucro !== 0 ? fmtPct(ind.impostosSobreLucro / 100) : "—" },
  ];

  autoTable(doc, {
    startY: yStart,
    head: [["Indicador", "Fórmula", "Valor"]],
    body: rows.map((r) => [r.nome, r.formula, r.valor]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3.5,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3, overflow: "linebreak" },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "left" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: {
      0: { halign: "left", fontStyle: "bold", cellWidth: 170 },
      1: { halign: "left", textColor: COLOR.formula, fontSize: 8, cellWidth: 250 },
      2: { halign: "right", fontStyle: "bold", cellWidth: 75 },
    },
  });
}

// =====================================================================
// DIAGNÓSTICO — riscos, NCG, score, diagnóstico CFO completo
// =====================================================================
function renderDiagnostico(doc: jsPDF, state: AppState, model: FinancialModel): void {
  const { dre, ind, cf } = model;
  let y = newTopic(doc, "Diagnóstico Financeiro",
    "Riscos imediatos, capital de giro, score de saúde e análise CFO completa");

  // 1) Riscos imediatos detectados
  const diags = diagnose(state, dre, ind);
  const riscos = diags.filter((d) => d.level === "danger");
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.setTextColor(...COLOR.textDark);
  doc.text("Riscos imediatos detectados", MARGIN_X, y);
  y += 8;
  if (riscos.length === 0) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.setTextColor(...COLOR.textMuted);
    doc.text("Nenhum risco crítico detectado nos indicadores atuais.", MARGIN_X, y + 10);
    y += 22;
  } else {
    y = drawTable(doc, y + 4, ["Risco", "Detalhe"],
      riscos.map((d) => [d.title, d.message]),
      { colStyles: { 0: { halign: "left", cellWidth: 160, fontStyle: "bold", textColor: COLOR.danger },
        1: { halign: "left" } } });
  }

  // 2) Por dentro do seu Capital de Giro
  const receitaDia = sum(dre.receitaBruta) / 360;
  const cpvDia = sum(dre.cpv) / 360;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.setTextColor(...COLOR.textDark);
  doc.text("Por dentro do seu Capital de Giro", MARGIN_X, y + 4);
  y = drawTable(doc, y + 12, ["Componente", "Valor"], [
    ["NCG — Necessidade de Capital de Giro", fmtBRL(ind.ncg)],
    ["Caixa disponível (NCG − Gap)", fmtBRL(ind.ncg - ind.gapCapitalGiro)],
    ["Gap de Capital de Giro (déficit a financiar)", fmtBRL(ind.gapCapitalGiro)],
    ["PMR — Prazo Médio de Recebimento", `${state.revenue.pmr} dias`],
    ["PMP — Prazo Médio de Pagamento", `${state.revenue.pmp} dias`],
    ["Ciclo Financeiro (PMR + PME − PMP)", `${ind.cicloFinanceiro.toFixed(0)} dias`],
    ["Receita média/dia", fmtBRL(receitaDia)],
    ["CPV médio/dia", fmtBRL(cpvDia)],
  ]);

  // 3) Score de Saúde
  const scoreNorms = [
    Math.min(100, Math.max(0, (ind.liquidezCorrente / 2) * 100)),
    Math.min(100, Math.max(0, 100 - ind.endividamentoGeral)),
    Math.min(100, Math.max(0, ind.margemLiquida * 5)),
    Math.min(100, Math.max(0, ind.coberturaJuros * 20)),
    Math.min(100, Math.max(0, ind.roe * 5)),
    Math.min(100, Math.max(0, ind.conversaoEbitdaCaixa)),
    Math.min(100, Math.max(0, 100 - ind.dividaLiqEbitda * 25)),
  ];
  const score = scoreNorms.reduce((a, b) => a + b, 0) / scoreNorms.length;
  const conceito = score >= 80 ? "Excelente" : score >= 65 ? "Boa"
    : score >= 45 ? "Regular" : score >= 30 ? "Frágil" : "Crítica";
  const tone: Card["tone"] = score >= 70 ? "ok" : score >= 40 ? "warn" : "danger";
  y = drawKpiGrid(doc, y, [
    { label: "Score de Saúde Financeira", value: `${score.toFixed(0)} / 100  ·  ${conceito}`,
      tone, sub: "Média de 7 indicadores (liquidez, endividamento, margem, juros, ROE, conversão, alavancagem)" },
  ], 1);

  // 4) Diagnóstico financeiro completo (todos os pontos)
  y = newTopic(doc, "Diagnóstico Financeiro — Análise CFO",
    "Todos os pontos identificados pelo motor de diagnóstico");
  const levelLabel = { ok: "OK", warn: "Atenção", danger: "Crítico" } as const;
  autoTable(doc, {
    startY: y,
    head: [["Nível", "Título", "Mensagem"]],
    body: diags.map((d) => [levelLabel[d.level], d.title, d.message]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3, valign: "top" },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: {
      0: { cellWidth: 55, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 140, fontStyle: "bold" },
      2: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const lvl = diags[data.row.index].level;
        data.cell.styles.textColor = lvl === "ok" ? COLOR.ok
          : lvl === "warn" ? COLOR.warn : COLOR.danger;
      }
    },
  });

  // 5) Recomendações prescritivas (cards)
  const cards = buildPrescriptiveCards(state);
  if (cards.length > 0) {
    // @ts-expect-error — runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 18;
    if (y > doc.internal.pageSize.getHeight() - 100) {
      y = newTopic(doc, "Recomendações Prescritivas", "Ações sugeridas pelo motor estratégico");
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.setTextColor(...COLOR.textDark);
      doc.text("Recomendações Prescritivas", MARGIN_X, y);
      y += 8;
    }
    autoTable(doc, {
      startY: y,
      head: [["Severidade", "Problema", "Causa provável", "Ações"]],
      body: cards.map((c) => [
        c.severity === "danger" ? "Crítico" : c.severity === "warn" ? "Atenção"
          : c.severity === "info" ? "Oportunidade" : "OK",
        c.problem, c.cause,
        c.actions.map((a) => `• ${a.title}`).join("\n") || "—",
      ]),
      margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4,
        textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3, valign: "top" },
      headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg, fontStyle: "bold" },
      alternateRowStyles: { fillColor: COLOR.zebra },
      columnStyles: {
        0: { cellWidth: 60, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 140, fontStyle: "bold" },
        2: { cellWidth: 160 },
        3: { cellWidth: "auto" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const s = cards[data.row.index].severity;
          data.cell.styles.textColor = s === "danger" ? COLOR.danger
            : s === "warn" ? COLOR.warn : s === "info" ? COLOR.accent : COLOR.ok;
        }
      },
    });
  }

  // Suprime aviso de import não utilizado em alguns builds (aggregateContracts mantido p/ extensão).
  void aggregateContracts;
}
