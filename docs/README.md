# FinancePRO — Documentação

Índice central da documentação técnica do projeto. Comece pelo
`ENGINE_OVERVIEW.md` para entender a arquitetura; use os outros
documentos como referência pontual.

---

## 📚 Documentos

| Arquivo                                      | O que é                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ENGINE_OVERVIEW.md`](./ENGINE_OVERVIEW.md) | **Comece aqui.** Visão técnica completa da engine financeira: arquitetura, `AppState`, fluxo de cálculo (DRE → indicadores → forecast → valuation), camada tributária, formato `.finnance`, store/persistência, calculadoras isoladas, testes e convenções. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)       | Arquitetura geral do app (rotas, providers, fronteiras client/server, deploy).                                                                                                                                                                              |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)       | Como contribuir, padrões de código, e o procedimento para **bump de versão** do `AppState` e do `.finnance` (adicionar `vN_to_vN+1` quando o schema muda).                                                                                                  |

---

## 🗺️ Mapa rápido por área

### Engine financeira (`src/engines/finance/`)

| Arquivo                    | Função                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                 | Barrel — API pública da engine                                                                                                                                                                 |
| `types.ts`                 | `AppState`, `DRE`, `Indicators`, `Scenario`, enums, `APP_STATE_SCHEMA_VERSION`                                                                                                                 |
| `defaults.ts`              | `DEFAULT_STATE` + `migrateState` (compat com versões antigas no localStorage)                                                                                                                  |
| `store.ts`                 | `useAppState` — hook estilo Zustand, autosave, multi-tab via `BroadcastChannel`                                                                                                                |
| `AppStateContext.tsx`      | Provider React que injeta o store na árvore                                                                                                                                                    |
| `persistence.ts`           | Camada IDB/localStorage + broadcast                                                                                                                                                            |
| `safeMath.ts`              | `clamp`, `coerceMonths`, divisão segura, anti-NaN                                                                                                                                              |
| `shared.ts`                | Helpers (`sum12`, `cagr12m`, growth)                                                                                                                                                           |
| `format.ts`                | `fill12`, currency, percent                                                                                                                                                                    |
| `dre.ts`                   | `buildDRE` — Demonstração de Resultados                                                                                                                                                        |
| `indicators.ts`            | `calcIndicators` — margens, ROIC/WACC, NCG, FCF, payback                                                                                                                                       |
| `calculations.ts`          | Barrel interno (DRE + indicators + diagnose)                                                                                                                                                   |
| `financialModel.ts`        | **SSOT pure-function** — `buildFinancialModel(state)` agrega regime + DRE + indicators + cashflow + valuation + health + CAGR num único objeto, com cache por hash (`getFinancialModelCached`) |
| `useFinanceModel.ts`       | Hook React que memoiza `buildFinancialModel` por `state` e expõe campos legados (`regime`, `dre`, `ind`, `cf`, `cagrReceitas12m`) + `model` completo                                           |
| `diagnose.ts`              | Heurísticas de alertas (EBIT≤0, FCF<0, runway baixo…)                                                                                                                                          |
| `cashflow.ts`              | DFC mensal + burn/runway                                                                                                                                                                       |
| `costs.ts`                 | Soma e classificação de custos                                                                                                                                                                 |
| `forecast.ts`              | Projeção determinística 5y (split `taxVendasRatio`/`taxLucroRatio`)                                                                                                                            |
| `spreadForecast.ts`        | Distribuição mensal de um total anual                                                                                                                                                          |
| `simulator.ts`             | Aplicação de alavancas (what-if)                                                                                                                                                               |
| `sensitivity.ts`           | Sensibilidade univariada                                                                                                                                                                       |
| `montecarlo.ts`            | Box-Muller + percentis P5/P50/P95 (sem viés)                                                                                                                                                   |
| `valuation.ts`             | Múltiplos (EV/EBITDA, EV/Receita, P/L→EV) + DCF/Gordon                                                                                                                                         |
| `prescriptive.ts`          | Recomendações priorizadas (impacto × esforço)                                                                                                                                                  |
| `strategic.ts`             | Concentração, governança, regulatória                                                                                                                                                          |
| `health.ts`                | Score de saúde 0–100                                                                                                                                                                           |
| `crossValidation.ts`       | Checagens DRE × DFC × Balanço                                                                                                                                                                  |
| `selftests.ts`             | Smoke tests da engine                                                                                                                                                                          |
| `regime.ts`                | Resolução do regime efetivo por era tributária                                                                                                                                                 |
| `taxDefaults.ts`           | Alíquotas padrão por setor                                                                                                                                                                     |
| `fileIO.ts`                | Bridge UI ↔ `fileFormat`                                                                                                                                                                       |
| `fileExtras.ts`            | Metadata adicional do arquivo                                                                                                                                                                  |
| `useFinnanceFile.ts`       | Hook de open/save no UI                                                                                                                                                                        |
| `usePersistedSimParams.ts` | Persistência de parâmetros do simulador                                                                                                                                                        |

### Tributos (`src/engines/finance/tax/`)

| Arquivo        | Função                                                      |
| -------------- | ----------------------------------------------------------- |
| `shared.ts`    | `resolveEffectiveRegime` + utilidades                       |
| `simples.ts`   | Anexos I–V do Simples Nacional                              |
| `presumido.ts` | Lucro Presumido (PIS/COFINS cumulativo)                     |
| `real.ts`      | Lucro Real + carryforward (PIS/COFINS, prejuízo fiscal 30%) |
| `reforma.ts`   | CBS/IBS — LC 214/2025 + transição 2026–2033                 |
| `compare.ts`   | Comparador entre regimes                                    |

### Formato de arquivo `.finnance` (`src/engines/finance/fileFormat/`)

| Arquivo               | Função                                           |
| --------------------- | ------------------------------------------------ |
| `index.ts`            | `openGzfp` / `saveGzfp` + pipeline de migrations |
| `schema.ts`           | `CurrentSchema` (Zod) + `CURRENT_VERSION`        |
| `migrations/index.ts` | Lista ordenada de `MIGRATIONS`                   |
| `migrations/types.ts` | Tipo `Migration` (`{ from, to, migrate }`)       |
| `__tests__/`          | Fixtures e testes de idempotência                |

### Calculadoras isoladas (`src/engines/calculadoras/`)

| Arquivo               | Função                                                   |
| --------------------- | -------------------------------------------------------- |
| `cltVsPj.ts`          | CLT × PJ (FGTS, INSS, IRRF com dependentes, 13°, férias) |
| `custoFuncionario.ts` | Custo total mensal/anual de um CLT                       |
| `rescisao.ts`         | Verbas rescisórias por modalidade                        |
| `sacPrice.ts`         | Tabela SAC × Price (amortização)                         |

### Compliance (`src/engines/compliance/`)

| Arquivo        | Função                           |
| -------------- | -------------------------------- |
| `checklist.ts` | Checklist regulatório            |
| `tax.ts`       | Auditoria tributária em markdown |

---

## 🧭 Rotas comuns

- **Quero entender o sistema** → `ENGINE_OVERVIEW.md`
- **Vou adicionar um campo persistido** → `CONTRIBUTING.md` (seção bump)
- **Vou mexer em um indicador** → `indicators.ts` + seus testes
- **Vou mexer em tributo** → `tax/<regime>.ts` + `taxDefaults.ts`
- **Vou adicionar uma migration do `.finnance`** → `CONTRIBUTING.md` + `fileFormat/migrations/`
