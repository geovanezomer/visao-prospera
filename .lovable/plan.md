## Mini-gráfico de evolução do spread (ROIC − WACC) abaixo do Termômetro

Preencher o espaço vazio à esquerda com um card compacto que projeta o spread ROIC − WACC ano a ano, alinhado ao tema do termômetro logo acima.

### O que aparece

Um card com a mesma largura do `CapitalStructureCard` e altura ~180–220px:

- **Título**: "Spread projetado · ROIC − WACC" + HelpTip
- **Subtítulo curto** (1 linha): "Se nada mudar, em X anos a empresa volta/deixa de criar valor" — ou "Continua destruindo valor nos próximos 5 anos" conforme o caso.
- **Mini-gráfico de barras** (5 anos, Y1–Y5): cada barra é o spread daquele ano.
  - Verde quando spread ≥ 0
  - Vermelho quando spread < 0
  - Linha tracejada no zero (linha do "ponto de equilíbrio econômico")
  - Eixo Y compacto sem grid pesado; rótulo de valor em cima de cada barra (ex.: "+2.3 p.p." / "−16.0 p.p.")
- **Rodapé** (1 linha em mono): "WACC fixo: 16.0% · Pressuposto: mesma estrutura de capital"

### Como o spread é calculado por ano (sem mexer em cálculos existentes)

Lógica local nova em `CapitalTab.tsx` (ou helper `src/lib/finance/spreadForecast.ts`):

1. Receita anual de cada ano vem do `buildForecast(state, DEFAULT_FORECAST_CFG)` que já agrega por mês — somo por ano.
2. Margem operacional do ano-base = `ind.margemOperacional` (já em `calcIndicators`) — assumo constante (com ganho de escala anual aplicado igual ao que o forecast já faz para CPV, se simples; senão constante).
3. NOPAT_ano = EBIT_ano × (1 − alíquota efetiva do ano-base).
4. Capital Investido projetado: parte do CI base e soma o capex acumulado de cada ano (do `capexAtivacao` que estende ao longo dos meses + `capexInicial` do forecast). Sem capex novo, CI permanece constante.
5. ROIC_ano = NOPAT_ano / CI_ano × 100.
6. WACC constante (= `ind.wacc` do estado atual, premissa "mesma estrutura").
7. Spread_ano = ROIC_ano − WACC.

Esta é uma projeção orientativa, não substitui o ROIC do ano-base nem altera nada em `calculations.ts`, `forecast.ts`, `valuation.ts` etc.

### Caso de borda — projeção degenerada

Se a receita projetada não muda (crescimento 0%), nenhum capex novo e estrutura igual → todos os 5 anos teriem o mesmo spread. Nesse caso:
- Trocar o gráfico por uma mensagem: "Sem projeção configurada — defina crescimento/capex em **Receitas** ou no **Simulador** para ver a evolução do spread."
- Com link/atalho para abrir a aba do Simulador.

### Arquivos afetados

- `src/components/sim/CapitalTab.tsx` — adicionar `<SpreadForecastCard />` dentro da coluna esquerda, após `<WaccRoicMeter />`. Componente fica no mesmo arquivo se < 80 linhas; senão extraio para `src/components/sim/capital/SpreadForecastCard.tsx`.
- Possível helper novo `src/lib/finance/spreadForecast.ts` (~40 linhas) para encapsular o cálculo do spread anual — mantém `CapitalTab.tsx` enxuto.

### O que NÃO muda

- `calculations.ts`, `forecast.ts`, `valuation.ts`, `strategic.ts`, `prescriptive.ts` — intocados.
- Termômetro de Valor existente continua igual (mostra o ano-base).
- Nenhum input novo de usuário; o card consome o que já está no `state`.
