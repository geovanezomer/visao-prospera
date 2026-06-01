## Contexto

A aba **Regime Tributário** hoje compara apenas Simples × Presumido × Real no sistema atual (PIS, COFINS, ICMS, ISS, IRPJ, CSLL). A Reforma Tributária (EC 132/2023 + LC 214/2025) substitui PIS/COFINS por **CBS** (federal) e ICMS/ISS por **IBS** (estadual+municipal), em transição faseada de **2026 a 2032**, com CBS/IBS plenos em 2033. O Simples Nacional **permanece**, com opção de apropriação de créditos por fora do DAS.

O MD enviado captura a ideia certa, mas com alguns números desatualizados (alíquotas de referência 27%/8%, transição 70/30 binária). Vou usar o cronograma e as alíquotas oficialmente projetadas:

| Ano | CBS | IBS | PIS/COFINS | ICMS/ISS |
|---|---|---|---|---|
| 2026 (teste) | 0,9% | 0,1% | integral, compensável c/ CBS/IBS | integral |
| 2027 | ~8,8% | 0,1% | **extinto** | integral |
| 2028 | ~8,8% | 0,1% | — | integral |
| 2029 | ~8,8% | ~3,5% | — | 90% |
| 2030 | ~8,8% | ~7,1% | — | 80% |
| 2031 | ~8,8% | ~10,6% | — | 70% |
| 2032 | ~8,8% | ~14,1% | — | 60% |
| 2033 | ~8,8% | ~17,7% | — | **extinto** |

Combinado de referência: **~26,5%** (calibrado pelo Senado/MF — todos os valores serão **configuráveis**).

## Decisões de design

1. **Não criar um 4º card.** Em vez disso, adicionar um **seletor de "Era Tributária"** no topo da aba, que reconfigura os 3 cards existentes (Simples / Presumido / Real) para o regime vigente naquele ano. Mais limpo e evita explosão combinatória.
2. **Eras suportadas**: `atual` (até 2025), `transicao_2026`, `transicao_2027_2028`, `transicao_2029_2032` (ano-a-ano), `pleno_2033`. Selecionável por **ano-base** (slider/select 2025–2033) — o sistema deduz a era e mostra os percentuais aplicáveis.
3. **Simples Nacional**: card permanece igual em todas as eras (DAS mantido). Adicionar nota "opção de apropriação de créditos de IBS/CBS aos clientes" quando ano ≥ 2027.
4. **Presumido/Real**: PIS+COFINS é substituído por CBS; ICMS/ISS é substituído por IBS, **misturados conforme cronograma**. IRPJ/CSLL inalterados.
5. **Comparativo lado a lado**: novo bloco "Sistema Atual vs. Reforma no ano X" mostrando carga efetiva projetada para o regime ativo nos dois mundos.
6. **Cashback / split payment / não-cumulatividade plena**: IBS/CBS têm **crédito amplo** sobre qualquer aquisição (inclusive uso/consumo), diferente do PIS/COFINS atual. Refletir nas funções `calcPresumido`/`calcReal` (eras pós-2026): crédito sobre todo o CPV + custos/variáveis tributáveis, sem o filtro `semCredito` exclusivo de ICMS-ST (que perde sentido pós-2033).

## Implementação

### 1) `src/lib/finance/types.ts`

- `TaxEra = "atual" | "2026" | "2027" | "2028" | "2029" | "2030" | "2031" | "2032" | "2033"`
- `TaxConfig` ganha:
  - `era: TaxEra` (default `"atual"`)
  - `cbsAliquota?: number` (default 8.8)
  - `ibsAliquotaRef?: number` (default 17.7, alíquota plena de referência)
  - `cbsCreditoAmplo?: boolean` (default true a partir de 2027)
- `IBS_TRANSICAO[ano]` e `ICMS_REDUTOR[ano]` como constantes exportadas.

### 2) `src/lib/finance/calculations.ts`

- Nova função `tributosReforma(receita, baseCredito, era, cfg)` retornando `{ cbs, ibs, residualPisCofins, residualIcmsIss }` mês a mês, aplicando os percentuais da tabela acima.
- `calcPresumido(state)` e `calcReal(state)`: se `era !== "atual"`, substituem os blocos PIS/COFINS e ICMS/ISS pelo retorno de `tributosReforma`, mantendo IRPJ/CSLL e a lógica de carry-over de crédito.
- `compareRegimes(state)` passa a aceitar `era` opcional (default = `state.tax.era`) e ganha versão `compareErasForRegime(state, regime)` → retorna carga efetiva por ano (2025→2033) para gráfico.
- Atualizar `simplesAliquotaEfetiva` — sem mudança de fórmula, só adicionar nota informativa quando era ≥ 2027.

### 3) `src/components/sim/TaxTab.tsx`

- Novo bloco no topo: **Seletor de Era** (Select com 9 opções + tooltip explicando cada fase).
- Os 3 cards existentes passam a renderizar linhas extras quando `era !== "atual"`:
  - Presumido/Real: `CBS (X%)`, `IBS (Y%)`, `PIS/COFINS residual`, `ICMS residual` (linhas aparecem/desaparecem conforme ano).
  - Simples: badge "Sem mudanças" + nota sobre crédito a clientes.
- Novo bloco abaixo do comparativo entre regimes: **"Projeção 2025–2033"** — pequena tabela/gráfico de barras mostrando carga efetiva por ano para o regime ativo, evidenciando o cruzamento da transição.
- Inputs configuráveis (collapsible "Parâmetros avançados da Reforma"): alíquota CBS, IBS de referência, % de crédito CBS — tudo com defaults oficiais.

### 4) `src/lib/finance/defaults.ts`

- Adicionar defaults da reforma no `TaxConfig` inicial: `era: "atual"`, `cbsAliquota: 8.8`, `ibsAliquotaRef: 17.7`.
- Migração defensiva: estados salvos sem esses campos recebem defaults sem quebrar.

### 5) `src/lib/finance/selftests.ts`

- 4 novos testes: era 2026 (carga ≈ atual + 1pp), era 2029 (mistura 50/50), era 2033 (100% CBS+IBS, PIS/COFINS/ICMS zerados), Simples (invariante em todas as eras).

### 6) `src/components/sim/DRETab.tsx`

- Sem mudanças estruturais — a DRE consome `buildDRE(state, regime)` que já usa o `era` via `calcReal`/`calcPresumido`. Adicionar apenas uma badge "Era: 2029 (transição)" no topo do DRE quando `era !== "atual"`, para o usuário não esquecer o contexto.

### 7) Memória do projeto

Registrar em `mem://features/reforma-tributaria.md`: cronograma oficial, alíquotas de referência, e nota de que tudo é configurável.

## Fora do escopo (poderia ser fase 2)

- Split payment automático e cashback para PF de baixa renda (afeta caixa, não a DRE).
- Regime regional/setorial diferenciado (combustíveis, financeiro, planos de saúde) — usariam alíquotas próprias.
- Crédito presumido de IBS/CBS para exportador.
- Mudança automática de `era` baseada em data atual (deixar manual para fins de simulação).

## Pontos a confirmar antes de codar

1. **Profundidade na transição**: ano-a-ano (9 eras) ou apenas 3 marcos ("atual", "transição 2027–2032", "pleno 2033")? Recomendo ano-a-ano porque é o diferencial da ferramenta para CFO planejar 2027–2032.
2. **Alíquotas default**: usar 8,8% CBS + 17,7% IBS (referência atual) ou permitir o usuário escolher um cenário "MF otimista" vs. "Senado conservador" (26,5% vs. 28%)?
3. **Comparativo "atual vs. reforma"**: tabela compacta dentro da aba ou gráfico de barras dedicado embaixo?