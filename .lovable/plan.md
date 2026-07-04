## Objetivo

Refatorar `balancoFechamento.ts` para que o Balanço de fechamento seja derivado **por conservação de massa** (abertura + fluxos da DFC), eliminando as fórmulas paralelas de "regime permanente" que hoje quebram a identidade Ativo = Passivo + PL em cenários com PMR/PMP > 0.

## Diagnóstico

Hoje:
- Caixa vem da DFC (fluxo real por dias).
- CR = `Receita × PMR / 360` — regime permanente.
- Fornecedores = `CPV × PMP / 360` — regime permanente.
- Impostos = `computeImpostosPagarFechamento` — rotina paralela.
- Depreciação = recalculada localmente (mensal×12 + ativações).

Consequência: com PMR=45, a DFC retém ~R$ 250k de receita não recebida (caixa cai), mas o CR não incorpora essa retenção → resíduo estrutural.

## Solução

### 1. Refatorar `deriveBalancoFechamento` (`src/engines/finance/balancoFechamento.ts`)

Substituir cada rubrica de regime permanente por conservação de massa:

```text
Rubrica            = Saldo_ini + Competência_período − Caixa_período
CR_fim             = CR_ini    + Recebível          − Recebimentos DFC
Fornecedores_fim   = Forn_ini  + Compras (CPV DRE)  − PagFornec DFC
ImpostosPagar_fim  = Imp_ini   + ImpostosCompetência − PagImpostos DFC
Depreciação_período = sumArr(dre.depreciacao)  // SSOT da DRE
Empréstimos        = já refatorado (ini + captações − amortizações)
Aportes            = somam a capitalSocial no PL
Resultado_exerc    = LL − dividendos
```

### 2. Exportar séries reutilizáveis de `cashflow.ts`

- Já existe `computeRecebimentos(state, dre)` → usar `recebivelMensal` (série antes do shift PMR) como base. Extrair helper `buildRecebivelMensal(state, dre): number[]` exportado, para não duplicar a fórmula (Receita Bruta − Inadimplência real).
- Compras = `dre.cpv` (já é a base pré-PMP).
- ImpostosCompetência = `sumArr(dre.impostos) + sumArr(dre.impostosVendas)` (verificar campo).

### 3. Liquidar saldos de abertura na DFC (`src/engines/finance/cashflow.ts`)

Pré-requisito da conservação: os saldos de abertura precisam virar caixa dentro do horizonte, senão CR_fim inflado eternamente. Adicionar liquidação distribuída pelo prazo:

- **CR de abertura**: distribuído em recebimentos dos primeiros meses segundo PMR (≤30d: mês 1; 31–60: meses 1–2 proporcional; >60: meses 1–3).
- **Fornecedores de abertura**: idem via PMP.
- **Impostos a pagar de abertura**: liquidados no mês 1.

Cada série ganha um "kickstart" derivado de `deriveAbertura(state)` que soma nos vetores existentes.

### 4. PL — aportes e resultado

- `aportesPeriodo = sumArr(cf.aportes)` somado ao `capitalSocial` no PL do balanço.
- `resultadoExercicio` mantém `lucroLiquidoAnual − dividendosPagos`.

### 5. Depreciação

Substituir cálculo local por `sumArr(dre.depreciacao)`. Se DRE mudar regra, balanço acompanha.

### 6. Cabeçalho do arquivo

Reescrever comentário-cabeçalho descrevendo o método de conservação de massa e remover menção a "regime permanente".

## Testes

### Novo arquivo: `src/engines/finance/__tests__/balanco-identidade.test.ts`

Cada teste valida `|diferença| < R$ 1`:
- (a) empresa uniforme, sem PMR/PMP.
- (b) receita sazonal, PMR=45.
- (c) contratos de dívida com amortizações no período.
- (d) CAPEX ativado no meio do ano.
- (e) aporte de capital.
- (f) dividendos.
- (g) regimes Simples / Presumido / Real.
- (h) reforma tributária com Split Payment ativo.
- (i) consistência ΔCR = Recebível − Recebimentos DFC.
- (j) à vista (PMR=0): CR_fim = CR_ini.

### Testes existentes

- Ajustar `balancoFechamento-tax.test.ts`: os asserts que assumiam a rotina paralela `computeImpostosPagarFechamento` precisam ser reescritos para validar conservação (agora o balanço herda o efeito do lag via DFC).
- `aberturaDerivada.test.ts` não deve mudar (SSOT de abertura permanece intacto).
- Rodar `bunx vitest run` — toda a suíte deve passar.

## Arquivos afetados

- `src/engines/finance/balancoFechamento.ts` — refatoração principal.
- `src/engines/finance/cashflow.ts` — export de `buildRecebivelMensal` + liquidação dos saldos de abertura.
- `src/engines/finance/__tests__/balanco-identidade.test.ts` — novo.
- `src/engines/finance/__tests__/balancoFechamento-tax.test.ts` — ajustar asserts.

## Riscos e mitigações

- **Regressão no DFC**: liquidar saldos de abertura muda `saldoFinal[i]` — pode alterar métricas dependentes (alertas de caixa negativo, WACC via caixa). Mitigação: rodar suíte completa; comparar `cashflow.test.ts` antes/depois.
- **Semântica de `impostosVendas`**: verificar se existe esse campo no DRE ou se `dre.impostos` já é o total. Ajustar antes de codar.
- **Escopo grande**: proponho executar em 3 commits lógicos — (1) export `buildRecebivelMensal` + liquidação de abertura na DFC; (2) refatorar `deriveBalancoFechamento`; (3) testes de identidade.

## Confirmação necessária

Confirma que:
1. Podemos alterar `cashflow.ts` para liquidar saldos de abertura (isso mexe em `saldoFinal` mensal e pode requerer ajustes em testes de DFC).
2. Preferência: subcampo `aportesPeriodo` em `patrimonioLiquido` (nova coluna) OU somar em `capitalSocial` (mais simples, sem migration de types)?
