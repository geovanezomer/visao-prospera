## Plano de Correção da Auditoria Financeira

A auditoria lista **30 itens** (3 críticos, 7 altos, 8 médios, 12 baixos) + **reforma CBS/IBS** + **6 grandes módulos novos** (Excel I/O, RBAC, Risk/VaR, Postgres, ESG, PWA Mobile).

Os 6 módulos novos são projetos independentes (semanas/meses de trabalho cada) e ficam **fora deste plano** — vamos tratá-los depois, um a um, se você quiser. Aqui foco apenas nas **correções de cálculo** que afetam diretamente os números mostrados pelo sistema.

---

### Fase 1 — Bugs Críticos (P0) — núcleo financeiro

Alvo: `src/lib/finance/calculations.ts`

1. **NOPAT correto para ROIC** — usar `EBIT − impostos efetivos do DRE` (ou alíquota efetiva via `LAIR`) em vez de `EBIT × (1 − shield)`.
2. **WACC com shield correto por regime** — manter `Kd × (1 − Tc)` somente onde juros são dedutíveis.
3. **`irShieldForRegime`** — Real = 0,34; Presumido = 0; Simples = 0 (juros não deduzem em Presumido/Simples).
4. **Capital Investido do ROIC** — descontar caixa ocioso (novo campo `capital.caixaOcioso` opcional, default 0) e somar passivos não-onerosos quando informados; fallback ao comportamento atual quando não preenchido para não quebrar dados existentes.

### Fase 2 — Bugs Altos (P1) — tributação e ciclo

1. **PIS/COFINS não-cumulativo**: ratear `pisCreditos` e `cofinsCreditos` em base mensal (`/12`) em `calcReal`.
2. **PME com estoque médio**: usar `(estoqueInicial + estoqueFinal)/2` quando os dois existirem; manter fallback ao único valor atual.
3. **TIR/VPL**: `irr()` retorna `{ value, error }`; UI passa a mostrar mensagem clara quando não converge.
4. **Depreciação por ativação**: aceitar lista opcional de `capex[]` (mês + valor + vida útil) e somar à depreciação base a partir do mês de ativação. Mantém o campo atual.
5. **ICMS — carry-over de crédito entre meses** (`calcPresumido`/`calcReal`): saldo credor passa para o próximo mês.
6. **ICMS-ST sem crédito**: nova flag `semCredito` em `CostLine` (default `false`), respeitada nos cálculos.
7. **Fator R do Simples**: alerta no UI quando RBT12 ultrapassa R$ 4.8M (sai do Simples) ou quando atividade não permite Anexo III.

### Fase 3 — Inconsistências e precisão (P2)

1. **PDD com reversão**: campo opcional `pddReversaoMensal` aplicado como receita não-operacional.
2. **Ciclo × NCG**: novo aviso textual no card de capital de giro quando os sinais divergem.
3. **Composição mensal de escala** (`forecast.ts`): aplicar fator anual ao ano e interpolar dentro do ano, evitando o erro composto.
4. **Divisões por zero**: `terminalValue` exige `WACC − g ≥ 0,5%` (caso contrário, usa fallback explícito e marca a confiança como "C"); Newton-Raphson protegido contra `r→1`.
5. **Infinity/NaN**: substituir `Infinity` por valores neutros (`99` para liquidez, `null` para cobertura de juros) e tratar no display.

### Fase 4 — Edge cases e testes (P3)

1. Avisos no Diagnóstico CFO: receita ≈ 0 com custos fixos, inadimplência ≥ 100%, custos negativos.
2. Suíte de **self-tests** (estilo do `runValuationSelfTests`) em novo arquivo `src/lib/finance/__tests__/finance.selftests.ts`:
   - NOPAT/ROIC (caso da auditoria: EBIT 100k, impostos 30k → ROIC 14%).
   - WACC nos 3 regimes.
   - PIS/COFINS mensal vs anual.
   - PME com estoque médio.
   - ICMS com carry-over.
   - Gordon degenerado e proteção `WACC≈g`.
   - TIR convergente, divergente e fallback.
   Resultados logados no console e expostos na aba **Valuation → Auditoria** (estender a tabela existente).

### Fora deste plano (confirmar depois)

- Reforma tributária **CBS/IBS** (novo regime, mudanças em `types.ts`, UI de seletor, simulação dual): trabalho grande, deve ser um plano dedicado.
- Os 6 módulos novos: Excel I/O, RBAC multi-user, Risk/VaR, migração Postgres, ESG, PWA Mobile.

### Detalhes técnicos

- Todas as mudanças mantêm **compatibilidade retroativa** com o `AppState` salvo no `localStorage` — novos campos são opcionais e têm default seguro em `defaults.ts`/`store.ts` (migração leve por versão).
- Mudanças em `calculations.ts` são refletidas automaticamente em DRE, Indicadores, Simulador, Valuation e Análises (já consomem `buildDRE`/`calcIndicators`).
- Cada fase termina rodando os self-tests; logs aparecem no console (F12) e na aba **Auditoria** do Valuation.

---

Quer que eu siga **todas as 4 fases de uma vez** (são bugs claros e isolados), ou prefere que eu pare ao fim da **Fase 1** para você validar os números antes de continuar?
