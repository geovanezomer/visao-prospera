// Briefing automático estilo "CFO entra na sala com a pauta pronta".
// Roda silenciosamente ao abrir uma conversa NOVA e injeta a primeira mensagem
// do assistente com 3-5 pontos críticos + pergunta de abertura.
//
// 100% local (sem chamar LLM): usa diagnose + calcIndicators + buildCashFlow +
// computeHealth + benchmark do setor. Determinístico, instantâneo, sem custo.

import type { AppState } from "@/engines/finance/types";
import { diagnose } from "@/engines/finance";
import { getFinancialModelCached } from "@/engines/finance/financialModel";
import { resolveBenchmark } from "@/engines/benchmark/sectors";
import type { SnapshotSections } from "./snapshot";

// M-1: alinhado com tools.ts (mesma assinatura, mesmo Intl).
const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

/**
 * M-3: aceita `sections` opcional. Quando vier do cache (getSectionsCached em useAIChat),
 * reaproveita dre/ind/health/alerts já calculados em vez de refazer os 5 buildXxx.
 */
export function buildOpeningBriefing(state: AppState, sections?: SnapshotSections): string | null {
  try {
    const company = state.companyName || "a empresa";
    const model = getFinancialModelCached(state);
    const dre = sections?.data?.dre ?? model.dre;
    const ind = sections?.data?.ind ?? model.ind;
    const cf = sections?.data?.cf ?? model.cf;
    const health = sections?.data?.health ?? model.health;
    const alerts = sections?.data?.alerts ?? diagnose(state, dre, ind);
    const criticos = alerts.filter((a) => a.level === "danger");
    const atencao = alerts.filter((a) => a.level === "warn");

    // === Coleta pontos críticos (máx 3) — prioridade: caixa < 0, DSCR baixo, margem vs setor ===
    const pontos: string[] = [];

    // 1) Pior mês de caixa negativo
    const pior = cf.totais.pioresMes;
    if (pior && pior.saldo < 0) {
      pontos.push(`caixa negativo em **${pior.mes}** (${brl(pior.saldo)})`);
    }

    // 2) DSCR abaixo de 1,5x
    if (ind.dscr != null && Number.isFinite(ind.dscr) && ind.dscr < 1.5) {
      pontos.push(
        `DSCR em **${ind.dscr.toFixed(2)}x** ${ind.dscr < 1 ? "(não cobre o serviço da dívida)" : "(risco de covenant)"}`,
      );
    }

    // 3) Margem EBITDA vs setor
    const sector = resolveBenchmark(state);
    if (sector && Number.isFinite(ind.margemEbitda)) {
      const delta = ind.margemEbitda - sector.margemEbitda.p50;
      if (delta < -2) {
        pontos.push(
          `margem EBITDA **${Math.abs(delta).toFixed(1)}p.p. abaixo** da mediana do setor (${ind.margemEbitda.toFixed(1)}% vs ${sector.margemEbitda.p50}%)`,
        );
      }
    }

    // 4) Alavancagem
    if (pontos.length < 3 && Number.isFinite(ind.dividaLiqEbitda) && ind.dividaLiqEbitda > 3) {
      pontos.push(
        `Dívida Líq./EBITDA em **${ind.dividaLiqEbitda.toFixed(1)}x** (acima do limite saudável de 3x)`,
      );
    }

    // 5) Cobertura de juros
    if (pontos.length < 3 && ind.coberturaJuros != null && Number.isFinite(ind.coberturaJuros) && ind.coberturaJuros < 2) {
      pontos.push(
        `cobertura de juros em **${ind.coberturaJuros.toFixed(1)}x** (EBIT mal cobre os juros)`,
      );
    }

    // 6) Gap de capital de giro
    if (pontos.length < 3 && ind.gapCapitalGiro > 0) {
      pontos.push(`gap de capital de giro de **${brl(ind.gapCapitalGiro)}** não financiado`);
    }

    // === Riscos qualitativos da página Governança/Estratégico ===
    // Tratamos como "alertas de risco estrutural" complementares aos financeiros.
    const riscos: string[] = [];
    const s = state.strategic;
    if (s) {
      const c = s.concentration;
      if (c?.pctMaiorCliente !== undefined && c.pctMaiorCliente >= 30) {
        riscos.push(`maior cliente concentra **${c.pctMaiorCliente.toFixed(0)}%** da receita`);
      }
      if (c?.pctMaiorFornecedor !== undefined && c.pctMaiorFornecedor >= 30) {
        riscos.push(`maior fornecedor concentra **${c.pctMaiorFornecedor.toFixed(0)}%** do CPV`);
      }
      if (c?.dependeCanal === "sim") {
        riscos.push(`dependência crítica de **um único canal** de aquisição`);
      }
      const g = s.governance;
      // Sócio único → concentração societária máxima (risco-chave automático).
      if (state.numSocios === 1) {
        riscos.push(`**sócio único** (concentração societária total — risco-chave estrutural)`);
      }
      if (g?.socioAfastado60d === "para") {
        riscos.push(`negócio **para** se sócio se afasta 60 dias (risco-chave)`);
      } else if (g?.socioAfastado60d === "perde_eficiencia" && pontos.length + riscos.length < 5) {
        riscos.push(`empresa perde eficiência sem o sócio (dependência operacional)`);
      }
      if (g?.processosDocumentados === "nenhum") {
        riscos.push(`**nenhum processo documentado** (risco de continuidade)`);
      }
      if (g?.planoSucessao === "nao" || g?.planoSucessao === "nunca") {
        riscos.push(`sem plano de sucessão`);
      }
      if (g?.quemFechaContrato === "ninguem") {
        riscos.push(`ninguém autorizado a fechar contrato (gargalo comercial)`);
      }
      if (s.regulatory?.exposicaoRegulatoria === "sim") {
        riscos.push(`exposição regulatória/licenças crítica`);
      }
    }
    // Adiciona até 2 riscos qualitativos ao briefing (mantém 5 linhas)
    riscos.slice(0, 2).forEach((r) => pontos.push(r));

    // Se não houver nada crítico/atenção, devolve briefing positivo curto
    if (!pontos.length && !criticos.length && !atencao.length) {
      return [
        `👋 **Briefing — ${company}**`,
        ``,
        `Rodei o diagnóstico inicial e **não identifiquei pontos críticos**. Score de saúde: **${health.total.toFixed(0)}/100 (${health.grade})**.`,
        ``,
        `Por onde você quer começar? Posso aprofundar em valuation, projeções, simulação de alavancas ou comparação setorial.`,
      ].join("\n");
    }

    // Se não pegou nada nos pontos mas há alertas, usa títulos dos primeiros alertas
    if (!pontos.length) {
      criticos
        .concat(atencao)
        .slice(0, 3)
        .forEach((a) => pontos.push(a.title.toLowerCase()));
    }

    const linha =
      pontos.length === 1
        ? `**1 ponto crítico**: ${pontos[0]}`
        : `**${pontos.length} pontos críticos**: ${pontos.slice(0, -1).join("; ")}${pontos.length > 1 ? " e " : ""}${pontos[pontos.length - 1]}`;

    // Sugestões de partida baseadas nos pontos detectados
    const opcoes: string[] = [];
    if (pior && pior.saldo < 0) opcoes.push("**fluxo de caixa** (entender o gap)");
    if (ind.dscr != null && Number.isFinite(ind.dscr) && ind.dscr < 1.5)
      opcoes.push("**estrutura da dívida** (renegociação)");
    if (sector && ind.margemEbitda < sector.margemEbitda.p50 - 2)
      opcoes.push("**alavancas de margem** (onde cortar)");
    if (opcoes.length < 2) opcoes.push("**simulação de cenários**");
    if (opcoes.length < 3) opcoes.push("**análise 360°**");

    return [
      `👋 **Briefing — ${company}**`,
      ``,
      `Antes de começar, rodei o diagnóstico. ${linha}.`,
      ``,
      `Score de saúde: **${health.total.toFixed(0)}/100 (${health.grade})** · ${criticos.length} alerta(s) crítico(s), ${atencao.length} de atenção.`,
      ``,
      `Por onde quer começar? Sugiro: ${opcoes.slice(0, 3).join(", ")}.`,
    ].join("\n");
  } catch {
    return null;
  }
}
