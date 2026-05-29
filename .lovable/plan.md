## Reestruturação das abas + Simulador unificado

### 1. Renomeação e consolidação de abas

| Antes | Depois | Conteúdo |
|---|---|---|
| Diagnóstico e Decisões | **Resultados** | Cards prescritivos (sem botões "Simular") + síntese estratégica vinda de Governança |
| Análise Estratégica | **Governança** | Apenas o formulário (perguntas de concentração, dependência, competitividade, fornecedores, regulatório) |
| — (nova) | **Simulador** | Painel de sliders + DRE Simulado Anual em tempo real |

A aba **Resultados** passa a ser o ponto único de leitura — financeiro (cards do prescriptive) + estratégico (matriz 2x2, índice, highlights por dimensão, frase-síntese). Os botões "Simular esta ação" desaparecem dali.

### 2. Aba Simulador (o ponto alto)

**Layout em duas colunas:**

```text
┌──────────────────────────────┬──────────────────────────┐
│ CONTROLES (sliders agrupados)│ DRE SIMULADO ANUAL       │
│                              │ (sticky, atualiza live)  │
│ ▸ Receita & Preço            │                          │
│ ▸ Custos & Pessoal           │ Receita Bruta            │
│ ▸ Capital de Giro            │ (−) Deduções             │
│ ▸ Dívida & Juros             │ = Receita Líquida        │
│ ▸ Tributário                 │ (−) CPV                  │
│                              │ = Lucro Bruto   [Δ %]    │
│ [Resetar] [Salvar cenário]   │ (−) Despesas Op.         │
│                              │ = EBITDA        [Δ %]    │
│                              │ (−) Financeiras          │
│                              │ = LAIR                   │
│                              │ (−) IR/CSLL              │
│                              │ = Lucro Líquido [Δ %]    │
│                              │                          │
│ Barra: "X ajustes ativos"    │ KPIs delta: margem,      │
│                              │ caixa, ROIC, NCG         │
└──────────────────────────────┴──────────────────────────┘
```

**Sliders propostos (agrupados por bloco, com valor atual exibido e Δ live):**

Receita & Preço
- Preço de venda: −30% a +30%
- Volume de vendas: −50% a +50%
- Mix de receita (% serviços vs produtos): 0–100%

Custos & Pessoal
- CPV / insumos: −20% a +30%
- Folha (contratar/demitir equivalente): −30% a +30% com leitura "= X pessoas"
- Custos fixos top-N: −50% a 0%
- Terceirização (% do CPV → fixo): 0–100% + campo de valor fixo

Capital de Giro
- PMR (dias): −60 a 0
- PMP (dias): 0 a +60
- Antecipação de recebíveis (% a.m.): 0–6

Dívida & Juros
- Captar empréstimo: R$ 0 a 5× EBITDA + prazo + kd
- Quitar dívida (% do caixa): 0–100%
- kd / Selic: −5pp a +5pp

Tributário
- Regime: Simples / Presumido / Real (select)
- Alíquota efetiva (override): apenas Real

**DRE Simulado Anual** (lado direito, sticky):
- Linhas do DRE com **valor base × valor simulado × Δ absoluto × Δ%**
- Setas coloridas (verde/vermelha) por linha
- 4 KPIs no rodapé: Margem Líquida, Caixa Operacional, ROIC, NCG
- Botão "Salvar como cenário" persiste o snapshot atual (reaproveita `saveScenario`)

### 3. Melhorias que sugiro adicionar

1. **Barra de status de ajustes ativos** no topo: "5 ajustes ativos · Δ EBITDA +18% · Δ Caixa −R$ 230k" — feedback constante sem precisar olhar a coluna direita.
2. **Botão "Aplicar combinação ao cenário base"** — quando a combinação de sliders é o "cenário perfeito", aplica de fato no `state` e move para os outros tabs.
3. **Presets rápidos**: chips "Crise leve", "Crise dura", "Expansão", "Reestruturação" que pré-posicionam os sliders.
4. **Alertas de inconsistência inline**: se a combinação gera LL negativo, caixa negativo ou cobertura de juros < 1, mostra badge vermelho no DRE.
5. **Comparador A vs B**: permitir congelar uma simulação como "A" e mexer nos sliders para criar "B", mostrando lado a lado (opcional, fase 2).

### Notas técnicas

- Criar `src/lib/finance/simulator.ts` com `SimulatorParams` (todos os controles) e `applySimulator(state, params) → AppState`. Reusa lógica de `scenarios.ts` (extraindo as funções `apply` já existentes).
- Criar `src/components/sim/SimulatorTab.tsx` com sliders agrupados (Accordion ou seções) + painel DRE recalculado via `computeDRE(applySimulator(state, params))` memoizado.
- `DiagnosisTab` → renomear para `ResultsTab.tsx`, remover prop `saveScenario`, esconder coluna de ações nos cards e injetar bloco de síntese estratégica (mover do `StrategicTab`).
- `StrategicTab` vira `GovernanceTab.tsx` contendo apenas o formulário; toda renderização de matriz/índice/highlights migra para `ResultsTab`.
- `routes/index.tsx`: renomear labels das tabs, adicionar nova tab "Simulador" entre Cenários e Forecast (ordem sugerida).

### Fora de escopo (não mexer)

- Lógica de cálculo de DRE, NCG, ROIC, WACC permanece intacta.
- Wizard, Forecast, Monte Carlo, Cashflow seguem como estão.
- A engine de `prescriptive.ts` continua produzindo os cards — apenas a UI deixa de oferecer "Simular".
