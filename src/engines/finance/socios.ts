/**
 * socios.ts — Pró-labore × Distribuição de Lucros (Plano v3).
 *
 * Engine pura. Sem React, sem UI. Calcula:
 *  - INSS sócio (contribuinte individual, plano simplificado, limitado ao teto)
 *  - INSS patronal (20% Presumido/Real; zero Simples salvo Anexo IV)
 *  - IRPF mensal (escolhe automaticamente tradicional × simplificado)
 *  - Limite de distribuição isenta (Presumido sem escrituração: base presunção − tributos)
 *  - Otimização do mix pró-labore × distribuição (analítico Simples; ternário Presumido/Real)
 *  - Sincronização SSOT com linhas system em `state.costs` (sem invadir o pipeline)
 *
 * Toda alíquota/tabela é lida via getters de taxDefaults — ZERO hardcode aqui.
 */
import type {
  AppState,
  CostLine,
  Months,
  SocioRetirada,
  TaxConfig,
  TaxRegime,
} from "./types";
import {
  getInssSocioAliq,
  getInssTeto,
  getInssPatronalAliq,
  getInssPatronalSimples,
  getIrpfTable,
  getIrpfDependenteDeducao,
  getIrpfDescontoSimplificado,
  getIrpfSimplificadoAuto,
  getDistribuicaoLimitePresumidoAuto,
  getSalarioMinimo,
  getPresumidoBases,
  getIrpjPct,
  getIrpjAdicionalPct,
  getIrpjAdicionalGatilhoTri,
  getCsllPct,
  getPisCumPct,
  getCofinsCumPct,
} from "./taxDefaults";
import { sum } from "./format";
import { coerceMonths } from "./safeMath";
import { redutorLei15270 } from "@/engines/calculadoras/rescisao";

// IDs reservados para linhas sintéticas em state.costs.
export const SOCIOS_PROLABORE_LINE_ID = "__socios_prolabore__";
export const SOCIOS_PATRONAL_LINE_ID = "__socios_inss_patronal__";

// =====================================================================
// Retenção de dividendos — Lei 15.270/2025, vigente 2026+
// =====================================================================
/** Limite mensal: distribuição da MESMA PJ à MESMA PF sem retenção. */
export const DIVIDENDO_RETENCAO_LIMITE_MENSAL = 50_000;
/** Alíquota de retenção sobre o TOTAL distribuído no mês quando excede o limite. */
export const DIVIDENDO_RETENCAO_ALIQ = 0.1;
/** Renda anual do sócio a partir da qual o IRPF Mínimo (IRPFM) pode incidir. */
export const IRPFM_ALERTA_RENDA_ANUAL = 600_000;

/**
 * Retenção de 10% sobre o TOTAL distribuído no mês quando ultrapassa
 * R$ 50 mil (não incide apenas sobre o excedente).
 * Antecipação do IRPF Mínimo anual — Lei 15.270/2025, vigente 2026+.
 */
export function calcRetencaoDividendosMensal(totalDistribuidoMensal: number): number {
  if (totalDistribuidoMensal <= DIVIDENDO_RETENCAO_LIMITE_MENSAL) return 0;
  return totalDistribuidoMensal * DIVIDENDO_RETENCAO_ALIQ;
}

export interface SocioCalcResult {
  socioId: string;
  prolaboreMensal: number;
  /** INSS retido do sócio (contribuinte individual). */
  inssSocio: number;
  /** Cota patronal de INSS — custo da PJ (Presumido/Real apenas, salvo flag). */
  inssPatronal: number;
  /** IRPF mensal devido — após escolher tradicional × simplificado (auto). */
  irpfMensal: number;
  /** Modo de IRPF efetivamente aplicado. */
  irpfModo: "tradicional" | "simplificado";
  /** Distribuição isenta de IR (dentro do limite). */
  distribuicaoIsentaMensal: number;
  /** Distribuição além do limite (tributável como rendimento comum no sócio). */
  distribuicaoTributavelMensal: number;
  /** Retenção 10% (Lei 15.270/25) sobre o total distribuído no mês quando > R$ 50k. */
  retencaoDividendosMensal: number;
  /** true quando distribuição anualizada > R$ 600k (potencial IRPFM). */
  alertaIRPFM: boolean;
  /** Líquido mensal ao sócio: (prolab − INSS − IRPF) + distribuição isenta + tributável líquido − retenção. */
  liquidoSocio: number;
  /** Custo total para a PJ no mês: prolab + INSS patronal. */
  custoTotalPJ: number;
}

const fill12 = (n: number): Months =>
  [n, n, n, n, n, n, n, n, n, n, n, n] as Months;

// =====================================================================
// INSS sócio — contribuinte individual (plano simplificado)
// =====================================================================
export function calcInssSocio(prolaboreMensal: number, tax: TaxConfig): number {
  if (prolaboreMensal <= 0) return 0;
  const aliq = getInssSocioAliq(tax) / 100;
  const teto = getInssTeto(tax);
  const base = Math.min(prolaboreMensal, teto);
  return base * aliq;
}

// =====================================================================
// INSS patronal — 20% sobre pró-labore (Presumido/Real)
// =====================================================================
export function calcInssPatronal(
  prolaboreMensal: number,
  regime: TaxRegime,
  tax: TaxConfig,
): number {
  if (prolaboreMensal <= 0) return 0;
  // Simples Nacional: CPP já no DAS (exceto Anexo IV via flag).
  if (regime === "simples" && !getInssPatronalSimples(tax)) return 0;
  return prolaboreMensal * (getInssPatronalAliq(tax) / 100);
}

// =====================================================================
// IRPF mensal — escolhe automaticamente tradicional × simplificado
// =====================================================================
function irpfPorTabela(base: number, tax: TaxConfig): number {
  if (base <= 0) return 0;
  const tabela = getIrpfTable(tax);
  for (const [teto, aliq, deduzir] of tabela) {
    if (base <= teto) return Math.max(0, base * (aliq / 100) - deduzir);
  }
  // Acima de todas faixas (não deveria ocorrer — última faixa é Infinity)
  const last = tabela[tabela.length - 1];
  return Math.max(0, base * (last[1] / 100) - last[2]);
}

export function calcIrpfMensal(
  prolaboreMensal: number,
  inssSocio: number,
  dependentes: number,
  outrasDeducoes: number,
  tax: TaxConfig,
): { valor: number; modo: "tradicional" | "simplificado" } {
  if (prolaboreMensal <= 0) return { valor: 0, modo: "tradicional" };
  const deducaoDep = getIrpfDependenteDeducao(tax);
  // Tradicional: prolab − INSS − dependentes − outras.
  const baseTrad =
    prolaboreMensal - inssSocio - dependentes * deducaoDep - outrasDeducoes;
  const irpfTrad = irpfPorTabela(Math.max(0, baseTrad), tax);

  // Redutor Lei 15.270/2025 — aplica-se sobre o rendimento tributável bruto
  // do mês (pró-labore); nunca gera IR negativo.
  const aplicarRedutor = (ir: number): number =>
    Math.max(0, ir - redutorLei15270(prolaboreMensal, ir));

  if (!getIrpfSimplificadoAuto(tax)) {
    return { valor: aplicarRedutor(irpfTrad), modo: "tradicional" };
  }

  // Simplificado (Lei 14.973/2024): prolab − desconto único (sem outras deduções).
  const descSimp = getIrpfDescontoSimplificado(tax);
  const baseSimp = prolaboreMensal - descSimp;
  const irpfSimp = irpfPorTabela(Math.max(0, baseSimp), tax);

  return irpfSimp < irpfTrad
    ? { valor: aplicarRedutor(irpfSimp), modo: "simplificado" }
    : { valor: aplicarRedutor(irpfTrad), modo: "tradicional" };
}

// =====================================================================
// Limite de distribuição isenta — Presumido sem escrituração
// =====================================================================
/**
 * Retorna o teto MENSAL de distribuição isenta. Quando o usuário marca
 * `distribuicaoLimitePresumidoAuto=false`, assume escrituração contábil
 * completa (RIR/2018 art. 238) → retorna Infinity (sem teto regulatório).
 *
 * Para Lucro Real, default = Infinity (escrituração já é exigida).
 * Para Simples, default = Infinity (RBT × percentuais — a engine simplifica).
 */
export function calcDistribuicaoIsentaLimite(
  state: AppState,
  regime: TaxRegime,
): number {
  const { tax } = state;
  if (regime !== "presumido") return Number.POSITIVE_INFINITY;
  if (!getDistribuicaoLimitePresumidoAuto(tax)) return Number.POSITIVE_INFINITY;

  // Base de presunção mensal × (1 − IRPJ − CSLL − PIS − COFINS) — proxy do
  // "lucro presumido disponível" para distribuição isenta sem escrituração.
  const receitaBrutaAno = sum(state.revenue.bruta);
  const bases = getPresumidoBases(tax, state.businessType);
  const basePresumida = receitaBrutaAno * (bases.irpj / 100); // base IRPJ anual (proxy)
  // Tributos federais sobre essa base (aprox; superestima ligeiramente):
  const tributosFed =
    basePresumida * ((getIrpjPct(tax) + getCsllPct(tax)) / 100) +
    receitaBrutaAno * ((getPisCumPct(tax) + getCofinsCumPct(tax)) / 100);
  // Adicional IRPJ (10%) sobre o excedente trimestral acima do gatilho
  // (R$ 60k/trim por padrão). Sem isso, o teto de distribuição isenta fica
  // SUPERESTIMADO em empresas com lucro alto — o adicional já saiu do caixa.
  const baseTri = basePresumida / 4;
  const gatilhoTri = getIrpjAdicionalGatilhoTri(tax);
  const adicionalIrpjAno =
    Math.max(0, baseTri - gatilhoTri) * (getIrpjAdicionalPct(tax) / 100) * 4;
  const disponivelAno = Math.max(0, basePresumida - tributosFed - adicionalIrpjAno);
  return disponivelAno / 12;
}

/**
 * Detalhamento do teto de distribuição isenta — útil para tooltip/UI.
 * Mostra como o adicional IRPJ (10% sobre lucro trimestral > gatilho) reduz
 * o "lucro disponível para distribuição isenta sem escrituração".
 */
export function calcDistribuicaoIsentaBreakdown(state: AppState, regime: TaxRegime) {
  const { tax } = state;
  const receitaBrutaAno = sum(state.revenue.bruta);
  const bases = getPresumidoBases(tax, state.businessType);
  const basePresumida = receitaBrutaAno * (bases.irpj / 100);
  const tributosFed =
    basePresumida * ((getIrpjPct(tax) + getCsllPct(tax)) / 100) +
    receitaBrutaAno * ((getPisCumPct(tax) + getCofinsCumPct(tax)) / 100);
  const baseTri = basePresumida / 4;
  const gatilhoTri = getIrpjAdicionalGatilhoTri(tax);
  const adicionalIrpjAno =
    Math.max(0, baseTri - gatilhoTri) * (getIrpjAdicionalPct(tax) / 100) * 4;
  const limiteMensal = calcDistribuicaoIsentaLimite(state, regime);
  return { basePresumida, tributosFed, adicionalIrpjAno, baseTri, gatilhoTri, limiteMensal };
}

// =====================================================================
// Distribuição REALIZADA — fonte da verdade para DRE/DFC/Balanço
// =====================================================================
/** Retorna o array de 12 meses de distribuição realizada (default zero). */
export function getDistribuicaoRealizadaMeses(state: AppState): Months {
  const dr = state.distribuicaoRealizada;
  if (!dr || !Array.isArray(dr.values)) {
    return fill12(0);
  }
  const values = coerceMonths(dr.values);
  return (dr.fixed ? fill12(values[0] ?? 0) : values) as Months;
}

/** Distribuição mensal MÉDIA realizada (R$/mês) — útil para cálculo do IRPF
 *  excedente quando o usuário escolhe usar média anual. */
export function getDistribuicaoRealizadaMediaMensal(state: AppState): number {
  const arr = getDistribuicaoRealizadaMeses(state);
  return arr.reduce((a, b) => a + b, 0) / 12;
}

// =====================================================================
// Cálculo completo de um sócio
// =====================================================================
export function calcRetiradaSocio(
  socio: SocioRetirada,
  state: AppState,
  regime: TaxRegime,
  /** Lucro distribuível mensal disponível (proporcional à participação). */
  distribuicaoMensalDisponivel: number,
): SocioCalcResult {
  const tax = state.tax;
  const prolab = Math.max(0, socio.prolaboreMensal);
  const inssSocio = calcInssSocio(prolab, tax);
  const inssPatronal = calcInssPatronal(prolab, regime, tax);
  const { valor: irpfMensal, modo: irpfModo } = calcIrpfMensal(
    prolab,
    inssSocio,
    socio.dependentes,
    socio.outrasDeducoes,
    tax,
  );

  // Distribuição (proporcional à participação do sócio).
  // O limite calculado é da EMPRESA; para avaliar cada sócio, aplica-se a
  // participação societária. Sem esse rateio, dois sócios poderiam consumir o
  // mesmo teto integral e subestimar a parcela tributável.
  const limiteEmpresa = calcDistribuicaoIsentaLimite(state, regime);
  const limiteIsento = Number.isFinite(limiteEmpresa)
    ? limiteEmpresa * (Math.max(0, socio.participacaoPct) / 100)
    : limiteEmpresa;
  const distSocio = Math.max(0, distribuicaoMensalDisponivel);
  const distIsenta = Math.min(distSocio, limiteIsento);
  const distExcedente = Math.max(0, distSocio - distIsenta);
  // IRPF sobre excedente — alíquota máxima (27,5%) por simplificação; o sócio
  // somaria à renda anual. Para refinamento futuro: usar tabela anual.
  const tabela = getIrpfTable(tax);
  const aliqTopo = tabela[tabela.length - 1][1] / 100;
  const irpfDistExcedente = distExcedente * aliqTopo;

  const liquidoSocio =
    prolab - inssSocio - irpfMensal + distIsenta + (distExcedente - irpfDistExcedente);
  const custoTotalPJ = prolab + inssPatronal;

  return {
    socioId: socio.id,
    prolaboreMensal: prolab,
    inssSocio,
    inssPatronal,
    irpfMensal,
    irpfModo,
    distribuicaoIsentaMensal: distIsenta,
    distribuicaoTributavelMensal: distExcedente,
    liquidoSocio,
    custoTotalPJ,
  };
}

// =====================================================================
// Otimização — minimiza carga total (INSS sócio + patronal + IRPF)
// =====================================================================
/**
 * Encontra o pró-labore ótimo para um sócio dado o total a retirar
 * (prolab + distribuição). Em Simples sem patronal, o ótimo é o piso.
 * Em Presumido/Real, usa busca ternária no intervalo [piso, totalRetirada].
 */
export function otimizarProLabore(
  socio: SocioRetirada,
  totalRetiradaMensal: number,
  state: AppState,
  regime: TaxRegime,
): number {
  const tax = state.tax;
  const piso = socio.operacional ? getSalarioMinimo(tax) : 0;
  const hi = Math.max(piso, totalRetiradaMensal);
  if (hi <= piso) return piso;

  // Atalho Simples sem patronal: 100% dos encargos extras são prejuízo →
  // pró-labore mínimo (piso) é sempre ótimo.
  const hasPatronal = calcInssPatronal(100, regime, tax) > 0;
  if (!hasPatronal) return piso;

  // Custo "para o caixa do sócio + PJ" ao escolher pró-labore = p.
  const custoTotal = (p: number): number => {
    const inssS = calcInssSocio(p, tax);
    const inssP = calcInssPatronal(p, regime, tax);
    const { valor: irpf } = calcIrpfMensal(
      p,
      inssS,
      socio.dependentes,
      socio.outrasDeducoes,
      tax,
    );
    return inssS + inssP + irpf;
  };

  // Busca ternária (função aprox. convexa em p, com saltos nas faixas).
  let lo = piso;
  let hiB = hi;
  for (let i = 0; i < 60 && hiB - lo > 0.5; i++) {
    const m1 = lo + (hiB - lo) / 3;
    const m2 = hiB - (hiB - lo) / 3;
    if (custoTotal(m1) < custoTotal(m2)) hiB = m2;
    else lo = m1;
  }
  return Math.round((lo + hiB) / 2);
}

// =====================================================================
// Sincronização SSOT — `state.socios` → linhas system em `state.costs`
// =====================================================================
/**
 * Upserta linhas sintéticas `__socios_prolabore__` e `__socios_inss_patronal__`
 * em `state.costs` a partir de `state.socios`. Chamada após qualquer CRUD em
 * sócios para que TODOS os consumers (DRE, balanço, forecast, simulator,
 * sensitivity, montecarlo) enxerguem o pró-labore como custo normal.
 *
 * Não invade o pipeline da engine: mantém SSOT em `state.costs`.
 */
export function syncSociosToCosts(state: AppState, regime: TaxRegime): AppState {
  const socios = state.socios ?? [];
  const prolaboreMensal = socios.reduce((acc, s) => acc + Math.max(0, s.prolaboreMensal), 0);
  const patronalMensal = socios.reduce(
    (acc, s) => acc + calcInssPatronal(Math.max(0, s.prolaboreMensal), regime, state.tax),
    0,
  );

  // Remove linhas system anteriores E linhas legadas com id="prolabore" ou label
  // "Pró-labore (sócios)" (defesa contra seeds/duplicatas de states persistidos).
  const semSystem = state.costs.filter((c) => {
    if (c.id === SOCIOS_PROLABORE_LINE_ID || c.id === SOCIOS_PATRONAL_LINE_ID) return false;
    // [SSOT] Seed legado — pró-labore agora vem SÓ de `state.socios`.
    if (c.id === "prolabore") return false;
    if (c.label === "Pró-labore (sócios)" || c.label === "INSS Patronal sócios") {
      return false;
    }
    return true;
  });
  const novas: CostLine[] = [];
  if (prolaboreMensal > 0) {
    novas.push({
      id: SOCIOS_PROLABORE_LINE_ID,
      label: "Pró-labore (sócios)",
      category: "despesa_administrativa",
      values: fill12(prolaboreMensal),
      fixed: true,
      comportamento: "fixo",
      system: true,
    });
  }
  if (patronalMensal > 0) {
    novas.push({
      id: SOCIOS_PATRONAL_LINE_ID,
      label: "INSS Patronal sócios",
      category: "despesa_administrativa",
      values: fill12(patronalMensal),
      fixed: true,
      comportamento: "fixo",
      system: true,
    });
  }
  return { ...state, costs: [...semSystem, ...novas] };
}

/**
 * Helper de mutação SSOT: aplica nova lista de sócios E reconcilia
 * `state.costs`. Use sempre que a UI alterar sócios.
 */
export function applySociosChange(
  state: AppState,
  novosSocios: SocioRetirada[],
  regime: TaxRegime,
): AppState {
  return syncSociosToCosts({ ...state, socios: novosSocios }, regime);
}
