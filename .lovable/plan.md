# Plano v2 — Card "Análise DuPont" (Indicadores)

## Objetivo
Adicionar um card em `Accordion` (fechado por padrão) ao final da aba **Indicadores**, chamado **"Árvore DuPont — Decomposição do ROE"**, que exiba a hierarquia visual completa do retorno sobre o patrimônio nos modelos de **3 fatores** e **5 fatores (DuPont Estendida)**, totalmente alimentado pela engine (SSOT) e integrado ao resto do sistema (consultor, tooltips, formatação, period view, comparação).

## Visão de CFO — por que 3 e 5 fatores
- **3 fatores (clássico):** `ROE = Margem Líquida × Giro do Ativo × MAF` — diagnóstico rápido (operação × eficiência de ativos × alavancagem).
- **5 fatores (Estendida/Damodaran):** `ROE = (EBIT/Vendas) × (Vendas/Ativo) × (Ativo/PL) × (LAIR/EBIT) × (LL/LAIR)` — separa **operação** (margem EBIT × giro), **estrutura de capital** (MAF × carga financeira) e **carga tributária**, permitindo identificar com precisão a *origem* da variação do ROE.
- Útil para benchmark setorial e para o consultor explicar ao cliente *qual alavanca move o ROE* (operacional, financeira ou fiscal).

## Decomposição apresentada

**Camada A — DuPont 3 Fatores**
```
ROE = Margem Líquida × Giro do Ativo × MAF
ROA = Margem Líquida × Giro do Ativo
MAF = Ativo Total Médio ÷ PL Médio
```

**Camada B — DuPont 5 Fatores (Estendida)**
```
ROE = Margem EBIT × Giro Ativo × MAF × Carga Financeira × Carga Tributária
  Margem EBIT       = EBIT ÷ Vendas
  Giro Ativo        = Vendas ÷ Ativo Médio
  MAF               = Ativo Médio ÷ PL Médio
  Carga Financeira  = LAIR ÷ EBIT          (impacto de juros)
  Carga Tributária  = LL ÷ LAIR            (1 − alíquota efetiva)
```

**Camada C — Drill-down da Margem Líquida (cascata DRE)**
```
Receita Líquida → (−CPV) Margem Bruta
              → (−Desp. Op.) Margem EBIT
              → (±Result. Fin.) LAIR
              → (−IRPJ/CSLL) Lucro Líquido → Margem Líquida
```

**Camada D — Drill-down do Ativo (composição do giro)**
```
Ativo Total = AC + ANC
  AC  = Disponibilidades + Contas a Receber + Estoques + Outros
  ANC = Imobilizado Líq. + Intangível + Outros
```

Cada nó: rótulo · valor (R$ ou %) · `HelpTip` com fórmula e memória de cálculo numérica (mesma UX dos demais indicadores).

## Integração com o sistema (CFO + Eng)
- **SSOT total:** consome `indicators.ts` e `dre.ts` via `useFinanceModel(state)` — nenhum recálculo local.
- **Period view:** respeita `usePeriodView` (mensal/anual) como os demais cards, mostrando valores do período ativo.
- **Comparação histórica:** se houver `Snapshot` selecionado no `comparisonStore`, mostra delta `Δ ROE` ao lado de cada nó-raiz (Atual vs. último realizado). Não bloqueante: ausente quando não há comparação.
- **Benchmark setorial:** consome `engines/benchmark/sectors.ts` (já existente) para colorir nós `ROE/ROA/Margem/Giro` em **verde/âmbar/vermelho** vs. mediana do setor — mesma convenção dos outros cards.
- **Consultor IA:** adicionar pequeno bloco `dupont` ao snapshot que o agente lê (`src/engines/ai/snapshot.ts`) — 5 números (margemEbit, giro, maf, cargaFin, cargaTrib) + ROE. Permite ao consultor pedir "explique o ROE pela DuPont" sem reprocessar.
- **Telemetria de qualidade:** se Ativo Total não foi informado (`endividamentoGeralDadosCompletos=false`), exibir badge **"Dados incompletos — Ativo estimado"** no nó MAF e no Giro, replicando a convenção já usada na aba.

## Tratamento numérico (rigor financeiro)
- Bases **médias** (já calculadas: `plMedio`, `atMedio`) para MAF, ROA e Giro — consistência com CFA/Damodaran já adotada na engine.
- **Reconciliação de identidade:** componente calcula `roeReconstruido = m × g × maf` (3F) e `m_ebit × g × maf × cf × ct` (5F) e compara com `ind.roe`. Se divergência > 0.5 p.p., mostra ícone de alerta com a diferença (proteção contra inconsistências silenciosas de períodos parciais).
- **Sinais especiais:** quando `EBIT ≤ 0` ou `LAIR ≤ 0`, Carga Financeira/Tributária podem ficar negativas ou > 100% — exibir em cinza com tooltip explicativo ("ratio sem significado econômico quando base é negativa") em vez de número enganoso.
- Usa `safeDivide`/`safePct` da engine para evitar `NaN`/`Infinity`.

## Arquivos
1. **`src/engines/finance/dupont.ts`** *(novo, pure function)*  
   Exporta `buildDupont(state, dre, ind): DupontModel` com os 5 fatores, reconciliação e flags de qualidade. Adicionado a `financialModel.ts` para participar do cache WeakMap (zero custo extra por consumidor).
2. **`src/engines/finance/__tests__/dupont.test.ts`** *(novo)*  
   Testes: identidade 3F e 5F (margem de erro < 0.01 p.p.) em estados sintéticos; comportamento com EBIT/LAIR negativos; bases médias.
3. **`src/engines/finance/indicatorCalc.ts`** — adiciona memórias `dupont3F`, `dupont5F`, `maf`, `cargaFinanceira`, `cargaTributaria` (strings p/ `HelpTip.calc`).
4. **`src/components/sim/indicators/DupontTree.tsx`** *(novo)*  
   Apresentação pura. Recebe `state`. Renderiza Camadas A→D em CSS Grid responsivo (desktop: árvore horizontal; mobile: stack vertical). Sem libs novas. Tokens semânticos (`--primary`, `--success`, `--destructive`, `--muted`). Conectores via simples `border` + pseudo-elementos (sem SVG complexo).
5. **`src/components/sim/indicators/IndicatorsTab.tsx`** — Accordion ao final com `<DupontTree />`.
6. **`src/engines/ai/snapshot.ts`** — inclui `dupont` resumido no payload do consultor.

## UI / UX
- `Accordion` shadcn, `type="single" collapsible`, fechado por padrão.
- Header do accordion mostra o **ROE atual** + mini-badge do fator dominante ("Operação", "Alavancagem" ou "Tributos"), calculado pela maior contribuição relativa — preview de valor mesmo fechado.
- Toggle interno **"3 fatores | 5 fatores"** (Tabs shadcn).
- Cada nó: card `rounded-lg border bg-card/50 p-3`, valor em `mono`, operadores `× ÷ − =` como spans grandes em `text-muted-foreground`.
- HelpTip em todos os nós (descrição + fórmula + memória).
- Acessibilidade: `aria-label` por nó com `"Fator X: valor Y"`.

## Fora de escopo
- Sem alteração no `AppState`/migrations.
- Sem novas dependências.
- Sem export PDF dedicado (entra no export geral existente, se houver, em iteração futura).
- Sem série histórica gráfica do ROE decomposto (proposto como follow-up).

## Validação
- TS strict + `bun run build` limpo.
- `vitest` novos passando (identidade DuPont).
- Conferência manual: nós Margem Líq./Giro/ROE/ROA batem com `IndicatorsGrid`.
- Sanity: cenário com prejuízo (EBIT<0) e cenário sem dívida (MAF=1) renderizam corretamente.

Aprovado? Se sim, implemento na ordem 1 → 2 → 3 → 4 → 5 → 6.