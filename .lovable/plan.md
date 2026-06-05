## Objetivo

Tirar do código-fonte todas as alíquotas e tabelas tributárias hoje hardcoded e permitir edição pelo usuário, sem perder os valores oficiais como padrão. Acesso via ícone de engrenagem na barra superior, ao lado do botão Reset.

## Constantes que ficarão editáveis

**Federais sobre lucro**
- IRPJ — alíquota base (hoje 15%)
- Adicional IRPJ — alíquota (hoje 10%) e gatilho trimestral (hoje R$ 60.000)
- CSLL — alíquota (hoje 9%)

**Federais sobre venda — sistema atual**
- PIS cumulativo (Presumido) — hoje 0,65%
- COFINS cumulativo (Presumido) — hoje 3,0%
- PIS não-cumulativo (Real) — hoje 1,65%
- COFINS não-cumulativo (Real) — hoje 7,6%

**Simples Nacional**
- Limite anual de enquadramento (hoje R$ 4.800.000)
- Fator R — % mínimo de folha/RBT12 (hoje 28%)
- Tabelas dos Anexos I, II, III, IV, V — 6 faixas cada, com `teto`, `alíquota` e `parcela a deduzir`. Total: 90 valores editáveis, organizados por anexo em tabela compacta.

**Lucro Presumido — bases de presunção**
- Indústria: IRPJ 8% / CSLL 12%
- Comércio: IRPJ 8% / CSLL 12%
- Serviços: IRPJ 32% / CSLL 32%

**Reforma tributária (transição)**
- Multiplicador de IBS na fase de transição (hoje 0,5)
- Multiplicador de ICMS/ISS na fase de transição (hoje 0,5)
- `cbsAliquota` e `ibsAliquotaRef` já são editáveis em TaxConfig — serão movidos para o painel para concentrar tudo no mesmo lugar.

## Como o usuário interage

1. Botão de engrenagem (`Settings`) no header, à esquerda do Reset.
2. Abre um `Dialog` largo com 4 abas:
   - **Federais** — IRPJ, Adicional, CSLL, PIS, COFINS
   - **Simples Nacional** — limite, Fator R, e seletor de anexo para editar a tabela de 6 faixas
   - **Lucro Presumido** — 3 linhas (indústria/comércio/serviços) × 2 colunas (IRPJ/CSLL)
   - **Reforma** — alíquotas plenas CBS/IBS e multiplicadores da transição
3. Cada campo numérico tem o valor padrão oficial mostrado como placeholder/tooltip; campos vazios = usa padrão.
4. Botão "Restaurar padrões oficiais" por aba e um geral no rodapé.
5. As mudanças são salvas em `state.tax` (cenário atual) — entram automaticamente em Save Cenário e Comparar Cenários, permitindo simular "mesma empresa, reforma alternativa".

## Detalhes técnicos

**Tipos** (`src/lib/finance/types.ts`)
Estender `TaxConfig` com um sub-objeto opcional `rates`:
```ts
ratesOverride?: {
  irpj?: number; irpjAdicional?: number; irpjAdicionalGatilhoTri?: number;
  csll?: number;
  pisCum?: number; cofinsCum?: number;
  pisNaoCum?: number; cofinsNaoCum?: number;
  simplesLimite?: number; fatorRMinimo?: number;
  simplesTables?: Partial<Record<SimplesAnexo, [number,number,number][]>>;
  presumidoBases?: Partial<Record<BusinessType, { irpj: number; csll: number }>>;
  reformaTransicaoIbsMult?: number;
  reformaTransicaoIcmsIssMult?: number;
};
```
Tudo opcional — `undefined` = usar padrão oficial. Garante retrocompatibilidade total com cenários salvos.

**Defaults centralizados** (`src/lib/finance/taxDefaults.ts` — novo)
Move `SIMPLES_TABLES`, `presumidoBases`, e cria constantes nomeadas (`IRPJ_PCT`, `CSLL_PCT`, `PIS_CUM_PCT`, etc.) — todas exportadas. Vira a "fonte da verdade" dos valores oficiais.

**Resolvers** (`src/lib/finance/taxDefaults.ts`)
Funções `getIrpj(state)`, `getSimplesTable(state, anexo)`, `getPresumidoBases(state, business)` etc., que retornam `ratesOverride?.x ?? DEFAULT`. Sem `??` espalhado pelo `calculations.ts`.

**Refactor cirúrgico** em `calculations.ts`
Trocar cada constante mágica pelo resolver correspondente. Mudanças localizadas em `calcSimples`, `calcPresumido`, `calcReal`, `presumidoBases`, `resolveSimplesAnexo`, `simplesExcedeLimite`, `getReformaRates`. Nenhuma mudança de assinatura pública.

**UI** (`src/components/sim/TaxSettingsDialog.tsx` — novo)
Componente único com `Tabs` shadcn. Editor de tabela do Simples: dropdown de anexo + grid 6×3 com inputs numéricos. Botão "restaurar este anexo" reseta `simplesTables[anexo]` para `undefined`.

**Header** (`src/routes/index.tsx`)
Adicionar `<TaxSettingsDialog />` antes do `ConfirmDialog` de Reset. Ícone `Settings` do lucide.

**Migração** (`src/lib/finance/defaults.ts` → `migrateState`)
Nenhuma mudança necessária — `ratesOverride` é opcional, cenários antigos seguem usando padrões oficiais.

## Testes

Adicionar em `src/lib/finance/__tests__/`:
- `tax-overrides.test.ts` — cobrindo:
  - Cenário sem override gera mesmo resultado que hoje (regressão dos 39 testes existentes não pode quebrar).
  - Override de IRPJ para 20% aumenta `tax.annualLucro` no Real proporcionalmente.
  - Override de tabela do Simples Anexo III altera DAS no `calcSimples`.
  - Override de `simplesLimite` para R$ 6M faz desaparecer o alerta de desenquadramento que apareceria com 5M.
  - Override de `reformaTransicaoIbsMult` para 1,0 zera o desconto da transição.

## Fora de escopo

- Persistir padrões em um lugar global (rejeitado na pergunta — fica por cenário).
- Versionamento histórico das alíquotas (ex.: "alíquotas de 2025 vs 2026"). Pode virar uma feature futura usando o sistema de cenários.
- Validação fiscal (ex.: avisar se faixa nova quebra monotonicidade da tabela). Mostro apenas o input cru — confiança no usuário.

## Arquivos afetados

Novos:
- `src/lib/finance/taxDefaults.ts`
- `src/components/sim/TaxSettingsDialog.tsx`
- `src/lib/finance/__tests__/tax-overrides.test.ts`

Editados:
- `src/lib/finance/types.ts` (+ `ratesOverride` em `TaxConfig`)
- `src/lib/finance/calculations.ts` (substituir constantes por resolvers)
- `src/routes/index.tsx` (botão de engrenagem no header)
