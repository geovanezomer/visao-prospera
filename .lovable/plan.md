## Veredito da auditoria

Validei cada ponto contra o codebase. A maioria está correta, com 1 **falso positivo** e 2 ressalvas:

| # | Auditoria | Veredito |
|---|---|---|
| 1 | `external.ts` 22 funções mortas | ✅ Confirmado — só `vplExcel`, `vplClassico`, `tir`, `parcela` são usadas. `media`/`mediana` também não são. |
| 2 | `spreadForecast.ts` morto | ✅ Confirmado — zero importadores. |
| 3 | `selftests.ts` morto | ✅ Confirmado. |
| 4 | `KpiTile`, `SummaryList`, `IntroCard`, `AIFab` mortos | ✅ Confirmado. |
| 6 | `fmtBRL` duplicado em 11 lugares | ✅ Real. |
| 7 | `const n =` duplicado nos arquivos de balanço | ✅ Real. SSOT é `safeNumber`. |
| 8 | `MESES_PT` duplicado em `breakEvenDinamico.ts` | ✅ Real. |
| 9 | Exports não usados em `comparisonStore.ts` | ⚠️ Baixo valor, deixar. |
| 10 | Adoção de `clampFinite`/`safePositive` | ⚠️ Refactor cosmético, baixo ROI agora. |
| 11 | `useFeatureFlag`/`useSubscription` sem migrations | ❌ **FALSO** — as migrations `feature_flags` e `get_active_plan` existem (4 arquivos em `supabase/migrations/`). Ignorar. |
| 12 | `cashflowProjection` ignora `debtContracts` | ✅ Gap real de precisão financeira. |
| 13 | Recharts síncrono no Dashboard | ⚠️ Real, mas Dashboard é a primeira tela — lazy adicionaria flash. Adiar. |

**Impacto real do bundle de #1:** modesto. `@formulajs/formulajs` e `simple-statistics` ainda permanecem como deps porque `vplExcel`/`vplClassico`/`tir`/`parcela` usam `formulajs`. Ganho real: remoção das reexports + possibilidade de drop futuro de `simple-statistics` do `package.json`.

---

## Plano de execução (Claude Opus 4.5)

Ordem por risco crescente. Cada etapa termina com `bunx vitest run` + `tsgo`.

### Etapa 1 — Remoções diretas (sem refactor)
- Deletar `src/engines/finance/spreadForecast.ts`.
- Deletar `src/engines/finance/selftests.ts`.
- Deletar `src/components/sim/capital/parts.tsx` e `src/components/sim/capital/IntroCard.tsx`.
- Deletar `src/components/ai/AIFab.tsx`.
- Confirmar via `rg` que não restou importador órfão.

### Etapa 2 — Enxugar `external.ts`
- Manter apenas: `vplExcel` (NPV), `vplClassico`, `tir` (IRR), `parcela` (PMT).
- Remover imports de `simple-statistics` inteiro + 17 funções não usadas de `@formulajs/formulajs`.
- Rodar `bun pm ls simple-statistics` — se ninguém mais usar, remover do `package.json` com `bun remove simple-statistics`.
- Validar `cross-formulajs.test.ts` continua passando.

### Etapa 3 — Consolidar `fmtBRL` (SSOT em `format.ts`)
- Em cada arquivo da auditoria #6: remover declaração local e importar de `@/engines/finance/format`.
- `fmtBRLShort` → `fmtBRLCompact` (já existe).
- Arquivos afetados: 8 calculadoras + `cashflowProjection.ts` + `diagnose.ts` + `prescriptive.ts`.

### Etapa 4 — Consolidar `const n =` no módulo balanço
- Em `balanco.ts`, `balancoFechamento.ts`, `aberturaDerivada.ts`:
  - Trocar helper local por `import { safeNumber as n } from "./safeMath"`.
- **Manter** o helper em `migrations/v1_to_v2.ts` (migrations devem ser autossuficientes — sem dependência interna que possa mudar).

### Etapa 5 — `MESES_PT` em `breakEvenDinamico.ts`
- Substituir constante local por `import { MESES } from "./format"`.

### Etapa 6 — Precisão financeira: `cashflowProjection` × `debtContracts`
- Importar `scheduleContract`/`aggregateContracts` de `debtContracts.ts`.
- No início de `projectCenario`, gerar cronograma agregado dos contratos existentes em `state.debtContracts` e somar juros + amortizações nos meses do horizonte (não só os 12 já cobertos pela engine base).
- Para horizonte >12 meses, projetar continuidade dos contratos até o vencimento.
- Adicionar teste cobrindo: cenário com 1 contrato Price 24m → projeção 24m deve refletir amortização caindo a zero.

### Fora do escopo (rejeitados/adiados)
- #9, #10, #11, #13 — explicados acima.

### Critério de pronto
- 386+ testes verdes.
- `tsgo` sem erros.
- `bun run build` rodando, com chunk size delta reportado para evidenciar ganho da Etapa 2.
