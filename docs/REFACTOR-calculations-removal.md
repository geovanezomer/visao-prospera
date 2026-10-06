# Remoção da fachada `calculations.ts` (engine financeira)

**Data:** 2026-06-17
**Escopo:** `src/engines/finance/`

## Contexto

Após os refactors anteriores (Fases 1–4), `src/engines/finance/calculations.ts`
já não continha lógica — havia se tornado um arquivo de ~49 linhas com
re-exports dos submódulos coesos (`./dre`, `./indicators`, `./diagnose`,
`./regime`, `./costs`, `./shared`, `./tax/*`). A fachada existia apenas
para preservar compatibilidade com os ~17 call sites antigos.

Manter o arquivo gerava ruído no mapa do módulo: dois pontos de entrada
para os mesmos símbolos (`./calculations` e o barrel `./index.ts`), com
risco de novos arquivos importarem do caminho legado.

## Mudança

1. **Barrel `src/engines/finance/index.ts`** passou a re-exportar diretamente
   dos submódulos (sem intermediar via `./calculations`).
2. **Arquivos internos da engine** (`valuation`, `cashflow`, `simulator`,
   `forecast`, `prescriptive`, `health`, `sensitivity`, `crossValidation`,
   `montecarlo`, `spreadForecast`, `selftests`, `financialModel`) e
   **testes em `__tests__/`** importam agora dos submódulos diretos
   (evita ciclos com o barrel).
3. **Callers externos** (UI em `src/components/sim/*`, AI em
   `src/engines/ai/*`, `src/engines/compliance/tax.ts`, `src/hooks/useAIChat.ts`)
   trocaram `@/engines/finance/calculations` por `@/engines/finance`
   (barrel oficial).
4. **`calculations.ts` removido.**

## Equivalência de imports

| Antes                                                  | Depois                               |
| ------------------------------------------------------ | ------------------------------------ |
| `@/engines/finance/calculations` (código de aplicação) | `@/engines/finance`                  |
| `./calculations` (dentro de `src/engines/finance/`)    | submódulo específico (`./dre`, etc.) |

Mapa símbolo → submódulo:

- `buildDRE`, `DRE` → `./dre`
- `calcIndicators`, `Indicators` → `./indicators`
- `diagnose`, `Diagnostic` → `./diagnose`
- `resolveEffectiveRegime`, `resolveSimplesAnexo`, `simplesExcedeLimite`, `folhaAnual` → `./regime`
- `isCpvCost`, `fixedCostBase`, `effectiveMonthValues`, `monthValues` → `./costs`
- `computeNetDebt`, `splitReceitasFinanceiras`, `outrasDeducoesMensal`, `cagr12m` → `./shared`
- `calcSimples`, `simplesAliquotaEfetiva` → `./tax/simples`
- `calcPresumido`, `presumidoBases` → `./tax/presumido`
- `calcReal`, `irShieldForRegime` → `./tax/real`
- `MonthlyTax` → `./tax/shared`
- `compareRegimes`, `compareYearsForRegime`, `compareErasForRegime` → `./tax/compare`
- `ReformaRates`, `getReformaRates`, `getReformaRatesForYear`, `eraForYear`,
  `getIbsFractionForYear`, `getIcmsIssFractionForYear`,
  `getPisCofinsFractionForYear`, `getCbsPctForYear` → `./tax/reforma`

## Convenção a partir de agora

- **Código de aplicação** (UI, AI, hooks, compliance): importar do barrel
  `@/engines/finance`.
- **Código interno da engine** (`src/engines/finance/*.ts`): importar dos
  submódulos diretos para evitar ciclos com `./index`.

## Verificação

- 100/100 testes (`bunx vitest run`) verdes após a remoção.
- `rg "calculations" src` retorna apenas comentários históricos —
  nenhum import remanescente.
