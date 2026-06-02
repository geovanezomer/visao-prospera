# Linhas de dedução customizadas na aba Receitas

## Objetivo
Permitir que o usuário adicione, na tabela "Receita Mensal — 12 meses", quantas linhas de dedução quiser (devoluções, perdas, furtos, descontos comerciais, abatimentos, etc.). Cada linha tem um **rótulo livre** e **12 valores em R$**, é **persistida com o cenário** e **abatida antes da Receita Líquida** — tanto na aba Receitas quanto na DRE (entrando na composição que reduz a base de impostos sobre venda).

## Comportamento na UI

Card "Receita Mensal — 12 meses":
- Header ganha botão **`+ Incluir linha`** à direita do título.
- Cada linha customizada renderiza:
  - 1ª coluna: input de texto editável com o rótulo (placeholder "Ex: Devoluções")
  - 12 colunas: `MoneyInput` em R$ (default 0)
  - Coluna Total: soma anual em vermelho/negativo (tom `neg`)
  - Botão **lixeira** discreto na ponta para remover a linha
- Linha "Receita Líquida" continua sendo a última, agora calculada como:
  `Líquida = Bruta × (1 − inad.) − Σ deduções customizadas`

Card de KPI "Receita Líquida Anual" no topo passa a refletir a mesma fórmula. O `hint` que hoje diz *"Bruta − Inadimplência − Deduções"* finalmente bate com o cálculo.

## Impacto na DRE

Na DRE, a soma anual das linhas customizadas vira uma nova linha **"Outras deduções de receita"** entre "Inadimplência / Deduções" e "DAS / Impostos sobre Vendas". A base de cálculo de impostos sobre venda passa a ser a receita já líquida dessas deduções (consistente com IFRS 15/CPC 47 — devoluções e descontos reduzem a base tributável).

## Mudanças técnicas

### 1. `src/lib/finance/types.ts`
Adicionar ao `interface Revenue`:
```ts
deducoes?: Array<{
  id: string;       // uuid local
  label: string;    // rótulo livre
  valores: Months;  // 12 valores em R$
}>;
```
Opcional para retrocompatibilidade com cenários salvos antes da mudança.

### 2. `src/lib/finance/defaults.ts`
Default: `deducoes: []`.

### 3. `src/lib/finance/calculations.ts`
- Em `buildDRE` (linha ~410), calcular `outrasDeducoes[i] = Σ deducoes[*].valores[i]`.
- Atualizar `receitaLiquida[i] = receitaBruta[i] − deducoesInadimplencia[i] − outrasDeducoes[i] − impostosVendas[i]`.
- Garantir que `impostosVendas` use a base já líquida dessas deduções (passar `bruta − inadimplência − outrasDeducoes` para `calcSimples/Presumido/Real` no lugar de só `bruta`).
- Expor `outrasDeducoes` no retorno para a DRE renderizar a linha.

### 4. `src/components/sim/DRETab.tsx`
Adicionar linha "Outras deduções de receita" abaixo de "Inadimplência / Deduções", lendo `outrasDeducoes` do DRE construído. Só renderizar a linha se houver pelo menos uma dedução customizada com valor > 0 (evita poluir DRE de quem não usa).

### 5. `src/components/sim/RevenueTab.tsx`
- Recalcular `liquidas` localmente subtraindo a soma das deduções customizadas por mês.
- Botão `+ Incluir linha` no header do card.
- Renderizar dinamicamente as linhas customizadas entre "Inadimplência" e "Receita Líquida".
- Helpers `addDeducao`, `removeDeducao(id)`, `setDeducaoLabel(id, label)`, `setDeducaoValor(id, mesIdx, valor)` atualizando o estado imutavelmente.

### 6. Persistência
`useAppState` (store em localStorage) já serializa o `AppState` inteiro. Como `deducoes` é parte do `Revenue`, é salvo/carregado/exportado automaticamente, junto com cenários salvos via `useScenarios`.

## Fora de escopo
- Suporte a `%` (apenas R$ por mês, conforme decidido).
- Validação tributária por tipo de dedução (ex: ICMS de devolução). O usuário é responsável pelo significado contábil do que digita.
- Alteração nos outros lugares que consomem receita (Cashflow, Valuation): já consomem a Receita Líquida final via `buildDRE`, então a propagação é automática.

## Verificação após implementar
1. Adicionar uma linha "Devoluções" com R$ 500/mês: KPI "Receita Líquida Anual" cai R$ 6.000.
2. Abrir a DRE: aparece linha "Outras deduções de receita" com −R$ 6.000 e os impostos sobre venda diminuem proporcionalmente.
3. Salvar cenário, recarregar a página, restaurar cenário: a linha customizada continua lá com rótulo e valores.
4. Remover a linha: DRE volta a esconder a linha "Outras deduções" e KPIs voltam ao valor original.