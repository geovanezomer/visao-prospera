## Objetivo

Eliminar o "time bomb" do `src/engines/finance/calculations.ts` (1.312 linhas, 35 exports, função `buildDRE` monolítica) sem quebrar os 89 testes verdes nem mudar o comportamento numérico. Não é refactor estético: é redução de risco de regressão e habilitação para evoluções da Reforma Tributária (CBS/IBS).

## Princípios

- **Comportamento idêntico** em cada fase (testes verdes obrigatórios entre fases).
- **Re-export por compat**: `calculations.ts` permanece como fachada (re-exporta tudo) durante toda a migração. Nenhum call site quebra.
- **Pure functions** isoladas, sem `any`, sem dependência de UI/store.
- **Comentários em português** nos pontos críticos (regras tributárias, fórmulas).
- **Um regime tributário por arquivo** — facilita pedidos futuros do tipo "ajuste IRPJ do Lucro Real" atingirem só `real.ts`.

## Arquitetura alvo

```text
src/engines/finance/
├── calculations.ts            (fachada: só re-exports, ~30 linhas)
├── index.ts                   (barrel público existente)
├── tax/
│   ├── reforma.ts             ReformaRates, frações CBS/IBS por ano, era
│   ├── simples.ts             calcSimples, simplesAliquotaEfetiva, anexo, limite
│   ├── presumido.ts           calcPresumido, presumidoBases
│   ├── real.ts                calcReal, irShieldForRegime
│   ├── shared.ts              MonthlyTax (tipo), helpers comuns
│   └── compare.ts             compareRegimes, compareErasForRegime, compareYearsForRegime
├── costs.ts                   isCpvCost, fixedCostBase, monthValues, effectiveMonthValues, folhaAnual
├── regime.ts                  resolveSimplesAnexo, resolveEffectiveRegime, simplesExcedeLimite
├── dre.ts                     DRE (tipo), buildDRE, splitReceitasFinanceiras, outrasDeducoesMensal, computeNetDebt
├── indicators.ts              Indicators (tipo), calcIndicators, cagr12m
└── diagnose.ts                Diagnostic (tipo), diagnose
```

## Fases

### Fase 1 — Extrações sem risco (helpers puros)
Mover sem alterar lógica:
- `costs.ts` ← `isCpvCost`, `fixedCostBase`, `monthValues`, `effectiveMonthValues`, `folhaAnual`
- `regime.ts` ← `resolveSimplesAnexo`, `simplesExcedeLimite`, `resolveEffectiveRegime`
- `tax/reforma.ts` ← `ReformaRates`, `getReformaRates`, `getIbsFractionForYear`, `getIcmsIssFractionForYear`, `getPisCofinsFractionForYear`, `getCbsPctForYear`, `getReformaRatesForYear`, `eraForYear`

`calculations.ts` passa a re-exportar. Rodar `bunx vitest run`.

### Fase 2 — Regimes tributários (1 arquivo por regime)
- `tax/shared.ts` ← `MonthlyTax`
- `tax/simples.ts` ← `simplesAliquotaEfetiva`, `calcSimples`
- `tax/presumido.ts` ← `presumidoBases`, `calcPresumido`
- `tax/real.ts` ← `calcReal`, `irShieldForRegime`
- `tax/compare.ts` ← `compareYearsForRegime`, `compareRegimes`, `compareErasForRegime`

Cada arquivo importa só o que precisa de `reforma.ts` e `types.ts`. Comentários `// [CBS/IBS]` nos pontos afetados pela LC 214/2025.

### Fase 3 — DRE e derivados
- `dre.ts` ← `DRE`, `computeNetDebt`, `outrasDeducoesMensal`, `splitReceitasFinanceiras`, `buildDRE`
- `indicators.ts` ← `Indicators`, `calcIndicators`, `cagr12m`
- `diagnose.ts` ← `Diagnostic`, `diagnose`

`buildDRE` permanece como **uma** função (quebrá-la internamente é Fase 5, fora deste escopo) — o ganho aqui é isolá-la num arquivo de ~150 linhas em vez de viver junto com tudo.

### Fase 4 — Limpeza
- `calculations.ts` vira fachada de ~30 linhas só com `export * from './tax/...'` etc., marcada `@deprecated — importe do submódulo específico`.
- Atualizar `src/engines/finance/index.ts` para re-exportar dos novos módulos diretamente (barrel limpo).
- Rodar lint + testes + build.

## Garantias de não-regressão

1. Suite atual (89 testes) roda verde após **cada** fase, não só no final.
2. Nenhum call site é tocado nas fases 1–3 (fachada preserva API).
3. Sem mudanças de tipo público, sem renomes, sem reordenação de parâmetros.
4. `any` residual: catalogar durante a migração e tratar em PR separado (não misturar refactor estrutural com tightening de tipos).

## Fora de escopo (próximos passos)

- Quebrar `buildDRE` internamente em sub-funções (`computeReceitaBruta`, `computeDeducoes`, `computeCustosFixos`, etc.) — Fase 5.
- Remover `any` — Fase 6.
- Mover `services/{benchmark,compliance}` para `engines/` — proposta anterior, independente.

## Resultado esperado

`calculations.ts`: 1.312 → ~30 linhas (fachada).  
Maior arquivo novo: `dre.ts` ~250 linhas.  
Risco de uma alteração de IRPJ-Real afetar Simples: eliminado (arquivos separados).  
Compatibilidade com call sites: 100% (fachada + barrel).

Confirma a execução começando pela **Fase 1**?
