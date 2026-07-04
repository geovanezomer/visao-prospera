## Diagnóstico

As duas linhas na página **Despesas → Despesas Administrativas** —
`Pró-labore (sócios)` e `INSS Patronal sócios` — não são seeds antigos. Elas são
**linhas system geradas pela SSOT** em `src/engines/finance/socios.ts`
(`syncSociosToCosts`), que insere/atualiza em `state.costs`:

- `id = SOCIOS_PROLABORE_LINE_ID` (`__socios_prolabore__`) — flag `system: true`
- `id = SOCIOS_PATRONAL_LINE_ID` (`__socios_inss_patronal__`) — flag `system: true`

Esse mecanismo é intencional e **não pode ser removido**: DRE, Balanço, Fluxo
de Caixa, Simulador, Sensitivity, Monte Carlo e Forecast leem custos por
`state.costs`. Se pararmos de sincronizar as linhas, o pró-labore some dos
resultados. Ou seja, o problema é **apenas de UI**: a lista `CostsTab` não
filtra as linhas `system` e o usuário vê como se fossem editáveis.

## Objetivo

- Manter SSOT em `state.socios` → `syncSociosToCosts` → `state.costs` (não
  mexer no engine, testes e integrações).
- **Esconder** as linhas com `system: true` da UI de Despesas, para que a
  edição aconteça apenas em **Configurações → Sócios** (ProlaboreTab).
- Adicionar uma nota discreta no bloco "Despesas Administrativas"
  informando que pró-labore/INSS patronal são geridos na ProlaboreTab, com
  link/atalho para lá.

## Plano

### 1. Filtrar linhas `system` na `CostsTab`

Arquivo: `src/components/sim/costs/CostsTab.tsx`

- Alterar o helper `byCat`:
  ```ts
  const byCat = (cat: CostCategory) =>
    state.costs.filter(
      (c) => (c.category === cat || c.category === ALIAS[cat]) && !c.system,
    );
  ```
  Isso remove `Pró-labore (sócios)` e `INSS Patronal sócios` de todas as
  seções (aparecem em "Despesas Administrativas" hoje) sem mudar o cálculo.
- Nenhuma mudança em `addLine`, `removeLine`, `setMonth` etc. — todas
  operam por `id` e nunca serão chamadas para IDs system porque as linhas
  não aparecem mais na tabela.

### 2. Nota informativa em "Despesas Administrativas"

Ainda em `CostsTab.tsx`, dentro da `SectionBlock` "Despesas Administrativas"
(linha 265), adicionar uma faixa discreta acima da `CostTable` **apenas
quando existir pelo menos um sócio com pró-labore > 0** (checando
`state.socios?.some((s) => s.prolaboreMensal > 0)`):

> "Pró-labore e INSS Patronal dos sócios são geridos em **Configurações →
> Sócios / Pró-labore**. Os valores entram automaticamente no DRE, Balanço
> e Fluxo de Caixa."

Sem botão de navegação (a página Configurações já tem entrypoint global);
apenas o texto para tirar a confusão.

### 3. Não mexer no engine (nada muda em cálculo)

- `syncSociosToCosts` continua criando/atualizando as duas linhas system —
  intocado.
- `defaults.ts` continua filtrando o seed legado `id="prolabore"` — intocado.
- Testes em `src/engines/finance/__tests__/socios.test.ts` continuam
  válidos (validam presença das linhas em `state.costs`, não a UI).

### 4. Verificação

- Rodar `bunx vitest run src/engines/finance/__tests__/socios.test.ts` para
  garantir zero regressão no engine.
- Conferir visualmente: (a) as duas linhas somem de Despesas; (b) DRE,
  Fluxo de Caixa e Simulador continuam mostrando o pró-labore no total de
  despesas administrativas; (c) editar valor em ProlaboreTab atualiza os
  totais (mas nada aparece em Despesas).

## Ordem de execução

Uma única passada: editar `CostsTab.tsx` (2 mudanças pequenas) → rodar
testes. Nenhum outro arquivo precisa ser alterado.
