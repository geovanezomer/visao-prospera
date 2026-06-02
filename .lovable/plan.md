## Inverter Ordem dos Cards na Aba Fluxo de Caixa

### Objetivo
Na aba "Fluxo de Caixa", inverter a ordem de exibição para que a **tabela "Demonstração do Fluxo de Caixa — método direto"** apareça **antes** do **gráfico "Saldo de caixa projetado (12 meses)"**.

### Alteração
No arquivo `src/components/sim/CashflowTab.tsx`, mover o bloco do gráfico (linhas 92–120) para depois do bloco da tabela (linhas 122–193). A ordem final será:

1. Cards de sumário (Recebimentos no ano, Fluxo Operacional, etc.)
2. Alertas de caixa negativo/abaixo do mínimo
3. **Tabela detalhada** — "Demonstração do Fluxo de Caixa — método direto"
4. **Gráfico** — "Saldo de caixa projetado (12 meses)"

### Escopo
- Apenas reordenação dos elementos JSX, sem alterar lógica, cálculos ou estilos.
- Nenhuma mudança em outros arquivos.