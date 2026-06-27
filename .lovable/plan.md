# Plano — Memória de cálculo em todos os indicadores

## Objetivo
Replicar o bloco **"Memória de cálculo"** (fórmula resolvida com os números do estado atual) que já existe no card *Margem Bruta* em **todos os demais indicadores** — grade de Indicadores, página Simulador e cards do topo de cada aba (Dashboard, DRE, Fluxo, Balanço, Capital, Valuation, Receitas, Despesas).

Sem mudar fórmulas, sem mudar valores — apenas mostrar **de onde** o número saiu.

---

## 1. Fonte única (SSOT) — `src/engines/finance/indicatorCalc.ts` (novo)

Função `buildIndicatorCalcs(state, dre, ind)` retorna um objeto tipado `IndicatorCalcs` com strings pt-BR prontas:

```text
{
  margemBruta:   "R$ 1.000.000,00 ÷ R$ 1.030.500,00 × 100\n= 97,04%"
  margemEbitda:  "−R$ 136.300,00 ÷ R$ 1.030.500,00 × 100\n= −13,23%"
  roe:           "−R$ 186.230,00 ÷ R$ 305.000,00 × 100\n= −61,07%"
  liquidezCorrente: "R$ 444.000,00 ÷ R$ 100.000,00\n= 4,44"
  dscr:          "R$ 0,00 ÷ (R$ 0,00 + R$ 0,00)\n= —"
  ...
}
```

Regras:
- Quando o denominador for 0 ou a base for insuficiente: `"Base insuficiente — cálculo indisponível"`.
- Quando o indicador é capeado (ex.: Liquidez 99): mostra valor real + nota `"(capeado)"`.
- Anualização: usa os mesmos campos já anualizados expostos em `Indicators` (`ebitdaAnual`, `receitaLiquidaAnual`, `lucroLiquidoAnual`, …) — sem recálculo.
- Para alavancagem (`leverageDisplay`): a string vai junto com o display retornado.

Testes em `__tests__/indicatorCalc.test.ts`: snapshot dos formatos pt-BR e tratamento de denominadores zero.

## 2. Formatação pt-BR centralizada — `src/engines/finance/format.ts`

Já existem `fmtBRL`, `fmtPct`, `fmtTimes`. Acrescentar:
- `fmtNum(n, decimals=2)` — `1.234,56`
- `fmtRatio(n, decimals=2)` — `4,44` (sem unidade)
- `fmtDays(n)` — `30 dias`
- `fmtAnos(n)` — `2,5 anos`

A `IndicatorCalcs` usa apenas esses helpers, garantindo consistência total.

## 3. Componentes — suporte `calc` sem quebrar TS

- `HelpTip` já aceita `calc` ✅
- `HelpHint` (type): adicionar `calc?: string` opcional.
- `renderHint`: propagar `calc` para `HelpTip`.
- `StatCard`: já recebe `hint: HelpHint` → herda `calc` automaticamente.
- `Gauge` (DashboardTab): já passa `hint` para `HelpTip` → herda `calc`.
- `Ind` (IndicatorsGrid): já passa `calc` ✅
- `LeverageDisplay`: adicionar campo opcional `calc?: string` → repassado ao `Ind`.

Resultado: nenhuma assinatura nova é exigida nas calls existentes — `calc` flui pelo mesmo `hint`.

## 4. Locais de wiring

| Arquivo                                  | Cards a alimentar                                                |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `IndicatorsGrid.tsx`                     | os 35+ indicadores da grade (passar `calc={calcs.<id>}`)         |
| `IndicatorsTab.tsx`                      | topo: Ciclo Financeiro, NCG, Gap CG, Conversão de Caixa          |
| `dashboard/DashboardTab.tsx`             | 5 StatCards de topo + 4 Gauges (Margem Líq., ROE, Liq., Endiv.)  |
| `dre/DRETab.tsx`                         | 5 StatCards de topo (Receita Líq., Lucro Bruto, EBITDA, …)       |
| `cashflow/CashflowTab.tsx`               | StatCards de topo + linhas FCO/FCI/FCF                           |
| `balanco/BalancoTab.tsx`                 | 4 StatCards (Ativo, Passivo, PL, …)                              |
| `capital/CapitalTab.tsx`                 | 3 StatCards (Estrutura de Capital, WACC, …)                      |
| `valuation/ValuationTab.tsx`             | 4 StatCards (FCFF, Terminal, EV, …)                              |
| `costs/CostsTab.tsx` · `revenue/RevenueTab.tsx` | StatCards de resumo                                       |
| `capital/WaccRoicMeter.tsx`              | tooltip WACC e ROIC já consome `calcs.wacc` / `calcs.roic`       |

A página **Simulador** (`SimulatorTab` → `IndicatorsCard`) reusa `IndicatorsGrid` — herda tudo sem mudança extra.

## 5. Entrega — passos

1. `format.ts`: novos helpers (`fmtNum`, `fmtRatio`, `fmtDays`, `fmtAnos`).
2. `indicatorCalc.ts`: SSOT + testes.
3. `primitives.tsx`: `HelpHint.calc` opcional + `renderHint` propaga.
4. `leverageLabel.ts`: campo `calc` no `LeverageDisplay`.
5. Wiring: `IndicatorsGrid`, `IndicatorsTab` (topo), `DashboardTab` (StatCards + Gauges), `DRETab`, `CashflowTab`, `BalancoTab`, `CapitalTab`, `ValuationTab`, `CostsTab`, `RevenueTab`, `WaccRoicMeter`.
6. `bun run typecheck` + `bun run test` + checagem visual no preview.

## 6. Não-objetivos (deixar para depois)

- Não mudar fórmulas, regras de anualização ou capeamentos.
- Não tocar PDFs/exports (já recebem `ind` direto).
- Não criar tooltip novo no AI/Chat (consome `Indicators` por outro caminho).

---

## Detalhe técnico — exemplo do helper

```ts
// src/engines/finance/indicatorCalc.ts
export interface IndicatorCalcs {
  margemBruta: string; margemEbitda: string; margemEbit: string;
  margemLiquida: string; margemContribuicao: string;
  roe: string; roa: string; roic: string; wacc: string;
  liquidezCorrente: string; liquidezSeca: string; liquidezImediata: string; liquidezGeral: string;
  coberturaJuros: string; giroAtivo: string; dscr: string;
  cicloFinanceiro: string; ncg: string; gapCapitalGiro: string; conversaoEbitdaCaixa: string;
  endividamentoGeral: string; capitalProprio: string;
  dividaLiqEbitda: string; dividaLiqEbit: string; dividaLiqPl: string;
  margemSeguranca: string; gao: string; qualidadeLucro: string;
  fcf: string; paybackCapex: string; amortizacaoPlPorLucro: string;
  cagrReceitas12m: string;
  faturamentoPorColab: string; receitaPorColab: string;
  ebitdaPorColab: string; lucroPorColab: string;
  folhaSobreReceita: string;
  impostosSobreReceita: string; impostosSobreLucro: string;
  // topo de páginas
  receitaLiquida12m: string; ebitda12m: string; lucroLiquido12m: string;
  alavancagemPatrimonial: string;
}

export function buildIndicatorCalcs(
  state: AppState, dre: DRE, ind: Indicators,
): IndicatorCalcs { /* compõe strings com fmtBRL/fmtPct/fmtRatio */ }
```

Cada card faz apenas `calc={calcs.<id>}`. Zero lógica de cálculo em UI.
