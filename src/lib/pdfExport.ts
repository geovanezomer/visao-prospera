// =====================================================================
// Exportação de relatório em PDF (jsPDF + autoTable).
//
// Gera um relatório executivo com cabeçalho/rodapé em tema escuro e
// conteúdo em tema claro (impressão amigável). Seções:
//   - Dados da empresa
//   - Dashboard (KPIs principais)
//   - Fluxo de Caixa (DFC anual)
//   - DRE (visão anual)
//   - Balanço (totais derivados)
//   - Indicadores
//   - Diagnóstico (alertas)
//
// Pure-ish: recebe `state` e `model` já calculados; depende apenas de
// jsPDF no client. Não importa nada de UI/React.
// =====================================================================

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { sum, fmtBRL, fmtPct } from "@/engines/finance/format";
import type { AppState } from "@/engines/finance/types";
import type { FinancialModel } from "@/engines/finance/financialModel";
import { diagnose } from "@/engines/finance/diagnose";

// Paleta — cabeçalho/rodapé escuros; conteúdo branco.
const COLOR = {
  headerBg: [15, 23, 42] as [number, number, number], // slate-900
  headerFg: [248, 250, 252] as [number, number, number],
  accent: [59, 130, 246] as [number, number, number], // blue-500
  textDark: [15, 23, 42] as [number, number, number],
  textMuted: [100, 116, 139] as [number, number, number],
  rule: [226, 232, 240] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  ok: [16, 185, 129] as [number, number, number],
  warn: [234, 179, 8] as [number, number, number],
  danger: [239, 68, 68] as [number, number, number],
};

const FOOTER_TEXT = "Gerado com FinnancePRO. Mais detalhes em finnancepro.com.br";

// Converte uma URL de imagem para data URL (necessário para jsPDF addImage).
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
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Desenha cabeçalho escuro com logo + nome do sistema.
function drawHeader(doc: jsPDF, logoData: string | null, companyName: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...COLOR.headerBg);
  doc.rect(0, 0, w, 64, "F");

  // Barra de acento.
  doc.setFillColor(...COLOR.accent);
  doc.rect(0, 64, w, 2, "F");

  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", 40, 16, 32, 32);
    } catch {
      /* ignora — segue sem logo */
    }
  }

  doc.setTextColor(...COLOR.headerFg);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("FinnancePRO", 82, 32);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text("Diagnóstico & Simulação Empresarial", 82, 46);

  // Lado direito: empresa + data.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR.headerFg);
  doc.text(companyName || "—", w - 40, 32, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(`Emitido em ${nowBR()}`, w - 40, 46, { align: "right" });
}

// Desenha rodapé escuro com mensagem padrão + paginação.
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
  doc.text(`Página ${pageNum} / ${pageCount}`, w - 40, h - 12, { align: "right" });
}

// Título de seção (conteúdo claro).
function sectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(...COLOR.accent);
  doc.rect(40, y - 12, 4, 16, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLOR.textDark);
  doc.text(title, 52, y);
  doc.setDrawColor(...COLOR.rule);
  doc.setLineWidth(0.5);
  doc.line(40, y + 6, doc.internal.pageSize.getWidth() - 40, y + 6);
  return y + 22;
}

// Grade de KPIs (cards lado a lado) — usada no Dashboard.
function drawKpiGrid(
  doc: jsPDF,
  yStart: number,
  cards: { label: string; value: string; tone?: "ok" | "warn" | "danger" | "neutral" }[],
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 40;
  const gap = 10;
  const cols = 3;
  const cardW = (pageW - marginX * 2 - gap * (cols - 1)) / cols;
  const cardH = 56;

  let y = yStart;
  cards.forEach((c, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) y += cardH + gap;
    const x = marginX + col * (cardW + gap);

    doc.setDrawColor(...COLOR.rule);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, cardH, 4, 4, "FD");

    // Barra lateral por tom.
    const tone =
      c.tone === "ok"
        ? COLOR.ok
        : c.tone === "warn"
          ? COLOR.warn
          : c.tone === "danger"
            ? COLOR.danger
            : COLOR.accent;
    doc.setFillColor(...tone);
    doc.rect(x, y, 3, cardH, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.textMuted);
    doc.text(c.label.toUpperCase(), x + 10, y + 16);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...COLOR.textDark);
    doc.text(c.value, x + 10, y + 38);
  });

  return y + cardH + 12;
}

// Tabela simples padronizada (autoTable).
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
    margin: { left: 40, right: 40 },
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 5,
      textColor: COLOR.textDark,
      lineColor: COLOR.rule,
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: COLOR.headerBg,
      textColor: COLOR.headerFg,
      fontStyle: "bold",
      fontSize: 9,
    },
    alternateRowStyles: { fillColor: COLOR.zebra },
    columnStyles: head.reduce<Record<number, { halign: "right" | "left" }>>(
      (acc, _h, i) => {
        if (i > 0) acc[i] = { halign: "right" };
        return acc;
      },
      {},
    ),
  });
  // @ts-expect-error — autoTable atribui lastAutoTable ao doc em runtime.
  return (doc.lastAutoTable?.finalY ?? yStart) + 16;
}

// Garante espaço; se não couber, cria nova página.
function ensureSpace(doc: jsPDF, y: number, need: number): number {
  const h = doc.internal.pageSize.getHeight();
  if (y + need > h - 50) {
    doc.addPage();
    return 88; // abaixo do cabeçalho
  }
  return y;
}

export interface ExportPDFInput {
  state: AppState;
  model: FinancialModel;
}

export async function exportFinancePDF({ state, model }: ExportPDFInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const logoData = await loadImageAsDataURL(logoAsset.url);

  const companyName = state.companyName?.trim() || "Sem empresa";
  const { dre, ind, cf, balancoFechamento, regime } = model;

  // ── Página 1: Dados da empresa + Dashboard ─────────────────────────
  let y = 88; // abaixo do cabeçalho (64 + 2 acento + margem)
  y = sectionTitle(doc, y, "Dados da Empresa");

  const periodoMeses = state.periodoAnaliseMeses ?? 12;
  const empresaRows: (string | number)[][] = [
    ["Razão social / nome", companyName],
    ["CNPJ", state.cnpj?.trim() || "—"],
    ["Tipo de negócio", state.businessType ?? "—"],
    ["Ramo de atuação", state.ramoAtuacao ?? "—"],
    ["Colaboradores", state.numColaboradores ?? state.headcountRange ?? "—"],
    ["Período de análise", `${periodoMeses} meses`],
    ["Ano fiscal", state.fiscalYear ?? new Date().getFullYear()],
    ["Regime tributário efetivo", String(regime).toUpperCase()],
  ];
  y = drawTable(doc, y, ["Campo", "Valor"], empresaRows);

  y = ensureSpace(doc, y, 220);
  y = sectionTitle(doc, y, "Dashboard — KPIs principais");
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const ebitdaAnual = sum(dre.ebitda);
  const llAnual = sum(dre.lucroLiquido);
  y = drawKpiGrid(doc, y, [
    { label: "Receita Líquida", value: fmtBRL(receitaLiqAnual) },
    { label: "EBITDA", value: fmtBRL(ebitdaAnual), tone: ebitdaAnual >= 0 ? "ok" : "danger" },
    { label: "Lucro Líquido", value: fmtBRL(llAnual), tone: llAnual >= 0 ? "ok" : "danger" },
    { label: "Margem Bruta", value: fmtPct(ind.margemBruta / 100) },
    {
      label: "Margem EBITDA",
      value: fmtPct(ind.margemEbitda / 100),
      tone: ind.margemEbitda >= 10 ? "ok" : ind.margemEbitda >= 0 ? "warn" : "danger",
    },
    {
      label: "Margem Líquida",
      value: fmtPct(ind.margemLiquida / 100),
      tone: ind.margemLiquida >= 5 ? "ok" : ind.margemLiquida >= 0 ? "warn" : "danger",
    },
    {
      label: "ROIC",
      value: fmtPct(ind.roic / 100),
      tone: ind.roic >= ind.wacc ? "ok" : "danger",
    },
    { label: "WACC", value: fmtPct(ind.wacc / 100) },
    {
      label: "Liquidez Corrente",
      value: ind.liquidezCorrente.toFixed(2),
      tone: ind.liquidezCorrente >= 1 ? "ok" : "danger",
    },
  ]);

  // ── Fluxo de Caixa (DFC anual) ─────────────────────────────────────
  doc.addPage();
  y = 88;
  y = sectionTitle(doc, y, "Fluxo de Caixa — visão anual");
  const cfRows: (string | number)[][] = [
    ["Saldo inicial (Jan)", fmtBRL(cf.saldoInicial[0] ?? 0)],
    ["Recebimentos de vendas", fmtBRL(cf.totais.recebimentos)],
    ["Receitas financeiras", fmtBRL(cf.totais.receitasFinanceiras)],
    ["Pagamentos totais (operação)", fmtBRL(-cf.totais.pagamentosTotais)],
    ["= Fluxo Operacional", fmtBRL(cf.totais.fluxoOperacional)],
    ["Fluxo de Investimento (CAPEX)", fmtBRL(cf.totais.fluxoInvestimento)],
    ["Fluxo de Financiamento", fmtBRL(cf.totais.fluxoFinanciamento)],
    ["= Variação de caixa", fmtBRL(cf.totais.variacao)],
    ["Saldo final (Dez)", fmtBRL(cf.totais.saldoFinal)],
  ];
  y = drawTable(doc, y, ["Linha", "Valor (12m)"], cfRows);

  // ── DRE Anual ──────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 300);
  y = sectionTitle(doc, y, "DRE — visão anual");
  const dreRows: (string | number)[][] = [
    ["Receita Bruta", fmtBRL(sum(dre.receitaBruta))],
    ["(-) Impostos sobre Vendas", fmtBRL(-sum(dre.impostosVendas))],
    ["(-) Outras deduções", fmtBRL(-sum(dre.outrasDeducoes))],
    ["= Receita Líquida", fmtBRL(receitaLiqAnual)],
    ["(-) CPV/CMV", fmtBRL(-sum(dre.cpv))],
    ["= Lucro Bruto", fmtBRL(sum(dre.lucroBruto))],
    ["(-) Despesas Operacionais", fmtBRL(-sum(dre.despesasOperacionais))],
    ["(+) Outras Receitas Op.", fmtBRL(sum(dre.outrasReceitasOperacionais))],
    ["= EBITDA", fmtBRL(ebitdaAnual)],
    ["(-) Depreciação/Amortização", fmtBRL(-sum(dre.depreciacao))],
    ["= EBIT", fmtBRL(sum(dre.ebit))],
    ["(+/-) Resultado Financeiro", fmtBRL(sum(dre.resultadoFinanceiro))],
    ["= LAIR", fmtBRL(sum(dre.lair))],
    ["(-) IR/CSLL e tributos s/ lucro", fmtBRL(-sum(dre.impostosTotal))],
    ["= Lucro Líquido", fmtBRL(llAnual)],
  ];
  y = drawTable(doc, y, ["Conta", "Valor (12m)"], dreRows);

  // ── Balanço ────────────────────────────────────────────────────────
  doc.addPage();
  y = 88;
  y = sectionTitle(doc, y, "Balanço Patrimonial — totais de fechamento");
  const bf = balancoFechamento.totals;
  const balRows: (string | number)[][] = [
    ["Ativo Total", fmtBRL(bf.ativo)],
    ["Passivo (terceiros)", fmtBRL(bf.passivo)],
    ["Patrimônio Líquido", fmtBRL(bf.pl)],
    ["Diferença (deve ≈ 0)", fmtBRL(bf.diferenca)],
    ["Balanço fechado?", bf.fechado ? "Sim" : "Não"],
  ];
  y = drawTable(doc, y, ["Grupo", "Valor"], balRows);

  // ── Indicadores ────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 300);
  y = sectionTitle(doc, y, "Indicadores");
  const indRows: (string | number)[][] = [
    ["Margem Bruta", fmtPct(ind.margemBruta / 100)],
    ["Margem EBITDA", fmtPct(ind.margemEbitda / 100)],
    ["Margem EBIT", fmtPct(ind.margemEbit / 100)],
    ["Margem Líquida", fmtPct(ind.margemLiquida / 100)],
    ["Margem de Contribuição", fmtPct(ind.margemContribuicao / 100)],
    ["Ponto de Equilíbrio", fmtBRL(ind.pontoEquilibrio)],
    ["ROE", fmtPct(ind.roe / 100)],
    ["ROA", fmtPct(ind.roa / 100)],
    ["ROIC", fmtPct(ind.roic / 100)],
    ["WACC", fmtPct(ind.wacc / 100)],
    ["Liquidez Corrente", ind.liquidezCorrente.toFixed(2)],
    ["Liquidez Seca", ind.liquidezSeca.toFixed(2)],
    ["Liquidez Imediata", ind.liquidezImediata.toFixed(2)],
    ["Liquidez Geral", ind.liquidezGeral.toFixed(2)],
    ["Endividamento Geral", fmtPct(ind.endividamentoGeral / 100)],
    ["Cobertura de Juros (x)", ind.coberturaJuros.toFixed(2)],
    ["Dívida Líq./EBITDA (x)", ind.dividaLiqEbitda.toFixed(2)],
    ["Ciclo Financeiro (dias)", ind.cicloFinanceiro.toFixed(0)],
    ["NCG", fmtBRL(ind.ncg)],
    ["FCF (após CAPEX)", fmtBRL(ind.fcfAposCapex)],
  ];
  y = drawTable(doc, y, ["Indicador", "Valor"], indRows);

  // ── Diagnóstico ────────────────────────────────────────────────────
  doc.addPage();
  y = 88;
  y = sectionTitle(doc, y, "Diagnóstico");
  const diags = diagnose(state, dre, ind);
  if (diags.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR.textMuted);
    doc.text("Nenhum alerta gerado pelo motor de diagnóstico.", 40, y);
  } else {
    const levelLabel = { ok: "OK", warn: "Atenção", danger: "Crítico" } as const;
    const diagRows: (string | number)[][] = diags.map((d) => [
      levelLabel[d.level],
      d.title,
      d.message,
    ]);
    autoTable(doc, {
      startY: y,
      head: [["Nível", "Título", "Mensagem"]],
      body: diagRows,
      margin: { left: 40, right: 40 },
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 6,
        textColor: COLOR.textDark,
        lineColor: COLOR.rule,
        lineWidth: 0.3,
        valign: "top",
      },
      headStyles: {
        fillColor: COLOR.headerBg,
        textColor: COLOR.headerFg,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: COLOR.zebra },
      columnStyles: {
        0: { cellWidth: 60, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 140 },
        2: { cellWidth: "auto" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const lvl = diags[data.row.index].level;
          const color = lvl === "ok" ? COLOR.ok : lvl === "warn" ? COLOR.warn : COLOR.danger;
          data.cell.styles.textColor = color;
        }
      },
    });
  }

  // ── Cabeçalho/Rodapé em todas as páginas ───────────────────────────
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
