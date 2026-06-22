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
import { monthValues } from "@/engines/finance/costs";
import { splitReceitasFinanceiras } from "@/engines/finance/shared";

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
  y = newTopic(doc, "Fluxo de Caixa", "Visão trimestral — DFC método direto, completa, fiel à tela do sistema");

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

  // 3.2 DFC trimestral — mesma estrutura/labels do DFCTable.tsx
  type CFRow = { label: string; vals?: number[]; bold?: boolean; section?: boolean; highlight?: boolean };
  const cfRows: CFRow[] = [
    { label: "Saldo inicial", vals: [cf.saldoInicial[0] ?? 0, cf.saldoInicial[3] ?? 0,
      cf.saldoInicial[6] ?? 0, cf.saldoInicial[9] ?? 0, cf.saldoInicial[0] ?? 0] },
    { label: "ATIVIDADES OPERACIONAIS", section: true },
    { label: "(+) Recebimentos de clientes", vals: quartersOf(cf.recebimentos) },
    { label: "(+) Receitas financeiras (aplicações)", vals: quartersOf(cf.receitasFinanceiras) },
    { label: "(−) Pagamentos a fornecedores (CPV)", vals: quartersOf(cf.pagamentosFornecedores).map((v) => -v) },
    { label: "(−) Pagamentos de custos fixos", vals: quartersOf(cf.pagamentosFixos).map((v) => -v) },
    { label: "(−) Pagamentos de custos variáveis", vals: quartersOf(cf.pagamentosVariaveis).map((v) => -v) },
    { label: "(−) Despesas financeiras", vals: quartersOf(cf.pagamentosFinanceiros).map((v) => -v) },
    { label: "(−) Impostos pagos", vals: quartersOf(cf.pagamentosImpostos).map((v) => -v) },
    { label: "(=) Fluxo das Operações", vals: quartersOf(cf.fluxoOperacional), bold: true },
    { label: "ATIVIDADES DE INVESTIMENTO", section: true },
    { label: "(−) CapEx — aportes em ativo fixo", vals: quartersOf(state.cashflow.capex).map((v) => -v) },
    { label: "(=) Fluxo de Investimento", vals: quartersOf(cf.fluxoInvestimento), bold: true },
    { label: "ATIVIDADES DE FINANCIAMENTO", section: true },
    { label: "(+) Aportes de sócios", vals: quartersOf(state.cashflow.aportes) },
    { label: "(+) Captação de empréstimos", vals: quartersOf(state.cashflow.emprestimosCaptados) },
    { label: "(−) Amortização de principal", vals: quartersOf(state.cashflow.amortizacoes).map((v) => -v) },
    { label: "(−) Distribuição de dividendos", vals: quartersOf(state.cashflow.dividendos).map((v) => -v) },
    { label: "(=) Fluxo de Financiamento", vals: quartersOf(cf.fluxoFinanciamento), bold: true },
    { label: "(=) VARIAÇÃO DE CAIXA", vals: quartersOf(cf.variacaoCaixa), bold: true, highlight: true },
    { label: "(=) SALDO FINAL", vals: [cf.saldoFinal[2] ?? 0, cf.saldoFinal[5] ?? 0,
      cf.saldoFinal[8] ?? 0, cf.saldoFinal[11] ?? 0, cf.saldoFinal[11] ?? 0], bold: true, highlight: true },
  ];

  autoTable(doc, {
    startY: y,
    head: [["Linha", ...QUARTERS]],
    body: cfRows.map((r) => r.section
      ? [r.label, "", "", "", "", ""]
      : [r.label, ...(r.vals ?? []).map(fmtBRL)]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3, valign: "middle" },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "center" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: { 0: { halign: "left", cellWidth: 230 },
      1: { halign: "right" }, 2: { halign: "right" },
      3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const r = cfRows[data.row.index];
      if (!r) return;
      if (r.section) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 8;
        data.cell.styles.fillColor = [226, 232, 240];
        data.cell.styles.textColor = COLOR.textDark;
      } else if (r.highlight) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [219, 234, 254]; // blue-100
      } else if (r.bold) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = COLOR.totalBg;
      }
    },
  });

  // ── 4. DRE ─────────────────────────────────────────────────────────
  y = newTopic(doc, "DRE — Demonstração do Resultado do Exercício", "Visão trimestral · estrutura idêntica à tela do sistema");

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

  // 4.2 DRE trimestral — replica DRETab.tsx
  const zeros12 = () => Array(12).fill(0);
  const dedById = (id: string) => state.revenue.deducoes?.find((d) => d.id === id);
  const descIncond = dedById("desc_incond")?.valores ?? zeros12();
  const abatimentos = dedById("abatimentos")?.valores ?? zeros12();
  const outrasDedResto = dre.outrasDeducoes.map((v, i) => v - (descIncond[i] ?? 0) - (abatimentos[i] ?? 0));

  // Quebra das despesas por categoria (igual ao DRETab)
  const despComerciais = zeros12();
  const despAdmin = zeros12();
  const despFinanc = zeros12();
  for (const c of state.costs) {
    const v = monthValues(c, state.tax.regime);
    if (c.category === "variavel") for (let i = 0; i < 12; i++) despComerciais[i] += v[i];
    else if (c.category === "fixo") for (let i = 0; i < 12; i++) despAdmin[i] += v[i];
    else if (c.category === "financeiro") for (let i = 0; i < 12; i++) despFinanc[i] += v[i];
  }
  const { financeiras: receitasFinMensal, operacionais: outrasReceitasOpMensal } =
    splitReceitasFinanceiras(state);
  const usaPDD = !!state.revenue.inadimplenciaComoPDD;
  const pddLine = usaPDD ? dre.pdd : zeros12();
  const outrasOperacionais = dre.depreciacao.map(
    (d, i) => -d - pddLine[i] + outrasReceitasOpMensal[i],
  );
  const laft = dre.ebit.map((e, i) => e + receitasFinMensal[i]);

  type DRERow = { label: string; vals: number[]; bold?: boolean; highlight?: boolean };
  const dreRows: DRERow[] = [
    { label: "(+) Receita Operacional Bruta", vals: quartersOf(dre.receitaBruta), bold: true },
    { label: usaPDD ? "(−) Inadimplência (PDD)" : "(−) Inadimplência (perdas estimadas)",
      vals: quartersOf(dre.deducoesInadimplencia).map((v) => -v) },
    { label: "(−) Descontos Incondicionais", vals: quartersOf(descIncond).map((v) => -v) },
    { label: "(−) Abatimentos", vals: quartersOf(abatimentos).map((v) => -v) },
    { label: "(−) Outras Deduções", vals: quartersOf(outrasDedResto).map((v) => -v) },
    { label: regime === "simples"
      ? "(−) DAS Simples Nacional"
      : "(−) Tributos sobre Receita (PIS/COFINS/ICMS/ISS/CBS/IBS)",
      vals: quartersOf(dre.impostosVendas).map((v) => -v) },
    { label: "(=) Receita Operacional Líquida", vals: quartersOf(dre.receitaLiquida), bold: true },
    { label: "(−) CPV / CMV / CSP", vals: quartersOf(dre.cpv).map((v) => -v) },
    { label: "(=) LUCRO BRUTO", vals: quartersOf(dre.lucroBruto), bold: true },
    { label: "(−) Despesas Comerciais", vals: quartersOf(despComerciais).map((v) => -v) },
    { label: "(−) Despesas Administrativas", vals: quartersOf(despAdmin).map((v) => -v) },
    { label: "(±) Outras Despesas/Receitas Operacionais", vals: quartersOf(outrasOperacionais) },
    { label: "(=) LUCRO OPERACIONAL / EBIT", vals: quartersOf(dre.ebit), bold: true },
    { label: "(+) Receitas Financeiras", vals: quartersOf(receitasFinMensal) },
    { label: "(=) LUCRO ANTES DO FINANCIAMENTO E TRIBUTOS", vals: quartersOf(laft), bold: true },
    { label: "(−) Despesas Financeiras", vals: quartersOf(despFinanc).map((v) => -v) },
    { label: "(=) LUCRO ANTES DO IR/CSLL (EBT)", vals: quartersOf(dre.lair), bold: true },
    { label: dre.impostosLucroBase === "receita_presumida"
      ? "(−) IR / CSLL (base presumida sobre receita)"
      : "(−) IR / CSLL",
      vals: quartersOf(dre.impostos).map((v) => -v) },
    { label: "(=) LUCRO LÍQUIDO DO EXERCÍCIO", vals: quartersOf(dre.lucroLiquido), bold: true, highlight: true },
  ];
  autoTable(doc, {
    startY: y,
    head: [["Conta", ...QUARTERS]],
    body: dreRows.map((r) => [r.label, ...r.vals.map(fmtBRL)]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3, valign: "middle" },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "center" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: { 0: { halign: "left", cellWidth: 240 },
      1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" },
      4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const r = dreRows[data.row.index];
      if (!r) return;
      if (r.highlight) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [219, 234, 254];
      } else if (r.bold) {
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
  // "O que ele mede": texto pedagógico (mesmo conteúdo dos tooltips do app).
  type Row = { nome: string; mede: string; valor: string };
  const rows: Row[] = [
    { nome: "Margem Bruta", mede: "Quanto sobra da receita após pagar o custo direto do produto/serviço — eficiência da operação antes das despesas.", valor: fmtPct(ind.margemBruta / 100) },
    { nome: "Margem EBITDA", mede: "Quanto a operação gera de caixa antes de juros, impostos e depreciação — geração operacional 'pura'.", valor: fmtPct(ind.margemEbitda / 100) },
    { nome: "Margem EBIT", mede: "Lucro operacional (após depreciação, antes de juros e impostos) sobre receita — rentabilidade considerando o desgaste dos ativos.", valor: fmtPct(ind.margemEbit / 100) },
    { nome: "Margem Líquida", mede: "Lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos).", valor: fmtPct(ind.margemLiquida / 100) },
    { nome: "Margem de Contribuição", mede: "Quanto cada R$ vendido contribui para pagar custos fixos e gerar lucro. Quanto maior, mais resiliente o negócio.", valor: fmtPct(ind.margemContribuicao / 100) },
    { nome: "PE Operacional", mede: "Receita mínima para cobrir custos fixos operacionais (com depreciação, sem juros).", valor: fmtBRL(ind.pontoEquilibrioOperacional) },
    { nome: "PE Financeiro (caixa)", mede: "Receita mínima para cobrir desembolsos operacionais — exclui depreciação e juros. Break-even em caixa.", valor: fmtBRL(ind.pontoEquilibrioFinanceiro) },
    { nome: "PE Total (c/ juros)", mede: "Cobertura financeira completa: inclui juros como custo fixo. Visão para 'não ter prejuízo' com serviço da dívida.", valor: fmtBRL(ind.pontoEquilibrio) },
    { nome: "ROE", mede: "Retorno sobre o Patrimônio Líquido — quanto o capital dos sócios rende ao ano.", valor: fmtPct(ind.roe / 100) },
    { nome: "ROA", mede: "Retorno sobre o Ativo Total — eficiência da empresa em gerar lucro com seus ativos.", valor: fmtPct(ind.roa / 100) },
    { nome: "ROIC", mede: "Retorno sobre o Capital Investido na operação. Se ROIC > WACC, cria valor; se ROIC < WACC, destrói.", valor: fmtPct(ind.roic / 100) },
    { nome: "WACC", mede: "Custo médio ponderado de capital — retorno mínimo exigido por sócios e credores. Meta do ROIC.", valor: fmtPct(ind.wacc / 100) },
    { nome: "Liquidez Corrente", mede: "Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. >1,0 folga; <1,0 aperto.", valor: `${ind.liquidezCorrente.toFixed(2)}x` },
    { nome: "Liquidez Seca", mede: "Liquidez corrente sem estoques (que podem demorar a virar caixa). Ideal >1,0.", valor: `${ind.liquidezSeca.toFixed(2)}x` },
    { nome: "Liquidez Imediata", mede: "Capacidade de pagar dívidas de curto prazo IMEDIATAMENTE, só com caixa e aplicações.", valor: `${ind.liquidezImediata.toFixed(2)}x` },
    { nome: "Liquidez Geral", mede: "Capacidade total de honrar todas as dívidas (curto + longo prazo) com ativos circulantes. <1 = depende de refinanciamento.", valor: `${ind.liquidezGeral.toFixed(2)}x` },
    { nome: "Endividamento Geral", mede: "Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro.", valor: fmtPct(ind.endividamentoGeral / 100) },
    { nome: "Capital Próprio", mede: "Participação do PL no financiamento total da empresa (PL + dívida onerosa).", valor: `${ind.proprioPercent.toFixed(1)}%` },
    { nome: "Cobertura de Juros", mede: "Quantas vezes o lucro operacional cobre as despesas de juros. <2× é zona de risco.", valor: `${ind.coberturaJuros.toFixed(2)}x` },
    { nome: "Giro do Ativo", mede: "Quantas vezes o ativo total 'gira' em vendas no ano — eficiência de uso dos ativos.", valor: `${ind.giroAtivo.toFixed(2)}x` },
    { nome: "Dívida Líq. / EBITDA", mede: "Em quantos anos de geração de caixa a empresa quitaria sua dívida líquida. >3× preocupa bancos.", valor: `${ind.dividaLiqEbitda.toFixed(2)}x` },
    { nome: "Dívida Líq. / EBIT", mede: "Quantos anos de lucro operacional para quitar a dívida líquida. Mais conservador que DL/EBITDA.", valor: `${ind.dividaLiqEbit.toFixed(2)}x` },
    { nome: "Dívida Líq. / PL", mede: "Relação entre dívida líquida e capital dos sócios — quanto a empresa está alavancada sobre o patrimônio próprio.", valor: `${ind.dividaLiqPl.toFixed(2)}x` },
    { nome: "Ciclo Operacional", mede: "Dias entre comprar/produzir e receber do cliente (PMR + PME).", valor: `${ind.cicloOperacional.toFixed(0)} dias` },
    { nome: "Ciclo Financeiro", mede: "Dias em que a empresa financia a operação com capital próprio (PMR + PME − PMP).", valor: `${ind.cicloFinanceiro.toFixed(0)} dias` },
    { nome: "NCG", mede: "Necessidade de Capital de Giro — recursos permanentes que a operação exige para girar.", valor: fmtBRL(ind.ncg) },
    { nome: "Gap de Capital de Giro", mede: "Diferença entre a NCG e o caixa disponível — déficit que precisa ser financiado.", valor: fmtBRL(ind.gapCapitalGiro) },
    { nome: "Amortização do PL pelo Lucro", mede: "Anos para o lucro acumulado igualar o PL — velocidade de remuneração do capital próprio.",
      valor: Number.isFinite(ind.amortizacaoPlPorLucro) ? `${ind.amortizacaoPlPorLucro.toFixed(1)} anos` : "—" },
    { nome: "Payback (CAPEX)", mede: "Tempo para a geração de caixa recuperar o CAPEX total do ano.",
      valor: Number.isFinite(ind.paybackCapex) && ind.paybackCapex > 0 ? `${ind.paybackCapex.toFixed(1)} anos` : "—" },
    { nome: "FCF estimado", mede: "Free Cash Flow operacional antes do CAPEX — caixa após impostos e variação de capital de giro.", valor: fmtBRL(ind.fcf) },
    { nome: "FCF após CAPEX", mede: "Caixa livre após investimentos — disponível para dividendos, amortização ou reserva.", valor: fmtBRL(ind.fcfAposCapex) },
    { nome: "CAGR Receitas 12m", mede: "Ritmo equivalente anualizado de crescimento da receita líquida nos 12 meses.",
      valor: Number.isFinite(model.cagrReceitas12m) ? fmtPct(model.cagrReceitas12m) : "—" },
    { nome: "GAO", mede: "Grau de Alavancagem Operacional: se a receita variar 1%, o EBIT varia GAO%. Sensível em queda.",
      valor: ind.gao !== 0 ? `${ind.gao.toFixed(2)}x` : "—" },
    { nome: "Qualidade do Lucro", mede: "O lucro contábil está virando caixa? ≥1 saudável; <1 lucro 'no papel'.",
      valor: ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}x` : "—" },
    { nome: "Margem de Segurança", mede: "Folga entre receita atual e ponto de equilíbrio. >25% confortável; <10% zona crítica.",
      valor: ind.margemSeguranca !== 0 ? fmtPct(ind.margemSeguranca / 100) : "—" },
    { nome: "DSCR — Serviço da Dívida", mede: "Quantas vezes o EBITDA cobre juros + amortização. Bancos exigem ≥1,25× para giro; ≥1,5× destrava linhas.",
      valor: ind.dscr !== 0 ? `${ind.dscr.toFixed(2)}x` : "—" },
    { nome: "Conversão EBITDA → Caixa", mede: "Quanto do EBITDA vira caixa livre (FCF). Mostra eficiência da operação em gerar caixa real.", valor: `${ind.conversaoEbitdaCaixa.toFixed(1)}%` },
    { nome: "Faturamento / Colaborador", mede: "Receita bruta gerada por colaborador no ano — benchmark de produtividade.", valor: fmtBRL(ind.faturamentoPorColaborador) },
    { nome: "Receita Líq. / Colaborador", mede: "Receita líquida (após deduções/impostos sobre venda) por colaborador. Comparável entre regimes.", valor: fmtBRL(ind.receitaPorColaborador) },
    { nome: "EBITDA / Colaborador", mede: "Geração operacional (EBITDA) por colaborador no ano.", valor: fmtBRL(ind.ebitdaPorColaborador) },
    { nome: "Lucro / Colaborador", mede: "Lucro líquido gerado por colaborador no ano — conversão de mão de obra em resultado.", valor: fmtBRL(ind.lucroPorColaborador) },
    { nome: "Folha / Receita", mede: "Peso da folha total (CLT + pró-labore + MOD, com encargos) sobre a receita. >35% acende alerta em serviços.",
      valor: ind.custoPessoalSobreReceita > 0 ? fmtPct(ind.custoPessoalSobreReceita / 100) : "—" },
    { nome: "Impostos / Receita", mede: "Carga tributária total (impostos s/ vendas + IRPJ/CSLL) sobre receita bruta — peso fiscal completo.",
      valor: fmtPct(ind.impostosSobreReceita / 100) },
    { nome: "Impostos / Lucro Líquido", mede: "Quanto a empresa paga de impostos para cada R$ 1 de lucro. >100% = fisco leva mais que sobra para os sócios.",
      valor: ind.impostosSobreLucro !== 0 ? fmtPct(ind.impostosSobreLucro / 100) : "—" },
  ];

  autoTable(doc, {
    startY: yStart,
    head: [["Indicador", "O que ele mede", "Valor"]],
    body: rows.map((r) => [r.nome, r.mede, r.valor]),
    margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: 50 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4,
      textColor: COLOR.textDark, lineColor: COLOR.rule, lineWidth: 0.3, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: COLOR.headerBg, textColor: COLOR.headerFg,
      fontStyle: "bold", fontSize: 9, halign: "left" },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: {
      0: { halign: "left", fontStyle: "bold", cellWidth: 130 },
      1: { halign: "left", textColor: COLOR.textMuted, fontSize: 8, cellWidth: 320 },
      2: { halign: "right", fontStyle: "bold", cellWidth: 65 },
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
