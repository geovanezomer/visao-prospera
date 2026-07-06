import { AppState } from "./types";
import { buildDRE, type DRE } from "./dre";
import { calcIndicators, type Indicators } from "./indicators";
import { resolveEffectiveRegime } from "./regime";
import { buildCashFlow, type CashFlow } from "./cashflow";
import { computeStrategic, type StrategicResult } from "./strategic";

/** Permite reaproveitar DRE/indicadores/CF já calculados (evita 3× recálculo do engine). */
export interface HealthPrecomputed {
  dre?: DRE;
  ind?: Indicators;
  cf?: CashFlow;
}

export interface HealthDimension {
  key: string;
  label: string;
  score: number; // 0-100
  weight: number; // 0-1
  value: string; // valor humano
  comment: string;
  status: "ok" | "warn" | "danger";
}

export interface HealthScore {
  /** Score financeiro puro (sem haircut estratégico). 0-100. */
  financial: number;
  /** Score final após haircut estratégico. 0-100. */
  total: number;
  grade: "A" | "B" | "C" | "D" | "E";
  status: "ok" | "warn" | "danger";
  dimensions: HealthDimension[];
  headline: string;
  strategic: StrategicResult;
  haircut: number;
}

/** Mapeia um valor x dentro de [min..max] para 0..100 (clamp). */
function band(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) return 0;
  if (max === min) return 50;
  const t = (x - min) / (max - min);
  return Math.max(0, Math.min(100, t * 100));
}
function inverseBand(x: number, good: number, bad: number): number {
  // good < bad: quanto menor o valor, melhor (ex: D.Liq/EBITDA)
  return band(bad - x, 0, bad - good);
}
function statusFromScore(s: number): "ok" | "warn" | "danger" {
  if (s >= 70) return "ok";
  if (s >= 45) return "warn";
  return "danger";
}
function gradeFromScore(s: number): HealthScore["grade"] {
  if (s >= 85) return "A";
  if (s >= 70) return "B";
  if (s >= 55) return "C";
  if (s >= 40) return "D";
  return "E";
}

export function computeHealth(state: AppState, precomputed?: HealthPrecomputed): HealthScore {
  // Verdade absoluta: usa regime efetivo (Simples pode ter excedido limite → Presumido).
  const dre = precomputed?.dre ?? buildDRE(state, resolveEffectiveRegime(state)).dre;
  const ind = precomputed?.ind ?? calcIndicators(state, dre);
  const cf = precomputed?.cf ?? buildCashFlow(state);
  const piorCaixa = cf.totais.pioresMes?.saldo ?? 0;
  const margemEbitda = ind.margemEbitda;
  const margemLiquida = ind.margemLiquida;

  const dims: HealthDimension[] = [
    {
      key: "rentab",
      label: "Rentabilidade (EBITDA)",
      score: band(margemEbitda, 0, 25),
      weight: 0.2,
      value: `${margemEbitda.toFixed(1)}%`,
      comment:
        margemEbitda < 8
          ? "Operação com pouca gordura — risco em qualquer choque."
          : margemEbitda > 20
            ? "Margem operacional saudável."
            : "Dentro do esperado para PMEs.",
      status: statusFromScore(band(margemEbitda, 0, 25)),
    },
    {
      key: "ll",
      label: "Margem Líquida",
      score: band(margemLiquida, -5, 20),
      weight: 0.12,
      value: `${margemLiquida.toFixed(1)}%`,
      comment:
        margemLiquida < 0
          ? "Prejuízo — atenção crítica."
          : margemLiquida < 5
            ? "Lucratividade fraca após impostos e juros."
            : "Lucratividade adequada.",
      status: statusFromScore(band(margemLiquida, -5, 20)),
    },
    {
      key: "roic",
      label: "ROIC × WACC",
      score: band(ind.roic - ind.wacc, -10, 15),
      weight: 0.18,
      value: `${ind.roic.toFixed(1)}% − ${ind.wacc.toFixed(1)}%`,
      comment:
        ind.roic < ind.wacc
          ? "Destrói valor: retorno do capital abaixo do custo."
          : "Cria valor econômico (ROIC > WACC).",
      status: ind.roic >= ind.wacc ? "ok" : "danger",
    },
    {
      key: "alav",
      // calcIndicators já aplica cap em CAP_DL_EBITDA (99) — sempre finito.
      label: "Alavancagem (D.Líq/EBITDA)",
      score: inverseBand(ind.dividaLiqEbitda, 0, 5),
      weight: 0.12,
      value: `${ind.dividaLiqEbitda.toFixed(1)}×`,
      comment:
        ind.dividaLiqEbitda > 3
          ? "Dívida alta — limita captação e pressiona caixa."
          : "Endividamento sob controle.",
      status: statusFromScore(inverseBand(ind.dividaLiqEbitda, 0, 5)),
    },
    {
      key: "cob",
      // Sem dívida (coberturaJuros == null) → dimensão saudável (score máximo).
      label: "Cobertura de Juros",
      score: ind.coberturaJuros == null ? band(10, 0, 6) : band(Math.min(ind.coberturaJuros, 10), 0, 6),
      weight: 0.08,
      value: ind.coberturaJuros == null ? "N/A" : `${ind.coberturaJuros.toFixed(1)}×`,
      comment:
        ind.coberturaJuros == null
          ? "Sem dívida onerosa — não há juros a cobrir."
          : ind.coberturaJuros < 2
            ? "EBIT mal cobre os juros — risco de default."
            : "Lucro operacional cobre confortavelmente o serviço da dívida.",
      status: statusFromScore(ind.coberturaJuros == null ? band(10, 0, 6) : band(Math.min(ind.coberturaJuros, 10), 0, 6)),
    },
    {
      key: "liq",
      label: "Liquidez Corrente",
      score: band(ind.liquidezCorrente, 0.5, 2.0),
      weight: 0.1,
      value: ind.liquidezCorrente.toFixed(2),
      comment:
        ind.liquidezCorrente < 1
          ? "Passivo CP > Ativo CP — pode faltar caixa para honrar curto prazo."
          : "Capacidade de honrar obrigações de curto prazo.",
      status: statusFromScore(band(ind.liquidezCorrente, 0.5, 2.0)),
    },
    {
      key: "caixa",
      label: "Pior mês de caixa",
      score:
        piorCaixa >= state.cashflow.caixaMinimo
          ? 100
          : piorCaixa < 0
            ? 0
            : band(piorCaixa, 0, state.cashflow.caixaMinimo || 1),
      weight: 0.12,
      value: piorCaixa.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      comment:
        piorCaixa < 0
          ? "Projeção mostra mês com caixa negativo."
          : piorCaixa < state.cashflow.caixaMinimo
            ? "Caixa fura o mínimo de segurança em algum mês."
            : "Caixa sempre acima do mínimo no horizonte projetado.",
      status: piorCaixa < 0 ? "danger" : piorCaixa < state.cashflow.caixaMinimo ? "warn" : "ok",
    },
    {
      key: "ciclo",
      label: "Ciclo Financeiro",
      score: inverseBand(ind.cicloFinanceiro, -30, 90),
      weight: 0.08,
      value: `${(ind.cicloFinanceiro ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`,
      comment:
        ind.cicloFinanceiro > 60
          ? "Ciclo longo demanda muito capital de giro."
          : ind.cicloFinanceiro < 0
            ? "Ciclo negativo libera caixa (recebe antes de pagar)."
            : "Ciclo gerenciável.",
      status: statusFromScore(inverseBand(ind.cicloFinanceiro, -30, 90)),
    },
  ];

  const financial = dims.reduce((acc, d) => acc + d.score * d.weight, 0);
  const strategic = computeStrategic(state);
  const haircut = strategic.haircut;
  const total = financial * (1 - haircut);
  const status = statusFromScore(total);
  const grade = gradeFromScore(total);

  const baseHeadline =
    grade === "A"
      ? "Empresa financeiramente saudável e cria valor econômico."
      : grade === "B"
        ? "Estrutura sólida com pontos de melhoria pontuais."
        : grade === "C"
          ? "Saúde mediana — vários indicadores em zona de atenção."
          : grade === "D"
            ? "Sinais relevantes de fragilidade financeira."
            : "Situação crítica — atuação imediata recomendada.";

  const headline =
    strategic.hasAnyAnswer && haircut > 0
      ? `${baseHeadline} Risco estratégico reduziu o score em ${(haircut * 100).toFixed(0)}%.`
      : baseHeadline;

  return { financial, total, grade, status, dimensions: dims, headline, strategic, haircut };
}
