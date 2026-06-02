## Melhorias na Aba Fluxo de Caixa

Aplicar 3 melhorias em `src/components/sim/CashflowTab.tsx`. Nenhuma mudança em lógica de cálculo (`cashflow.ts`).

### 1. Tokens de cor no gráfico
Substituir cores hardcoded por tokens semânticos do design system:
- `#00E5A0` (área/linha do saldo) → `var(--success)`
- `#F5B85B` (linha do mínimo) → `var(--warning)`
- `#FF6B6B` (linha do zero) → `var(--destructive)`
- `#9ca3af` (eixos) → `var(--muted-foreground)`
- `#ffffff10` (grid) → `var(--border)`

Manter o gradiente de área usando o token `--success`.

### 2. Mover inputs editáveis para card separado
Hoje CapEx, Aportes, Empréstimos, Amortizações e Dividendos são inputs `text-[10px]` no meio da tabela contábil. Criar um novo card **"Movimentações de caixa não operacionais"** posicionado **entre os alertas e a tabela DFC**, com:

- 5 sub-seções (uma por linha): CapEx, Aportes de sócios, Captação de empréstimos, Amortizações, Dividendos.
- Cada sub-seção exibe um label + 12 inputs `MoneyInput` (tamanho normal, não `text-[10px]`) + total anual à direita.
- Ícone/tom apropriado por categoria (investimento vs. financiamento).

Na tabela DFC, substituir os `EditableRow` por `Row` somente-leitura — os valores continuam vindo de `state.cashflow.*`, apenas a edição sai da tabela.

### 3. Coluna "Linha" sticky + destacar meses críticos
**Tabela DFC:**
- Primeira coluna (`<th>` e `<td>` de label) com `sticky left-0`, fundo igual ao da linha (incluindo variantes `bg-accent/20`, `bg-primary/10`, `bg-card/60`) para não vazar conteúdo ao rolar.
- Adicionar `z-index` apropriado e borda direita sutil.

**Gráfico de saldo:**
- Calcular `criticalMonths` a partir de `cf.alertas` (mês → tipo).
- Renderizar um `<Scatter>` ou pontos via `dot` customizado no `<Area>` que destaca:
  - Pontos vermelhos (`var(--destructive)`) onde saldo < 0
  - Pontos amarelos (`var(--warning)`) onde saldo < caixaMinimo mas ≥ 0
  - Pontos normais (sem destaque) nos demais

### Estrutura final da aba
1. Cards de sumário (4 StatCards)
2. Alertas
3. **NOVO**: Card "Movimentações de caixa não operacionais" (5 inputs editáveis)
4. Tabela DFC (somente leitura, primeira coluna sticky)
5. Gráfico (tokens semânticos + pontos críticos destacados)

### Arquivos
- `src/components/sim/CashflowTab.tsx` — única alteração.