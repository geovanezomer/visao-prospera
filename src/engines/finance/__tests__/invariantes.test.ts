// Invariantes do motor em estados aleatórios (semente fixa, reprodutível).
//
// Para cada estado: a DRE fecha linha a linha, a DFC acumula sem salto, o
// balanço de fechamento conserva a diferença da abertura (o ano não cria nem
// destrói valor), tributos não são negativos e somam o total, o cálculo é
// puro (não altera o estado e repete o resultado) e o simulador neutro não
// muda nada. INVARIANTES_N define a quantidade (padrão 2.000; o plano de
// qualidade roda com 10.000).
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { buildFinancialModel } from "../financialModel";
import { deriveAbertura } from "../aberturaDerivada";
import { applySimulator, DEFAULT_SIM } from "../simulator";
import { payDownDebt } from "../levers/primitives";
import type { AppState, BusinessType, CostLine, DebtContract, TaxRegime } from "../types";

const N = Number(process.env.INVARIANTES_N ?? 2000);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIAS: CostLine["category"][] = [
  "custo_vendas",
  "direto_venda",
  "despesa_administrativa",
  "despesa_comercial",
  "financeiro",
];
const ROTULOS = [
  "Insumos",
  "Mercadorias",
  "Salários",
  "Aluguel",
  "Energia elétrica",
  "Marketing",
  "Juros bancários",
  "Pró-labore",
  "Frete",
  "Software",
];
const REGIMES: TaxRegime[] = ["simples", "presumido", "real"];
const NEGOCIOS: BusinessType[] = ["comercio", "industria", "servicos"];

function estadoAleatorio(seed: number): AppState {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const base = createState();
  const nivel = 10_000 + rnd() * 490_000;
  const sazonal = rnd() < 0.5;
  const bruta = Array.from({ length: 12 }, (_, i) =>
    Math.round(nivel * (sazonal ? 0.6 + 0.8 * Math.abs(Math.sin(i + seed)) : 0.9 + 0.2 * rnd())),
  );
  const costs: CostLine[] = Array.from({ length: 2 + Math.floor(rnd() * 8) }, (_, k) => {
    const label = pick(ROTULOS);
    const fixed = rnd() < 0.5;
    const v = Math.round(nivel * (0.02 + rnd() * 0.25));
    return {
      id: `c${k}`,
      label,
      category: pick(CATEGORIAS),
      values: fixed ? Array(12).fill(v) : bruta.map((b) => Math.round(b * (v / nivel))),
      fixed,
      encargosAuto: label === "Salários" && rnd() < 0.7,
      semCredito: rnd() < 0.1,
    };
  });
  const contratos: DebtContract[] = Array.from({ length: Math.floor(rnd() * 3) }, (_, k) => ({
    id: `d${k}`,
    credor: "Banco",
    saldoDevedor: Math.round(nivel * rnd() * 6),
    taxaAA: 8 + rnd() * 30,
    sistema: rnd() < 0.5 ? "price" : "sac",
    prazoMeses: 6 + Math.floor(rnd() * 54),
  }));
  const estado: AppState = {
    ...base,
    businessType: pick(NEGOCIOS),
    revenue: { ...base.revenue, bruta, pmr: Math.floor(rnd() * 90), pmp: Math.floor(rnd() * 90) },
    costs,
    tax: {
      ...base.tax,
      regime: pick(REGIMES),
      era: pick(["atual", "transicao", "pleno"] as const),
      prejuizoFiscalAcumuladoAbertura: rnd() < 0.3 ? Math.round(nivel * rnd() * 3) : 0,
    },
    capital: {
      ...base.capital,
      debtContracts: contratos,
      disponibilidades: Math.round(nivel * rnd() * 2),
    },
  };
  // 1 em 5 estados quita parte da dívida no mês 1 (alavanca do prescritivo).
  return contratos.length && rnd() < 0.2 ? payDownDebt(estado, rnd()) : estado;
}

const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);
const perto = (a: number, b: number, escala: number) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, escala);

type Falha = { seed: number; regra: string; detalhe: string };

function verificar(seed: number): Falha[] {
  const s = estadoAleatorio(seed);
  const copia = JSON.stringify(s);
  const falhas: Falha[] = [];
  const f = (regra: string, detalhe: string) => falhas.push({ seed, regra, detalhe });
  const m = buildFinancialModel(s);
  const { dre, cf, tax } = m;
  const escala = soma(s.revenue.bruta);

  for (let i = 0; i < 12; i++) {
    const rl =
      dre.receitaBruta[i] -
      dre.deducoesInadimplencia[i] -
      dre.outrasDeducoes[i] -
      dre.impostosVendas[i];
    if (!perto(dre.receitaLiquida[i], rl, escala)) f("DRE receita líquida", `mês ${i}`);
    if (!perto(dre.lucroBruto[i], dre.receitaLiquida[i] - dre.cpv[i], escala))
      f("DRE lucro bruto", `mês ${i}`);
    if (!perto(dre.ebit[i], dre.ebitda[i] - dre.depreciacao[i], escala)) f("DRE EBIT", `mês ${i}`);
    const lair = dre.ebit[i] + dre.resultadoFinanceiro[i] + dre.resultadoNaoOperacional[i];
    if (!perto(dre.lair[i], lair, escala)) f("DRE LAIR", `mês ${i}: ${dre.lair[i]} × ${lair}`);
    if (!perto(dre.lucroLiquido[i], dre.lair[i] - dre.impostos[i], escala))
      f("DRE lucro líquido", `mês ${i}`);

    if (!perto(cf.saldoFinal[i], cf.saldoInicial[i] + cf.variacaoCaixa[i], escala))
      f("DFC saldo do mês", `mês ${i}`);
    if (i > 0 && !perto(cf.saldoInicial[i], cf.saldoFinal[i - 1], escala))
      f("DFC continuidade", `mês ${i}`);
    const fluxos = cf.fluxoOperacional[i] + cf.fluxoInvestimento[i] + cf.fluxoFinanciamento[i];
    if (!perto(cf.variacaoCaixa[i], fluxos + (cf.permutasLiquido?.[i] ?? 0), escala))
      f("DFC variação = FCO + FCI + FCF", `mês ${i}`);
    if (tax.monthly[i] < -1e-9) f("Tributo negativo", `mês ${i}: ${tax.monthly[i]}`);
  }
  if (!perto(soma(tax.monthly), tax.annual, escala)) f("Tributos: meses = ano", "");

  const abertura = deriveAbertura({ state: s, impostosTotalMensais: dre.impostosTotal }).totals
    .diferenca;
  const fechamento = m.balancoFechamento.totals.diferenca;
  if (!perto(fechamento, abertura, escala * 10))
    f(
      "Balanço conserva a diferença da abertura",
      `abertura ${abertura} × fechamento ${fechamento}`,
    );

  if (JSON.stringify(s) !== copia) f("Pureza", "o cálculo alterou o estado");
  if (buildFinancialModel(s).dre.lucroLiquido.some((v, i) => v !== dre.lucroLiquido[i]))
    f("Determinismo", "resultado diferente na segunda execução");
  const sim = buildFinancialModel(applySimulator(s, DEFAULT_SIM)).dre.lucroLiquido;
  if (!perto(soma(sim), soma(dre.lucroLiquido), escala)) f("Simulador neutro", `${soma(sim)}`);
  return falhas;
}

describe(`invariantes do motor (${N} estados aleatórios)`, () => {
  it("nenhuma violação", () => {
    const falhas: Falha[] = [];
    for (let seed = 1; seed <= N; seed++) falhas.push(...verificar(seed));
    const porRegra = falhas.reduce<Record<string, { n: number; exemplo: Falha }>>((acc, x) => {
      acc[x.regra] = { n: (acc[x.regra]?.n ?? 0) + 1, exemplo: acc[x.regra]?.exemplo ?? x };
      return acc;
    }, {});
    expect(porRegra, JSON.stringify(porRegra, null, 2)).toEqual({});
  }, 600_000);
});
