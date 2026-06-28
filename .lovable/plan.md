# Plano de correção — Análise v17

Objetivo: endereçar os 4 achados sem alterar a engine financeira nem o comportamento visível do usuário.

## 1. Memória do build (risco operacional)

- Em `package.json`, ajustar o script `build` (e `build:dev` se existir) para incluir `NODE_OPTIONS=--max-old-space-size=4096` via `cross-env` (já compatível com Linux/CI/Docker do projeto).
- Validar que o `Dockerfile` e o workflow `.github/workflows/ci.yml` não sobrescrevem `NODE_OPTIONS`. Se sobrescreverem, harmonizar.

## 2. Lazy loading de abas (padrão recorrente)

Criar um único utilitário e aplicar em 2 lugares:

- Novo arquivo `src/components/common/LazyTab.tsx`:
  - Exporta `lazyTab(loader)` que devolve um componente `React.lazy` envolto em `<Suspense fallback={<TabSkeleton />}>`.
  - `TabSkeleton` usa `Skeleton` do shadcn já existente.
- Refatorar `src/components/calculadoras/CalculadorasTab.tsx`:
  - Trocar os 10 imports estáticos das `*Calc` por `lazyTab(() => import("..."))`.
  - Garantir que cada calculadora tenha `export default` (adicionar onde não houver — sem mudar a API nomeada existente, mantendo `export { X }` + `export default X`).
- Refatorar `src/routes/admin.tsx`:
  - Trocar os 12 imports estáticos das `tabs/*Tab` pelo mesmo padrão.
  - Mesma regra de `export default` nos componentes de aba.
- Critério de sucesso: chunks `admin` e `calculadoras` deixam de existir como bloco único; cada aba vira chunk próprio sob demanda. Sem mudança visual além do skeleton no primeiro clique.

## 3. Peso da Landing (660 KB)

Investigação antes de fatiar:

- Adicionar `rollup-plugin-visualizer` como `devDependency`.
- Em `vite.config.ts`, registrar o plugin apenas quando `process.env.ANALYZE === "1"` (não afeta build de produção normal).
- Adicionar script `build:analyze` no `package.json`.
- Após rodar uma vez, aplicar correções pontuais baseadas no relatório (provavelmente: lazy do `TrialRequestDialog`, do bloco de vídeo/lightbox e do `FAQ` JSON-LD-only). Essas correções entram como segundo passo, com base em evidência.

## 4. Regex do Fator R (dívida técnica)

Em `src/engines/finance/regime.ts`:

- Separar em dois padrões nomeados:
  - `PLR_EMPREGADO_RE` — captura PLR de empregado CLT (entra no Fator R).
  - `DISTRIBUICAO_SOCIO_RE` — captura "distribuição"/"dividendos"/"participação de sócio" (NÃO entra, usada como exclusão explícita).
- Ajustar `LABOR_INCLUDE_RE` para excluir matches de `DISTRIBUICAO_SOCIO_RE` antes de aceitar.
- Comentário em PT explicando a ambiguidade histórica de "participação nos lucros".
- Adicionar testes em `src/engines/finance/__tests__` cobrindo:
  - "PLR funcionários" → incluído.
  - "Participação nos lucros — diretoria sócia" → excluído.
  - "Distribuição de lucros sócio" → excluído.

## Ordem de execução e verificação

1. Item 4 (regex + testes) — menor risco, valida pipeline de testes.
2. Item 2 (lazy tabs) — maior ganho de bundle, mecânico.
3. Item 1 (NODE_OPTIONS) — uma linha, depois de confirmar que build local ainda passa.
4. Item 3 (visualizer + ações derivadas) — investigação + segundo PR baseado em evidência.

Validação final: `bun run build` local, `bunx vitest run`, e leitura dos tamanhos de chunk no output do Vite para confirmar que `admin` e `calculadoras` ficaram fatiados.

## Fora de escopo

- Não tocar na engine financeira (`src/engines/finance/*`) além do regex do item 4.
- Não alterar UI/UX visível (apenas skeleton no carregamento de aba).
- Não mexer em pagamentos, auth ou migrations.
