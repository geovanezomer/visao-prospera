# FinancePRO — Visão Técnica da Engine

Documento didático e detalhado da arquitetura, fluxo de dados e
responsabilidades de cada módulo do FinancePRO. Voltado a desenvolvedores
que vão evoluir a engine financeira, a camada tributária ou a UI.

> Atualizado em: 2026-06-17. Versão do schema do `AppState`: ver
> `APP_STATE_SCHEMA_VERSION` em `src/engines/finance/types.ts`.

---

## 1. Visão geral em 30 segundos

O FinancePRO é um SPA TanStack Start + React 19 que roda **toda a
matemática financeira no cliente** (pure functions, sem backend de cálculo).
O backend (Lovable Cloud / Supabase) cuida apenas de autenticação,
persistência opcional e arquivos `.finnance` (snapshots do estado).

```text
                ┌────────────────────────┐
   UI (rotas) ──▶  AppStateContext       │  ◀── Zustand-like store
                │  (useAppState)         │      (src/engines/finance/store.ts)
                └────────────┬───────────┘
                             │ AppState
                             ▼
                ┌────────────────────────┐
                │  Engine (pure funcs)   │  buildDRE → calcIndicators →
                │  src/engines/finance/* │  forecast → valuation → diagnose
                └────────────┬───────────┘
                             │ DRE / Indicators / Forecast / Valuation
                             ▼
                ┌────────────────────────┐
                │  UI de leitura         │  gráficos, tabelas, prescritivo
                │  (rotas/components)    │
                └────────────────────────┘
```

Regra de ouro: **a engine não toca DOM, hooks ou rede.** Tudo é
`(AppState, params) => Resultado`. Isso garante testabilidade
(`__tests__/`) e permite rodar a engine em worker, no SSR ou em CLI.

---

## 2. Estrutura de pastas

```text
src/engines/
├── finance/                  Engine principal
│   ├── index.ts              Barrel (API pública)
│   ├── types.ts              AppState, DRE, Indicators, Scenario, enums
│   ├── defaults.ts           DEFAULT_STATE + migrateState (compat legado)
│   ├── store.ts              useAppState — Zustand-like + autosave + multi-tab
│   ├── AppStateContext.tsx   Provider que injeta o store na árvore React
│   ├── persistence.ts        Camada IDB/localStorage + BroadcastChannel
│   ├── safeMath.ts           clamp, coerce, divisão segura, anti-NaN
│   ├── shared.ts             helpers (sum12, cagr12m, growth, …)
│   ├── format.ts             fill12, currency, percent
│   │
│   ├── dre.ts                buildDRE — Demonstração de Resultados
│   ├── indicators.ts         calcIndicators — margens, ROIC, NCG, payback, FCF
│   ├── calculations.ts       Barrel interno (DRE + indicators + diagnose)
│   ├── financialModel.ts     SSOT pure-function — agrega regime+DRE+ind+cf+valuation+health (cache por hash)
│   ├── useFinanceModel.ts    Hook React que memoiza buildFinancialModel(state)
│   ├── diagnose.ts           Heurísticas de alertas (EBIT≤0, FCF<0, …)
│   ├── cashflow.ts           DFC mensal + burn/runway
│   ├── costs.ts              Soma e classificação de custos
│   │
│   ├── forecast.ts           Projeção 5y (revenue, custos, NCG, FCF)
│   ├── spreadForecast.ts     Distribuição mensal de um total anual
│   ├── simulator.ts          Aplicação de "alavancas" (what-if)
│   ├── sensitivity.ts        Sensibilidade univariada
│   ├── montecarlo.ts         Box-Muller + percentis P5/P50/P95
│   │
│   ├── valuation.ts          Múltiplos (EV/EBITDA, EV/Revenue, P/L) + DCF/Gordon
│   ├── prescriptive.ts       Geração de recomendações priorizadas
│   ├── strategic.ts          Concentração, governança, regulatória
│   ├── health.ts             Score de saúde 0–100
│   ├── crossValidation.ts    Checagens cruzadas (DRE × DFC × Balanço)
│   ├── selftests.ts          Bateria de smoke tests da engine
│   │
│   ├── tax/                  Camada tributária
│   │   ├── shared.ts         Utilidades + resolveEffectiveRegime
│   │   ├── simples.ts        Anexos I–V do Simples Nacional
│   │   ├── presumido.ts      Lucro Presumido (PIS/COFINS cumulativo)
│   │   ├── real.ts           Lucro Real + carryforward (PIS/COFINS, prejuízo)
│   │   ├── reforma.ts        CBS/IBS — LC 214/2025 + transição 2026-2033
│   │   └── compare.ts        Comparador entre regimes
│   ├── taxDefaults.ts        Alíquotas padrão por setor
│   ├── regime.ts             Resolução de regime efetivo por era
│   │
│   ├── fileFormat/           Formato .finnance (snapshots versionados)
│   │   ├── index.ts          parseFinnanceFile / serialize + pipeline de migrations
│   │   ├── schema.ts         CurrentSchema (Zod) + CURRENT_VERSION
│   │   └── migrations/       vN_to_vN+1 (lista MIGRATIONS)
│   ├── fileIO.ts             Bridge UI ↔ fileFormat
│   ├── fileExtras.ts         Metadata adicional do arquivo
│   ├── useFinnanceFile.ts    Hook de open/save no UI
│   └── usePersistedSimParams.ts  Persistência de parâmetros do simulador
│
├── calculadoras/             Calculadoras isoladas (não usam AppState)
│   ├── cltVsPj.ts            Comparativo CLT × PJ (com 13°, FGTS, INSS, IRRF)
│   ├── custoFuncionario.ts   Custo total de um empregado CLT
│   ├── rescisao.ts           Verbas rescisórias por modalidade
│   └── sacPrice.ts           Tabela SAC × Price (amortização)
│
└── compliance/
    ├── checklist.ts          Checklist regulatório
    └── tax.ts                Auditoria tributária (markdown)
```

---

## 3. O contrato central: `AppState`

`AppState` (em `types.ts`) é o **único objeto que descreve a empresa
sendo modelada**. Toda a engine é uma função pura sobre ele.

Campos principais:

| Campo                                 | Tipo               | Papel                                                                            |
| ------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `companyName`, `cnpj`, `businessType` | string             | Identificação e segmentação                                                      |
| `taxRegime`                           | `TaxRegime`        | `simples` / `presumido` / `real`                                                 |
| `taxEra`                              | `TaxEra`           | `legado`, `transicao`, `reforma_plena`                                           |
| `revenue`                             | `Revenue`          | Receita bruta mensal (12 meses) + inadimplência + PMR/PMP + flags de PDD         |
| `revenueDeducoes`                     | `RevenueDeducao[]` | Linhas de deduções (devoluções, descontos, abatimentos, IRRF exclusivo na fonte) |
| `costs[]`                             | `CostLine[]`       | CPV/CMV/CSP + fixos + variáveis + financeiros                                    |
| `capitalStructure`                    | `CapitalStructure` | Dívida, equity, juros, NCG abertura                                              |
| `capexAtivacao`                       | `CapexAtivacao`    | CAPEX/ativação + depreciação                                                     |
| `taxConfig`                           | `TaxConfig`        | Alíquotas + regime + reforma CBS/IBS                                             |
| `cashFlowConfig`                      | `CashFlowConfig`   | Saldo inicial + prazos médios (PMR/PMP)                                          |

> Toda série mensal usa o type `Months` (alias de `number[]` com
> invariante de 12 posições finitas). Construa SEMPRE via `fill12` ou
> `coerceMonths` — nunca um literal manual.

### Versionamento

`APP_STATE_SCHEMA_VERSION` é incrementado quando o shape muda.
`migrateState()` (`defaults.ts`) faz a migração no boundary do
localStorage. Para o formato `.finnance` (arquivo), há um pipeline
**separado e versionado** em `fileFormat/migrations/` — ver
`docs/CONTRIBUTING.md` para a regra do bump.

---

## 4. Fluxo de cálculo: do estado ao gráfico

```text
AppState
   │
   ├── buildDRE(state) ─────────────────────────────▶ DRE
   │      └── splitReceitasFinanceiras
   │
   ├── calcIndicators(state, dre) ──────────────────▶ Indicators
   │      ├── margins (bruta, EBITDA, líquida, contribuição)
   │      ├── ROIC, ROE, ROA, WACC (CAPM ou ponderado)
   │      ├── liquidez corrente/seca/imediata
   │      ├── endividamento, cobertura de juros, Dív.Líq./EBITDA
   │      ├── NCG (PMR + PMV − PMP), ciclo financeiro
   │      ├── FCF = EBIT(1−t) + D&A − CAPEX − ΔNCG
   │      └── payback (CAPEX anual total ÷ FCF médio)
   │
   ├── diagnose(state, dre, ind) ───────────────────▶ Diagnostic[]
   │      └── Heurísticas: EBIT≤0+FCF<0, ROIC<WACC, runway<3m, …
   │
   ├── buildForecast(state, params) ────────────────▶ Forecast (5y)
   │      └── Crescimento composto + inflação + tax split
   │            (taxVendasRatio sobre receita; taxLucroRatio sobre LAIR)
   │
   ├── runMonteCarlo(state, params) ────────────────▶ {p5, p50, p95}
   │      └── Box-Muller; percentis com floor(p*(n-1))
   │
   ├── valuation(state, dre, ind) ──────────────────▶ Valuation
   │      ├── Múltiplos: EV/EBITDA, EV/Receita, P/L
   │      │   (P/L convertido para EV implícito: equity + netDebt)
   │      └── DCF/Gordon: VPL + perpetuidade FCF·(1+g)/(WACC−g)
   │
   └── prescriptive(state, dre, ind, diag) ─────────▶ Recomendação[]
          └── Alavancas priorizadas por impacto × esforço
```

### 4.1 DRE (`dre.ts`)

Calcula a Demonstração de Resultados a partir das receitas, deduções,
custos (CPV/CMV/CSP), despesas operacionais, resultado financeiro,
tributos sobre lucro e participações. Devolve séries mensais e totais
anuais. É a entrada para **todos** os indicadores e análises.

### 4.2 Indicadores (`indicators.ts`)

Calcula margens, retornos, liquidez, endividamento e geração de caixa.
Pontos sutis (depois das correções recentes):

- **FCF** usa **ΔNCG** (variação anual), não o gap total. `ncgAbertura`
  e `dividaCurtoPrazoPct` (default 0.30) entram em `CapitalStructure`.
- **paybackCapex** usa CAPEX **anual total**, não só `capex[0]`.
- **WACC**: ponderado dívida × equity, com benefício fiscal calibrado
  pelo regime efetivo.

### 4.3 Tributos (`tax/*` + `taxConfig`)

Cada regime é uma função `(receita, custos, params) => MonthlyTax`:

- **Simples** (`simples.ts`): seleção de Anexo I-V, faixa pela RBT12,
  efeito sublimite.
- **Presumido** (`presumido.ts`): IRPJ/CSLL sobre presunção, PIS/COFINS
  cumulativo.
- **Real** (`real.ts`): IRPJ/CSLL sobre lucro real, **carryforward de
  prejuízo fiscal** (limite 30% trimestral) e **carryforward de crédito
  PIS/COFINS** mês-a-mês.
- **Reforma** (`reforma.ts`): CBS + IBS com cronograma 2026-2033
  (substituição PIS/COFINS → CBS e ICMS/ISS → IBS). Marcado com
  `// [CBS/IBS]` no código.

`resolveEffectiveRegime` (em `tax/shared.ts`) é a fonte da verdade do
regime considerado em cada era — todos os módulos devem usá-lo para
manter coerência.

### 4.4 Forecast (`forecast.ts`) e Monte Carlo (`montecarlo.ts`)

- `forecast`: projeção determinística 5y. Aplica crescimento e inflação
  **multiplicativos** (composto contínuo); separa o ratio tributário em
  `taxVendasRatio` (sobre receita) e `taxLucroRatio` (sobre LAIR).
  Inclui `resultadoFinanceiro` no FCL (FCFE).
- `montecarlo`: amostragem com Box-Muller, percentis usando
  `Math.floor(p*(n-1))` para evitar viés no extremo superior.

### 4.5 Valuation (`valuation.ts`)

- Múltiplos: EV/EBITDA, EV/Receita, P/L. **P/L produz Equity Value**,
  que é convertido para EV implícito (`equity + netDebt`) **antes** do
  blend, evitando dupla dedução da dívida.
- DCF/Gordon: VPL dos FCFs projetados + valor terminal por Gordon
  `FCF·(1+g)/(WACC−g)`. Trace explica cada componente.

### 4.6 Prescritivo (`prescriptive.ts`)

Gera recomendações priorizadas em formato CFO: identifica alavancas
(margem, preço, ciclo, custo, mix tributário) e ranqueia por impacto
estimado × esforço.

---

## 5. Estado, store e persistência

### 5.1 `useAppState` (`store.ts`)

Hook Zustand-like que:

1. **Hidrata** do storage (`finnance:state:<userId>`), com fallback para
   chaves legadas (`simulapro:state:v2`, `:v1`).
2. **Migra** via `validateAndMigrate` (atualiza versão do schema).
3. **Autosave** debounced (`AutosaveStatus`: idle/saving/saved/error).
4. **Multi-tab**: `BroadcastChannel` propaga mudanças entre abas
   (`suppressSave` evita loop de eco).
5. **Race-safe** ao trocar de usuário (`hydratedFor` ref).

### 5.2 `persistence.ts`

Abstração sobre IndexedDB (preferencial) + fallback localStorage.
Expõe `loadKey`, `saveKey`, `broadcastChange`, `onRemoteChange`.

### 5.3 Arquivo `.finnance` (`fileFormat/`)

Formato de **snapshot exportável** (gzip + JSON). Versionado de forma
**independente** do schema do localStorage:

- `CURRENT_VERSION` em `schema.ts`
- `MIGRATIONS: Migration[]` em `migrations/index.ts` — cada item é
  `{ from, to, migrate }` aplicado sequencialmente.
- `openGzfp(blob)` roda o pipeline até `CURRENT_VERSION` e valida no
  `CurrentSchema` (Zod). Devolve `{ state, migratedFrom? }` para a UI
  exibir aviso quando o arquivo foi atualizado.
- `saveGzfp(state)` sempre grava em `CURRENT_VERSION`.

Como bumpar a versão e adicionar `vN_to_vN+1`: ver
`docs/CONTRIBUTING.md`.

---

## 6. Calculadoras isoladas (`calculadoras/`)

Não consomem `AppState`. Cada uma recebe seus próprios inputs (Zod) e
devolve um resultado puro — fácil de embedar em rotas avulsas.

- `cltVsPj.ts` — Comparativo de remuneração líquida CLT vs PJ.
  Considera FGTS, INSS patronal/empregado, IRRF (com dedução por
  dependentes, inclusive no 13°), férias + 1/3, encargos PJ.
- `custoFuncionario.ts` — Custo total mensal e anual de um CLT.
- `rescisao.ts` — Verbas por modalidade (pedido demissão, sem justa
  causa, acordo 484-A, justa causa, término contrato).
- `sacPrice.ts` — Tabela de amortização SAC vs Price para
  financiamentos.

---

## 7. Camada de UI

A UI vive em `src/routes/` (TanStack Start, file-based). O padrão é:

1. Route file usa `useAppState()` para ler/escrever o estado.
2. Roda funções da engine (`buildDRE`, `calcIndicators`, …) **dentro
   do render** — são puras e baratas.
3. Renderiza tabelas/gráficos. Para projeções pesadas (Monte Carlo),
   usa o worker `src/workers/montecarlo.worker.ts`.
4. `AppStateContext` injeta o store no topo da árvore via
   `src/routes/__root.tsx`.

---

## 8. Testes

Cobertura em `src/engines/finance/__tests__/`:

- Schemas e migrations do `.finnance` (fixtures v1 + futuros).
- DRE / Indicators / Forecast — números esperados em cenários âncora.
- Monte Carlo — convergência e estabilidade dos percentis.
- Tax — equivalência de regimes e correção dos carryforwards.
- Idempotência das migrations (rodar 2× = mesmo resultado).

Rodar: `bunx vitest run`. Hoje: **100/100 passando**.

---

## 9. Convenções para evoluir

1. **Engine é pura.** Nada de hooks, fetch ou `window` em
   `src/engines/finance/**` (exceto `store.ts`, `persistence.ts`,
   `useFinnanceFile.ts` — que são explicitamente a borda).
2. **Valide na borda.** Inputs financeiros usam Zod. A engine assume
   `AppState` válido.
3. **Séries mensais** sempre via `fill12` / `coerceMonths`.
4. **CBS/IBS** sempre marcado com `// [CBS/IBS]` quando a regra muda.
5. **Schema bump**: ver `docs/CONTRIBUTING.md` (state vs `.finnance`).
6. **Comentários em PT-BR** em código de domínio; nomes de símbolos em
   inglês quando técnicos (DRE/FCF/EBITDA são internacionais).
7. **Antes de implementar**, diagnostique. Ex.: ROIC=0 + cobertura
   negativa + FCF<0 ⇒ EBIT≤0 e capital investido ≈ 0. Reporte antes
   de mexer em fórmula.

---

## 10. Para onde olhar primeiro

| Quero…                          | Abra                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| Entender o estado               | `types.ts`                                                                |
| Mudar DRE                       | `dre.ts` + `__tests__/dre.test.ts`                                        |
| Mudar indicador                 | `indicators.ts`                                                           |
| Mudar regime tributário         | `tax/<regime>.ts` + `taxDefaults.ts`                                      |
| Adicionar campo persistido      | `types.ts` → bump `APP_STATE_SCHEMA_VERSION` → `defaults.ts/migrateState` |
| Adicionar campo ao `.finnance`  | bump `CURRENT_VERSION` + nova migration (ver CONTRIBUTING)                |
| Adicionar alavanca no simulador | `simulator.ts` + `prescriptive.ts`                                        |
| Mudar valuation                 | `valuation.ts` (cuidado com EV vs Equity)                                 |
