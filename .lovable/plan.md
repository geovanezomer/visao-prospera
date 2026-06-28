## Análise (Opus 4.5)

Verifiquei cada apontamento contra o código. Veredito:

| # | Apontamento | Status | Decisão |
|---|---|---|---|
| SSOT-01 | RevenueTab usa `state.tax.regime` (linha 73) | ✅ Real | **Corrigir** — divergência numérica entre abas |
| SSOT-02 | DRETab `monthValues(c, state.tax.regime)` (130, 176, 181) | ✅ Real, mas `monthValues` só usa o regime para filtros (`somenteSe`/Simples) | **Corrigir** — barato, elimina drift |
| SSOT-03 | CashflowTab roda `buildCashFlow` próprio | ✅ Real | **Corrigir** — 1 linha, ganha cache WeakMap |
| SSOT-04 | `prescriptive.ts` chama `calcIndicators(state, dre)` sem `cf` | ✅ Real (linhas 110 e 162) | **Corrigir** — passar `cf` evita 3ª construção |
| CALC-01 | DRETab reconstrói `outrasOperacionais` | ✅ Real, mas a fórmula local soma D&A+PDD+outras e a engine só expõe `outrasReceitasOperacionais` separadamente. A linha agregada do display NÃO existe pronta na DRE. | **Não mexer** — refator cosmético com risco de quebrar o agrupamento visual; o número final já bate |
| CALC-02 | `suggestions.ts` sem `normalizeStateFromBalanco` | ✅ Real | **Corrigir** — 2 linhas |
| CALC-03 | AI tools sem `getFinancialModelCached` | ✅ Real, mas exige refator de assinatura em N tools | **Adiar** — ROI baixo, performance only |

Bugs anteriores (BUG-01..11) confirmados como corrigidos. Cadeia SSOT principal (`buildFinancialModel` → `useFinanceModel`) está íntegra.

---

## Plano de execução

Ordem por risco crescente. Cada etapa = um arquivo, fechada com `bunx vitest run`.

### Etapa 1 — SSOT-01 · RevenueTab
`src/components/sim/revenue/RevenueTab.tsx`
- Importar `resolveEffectiveRegime` de `@/engines/finance/regime`.
- Linha 73: `buildDRE(state, resolveEffectiveRegime(state))`.

### Etapa 2 — SSOT-02 · DRETab
`src/components/sim/dre/DRETab.tsx` (linhas 130, 176, 181)
- Trocar `state.tax.regime` por `regime` (já desestruturado de `useFinanceModel` na linha 97).

### Etapa 3 — SSOT-03 · CashflowTab
`src/components/sim/cashflow/CashflowTab.tsx`
- Substituir `useMemo(() => buildCashFlow(state), [state])` por `const { cf } = useFinanceModel(state)`.
- Remover import órfão `buildCashFlow` (manter se ainda usado em outro ponto).

### Etapa 4 — SSOT-04 · prescriptive
`src/engines/finance/prescriptive.ts`
- Nos dois blocos (linhas 108-111 e 161-163): inverter a ordem para `buildCashFlow` primeiro e chamar `calcIndicators(state, dre, cf)`.

### Etapa 5 — CALC-02 · suggestions
`src/engines/ai/suggestions.ts`
- Importar `normalizeStateFromBalanco` (já existe na engine).
- Antes de `buildDRE`: `const ns = normalizeStateFromBalanco(state)` e usar `ns` em `buildDRE`/`buildCashFlow`.

### Fora do escopo
- CALC-01 (drift cosmético no DRETab) — manter como está.
- CALC-03 (refator das AI tools) — adiar até termos sinal de performance ruim.

### Critério de pronto
- 386+ testes verdes.
- `tsgo` limpo.
- Empresa Simples >R$4,8M anual: valores de tributo idênticos entre Receitas, DRE, Cashflow e Indicadores.
