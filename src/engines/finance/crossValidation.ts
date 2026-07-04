// ============================================================================
// crossValidation.ts — Validação cruzada entre abas (Tiers 1, 2, 3).
//
// Camada anterior ao `prescriptive` e ao `CriticalAlertsBanner`: identifica
// INCOERÊNCIAS ESTRUTURAIS de negócio sobre o `AppState` (não erros de
// cálculo). O objetivo é evitar que o consultor CVM apresente análises
// inconsistentes ao cliente — ex: margem bruta negativa estrutural,
// distribuição de dividendos > lucro, Simples acima do limite.
//
// SSOT: função pura sobre AppState + DRE/Indicators já calculados quando
// disponíveis (evita recomputar engine no DiagnosisTab que já tem o model).
// ============================================================================
import { totalDividaOnerosa } from "./debtContracts";
import type { AppState } from "./types";
import { buildDRE, type DRE } from "./dre";
import { calcIndicators, type Indicators } from "./indicators";
import { folhaAnual, resolveEffectiveRegime } from "./regime";
import { getSimplesLimite, getFatorRMinimoPct } from "./taxDefaults";
import { sum } from "./format";
import { mediaMensal, mesesPreenchidos } from "./periodUtils";

export type Severity = "info" | "warn" | "error";
export type Category = "estrutural" | "fiscal" | "operacional";
/** Ponteiro para a aba/seção da UI — habilita deep-link no futuro. */
export type Location =
  | "receitas"
  | "custos"
  | "capital"
  | "tributos"
  | "caixa"
  | "governanca"
  | "dre"
  | "indicadores"
  | "resultados"
  | "simulador"
  | "valuation";

export interface ValidationWarning {
  /** ID estável (não mudar) — usado para dedupe, snooze futuro e tests. */
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  /** Texto curto explicando o problema, com valores reais. */
  detail: string;
  /** Sugestão acionável — o que o consultor deve revisar. */
  fixHint?: string;
  /** Aba para deep-link. */
  location?: Location;
}

/** Modelo precomputado opcional — evita rebuildar DRE/Indicators. */
export interface CrossValidateModel {
  dre?: DRE;
  ind?: Indicators;
}

/** Limites econômicos/legais usados nas validações. Centralizados para
 *  facilitar revisão (atualização da reforma tributária, etc.). */
const LIMITS = {
  /** Receita anual mínima para obrigatoriedade do Lucro Real (LC 14/2024). */
  LUCRO_REAL_OBRIG: 78_000_000,
  /** Dívida Líquida / EBITDA — limite de alavancagem perigosa. */
  DIV_EBITDA_MAX: 5,
  /** Ciclo financeiro máximo "saudável" (dias). */
  CICLO_MAX_DIAS: 180,
  /** PMR isolado considerado "longo demais" para revisar política comercial. */
  PMR_LONGO_DIAS: 90,
  /** Multiplicador do caixa mínimo sobre receita média mensal. */
  CAIXA_MIN_MULTI_EXCESSO: 3,
} as const;

/**
 * Roda todos os checks de validação cruzada e retorna a lista de warnings.
 * Ordenada por severidade (error → warn → info), depois por categoria.
 */
export function crossValidate(state: AppState, model?: CrossValidateModel): ValidationWarning[] {
  const regime = resolveEffectiveRegime(state);
  const dre = model?.dre ?? buildDRE(state, regime).dre;
  const ind = model?.ind ?? calcIndicators(state, dre);

  const out: ValidationWarning[] = [];
  out.push(...checkTier1Estrutural(state, dre, ind));
  out.push(...checkTier2Fiscal(state, dre));
  out.push(...checkTier3Operacional(state, dre, ind));

  // Ordena: error > warn > info, depois estrutural > fiscal > operacional
  const sevRank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  const catRank: Record<Category, number> = { estrutural: 0, fiscal: 1, operacional: 2 };
  return out.sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] || catRank[a.category] - catRank[b.category],
  );
}

// ─── TIER 1 — Erros estruturais ──────────────────────────────────────
function checkTier1Estrutural(state: AppState, dre: DRE, ind: Indicators): ValidationWarning[] {
  const out: ValidationWarning[] = [];
  const receitaBrutaAnual = sum(dre.receitaBruta);
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const cpvAnual = sum(dre.cpv);
  const ebitdaAnual = sum(dre.ebitda);
  const ll = sum(dre.lucroLiquido);
  const dividendos = sum(state.cashflow.dividendos);
  const folha = folhaAnual(state);

  // 1.1 Margem bruta estrutural negativa (CPV > Receita Líquida)
  // [Auditoria Bloco 9] Antes comparava com Receita Bruta — condição
  // excessivamente conservadora (RL = RB − impostos − devoluções ≤ RB).
  // Margem Bruta = (RL − CPV) / RL, então o teste correto é CPV > RL.
  if (receitaLiqAnual > 0 && cpvAnual > receitaLiqAnual) {
    out.push({
      id: "estrutural.margem_bruta_negativa",
      severity: "error",
      category: "estrutural",
      title: "Margem bruta estrutural negativa",
      detail: `CPV anual (R$ ${fmt(cpvAnual)}) excede a Receita Líquida (R$ ${fmt(receitaLiqAnual)}). Cada venda gera prejuízo bruto.`,
      fixHint:
        "Revise os valores de CPV/CMV/CSP na aba Custos ou aumente o preço de venda na aba Receitas.",
      location: "custos",
    });
  }

  // 1.2 Folha total > Receita Líquida (operação inviável)
  if (receitaLiqAnual > 0 && folha > receitaLiqAnual) {
    out.push({
      id: "estrutural.folha_maior_que_receita",
      severity: "error",
      category: "estrutural",
      title: "Folha total maior que a receita líquida",
      detail: `Folha anual com encargos (R$ ${fmt(folha)}) supera a Receita Líquida (R$ ${fmt(receitaLiqAnual)}).`,
      fixHint:
        "Verifique se há linhas de folha duplicadas, salários superdimensionados ou receita subestimada.",
      location: "custos",
    });
  }

  // 1.3 Capital de Giro Disponível > Ativo Total (impossível)
  const cgd = state.capital.capitalGiroDisponivel ?? 0;
  const at = state.capital.ativoTotal ?? 0;
  if (at > 0 && cgd > at) {
    out.push({
      id: "estrutural.cgd_maior_que_ativo",
      severity: "error",
      category: "estrutural",
      title: "Capital de Giro Disponível maior que o Ativo Total",
      detail: `CGD (R$ ${fmt(cgd)}) > Ativo Total (R$ ${fmt(at)}). Impossível por definição contábil.`,
      fixHint: "Revise os valores de Ativo Total e Capital de Giro Disponível na aba Capital.",
      location: "capital",
    });
  }

  // [Auditoria Bloco 3] 1.3.1 — Equação patrimonial: Ativo Total ≥ PL + Dívida Onerosa + Passivo Circulante.
  // Não conseguimos validar Ativo = Passivo + PL com igualdade (faltam campos de PNC operacional no schema),
  // mas o lado direito JAMAIS pode exceder o Ativo Total em >5% (tolerância p/ campos parciais).
  const plCap = Math.max(0, state.capital.patrimonioLiquido || 0);
  const divOn = Math.max(0, totalDividaOnerosa(state));
  const pCirc = Math.max(0, state.capital.passivoCirculante || 0);
  if (at > 0) {
    const ladoDireito = plCap + divOn + pCirc;
    if (ladoDireito > at * 1.05) {
      out.push({
        id: "estrutural.equacao_patrimonial_desbalanceada",
        severity: "error",
        category: "estrutural",
        title: "Equação patrimonial desbalanceada",
        detail: `PL + Dívida Onerosa + Passivo Circulante (R$ ${fmt(ladoDireito)}) excede o Ativo Total (R$ ${fmt(at)}) em mais de 5%. Pela Lei 6.404/76 art. 178, Ativo = Passivo + PL.`,
        fixHint:
          "Revise PL, Dívida Onerosa, Passivo Circulante e Ativo Total na aba Capital — algum valor está duplicado ou faltando.",
        location: "capital",
      });
    }
    if (plCap > at) {
      out.push({
        id: "estrutural.pl_maior_que_ativo",
        severity: "error",
        category: "estrutural",
        title: "Patrimônio Líquido maior que o Ativo Total",
        detail: `PL (R$ ${fmt(plCap)}) > Ativo Total (R$ ${fmt(at)}). Só possível se passivo for negativo (impossível contabilmente).`,
        fixHint: "Confira PL e Ativo Total na aba Capital — provável digitação invertida.",
        location: "capital",
      });
    }
  }


  // 1.4 Dividendos > Lucro Líquido projetado (distribuição além do permitido)
  if (dividendos > 0 && dividendos > ll) {
    const detail =
      ll <= 0
        ? `Distribuição de R$ ${fmt(dividendos)} com Lucro Líquido projetado ${ll < 0 ? "NEGATIVO" : "zero"} (R$ ${fmt(ll)}). Vedado pela Lei 6.404/76 art. 201 (salvo reservas).`
        : `Dividendos (R$ ${fmt(dividendos)}) superam o Lucro Líquido projetado (R$ ${fmt(ll)}).`;
    out.push({
      id: "estrutural.dividendos_maior_que_ll",
      severity: "error",
      category: "estrutural",
      title: "Dividendos excedem o Lucro Líquido",
      detail,
      fixHint:
        "Reduza a distribuição na aba Caixa ou use reservas de lucros acumulados (não modeladas aqui).",
      location: "caixa",
    });
  }

  // 1.5 ROIC < WACC — destruição de valor (econômico, não contábil)
  if (
    Number.isFinite(ind.roic) &&
    Number.isFinite(ind.wacc) &&
    ind.wacc > 0 &&
    ind.roic < ind.wacc
  ) {
    out.push({
      id: "estrutural.roic_menor_que_wacc",
      severity: "warn",
      category: "estrutural",
      title: "Empresa destrói valor econômico",
      detail: `ROIC ${ind.roic.toFixed(1)}% < WACC ${ind.wacc.toFixed(1)}%. O capital investido não cobre o custo de oportunidade.`,
      fixHint: "Reduza Capital Investido (estoques, contas a receber) ou aumente NOPAT via margem.",
      location: "indicadores",
    });
  }

  return out;
}

// ─── TIER 2 — Inconsistências fiscais ────────────────────────────────
function checkTier2Fiscal(state: AppState, dre: DRE): ValidationWarning[] {
  const out: ValidationWarning[] = [];
  const { tax } = state;
  const rbt12 = sum(dre.receitaBruta); // RBT12 derivado da receita bruta anual
  const folha = folhaAnual(state);
  const limiteSimples = getSimplesLimite(tax);

  // 2.1 Simples + RBT12 acima do limite → desenquadramento obrigatório
  if (tax.regime === "simples" && rbt12 > limiteSimples) {
    out.push({
      id: "fiscal.simples_acima_limite",
      severity: "error",
      category: "fiscal",
      title: "Simples Nacional acima do limite — desenquadramento obrigatório",
      detail: `RBT12 derivado (R$ ${fmt(rbt12)}) excede o limite de R$ ${fmt(limiteSimples)}. LC 123/2006 art. 3º §9º.`,
      fixHint:
        "Migre para Lucro Presumido ou Real na aba Tributos — o app já calcula regime efetivo automaticamente, mas a configuração nominal está incorreta.",
      location: "tributos",
    });
  }

  // 2.2 Lucro Real "obrigatório" sub-utilizado: receita < R$ 78M mas configurado Real
  // (info, não erro — pode haver outra obrigatoriedade)
  if (tax.regime === "real" && rbt12 > 0 && rbt12 < LIMITS.LUCRO_REAL_OBRIG) {
    out.push({
      id: "fiscal.real_sem_obrigatoriedade",
      severity: "info",
      category: "fiscal",
      title: "Lucro Real opcional",
      detail: `Receita anual (R$ ${fmt(rbt12)}) abaixo do limite de obrigatoriedade do Lucro Real (R$ ${fmt(LIMITS.LUCRO_REAL_OBRIG)}). Empresa poderia optar por Presumido.`,
      fixHint:
        "Compare cargas tributárias entre Real e Presumido na aba Tributos. Real só vale a pena com margem baixa ou muitos créditos.",
      location: "tributos",
    });
  }

  // 2.3 Fator R automático desligado com folha alta o suficiente para mudar de anexo
  if (
    tax.regime === "simples" &&
    tax.simplesAnexo === "V" &&
    !tax.fatorRAuto &&
    rbt12 > 0 &&
    folha / rbt12 >= getFatorRMinimoPct(tax) / 100
  ) {
    out.push({
      id: "fiscal.fator_r_desativado",
      severity: "warn",
      category: "fiscal",
      title: "Fator R desativado com folha qualificante",
      detail: `Folha/RBT12 = ${((folha / rbt12) * 100).toFixed(1)}% (≥ 28%). Com Fator R automático ativado, o anexo migraria de V para III — alíquota menor.`,
      fixHint: "Ative 'Fator R automático' na aba Tributos para usar o Anexo III.",
      location: "tributos",
    });
  }

  // 2.4 ISS deduções acima de 50% — sinaliza para revisão (limite legal varia por município)
  const issDed = tax.issDeducoes ?? 0;
  const baseIss = rbt12 * ((tax.issIcms ?? 0) / 100);
  if (state.businessType === "servicos" && issDed > 0 && baseIss > 0 && issDed > baseIss * 0.5) {
    out.push({
      id: "fiscal.iss_deducao_excessiva",
      severity: "info",
      category: "fiscal",
      title: "Dedução de ISS acima de 50% da base",
      detail: `Deduções de ISS (R$ ${fmt(issDed)}/ano) representam >${((issDed / baseIss) * 100).toFixed(0)}% da base. Lei 116/2003 art. 7º §2º só permite materiais e subempreitada — varia por município.`,
      fixHint:
        "Confirme com o cliente a comprovação documental de materiais/subempreitada antes de apresentar a economia.",
      location: "tributos",
    });
  }

  return out;
}

// ─── TIER 3 — Inconsistências operacionais ───────────────────────────
function checkTier3Operacional(state: AppState, dre: DRE, ind: Indicators): ValidationWarning[] {
  const out: ValidationWarning[] = [];
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const ebitdaAnual = sum(dre.ebitda);

  // 3.1 PMR longo com estoque zerado e receita concentrada (vendas pontuais a prazo)
  // [Auditoria Bloco 9] === 0 era frágil em floats; usa < R$ 1 como "praticamente zero".
  const pmrMedio = state.revenue.pmr ?? 0;
  const estoqueTotal = (state.capital.estoques ?? 0) + (state.capital.estoqueFinal ?? 0);
  if (pmrMedio > LIMITS.PMR_LONGO_DIAS && estoqueTotal < 1 && receitaConcentrada(state)) {
    out.push({
      id: "operacional.pmr_longo_estoque_zero",
      severity: "warn",
      category: "operacional",
      title: "PMR longo com estoque zerado e receita concentrada",
      detail: `PMR de ${pmrMedio} dias sem estoque e com receita concentrada em poucos meses sugere vendas pontuais a prazo — risco de inadimplência alto.`,
      fixHint: "Revise a política de crédito ou exija sinal/garantia para vendas grandes.",
      location: "receitas",
    });
  }

  // 3.2 Ciclo financeiro insustentável (> 180 dias)
  if (Number.isFinite(ind.cicloFinanceiro) && ind.cicloFinanceiro > LIMITS.CICLO_MAX_DIAS) {
    out.push({
      id: "operacional.ciclo_insustentavel",
      severity: "warn",
      category: "operacional",
      title: "Ciclo financeiro insustentável",
      detail: `Ciclo = PMR + PME − PMP = ${ind.cicloFinanceiro.toFixed(0)} dias (> ${LIMITS.CICLO_MAX_DIAS}). Cada R$ 1 de receita gera necessidade prolongada de capital de giro.`,
      fixHint:
        "Negocie prazo com fornecedores (PMP↑), reduza estoque médio (PME↓) ou encurte prazo de recebimento (PMR↓).",
      location: "indicadores",
    });
  }

  // 3.3 Dívida Líquida / EBITDA > 5× (alto risco)
  if (
    Number.isFinite(ind.dividaLiqEbitda) &&
    ebitdaAnual > 0 &&
    ind.dividaLiqEbitda > LIMITS.DIV_EBITDA_MAX
  ) {
    out.push({
      id: "operacional.alavancagem_alta",
      severity: "warn",
      category: "operacional",
      title: "Alavancagem financeira em zona crítica",
      detail: `Dívida Líquida / EBITDA = ${ind.dividaLiqEbitda.toFixed(1)}× (> ${LIMITS.DIV_EBITDA_MAX}×). Cobertura insuficiente para servir a dívida com geração operacional.`,
      fixHint:
        "Renegocie alongamento de dívida ou capitalize via aporte de sócios — modelado na aba Caixa.",
      location: "capital",
    });
  }

  // 3.4 CAPEX anual > max(EBITDA, 0) — queima estrutural se EBITDA não cobre investimento
  const capexAnual = sum(state.cashflow.capex);
  const ebitdaCobertura = Math.max(ebitdaAnual, 0);
  if (capexAnual > 0 && capexAnual > ebitdaCobertura) {
    const detailEbitda =
      ebitdaAnual > 0
        ? `> EBITDA (R$ ${fmt(ebitdaAnual)})`
        : `com EBITDA ${ebitdaAnual < 0 ? "NEGATIVO" : "zero"} (R$ ${fmt(ebitdaAnual)})`;
    out.push({
      id: "operacional.capex_maior_que_ebitda",
      severity: "warn",
      category: "operacional",
      title: "CAPEX não coberto pela geração operacional",
      detail: `CAPEX anual (R$ ${fmt(capexAnual)}) ${detailEbitda}. Sem captação ou aporte, queima de caixa estrutural.`,
      fixHint:
        "Verifique se há aportes/empréstimos suficientes na aba Caixa para financiar o investimento.",
      location: "caixa",
    });
  }

  // 3.5 Caixa mínimo excessivo (> 3× receita média mensal)
  // Usa meses efetivamente preenchidos para não subestimar a média quando
  // o ano corrente está parcial (ex: análise em Mar com só Jan-Mar de receita).
  const mesesOp = mesesPreenchidos(state.revenue.bruta);
  const receitaMediaMensal = mediaMensal(receitaLiqAnual, mesesOp);
  const caixaMin = state.cashflow.caixaMinimo ?? 0;
  if (receitaMediaMensal > 0 && caixaMin > receitaMediaMensal * LIMITS.CAIXA_MIN_MULTI_EXCESSO) {
    out.push({
      id: "operacional.caixa_minimo_excessivo",
      severity: "info",
      category: "operacional",
      title: "Caixa mínimo possivelmente excessivo",
      detail: `Caixa mínimo (R$ ${fmt(caixaMin)}) é ${(caixaMin / receitaMediaMensal).toFixed(1)}× a receita média mensal. Capital parado deixa de gerar retorno.`,
      fixHint:
        "Reduza o caixa mínimo ou aplique o excesso em renda fixa (rendimento na aba Receitas).",
      location: "caixa",
    });
  }

  return out;
}

// ─── Utilitários ─────────────────────────────────────────────────────

/** Receita está "concentrada" quando >40% do total anual sai de um único mês. */
function receitaConcentrada(state: AppState): boolean {
  const total = sum(state.revenue.bruta);
  if (total <= 0) return false;
  const max = Math.max(...state.revenue.bruta);
  return max / total > 0.4;
}

/** Format BRL inline sem dependência de locale para tests/server. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString("pt-BR");
}

/** Agrupa por severidade — útil para UI. */
export function groupBySeverity(
  warnings: ValidationWarning[],
): Record<Severity, ValidationWarning[]> {
  return {
    error: warnings.filter((w) => w.severity === "error"),
    warn: warnings.filter((w) => w.severity === "warn"),
    info: warnings.filter((w) => w.severity === "info"),
  };
}
