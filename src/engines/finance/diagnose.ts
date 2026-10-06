// =====================================================================
// DIAGNÓSTICO — gera alertas estratégicos (OK / Warn / Danger) a partir
// da DRE e dos indicadores. Funções puras, sem dependência de UI.
// =====================================================================

import { AppState } from "./types";
import { sum, fmtBRLCompact, fmtBRL } from "./format";
import type { DRE } from "./dre";
import type { Indicators } from "./indicators";
import { deriveAbertura } from "./aberturaDerivada";

export interface Diagnostic {
  level: "ok" | "warn" | "danger";
  title: string;
  message: string;
}

export function diagnose(state: AppState, dre: DRE, ind: Indicators): Diagnostic[] {
  const out: Diagnostic[] = [];

  const receitaBrutaAnual = sum(state.revenue.bruta);
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const folha = dre.folhaCltAnual;
  const folhaPct = receitaLiqAnual > 0 ? (folha / receitaLiqAnual) * 100 : 0;
  const llAnual = sum(dre.lucroLiquido);
  const ebitdaAnual = sum(dre.ebitda);
  const fcfAnual = ind.fcf;

  // #0 Conversão de Lucro em Caixa (Auditoria CFO)
  if (llAnual > 1000) {
    const conversao = (fcfAnual / llAnual) * 100;
    if (conversao < 30 && conversao >= 0) {
      out.push({
        level: "warn",
        title: "Baixa conversão de lucro em caixa",
        message: `Apenas ${conversao.toFixed(1)}% do lucro líquido vira caixa livre. O restante está ficando imobilizado em capital de giro ou pagando dívidas.`,
      });
    } else if (conversao < 0) {
      out.push({
        level: "danger",
        title: "Lucro que não vira caixa",
        message: `Empresa é lucrativa (${fmtBRLCompact(llAnual)}), mas queima caixa livre (${fmtBRLCompact(fcfAnual)}). Risco de crise de liquidez por excesso de NCG ou serviço de dívida.`,
      });
    }
  }

  // #0.1 Divergência EBITDA x Caixa (Alerta imediato CFO)
  if (ebitdaAnual > 0 && fcfAnual < 0) {
    out.push({
      level: "danger",
      title: "Divergência: EBITDA (+) vs Caixa (−)",
      message:
        "Alerta CFO: A operação gera resultado operacional positivo, mas o caixa está caindo. Verifique se o crescimento está sendo financiado por excesso de prazo aos clientes ou estoques altos (NCG).",
    });
  }

  // ===== Edge cases =====
  const inadMedia = state.revenue.inadimplencia.reduce((a, b) => a + b, 0) / 12;
  if (inadMedia >= 95) {
    out.push({
      level: "danger",
      title: "Inadimplência crítica (~100%)",
      message: `Inadimplência média de ${inadMedia.toFixed(1)}% — receita líquida praticamente nula. Modelo de cobrança inviável; revise o crédito a clientes.`,
    });
  } else if (inadMedia >= 30) {
    out.push({
      level: "warn",
      title: "Inadimplência elevada",
      message: `Inadimplência média de ${inadMedia.toFixed(1)}% compromete o EBITDA e o caixa.`,
    });
  }

  const linhasNegativas = state.costs.filter((c) => c.values.some((v) => v < 0));
  if (linhasNegativas.length > 0) {
    out.push({
      level: "warn",
      title: "Linhas de custo com valores negativos",
      message: `${linhasNegativas.length} rubrica(s) com valor negativo (ex.: "${linhasNegativas[0].label}"). Margem bruta pode estar inflada artificialmente — use linhas dedicadas para recuperações/créditos.`,
    });
  }

  const custosFixosAnual = sum(dre.custosFixos);
  if (receitaBrutaAnual <= 0 && custosFixosAnual > 0) {
    out.push({
      level: "danger",
      title: "Operação inviável: receita zero com custos fixos",
      message: `Sem receita projetada e ${fmtBRLCompact(custosFixosAnual)} de custos fixos no ano. EBITDA projetado = ${fmtBRLCompact(ebitdaAnual)}. Ponto de equilíbrio indefinido — preencha a aba Receita.`,
    });
  } else if (receitaBrutaAnual > 0 && receitaLiqAnual <= 0) {
    out.push({
      level: "danger",
      title: "Receita líquida zerada",
      message: `Receita bruta de ${fmtBRLCompact(receitaBrutaAnual)} foi totalmente consumida por deduções/inadimplência/impostos. Receita líquida = ${fmtBRLCompact(receitaLiqAnual)}, EBITDA = ${fmtBRLCompact(ebitdaAnual)}. Indicadores percentuais (margens, folha %, ROIC) ficam indefinidos — revise inadimplência e regime tributário.`,
    });
  }

  if (folhaPct > 35)
    out.push({
      level: "danger",
      title: "Custo de mão de obra elevado",
      message: `Folha (com encargos) ${folhaPct.toFixed(1)}% da receita líquida (${fmtBRLCompact(folha)} de ${fmtBRLCompact(receitaLiqAnual)}).`,
    });
  else if (folhaPct > 25)
    out.push({
      level: "warn",
      title: "Folha em zona de atenção",
      message: `Folha em ${folhaPct.toFixed(1)}% da receita líquida (${fmtBRLCompact(folha)}).`,
    });

  const fixoPct = receitaLiqAnual > 0 ? (sum(dre.custosFixos) / receitaLiqAnual) * 100 : 0;
  if (receitaLiqAnual > 0 && fixoPct > 50)
    out.push({
      level: "danger",
      title: "Custos fixos altos demais",
      message: `Custos fixos somam ${fixoPct.toFixed(1)}% da receita líquida (${fmtBRLCompact(custosFixosAnual)}).`,
    });

  if (receitaLiqAnual > 0 && ind.margemBruta < 25)
    out.push({
      level: "danger",
      title: "Margem bruta baixa",
      message: `Margem bruta de ${ind.margemBruta.toFixed(1)}% — EBITDA ${fmtBRLCompact(ebitdaAnual)} (margem EBITDA ${ind.margemEbitda.toFixed(1)}%).`,
    });
  if (receitaLiqAnual > 0 && ind.margemLiquida < 5)
    out.push({
      level: ind.margemLiquida < 0 ? "danger" : "warn",
      title: "Margem líquida insuficiente",
      message: `Margem líquida em ${ind.margemLiquida.toFixed(1)}% (EBITDA ${ind.margemEbitda.toFixed(1)}%).`,
    });

  if (ind.coberturaJuros != null && Number.isFinite(ind.coberturaJuros) && ind.coberturaJuros < 2)
    out.push({
      level: "danger",
      title: "Cobertura de juros perigosa",
      message: `EBIT cobre apenas ${ind.coberturaJuros.toFixed(1)}× os juros.`,
    });
  if (ind.dividaLiqEbitda > 3 && Number.isFinite(ind.dividaLiqEbitda))
    out.push({
      level: "warn",
      title: "Alavancagem elevada",
      message: `Dívida Líq./EBITDA = ${ind.dividaLiqEbitda.toFixed(1)}×.`,
    });

  if (ind.gapCapitalGiro > 0)
    out.push({
      level: "warn",
      title: "Necessidade de Capital de Giro não coberta",
      message: `Falta ${ind.gapCapitalGiro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para o ciclo operacional.`,
    });
  else if (ind.gapCapitalGiro < 0 && ind.ncg < 0)
    out.push({
      level: "ok",
      title: "Ciclo financeiro libera caixa",
      message: `Empresa com ciclo negativo (PMP > PMR) — recebe antes de pagar.`,
    });

  if (ind.roic < ind.wacc)
    out.push({
      level: "danger",
      title: "Empresa destrói valor",
      message: `ROIC ${ind.roic.toFixed(1)}% < WACC ${ind.wacc.toFixed(1)}%.`,
    });
  else
    out.push({
      level: "ok",
      title: "Empresa cria valor econômico",
      message: `ROIC ${ind.roic.toFixed(1)}% ≥ WACC ${ind.wacc.toFixed(1)}%.`,
    });

  if (ind.liquidezCorrente < 1)
    out.push({
      level: "danger",
      title: "Liquidez corrente crítica",
      message: `Liquidez corrente ${ind.liquidezCorrente.toFixed(2)}.`,
    });

  // Balanço de abertura desequilibrado — causa raiz do fechamento não fechar.
  // Emite alerta warn com o valor do plug para o consultor aplicar em Capital.
  try {
    const ab = deriveAbertura({ state, impostosTotalMensais: dre.impostosTotal });
    if (!ab.totals.fechado) {
      out.push({
        level: "warn",
        title: "Balanço de abertura não fecha",
        message:
          `Ativo ${fmtBRL(ab.totals.ativo)} ≠ Passivo + PL ${fmtBRL(ab.totals.passivo + ab.totals.pl)} — ` +
          `diferença de ${fmtBRL(ab.totals.diferenca)}. Ajuste em Capital → botão ` +
          `"Ajustar Lucros Acumulados (plug: ${fmtBRL(ab.totals.diferenca)})"; ` +
          `isso soma o valor a capital.abertura.lucrosAcumulados e equilibra a abertura.`,
      });
    }
  } catch {
    /* no-op */
  }

  return out;
}
