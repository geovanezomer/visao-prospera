# Indicadores Financeiros — FinancePRO

> **Mapa de referência:** onde cada indicador é calculado, qual fórmula usa e quais inputs consome.
> Última revisão: gerado a partir do código-fonte (src/engines/finance + src/engines/calculadoras).
> Marcar com `[CBS/IBS]` o que é afetado pela Reforma Tributária (LC 214/2025 / EC 132/2023).

---

## Sumário

1. [Demonstrativos Estruturados](#1-demonstrativos-estruturados)
   - 1.1 [DRE](#11-dre-demonstração-de-resultado-do-exercício)
   - 1.2 [DFC](#12-dfc-demonstração-do-fluxo-de-caixa)
   - 1.3 [Balanço Patrimonial (inputs estruturais)](#13-balanço-patrimonial-inputs-estruturais)
2. [Indicadores de Rentabilidade](#2-indicadores-de-rentabilidade)
3. [Indicadores de Liquidez](#3-indicadores-de-liquidez)
4. [Indicadores de Endividamento](#4-indicadores-de-endividamento)
5. [Indicadores de Atividade / Ciclo](#5-indicadores-de-atividade--ciclo)
6. [Custo de Capital](#6-custo-de-capital)
7. [Valuation](#7-valuation)
8. [Análise de Risco / Cenários](#8-análise-de-risco--cenários)
9. [Tributação Brasileira](#9-tributação-brasileira)
10. [Calculadoras Avulsas](#10-calculadoras-avulsas)
11. [Forecast / Projeção](#11-forecast--projeção)
12. [Biblioteca Externa Centralizada](#12-biblioteca-externa-centralizada)

- [Anexo A — Mapa de Dependências](#anexo-a--mapa-de-dependências)
- [Anexo B — Convenções](#anexo-b--convenções)

---

## 1. Demonstrativos Estruturados

### 1.1 DRE (Demonstração de Resultado do Exercício)

- **Arquivo:** `src/engines/finance/dre.ts`
- **Função principal:** `buildDRE(state: AppState, regime: TaxRegime)`
- **Retorno:** `{ dre: DRE, tax: MonthlyTax }`
- **Periodicidade:** mensal (array 12 posições, índice 0 = Janeiro)

#### Arquitetura interna (4 sub-funções privadas)

| Passo | Sub-função              | Responsabilidade                                                                    |
| ----- | ----------------------- | ----------------------------------------------------------------------------------- |
| 1     | `computeImpostosVendas` | Calcula tributos sobre venda (PIS/COFINS/ISS/ICMS/DAS/CBS/IBS) — independem do LAIR |
| 2     | `classifyCosts`         | Distribui custos em CPV vs OpEx, Fixo vs Variável, aplica PDD líquida               |
| 3     | `computeDepreciacao`    | Depreciação base + ativações de custos + CAPEX programado                           |
| 4     | `computeImpostosLucro`  | Segunda passagem — IRPJ/CSLL sobre LAIR apurado (somente Lucro Real)                |

#### Linhas da DRE e fórmulas

```
Receita Bruta (receitaBruta)
  − Deduções por Inadimplência (deducoesInadimplencia)     [se !inadimplenciaComoPDD]
  − Outras Deduções (outrasDeducoes)                        [linhas livres do usuário]
  − Impostos sobre Venda (impostosVendas)                   [CPC/IFRS 15 — deduzidos antes da RL]
  = Receita Líquida (receitaLiquida)
  − CPV / CMV / CSP (cpv)
  = Lucro Bruto (lucroBruto)
  − Despesas Operacionais (despesasOperacionais)            [inclui PDD quando inadimplenciaComoPDD]
  + Outras Receitas Operacionais (outrasReceitasOperacionais) [aluguéis, venda de ativos]
  = EBITDA
  − Depreciação e Amortização (depreciacao)
  = EBIT
  + Resultado Financeiro (resultadoFinanceiro)              [rendimentos − custos financeiros]
  = LAIR (Lucro Antes do IR)
  − Impostos sobre Lucro (impostos)                         [IRPJ + Adicional + CSLL]
  = Lucro Líquido (lucroLiquido)
```

**Fórmulas-chave (dre.ts):**

| Campo                    | Fórmula                                                                                        | Linha-ref        |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------- |
| `receitaLiquida[i]`      | `receitaBruta[i] − deducoesInadimplencia[i] − outrasDeducoes[i] − impostosVendas[i]`           | `dre.ts:218-220` |
| `lucroBruto[i]`          | `receitaLiquida[i] − cpv[i]`                                                                   | `dre.ts:226`     |
| `ebitda[i]`              | `lucroBruto[i] − despesasOperacionais[i] + outrasReceitasOperacionais[i]`                      | `dre.ts:231`     |
| `ebit[i]`                | `ebitda[i] − depreciacao[i]`                                                                   | `dre.ts:235`     |
| `resultadoFinanceiro[i]` | `rendimentosFinanceiros[i] − custosFinanceirosTotal[i]`                                        | `dre.ts:238-240` |
| `lair[i]`                | `ebit[i] + resultadoFinanceiro[i]`                                                             | `dre.ts:241`     |
| `lucroLiquido[i]`        | `lair[i] − impostosLucro[i]`                                                                   | `dre.ts:247`     |
| `impostosTotal[i]`       | `impostosVendas[i] + impostosLucro[i]`                                                         | `dre.ts:246`     |
| `depreciacao[i]`         | `depreciacaoMensalBase + Σ(ativacoes custo) + Σ(capexAtivacao)` — linear `valor/vidaUtilMeses` | `dre.ts:166-182` |
| PDD bruta                | `receitaBruta[i] × (inadimplencia[i] / 100)`                                                   | `dre.ts:210`     |
| PDD líquida              | `max(0, pddBruta[i] − pddReversaoMensal[i])`                                                   | `dre.ts:139`     |

**Lógica inadimplência:**

- `inadimplenciaComoPDD = false`: deduzida na linha "Deduções por Inadimplência" (antes da Receita Líquida).
- `inadimplenciaComoPDD = true`: contabilizada como PDD em despesas operacionais (CPC 47/IFRS 9); classificada como custo **variável**.

**Campo `impostosLucroBase`:**

- `"lair"` → Lucro Real (IRPJ/CSLL sobre LAIR)
- `"receita_presumida"` → Lucro Presumido (base = receita × % de presunção)
- `"nao_aplica"` → Simples Nacional (IRPJ/CSLL embutidos no DAS)

**Depende de:** `costs.ts` (effectiveMonthValues), `regime.ts` (folhaAnual, resolveSimplesAnexo), `tax/simples.ts`, `tax/presumido.ts`, `tax/real.ts`, `shared.ts`

---

### 1.2 DFC (Demonstração do Fluxo de Caixa)

- **Arquivo:** `src/engines/finance/cashflow.ts`
- **Função principal:** `buildCashFlow(state: AppState, regime?: TaxRegime)`
- **Retorno:** `CashFlow` (objeto com arrays mensais e totais anuais)
- **Método:** Fluxo de Caixa Indireto adaptado (reconstruído mês a mês a partir da DRE)

#### Estrutura do DFC

```
FLUXO OPERACIONAL (fluxoOperacional):
  + Recebimentos                 [receitaBruta − inadimplência, deslocada por PMR]
  + Receitas Financeiras (caixa) [rendimentos de aplicações realizados]
  − Pagamentos a Fornecedores    [CPV deslocado por PMP]
  − Pagamentos Fixos             [custosFixos]
  − Pagamentos Variáveis         [custosVariaveis − cpv − pdd]  ← PDD é não-caixa
  − Pagamentos Financeiros       [custosFinanceirosTotal]
  − Pagamentos de Impostos       [total mensal de tributos, deslocado 30 dias]

FLUXO DE INVESTIMENTO (fluxoInvestimento):
  − CAPEX                        [cashflow.capex mensal]

FLUXO DE FINANCIAMENTO (fluxoFinanciamento):
  + Aportes                      [cashflow.aportes]
  + Empréstimos Captados         [cashflow.emprestimosCaptados]
  − Amortizações de Principal    [cashflow.amortizacoes]
  − Dividendos                   [cashflow.dividendos]

Variação de Caixa = FluxoOp + FluxoInv + FluxoFin
Saldo Final[i] = Saldo Final[i-1] + Variação[i]
```

#### Funções auxiliares puras (cashflow.ts)

| Função                                            | Fórmula                                                                                                                                         | Linha-ref             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `shiftByDaysSplit(values, lagDays)`               | Desloca array por `round(lagDays/30)` posições; transbordo acumula em `contasReceberAnoSeguinte`                                                | `cashflow.ts:57-71`   |
| `shiftByDaysSplitMonthly(values, lagDaysByMonth)` | Variante com lag diferente por mês (sazonalidade de PMR/PMP)                                                                                    | `cashflow.ts:77-90`   |
| `computeRecebimentos(state, dre)`                 | `receitaBruta[i] − deducoesInadimplencia[i]`, deslocado por PMR (ou `pmrMensal` se houver variação)                                             | `cashflow.ts:107-116` |
| `computeFornecedores(state, dre)`                 | `dre.cpv`, deslocado por PMP                                                                                                                    | `cashflow.ts:121-129` |
| `computeImpostos(tax)`                            | `tax.monthly`, deslocado 30 dias (apuração + DARF)                                                                                              | `cashflow.ts:134-136` |
| `computePagamentosOperacionais(dre)`              | fixos=`dre.custosFixos`; variáveis=`dre.custosVariaveis − cpv − pdd` (PDD é não-caixa, CPC 47/IFRS 9); financeiros=`dre.custosFinanceirosTotal` | `cashflow.ts:142-154` |
| `computeFluxos(...)`                              | Compõe os 3 fluxos e variação de caixa                                                                                                          | `cashflow.ts:159-197` |
| `computeSaldos(saldo0, variacao)`                 | `saldoFinal[i] = saldoFinal[i-1] + variacaoCaixa[i]`                                                                                            | `cashflow.ts:202-218` |
| `computeBurnRunway(...)`                          | `burnMedio3 = média(-fluxoOp[-3:])`, `runway = (caixa + recebiveis) / burnMedio3`                                                               | `cashflow.ts:250-262` |

**Alertas automáticos:**

- `saldoFinal[i] < 0` → tipo `"negativo"`
- `saldoFinal[i] < caixaMinimo` → tipo `"abaixoMinimo"`

**Depende de:** `dre.ts` (buildDRE), `shared.ts` (splitReceitasFinanceiras), `regime.ts`, `format.ts`

---

### 1.3 Balanço Patrimonial (inputs estruturais)

O FinancePRO **não gera** um Balanço automaticamente — os dados patrimoniais são informados pelo consultor via `state.capital` e usados como base nos cálculos de indicadores.

**Inputs de `capital` usados nos cálculos:**

| Campo                                          | Uso                                                            |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `patrimonioLiquido` (PL)                       | ROE, WACC, endividamento, payback PL                           |
| `patrimonioLiquidoAbertura`                    | ROE com PL médio (CFA/Damodaran): `(PL_abertura + PL_fim) / 2` |
| `dividaOnerosa` (D)                            | WACC, dívida líquida, grau de endividamento                    |
| `ativoTotal`                                   | ROA, giro do ativo, endividamento geral                        |
| `ativoCirculante`                              | Liquidez corrente e seca                                       |
| `passivoCirculante`                            | Liquidez corrente, seca, imediata                              |
| `disponibilidades`                             | Saldo inicial DFC, liquidez imediata                           |
| `caixaOcioso`                                  | Dívida líquida (SSOT: `D − caixaOcioso`)                       |
| `contasReceber`                                | NCG (preferencial sobre estimativa PMR)                        |
| `estoques` / `estoqueInicial` / `estoqueFinal` | PME, NCG                                                       |
| `fornecedores`                                 | NCG, passivo circulante estimado                               |
| `passivosNaoOnerosos` (PNO)                    | Capital investido (ROIC), endividamento fallback               |
| `capitalGiroDisponivel`                        | Gap de capital de giro, ΔNCG abertura                          |
| `ncgAbertura`                                  | Âncora para ΔNCG anual (evita consumo inflado)                 |
| `dividaCurtoPrazoPct`                          | Fração D que compõe o passivo circulante (default 30%)         |
| `ke`, `kd`, `proprio`                          | WACC (custo de capital próprio e de terceiros)                 |
| `capexAtivacao[]`                              | Depreciação + CAPEX anual                                      |
| `depreciacaoMensal`                            | Linha base de D&A                                              |

---

## 2. Indicadores de Rentabilidade

- **Arquivo:** `src/engines/finance/indicators.ts`
- **Função principal:** `calcIndicators(state: AppState, dre: DRE): Indicators`
- **Nota:** Todos os indicadores anuais somam os 12 meses da DRE via `sum()`.

---

### Margem Bruta

- **Fórmula:** `Lucro Bruto Anual / Receita Líquida Anual × 100`
- **Calculado em:** `indicators.ts:326` (campo `margemBruta`)
- **Código:** `safePct(lucroBrutoAnual, receitaLiqAnual)`
- **Significado:** Percentual da receita líquida que sobra após o custo direto de produção/venda.
- **Usado em:** IndicatorsTab, DRETab, IA tools, diagnóstico.

---

### Margem EBITDA

- **Fórmula:** `EBITDA Anual / Receita Líquida Anual × 100`
- **Calculado em:** `indicators.ts:327`
- **Código:** `safePct(ebitdaAnual, receitaLiqAnual)`
- **Significado:** Geração operacional de caixa (proxy) relativa à receita. Isenta de D&A, juros e impostos.

---

### Margem EBIT

- **Fórmula:** `EBIT Anual / Receita Líquida Anual × 100`
- **Calculado em:** `indicators.ts:328`
- **Código:** `safePct(ebitAnual, receitaLiqAnual)`
- **Significado:** Lucro operacional após D&A, antes de juros e impostos.

---

### Margem Líquida

- **Fórmula:** `Lucro Líquido Anual / Receita Líquida Anual × 100`
- **Calculado em:** `indicators.ts:329`
- **Código:** `safePct(llAnual, receitaLiqAnual)`

---

### Margem de Contribuição

- **Fórmula:** `(Receita Líquida Anual − Custos Variáveis Anuais) / Receita Líquida Anual × 100`
- **Calculado em:** `indicators.ts:153`
- **Código:** `safePct(receitaLiqAnual - custosVarAnual, receitaLiqAnual)`
- **Inputs:** `dre.custosVariaveis` (inclui CPV variável, PDD e outros variáveis); `dre.receitaLiquida`
- **Usado em:** Ponto de Equilíbrio, GAO.
- **Atenção:** Custos variáveis classificados pela `category` do custo (`custo_vendas`, `variavel`, `direto_venda`) ou override pelo campo `comportamento`.

---

### Ponto de Equilíbrio — Três variantes

#### PE Total (Financeiro com juros)

- **Fórmula:** `(Custos Fixos + Depreciação + Juros) / (MC%)`
- **Calculado em:** `indicators.ts:157`
- **Onde:** `custosFixosComJuros = custosFixosAnual + jurosAnual`; `mcFrac = margemContribuicao/100`
- **Uso:** Cobertura financeira completa. Inclui juros por serem custo fixo recorrente para PME.

#### PE Operacional Clássico (Garrison/Horngren)

- **Fórmula:** `Custos Fixos Operacionais (com D&A, SEM juros) / MC%`
- **Calculado em:** `indicators.ts:155-156`
- **Onde:** `custosFixosAnual = sum(dre.custosFixos) + sum(dre.depreciacao)`
- **Uso:** Referência acadêmica/contábil — juros ficam abaixo do EBIT.

#### PE Financeiro (caixa, sem D&A)

- **Fórmula:** `Custos Fixos Operacionais SEM depreciação e SEM juros / MC%`
- **Calculado em:** `indicators.ts:158-159`
- **Onde:** `custosFixosOperacionaisSemDep = custosFixosAnual − depreciacaoAnual`
- **Uso:** Receita mínima para cobrir desembolsos operacionais efetivos de caixa.

---

### ROE (Retorno sobre Patrimônio Líquido)

- **Fórmula:** `Lucro Líquido Anual / PL Médio × 100`
- **Calculado em:** `indicators.ts:187-189`
- **PL Médio:** `(PLAbertura + PL) / 2` quando `PLAbertura > 0`; caso contrário, usa `PL` direto.
- **Base:** CFA/Damodaran — PL médio reduz distorção em empresas com forte variação de equity.

---

### ROA (Retorno sobre Ativos)

- **Fórmula:** `Lucro Líquido Anual / Ativo Total × 100`
- **Calculado em:** `indicators.ts:190`
- **Condição:** Zero quando `ativoTotal` não informado.

---

### ROIC (Retorno sobre Capital Investido)

- **Fórmula:** `NOPAT / Capital Investido × 100`
- **Calculado em:** `indicators.ts:184`
- **NOPAT:** `max(0, EBIT Anual × (1 − alíquota marginal efectiva))` — `indicators.ts:175`
- **Alíquota marginal:** `irShieldForRegime()` — 34% se Lucro Real com LAIR > R$ 240k; 24% abaixo; 0% Simples/Presumido.
- **Capital Investido:** `max(1, ciBase − caixaOcioso)` onde `ciBase = PL + D` (lado financiamento, preferencial); fallback para `ativoTotal − PNO`. `indicators.ts:177-183`
- **Interpretação:** ROIC > WACC → empresa cria valor econômico (EVA positivo).

---

### GAO (Grau de Alavancagem Operacional)

- **Fórmula:** `Margem de Contribuição em R$ / EBIT`
- **Calculado em:** `indicators.ts:297`
- **Código:** `mcReais / ebitAnual` (cap −99 / +99)
- **Interpretação:** Elasticidade do lucro à receita — quanto o EBIT varia para cada 1% de variação na receita.

---

### Qualidade do Lucro

- **Fórmula:** `FCF após CAPEX / Lucro Líquido`
- **Calculado em:** `indicators.ts:298-299`
- **Interpretação:** Proporção do lucro contábil que se converte em caixa real. > 1 = excelente; < 0 = lucro não sustentado por caixa.

---

### Indicadores por Colaborador

| Indicador                   | Fórmula                                   | Linha-ref           |
| --------------------------- | ----------------------------------------- | ------------------- |
| `receitaPorColaborador`     | Receita Líquida Anual / headcount         | `indicators.ts:302` |
| `faturamentoPorColaborador` | Receita Bruta Anual / headcount           | `indicators.ts:303` |
| `ebitdaPorColaborador`      | EBITDA Anual / headcount                  | `indicators.ts:304` |
| `lucroPorColaborador`       | Lucro Líquido Anual / headcount           | `indicators.ts:305` |
| `custoPessoalSobreReceita`  | Folha Anual Total / Receita Líquida × 100 | `indicators.ts:307` |

**Input:** `state.numColaboradores`; Folha via `folhaAnual(state)` de `regime.ts`.

---

### Margem de Segurança

- **Fórmula:** `(Receita Líquida − Ponto de Equilíbrio) / Receita Líquida × 100`
- **Calculado em:** `indicators.ts:309-312`
- **Interpretação:** Queda percentual máxima na receita antes de entrar no prejuízo (usando PE Total).

---

## 3. Indicadores de Liquidez

**Arquivo:** `src/engines/finance/indicators.ts:206-230`

### Liquidez Corrente

- **Fórmula:** `Ativo Circulante / Passivo Circulante`
- **Calculado em:** `indicators.ts:221-222`
- **Ativo Circulante:** `capital.ativoCirculante` (quando > 0) ou `disponibilidades + contasReceber_estimado + estoques`
- **Passivo Circulante:** `capital.passivoCirculante` (quando > 0) ou `fornecedores_estimado + D × dividaCurtoPrazoPct`
- **Cap:** 99 (evita infinito quando passivo ≈ 0)

### Liquidez Seca

- **Fórmula:** `(Ativo Circulante − Estoques) / Passivo Circulante`
- **Calculado em:** `indicators.ts:223-226`
- **Estoques usados:** `estoqueMedio = (ei + ef) / 2` quando ambos disponíveis; fallback para `estoqueFinal` ou `capital.estoques`.

### Liquidez Imediata

- **Fórmula:** `Disponibilidades / Passivo Circulante`
- **Calculado em:** `indicators.ts:227-230`
- **Input:** `capital.disponibilidades`

---

## 4. Indicadores de Endividamento

**Arquivo:** `src/engines/finance/indicators.ts:232-268`

### Endividamento Geral

- **Fórmula (dados completos):** `(Ativo Total − PL) / Ativo Total × 100`
- **Fórmula (fallback):** `(D + PNO) / (PL + D + PNO) × 100`
- **Calculado em:** `indicators.ts:233-242`
- **Flag:** `endividamentoGeralDadosCompletos = capital.ativoTotal > 0`
- **Atenção:** Fallback evita exibir "0%" silenciosamente como "sem dívida" quando o consultor não informou o ativo total.

### Grau de Endividamento (Alavancagem Financeira)

- **Fórmula:** `Dívida Onerosa / Patrimônio Líquido × 100`
- **Calculado em:** `indicators.ts:243`

### Dívida Líquida / EBITDA

- **Fórmula:** `(Dívida Onerosa − Caixa Ocioso) / EBITDA Anual`
- **Calculado em:** `indicators.ts:251-256`
- **Dívida Líquida:** `computeNetDebt(state)` de `shared.ts` — SSOT único para todo o sistema.
- **Cap:** ±99.

### Dívida Líquida / EBIT

- **Fórmula:** `Dívida Líquida / EBIT Anual`
- **Calculado em:** `indicators.ts:257-262`

### Dívida Líquida / PL

- **Fórmula:** `Dívida Líquida / Patrimônio Líquido`
- **Calculado em:** `indicators.ts:263-268`

### Cobertura de Juros

- **Fórmula:** `EBIT Anual / Despesas Financeiras Anuais`
- **Calculado em:** `indicators.ts:247-248`
- **Cap:** 999 (quando juros < R$ 1/ano).

### DSCR (Debt Service Coverage Ratio)

- **Fórmula:** `EBITDA Anual / (Juros Anuais + Amortizações de Principal Anuais)`
- **Calculado em:** `indicators.ts:317-323`
- **Flag:** `dscrAmortizacoesInformadas = sum(cashflow.amortizacoes) > 0`. Quando `false`, DSCR ≈ cobertura de juros — resultado pode estar superestimado.
- **Interpretação:** Métrica bancária de cobertura do serviço da dívida. DSCR > 1,2 = confortável.

### Payback do CAPEX

- **Fórmula:** `CAPEX Anual Total / FCF Operacional`
- **Calculado em:** `indicators.ts:289-294`
- **CAPEX Anual:** `sum(cashflow.capex) + sum(capital.capexAtivacao[].valor)` — inclui CAPEX distribuído ao longo do ano.
- **Condição:** `Infinity` quando FCF ≤ 0 ou CAPEX = 0.

### Amortização do PL por Lucro

- **Fórmula:** `Patrimônio Líquido / Lucro Líquido Anual`
- **Calculado em:** `indicators.ts:269-271` (alias `payback` para retrocompat.)
- **Nota:** NÃO é o payback clássico de CAPEX — mede anos para o lucro contábil "recuperar" o PL.

---

## 5. Indicadores de Atividade / Ciclo

**Arquivo:** `src/engines/finance/indicators.ts:192-204`

### PMR (Prazo Médio de Recebimento)

- **Input direto:** `revenue.pmr` (dias) — informado pelo consultor.
- **Usado em:** NCG, DFC (lag de recebimentos), Ciclo Financeiro.

### PMP (Prazo Médio de Pagamento)

- **Input direto:** `revenue.pmp` (dias) — informado pelo consultor.
- **Usado em:** NCG, DFC (lag de pagamentos a fornecedores), Ciclo Financeiro.

### PME (Prazo Médio de Estocagem)

- **Fórmula:** `Estoque Médio / (CPV Anual / 360)`
- **Calculado em:** `indicators.ts:196-197`
- **Estoque Médio:** `(estoqueInicial + estoqueFinal) / 2` quando ambos > 0; fallback `estoqueFinal` ou `capital.estoques`.
- **CPV Diário:** `sum(dre.cpv) / 360`

### Ciclo Operacional

- **Fórmula:** `PMR + PME`
- **Nota:** Não exposto diretamente como campo — derivado implicitamente de PMR e PME.

### Ciclo Financeiro (Ciclo de Caixa)

- **Fórmula:** `PMR + PME − PMP`
- **Calculado em:** `indicators.ts:198`
- **Interpretação:** Dias em que a empresa precisa financiar o giro. Positivo = precisa de capital de giro.

### NCG (Necessidade de Capital de Giro)

- **Fórmula:** `Contas a Receber + Estoque Médio − Fornecedores`
- **Calculado em:** `indicators.ts:203`
- **CR estimado:** `capital.contasReceber` (quando > 0) ou `(receitaLiqAnual/360) × PMR`
- **Fornecedores estimados:** `capital.fornecedores` (quando > 0) ou `(CPV Anual/360) × PMP`
- **Código:** `ncg = crEstimado + estoqueMedio - fornecEstimado`

### Gap de Capital de Giro

- **Fórmula:** `NCG − Capital de Giro Disponível`
- **Calculado em:** `indicators.ts:204`
- **Input:** `capital.capitalGiroDisponivel`

### Giro do Ativo

- **Fórmula:** `Receita Líquida Anual / Ativo Total`
- **Calculado em:** `indicators.ts:249`
- **Condição:** Zero quando `ativoTotal` não informado.

---

## 6. Custo de Capital

**Arquivo:** `src/engines/finance/indicators.ts:161-184`

### WACC (Custo Médio Ponderado de Capital)

- **Fórmula:** `wE × Ke + wD × Kd × (1 − IR Shield)`
- **Calculado em:** `indicators.ts:171`
- **Componentes:**

| Componente  | Descrição                                                                                                                                                       | Fonte                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `wE`        | Peso do capital próprio = `PL / (PL + D)` (fallback: `capital.proprio/100`)                                                                                     | `indicators.ts:165`     |
| `wD`        | Peso do capital de terceiros = `D / (PL + D)`                                                                                                                   | `indicators.ts:166`     |
| `Ke`        | Custo do capital próprio (% a.a.) — input direto `capital.ke`; se vazio, Ke padrão do setor (`KE_DEFAULT_BY_SECTOR`: serviços 18%, comércio 17%, indústria 16%) | `indicators.ts:170-171` |
| `Kd`        | Custo da dívida (% a.a.) — input direto `capital.kd`                                                                                                            | `indicators.ts:171`     |
| `IR Shield` | Escudo fiscal de juros — `irShieldForRegime()` de `tax/real.ts:202-204`                                                                                         | `indicators.ts:169`     |

**Escudo Fiscal (`irShieldForRegime`):**

- Lucro Real com LAIR > R$ 240k → **34%** (15% IRPJ + 10% Adicional + 9% CSLL)
- Lucro Real com LAIR ≤ R$ 240k → **24%** (15% IRPJ + 9% CSLL, sem adicional)
- Simples / Presumido → **0%** (não captura escudo)
- Arquivo: `tax/real.ts:202-204`

**Nota:** O Ke informado pelo consultor deve incorporar o CAPM internamente (o sistema não calcula beta automaticamente). A fórmula CAPM sugerida é `Ke = Rf + β × (Rm − Rf) + prêmio país`, onde Rf = taxa livre de risco (IPCA + spread), Rm = retorno do mercado.

### EVA / Spread Econômico

- **Fórmula:** `EVA = NOPAT − (WACC% / 100) × Capital Investido`
- **Não é um campo direto** — derivado de `roic` e `wacc`:
  - `EVA > 0` quando `ROIC > WACC` (empresa cria valor)
  - Reportado na narrativa de Valuation: `indicators.ts (via valuation.ts:309-310)`

---

## 7. Valuation

- **Arquivo:** `src/engines/finance/valuation.ts`
- **Função principal:** `buildValuation(state, params, precomputed?)`
- **Retorno:** `ValuationResult`

### Presets por Tipo de Negócio

| Segmento  | EV/EBITDA (P/B/O) | EV/Receita (P/B/O) | P/L (P/B/O)  | g terminal |
| --------- | ----------------- | ------------------ | ------------ | ---------- |
| Serviços  | 4,0 / 5,5 / 7,0×  | 0,8 / 1,3 / 2,0×   | 8 / 12 / 18× | 2,5%       |
| Comércio  | 3,0 / 4,0 / 5,5×  | 0,4 / 0,7 / 1,1×   | 6 / 9 / 14×  | 1,5%       |
| Indústria | 4,5 / 6,0 / 8,0×  | 0,7 / 1,1 / 1,6×   | 9 / 13 / 20× | 2,0%       |

Arquivo: `valuation.ts:81-108`

---

### Método de Múltiplos

- **Calculado em:** `valuation.ts:154-182` (função `buildMultiples`)
- **Ponderação:** EV/EBITDA 50% · EV/Receita 30% · P/L 20% (pesos renormalizados pelos múltiplos > 0)

| Múltiplo       | Fórmula                                                           | Nota                                                                                    |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| EV via EBITDA  | `max(0, EBITDA) × evEbitdaMultiple`                               | EBITDA anual da DRE                                                                     |
| EV via Receita | `max(0, Receita Bruta) × evRevenueMultiple`                       | Receita bruta anual                                                                     |
| Equity via P/L | `max(0, LL) × plMultiple`                                         | Equity Value; convertido para EV: `equityFromPL + Dívida Líquida` — evita dupla dedução |
| EV Ponderado   | `(EV_EBITDA×0.5 + EV_Receita×0.3 + EV_implícito_PL×0.2) / wTotal` |                                                                                         |

---

### Método DCF

- **Calculado em:** `valuation.ts:187-252` (função `buildDCF`)
- **Fluxos:** `buildForecast()` gera FCL mensal; VPL calculado via `vplExcel` (formulajs NPV, convenção Excel — desconta a partir do período 1).
- **Fórmula VPL:** `Σ FCL_t / (1 + wacc_mensal)^t` para `t = 1..N`
- **Valor Terminal (Gordon):** `FCL_LTM / (WACC_anual − g)`
  - `FCL_LTM` = soma dos últimos 12 meses projetados (período T — sem aplicar (1+g) extra)
  - Fallback quando spread < 0,5pp: `FCL_LTM × 5`
- **VP do Terminal:** `VT / (1 + wacc_mensal)^N`
- **EV DCF:** `VPN_fluxos + VP_terminal`
- **WACC default:** 10% quando não definido (alerta explícito)
- **Arquivo:** `valuation.ts:209-240`

---

### Método Blended

- **Fórmula:** `(EV_Múltiplos + EV_DCF) / 2`
- **Calculado em:** `valuation.ts:350-354`

---

### Ajustes pós-EV

| Ajuste              | Fórmula                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Controle            | `EV × (1 + controlPremium)`                                        |
| Liquidez            | `EV × (1 − liquidityDiscount)` — default 15%                       |
| Haircut Estratégico | `EV × (1 − haircut)` — de `computeStrategic()`, 0–40%              |
| Equity Value        | `max(0, EV − Dívida Líquida)`                                      |
| Faixa (low/high)    | `EV × 0,75 / × 1,35` (com DCF) ou `× 0,90 / × 1,15` (só múltiplos) |

---

### Confidence Grade

| Score | Grade | Gatilhos de penalidade |
| ----- | ----- | ---------------------- |
| ≥ 85  | A     | —                      |
| 70–84 | B     | —                      |
| 55–69 | C     | —                      |
| 40–54 | D     | —                      |
| < 40  | E     | —                      |

Penalidades: análise estratégica não preenchida (−25), risco estratégico elevado (−15), estrutura de capital não informada (−20), Ke/Kd não definidos (−10), g > 5% (−10), WACC fora de faixa (−15). Arquivo: `valuation.ts:257-296`.

---

### Memória de Cálculo (ValuationTrace)

- **Função:** `traceValuation(state, params, precomputed?)`
- **Retorno:** `ValuationTrace` com `inputs` e `steps[]` (label, fórmula, value, note)
- **Uso:** Auditoria e relatórios para consultores/CVM.
- **Arquivo:** `valuation.ts:399-fim`

---

## 8. Análise de Risco / Cenários

### 8.1 Monte Carlo

- **Arquivo:** `src/engines/finance/montecarlo.ts`
- **Função principal:** `runMonteCarlo(state: AppState, cfg: MCConfig): MCResult`
- **Padrão:** 1.000 iterações

#### Variáveis de Choque

| Variável         | Sigma default | Descrição                             |
| ---------------- | ------------- | ------------------------------------- |
| `precoSigmaPct`  | 5%            | Desvio-padrão do crescimento de preço |
| `volumeSigmaPct` | 8%            | Desvio-padrão do volume/demanda       |
| `cpvSigmaPct`    | 5%            | Desvio-padrão do custo de vendas      |
| `folhaSigmaPct`  | 3%            | Desvio-padrão da folha de salários    |

#### Geração de Números Aleatórios — Box-Muller

```
u = max(1e-9, random())
v = random()
z = sqrt(-2 × ln(u)) × cos(2π × v)
```

`montecarlo.ts:85-88`

#### Correlação entre Variáveis — Cholesky

- Decompõe a matriz de correlação 4×4 em L triangular inferior: `L × Lᵀ = Σ`
- Gera choques correlacionados: `z_correlacionado = L × z_independente`
- Se a matriz não é positiva-definida → fallback para identidade (choques independentes); campo `correlationFellBackToIdentity = true`
- Algoritmo: `montecarlo.ts:98-118`

#### Matriz de Correlações Default

```
             preço  volume   CPV   folha
preço        1.00   -0.30   0.20   0.10   ← lei da demanda; repasse inflacionário
volume      -0.30    1.00  -0.20   0.30   ← economias de escala; horas extras
CPV          0.20   -0.20   1.00   0.40   ← inflação setorial; câmbio
folha        0.10    0.30   0.40   1.00   ← dissídios; reajustes
```

`montecarlo.ts:37-42`

#### Aplicação dos Choques

| Variável shockada      | Fórmula                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| Receita                | `receitaBruta[i] × (1 + zPreco × sigma_preco/100) × (1 + zVol × sigma_vol/100)` |
| CPV                    | `cpv[i] × fVol × fCpv`                                                          |
| Custos variáveis       | `valor × fVol`                                                                  |
| Folha (CLT/pró-labore) | `valor × fFolha`                                                                |

`montecarlo.ts:142-162`

#### Outputs

| Campo               | Fórmula                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `ebitda`            | Distribuição do EBITDA anual — MCDist (mean, median, P5, P25, P75, P95) |
| `lucroLiquido`      | Distribuição do Lucro Líquido anual                                     |
| `saldoCaixaFinal`   | Distribuição do saldo de caixa de dezembro                              |
| `probPrejuizo`      | `count(ll < 0) / iterations`                                            |
| `probCaixaNegativo` | `count(saldo < caixaMinimo) / iterations`                               |

**Percentil sem viés:** `idx = floor(p/100 × (n−1))` — corrige deslocamento de ~0,5pp em séries de 200 iterações. `montecarlo.ts:170-172`

---

### 8.2 Análise de Sensibilidade

- **Arquivo:** `src/engines/finance/sensitivity.ts`
- **Função principal:** `runSensitivity(state, output, drivers?)`
- **Deltas testados:** −15%, −10%, −5%, +5%, +10%, +15%

#### Drivers disponíveis

| Driver   | O que muda                                                           |
| -------- | -------------------------------------------------------------------- |
| `preco`  | Receita bruta (× fator, custos inalterados)                          |
| `volume` | Receita bruta + custos variáveis (CPV + `variavel` + `direto_venda`) |
| `cpv`    | Custos `custo_vendas` e `direto_venda`                               |
| `folha`  | Custos com `encargosAuto` ou label de folha                          |
| `fixos`  | Custos `fixo` não-folha                                              |
| `juros`  | Custos `financeiro`                                                  |

#### Outputs disponíveis

| Output         | Fórmula                             |
| -------------- | ----------------------------------- |
| `ebitda`       | `sum(dre.ebitda)`                   |
| `lucroLiquido` | `sum(dre.lucroLiquido)`             |
| `saldoCaixa`   | `buildCashFlow().totais.saldoFinal` |
| `roic`         | `calcIndicators().roic`             |

#### Elasticidade

- **Fórmula:** `% variação output / % variação input` (média dos deltas testados)
- Rows ordenadas por `|elasticidade|` decrescente (drivers mais críticos primeiro).
- `sensitivity.ts:104-111`

---

## 9. Tributação Brasileira

### 9.1 Simples Nacional

- **Arquivo:** `src/engines/finance/tax/simples.ts`
- **Função:** `calcSimples(state: AppState): MonthlyTax`

#### Fórmula da Alíquota Efetiva

```
AliqEfetiva(%) = max(0, (RBT12 × AliqNominal − ParcelaADeduzir) / RBT12) × 100
```

`simples.ts:17-26`

**Onde:** RBT12 = Receita Bruta dos últimos 12 meses; tabela por Anexo (I a V) em `taxDefaults.ts`.

#### DAS Mensal

```
DAS[i] = receitaTributavel[i] × (AliqEfetiva / 100)
```

- **Limite Simples:** configurável em `taxDefaults.ts` (default R$ 4,8M/ano).
- **Excedeu limite:** campo `detail` exibe aviso de desenquadramento obrigatório.
- **Separação:** `monthlyVendas = DAS` (tudo na linha de impostos sobre venda); `monthlyLucro = zeros12()` (IRPJ/CSLL dentro do DAS).
- **Anexo:** resolvido por `resolveSimplesAnexo(state)` de `regime.ts`.

**[CBS/IBS]:** Simples Nacional mantém opção de permanecer no DAS único (LC 214/2025 art. 41). Quem optar NÃO compõe CBS/IBS separadamente. `simples.ts:7`

---

### 9.2 Lucro Presumido

- **Arquivo:** `src/engines/finance/tax/presumido.ts`
- **Função:** `calcPresumido(state: AppState): MonthlyTax`

#### Tributos calculados

| Tributo             | Base                                        | Alíquota / Regra                                                         |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| IRPJ                | `receitaTributavel × baseIRPJ%`             | 15% sobre base; tabela `getIrpjPct(tax)`                                 |
| Adicional IRPJ      | base trimestral > R$ 60k                    | 10% sobre excedente; `adicionalIrpjTrimestral()` — `tax/shared.ts:29-43` |
| CSLL                | `receitaTributavel × baseCSLL%`             | 9%; tabela `getCsllPct(tax)`                                             |
| PIS (cumulativo)    | `receitaTributavel`                         | 0,65% × `pisCofinsMult`                                                  |
| COFINS (cumulativo) | `receitaTributavel`                         | 3% × `pisCofinsMult`                                                     |
| ISS/ICMS            | `(receitaTributavel − deducoes) × issIcms%` | `icmsIssMult`; crédito ICMS de entrada                                   |
| CBS `[CBS/IBS]`     | `receitaTributavel × cbsPct%`               | NÃO-cumulativo; crédito sobre CPV                                        |
| IBS `[CBS/IBS]`     | `receitaTributavel × ibsPct%`               | NÃO-cumulativo; crédito sobre CPV                                        |

**Bases de presunção (default LC 9.249/95):**

- Serviços: IRPJ 32%, CSLL 32%
- Comércio: IRPJ 8%, CSLL 12%
- Indústria: IRPJ 8%, CSLL 12%
- Overrides via `tax.presumidoBaseIRPJ` / `tax.presumidoBaseCSLL`

**Receitas Financeiras no Presumido:** entram INTEGRAIS na base IRPJ/CSLL (sem redutor de 8/32%). Rendimentos com tributação exclusiva na fonte são excluídos. `presumido.ts:67-70`

**Crédito ICMS de entrada:** `cpvMonthly[i] × icmsCredAliq + saldoCredorICMS` (carryforward acumulável). `presumido.ts:93-96`

---

### 9.3 Lucro Real

- **Arquivo:** `src/engines/finance/tax/real.ts`
- **Função:** `calcReal(state: AppState, baseLairMonthly: number[]): MonthlyTax`

#### Tributos calculados

| Tributo                 | Base                                                            | Alíquota / Regra                                                  |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| IRPJ                    | LAIR trimestral − carryforward prejuízo (Lei 9.065/95, máx 30%) | 15%; `getIrpjPct(tax)`                                            |
| Adicional IRPJ          | base trimestral > gatilho                                       | 10%; `adicionalIrpjTrimestral()`                                  |
| CSLL                    | LAIR mensal                                                     | 9%; `getCsllPct(tax)`                                             |
| PIS (não-cumulativo)    | `receitaTributavel − créditosPIS`                               | 1,65% × `pisCofinsMult`; crédito acumulável                       |
| COFINS (não-cumulativo) | `receitaTributavel − créditosCOFINS`                            | 7,6% × `pisCofinsMult`; crédito acumulável                        |
| PIS/COFINS s/ Rec. Fin. | `rendimentosFinanceiros`                                        | 0,65% + 4% (Decreto 8.426/2015); extinto quando `pisCofinsMult=0` |
| ISS/ICMS                | igual ao Presumido                                              | crédito ICMS de entrada                                           |
| CBS `[CBS/IBS]`         | igual ao Presumido                                              | não-cumulativo                                                    |
| IBS `[CBS/IBS]`         | igual ao Presumido                                              | não-cumulativo                                                    |

**Carryforward de Prejuízo Fiscal (Lei 9.065/95 art. 42):**

- Apuração trimestral.
- Prejuízo de trimestres anteriores compensa até 30% do lucro dos trimestres seguintes.
- Sem isso, empresas sazonais com Q1 negativo pagam IRPJ/CSLL sem compensação no Q2+.
- `real.ts:51-82`

**Saldo Credor PIS/COFINS:** acumulável mês a mês (créditos do mês excedem débito → rola para o mês seguinte). `real.ts:110-127`

---

### 9.4 Reforma Tributária (CBS/IBS — EC 132/2023 + LC 214/2025) `[CBS/IBS]`

- **Arquivo:** `src/engines/finance/tax/reforma.ts`
- **Função principal:** `getReformaRates(era, cfg): ReformaRates`
- **Função por ano:** `getReformaRatesForYear(year, cfg): ReformaRates`

#### Eras disponíveis

| Era (`TaxEra`) | CBS       | IBS             | PIS/COFINS | ICMS/ISS      |
| -------------- | --------- | --------------- | ---------- | ------------- |
| `"atual"`      | 0%        | 0%              | 100%       | 100%          |
| `"transicao"`  | CBS plena | IBS × `ibsMult` | 0%         | `icmsIssMult` |
| `"pleno"`      | CBS plena | IBS plena       | 0%         | 0%            |

**Alíquotas de referência (configuráveis):**

- CBS: `cfg.cbsAliquota` (default **8,8%**)
- IBS: `cfg.ibsAliquotaRef` (default **17,7%**)

#### Cronograma oficial ano a ano

| Ano   | CBS          | IBS (% do pleno) | PIS/COFINS | ICMS/ISS |
| ----- | ------------ | ---------------- | ---------- | -------- |
| 2025  | 0%           | 0%               | 100%       | 100%     |
| 2026  | 0,9% (teste) | 0,1% absoluto    | 100%       | 100%     |
| 2027  | CBS plena    | ~0%              | 0%         | 100%     |
| 2028  | CBS plena    | ~0%              | 0%         | 100%     |
| 2029  | CBS plena    | 10%              | 0%         | 90%      |
| 2030  | CBS plena    | 20%              | 0%         | 80%      |
| 2031  | CBS plena    | 30%              | 0%         | 70%      |
| 2032  | CBS plena    | 40%              | 0%         | 60%      |
| 2033+ | CBS plena    | 100%             | 0%         | 0%       |

`reforma.ts:51-78`

**Carga Combinada Estimada:** `CBS% + IBS% + ICMS_legado × icmsIssFraction`
**Alerta de transição:** `alertaTransicao = true` quando carga combinada > carga atual + 0,01pp. `reforma.ts:104-114`

**Créditos CBS/IBS:** ambos são não-cumulativos plenos — crédito sobre CPV deduzido mensalmente com saldo credor acumulável. `real.ts:140-151`, `presumido.ts:99-110`

---

### 9.5 Tabela Comparativa de Regimes

- **Arquivo:** `src/engines/finance/tax/compare.ts`
- **Uso:** Comparação simultânea dos três regimes para apoio à decisão de enquadramento.

---

## 10. Calculadoras Avulsas

### 10.1 CLT vs PJ

- **Arquivo:** `src/engines/calculadoras/cltVsPj.ts`
- **Função principal:** `compararCltVsPj(input: CltVsPjInput): ComparativoCltVsPj`
- **Regimes PJ comparados:** MEI, Simples Nacional (Anexo III), Lucro Presumido

#### CLT — Cálculo de Renda Líquida

| Item                 | Fórmula                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| INSS Mensal          | Progressivo por faixas 2025 (7,5% / 9% / 12% / 14%) — `calcularINSS()` em `rescisao.ts:78-90`         |
| IRRF Mensal          | Sobre `salário − INSS − dependentes × R$ 189,59` — `calcularIRRF()` em `rescisao.ts:93-102`           |
| Líquido Mensal       | `salário − INSS − IRRF`                                                                               |
| 13º Líquido          | INSS + IRRF calculados separadamente                                                                  |
| Férias Líquidas      | Base = `salário + salário/3`; INSS + IRRF sobre a base                                                |
| PLR Líquido          | Tabela exclusiva anual (Lei 14.020/2020): isenção até R$ 7.640,80 — `irrfPlr()` em `cltVsPj.ts:79-84` |
| FGTS Anual           | `salário × 8% × 12` (depositado pela empresa)                                                         |
| Multa FGTS Potencial | `fgtsAnual × 40%`                                                                                     |
| Total Anual Líquido  | `liquidoAnual + 13ºLíquido + fériasLíquidas + PLRLíquido + benefíciosAnuais`                          |

#### PJ — Cálculo por Regime

| Regime           | Impostos                                                                                | Pró-labore                                  | Limite Anual |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | ------------ |
| MEI              | DAS fixo ~R$ 80/mês                                                                     | Mínimo 1 SM (INSS 5% embutido no DAS)       | R$ 81.000    |
| Simples Nacional | Alíquota efetiva Anexo III progressiva                                                  | 11% INSS sobre pró-labore (até teto) + IRRF | R$ 4,8M      |
| Lucro Presumido  | ~16,33% sobre faturamento (IRPJ 15%×32% + CSLL 9%×32% + PIS 0,65% + COFINS 3% + ISS 5%) | 11% INSS + IRRF                             | R$ 78M       |

**Alíquota Simples Anexo III:**

```
rbt12 = faturamentoMensal × 12
efetiva = (rbt12 × aliqNominal − parcelaADeduzir) / rbt12
```

`cltVsPj.ts:56-64`

**Faturamento de Empate:** busca binária (60 iterações) do faturamento PJ que iguala o líquido mensal equivalente CLT. `cltVsPj.ts:262-272`

---

### 10.2 Custo Real do Funcionário CLT

- **Arquivo:** `src/engines/calculadoras/custoFuncionario.ts`
- **Função:** `calcularCustoFuncionario(input): CustoFuncionarioOutput`
- **Bases legais:** INSS Patronal 20% (Lei 8.212/91 art. 22, I); RAT 1/2/3% (Lei 8.212/91 art. 22, II + Decreto 6.957/09); Sistema S ~5,8%; FGTS 8% (Lei 8.036/90 art. 15); VT excedente a 6% do salário (Lei 7.418/85 art. 4º).

#### Componentes do Custo Mensal

| Componente                      | Fórmula                                 | Regime Simples?                   |
| ------------------------------- | --------------------------------------- | --------------------------------- |
| INSS Patronal                   | `salário × 20%`                         | Embutido no DAS (exceto Anexo IV) |
| RAT                             | `salário × (1% / 2% / 3%)`              | Sempre devido                     |
| Sistema S (Terceiros)           | `salário × 5,8%` (default)              | Embutido no DAS                   |
| FGTS                            | `salário × 8%`                          | Sempre devido                     |
| Provisão 13º                    | `salário × 1/12`                        | —                                 |
| FGTS sobre 13º                  | `salário × 0,8/12`                      | —                                 |
| Provisão Férias                 | `salário × (1/12 × 4/3)`                | —                                 |
| FGTS sobre Férias               | `salário × 0,08 × (1/12 × 4/3)`         | —                                 |
| Encargos patronais sobre 13º    | `salário × (1/12) × aliqPatronal`       | —                                 |
| Encargos patronais sobre Férias | `salário × (1/12 × 4/3) × aliqPatronal` | —                                 |
| VT (custo empresa)              | `max(0, custoVT − 6% × salário)`        | —                                 |
| VR, Plano Saúde, Outros         | valor direto                            | —                                 |

```
custoMensal = salário + encargos + provisões + benefícios
fatorMultiplicador = custoMensal / salário
```

`custoFuncionario.ts:271-273`

---

### 10.3 Rescisão CLT

- **Arquivo:** `src/engines/calculadoras/rescisao.ts`
- **Função:** `calcularRescisao(input): RescisaoOutput`
- **Bases legais:** CLT arts. 477, 478, 479, 480, 482, 484-A, 487-491; Lei 12.506/2011; Lei 8.036/90 art. 18; STJ REsp 1.230.957; STF Tema 985.

#### Verbas por Motivo de Rescisão

| Motivo              | Saldo | 13º Prop. | Férias Prop. | Aviso    | Multa FGTS | Saque FGTS |
| ------------------- | ----- | --------- | ------------ | -------- | ---------- | ---------- |
| Sem Justa Causa     | ✓     | ✓         | ✓            | Integral | 40%        | 100%       |
| Rescisão Indireta   | ✓     | ✓         | ✓            | Integral | 40%        | 100%       |
| Acordo 484-A        | ✓     | ✓         | ✓            | 50%      | 20%        | 80%        |
| Pedido de Demissão  | ✓     | ✓         | ✓            | —        | —          | —          |
| Justa Causa         | ✓     | —         | —            | —        | —          | —          |
| Término Experiência | ✓     | ✓         | ✓            | —        | —          | 100%       |

**Aviso Prévio Proporcional (Lei 12.506/2011):**

```
dias = min(90, 30 + floor(anosNaEmpresa) × 3)
```

`rescisao.ts:244-247`

**INSS/IRRF isentos:** aviso prévio indenizado e férias indenizadas + 1/3 (STJ REsp 1.230.957; STF Tema 985). `rescisao.ts:277-285`

**Tabelas 2025:**

- INSS progressivo: 7,5% até R$ 1.518 / 9% até R$ 2.793,88 / 12% até R$ 4.190,83 / 14% até R$ 8.157,41. `rescisao.ts:58-63`
- IRRF: 0% até R$ 2.428,80 / 7,5% até R$ 2.826,65 / 15% até R$ 3.751,05 / 22,5% até R$ 4.664,68 / 27,5% acima. Deduç. R$ 189,59/dependente. `rescisao.ts:66-76`

**Indenização Experiência (arts. 479/480):**

- Empregador rompe: `50% × diasRestantes × salário/30`
- Empregado rompe: desconto de `50% × diasRestantes × salário/30`

---

### 10.4 SAC vs PRICE (Financiamento)

- **Arquivo:** `src/engines/calculadoras/sacPrice.ts`
- **Funções:** `calcularSAC()`, `calcularPRICE()`, `simularSacPrice()`

#### SAC (Sistema de Amortização Constante)

```
amortização = PV / n (constante)
juros[t]    = saldoDevedor[t-1] × taxaMensal
parcela[t]  = amortização + juros[t]     ← decrescente ao longo do tempo
```

`sacPrice.ts:45-72`

#### PRICE (Sistema Francês)

```
parcela_fixa = PV × [i × (1+i)^n] / [(1+i)^n − 1]  ← PMT via formulajs
juros[t]     = saldoDevedor[t-1] × i
amort[t]     = parcela_fixa − juros[t]               ← crescente ao longo do tempo
```

`sacPrice.ts:74-105`

**Conversão taxa:** `(1 + taxaAnualPct/100)^(1/12) − 1` → `sacPrice.ts:38-40`

**Comparativo:** `economiaJurosSac = price.totalJuros − sac.totalJuros`

---

### 10.5 Calculadoras adicionais (utils.ts)

- **Arquivo:** `src/engines/calculadoras/utils.ts`
- **Função:** `round2(n: number): number` — arredondamento para 2 casas decimais (centavos), usada em todos os cálculos das calculadoras avulsas.

---

## 11. Forecast / Projeção

- **Arquivo:** `src/engines/finance/forecast.ts`
- **Função principal:** `buildForecast(state: AppState, cfg: ForecastConfig): ForecastResult`
- **Horizonte default:** 36 meses (configurável via `ForecastConfig.horizonteMeses`)

### Configurações (ForecastConfig)

| Parâmetro              | Default | Descrição                                        |
| ---------------------- | ------- | ------------------------------------------------ |
| `crescimentoMensalPct` | 1,0%    | Crescimento composto mensal da receita           |
| `inflacaoFixosAA`      | 5%      | Inflação anual sobre custos fixos não-folha      |
| `ganhoEscalaCpvAA`     | 0%      | Ganho de escala anual no CPV (reduz CPV/receita) |
| `stepReceitaPct`       | 50%     | A cada X% de receita extra, folha sobe 1 step    |
| `stepFolhaPct`         | 25%     | Incremento de folha por step                     |
| `horizonteMeses`       | 36      | Número de meses projetados                       |
| `capexInicial`         | 0       | Investimento inicial no t=0                      |

### Lógica de Projeção Mês a Mês

| Componente              | Fórmula                                                                                                     | Arquivo:Linha         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- |
| Receita                 | `receitaBase[mes] × (1+g)^i`                                                                                | `forecast.ts:162-163` |
| CPV não-folha           | `receita × cpvNaoFolhaRatio × (1 − ganhoEscalaCpvAA/100)^(i/12)`                                            | `forecast.ts:166`     |
| Variáveis não-CPV       | `receita × variaveisRatioBase`                                                                              | `forecast.ts:169`     |
| Folha (steps discretos) | `folhaMensalBase × (1 + stepFolhaPct/100)^steps` onde `steps = floor((crescVsBase × 100) / stepReceitaPct)` | `forecast.ts:173-179` |
| Fixos não-folha         | `fixosMensalBase × (1 + inflacaoAA/100)^(i/12)`                                                             | `forecast.ts:184-185` |
| EBITDA                  | `receita − cpv − despesasOp`                                                                                | `forecast.ts:189`     |
| EBIT                    | `EBITDA − depMensal`                                                                                        | `forecast.ts:190`     |
| Resultado Financeiro    | `receita × resultadoFinanceiroRatioBase` (proporção do ano-base)                                            | `forecast.ts:191`     |
| Impostos sobre venda    | `receita × taxVendasRatio`                                                                                  | `forecast.ts:195`     |
| Impostos sobre lucro    | `max(0, LAIR_projetado) × taxLucroRatio`                                                                    | `forecast.ts:196`     |
| NCG                     | `CR_T + estoque_T − fornec_T` (recalculada mês a mês via PMR/PMP)                                           | `forecast.ts:200-204` |
| ΔNCG                    | `NCG_T − NCG_{T-1}`                                                                                         | `forecast.ts:205`     |
| FCL                     | `EBITDA + resultadoFinanceiro − impostos − capex − ΔNCG`                                                    | `forecast.ts:211`     |

**Separação dos impostos (Auditoria #4):** `taxVendasRatio = sum(monthlyVendas) / receitaAnoBase` e `taxLucroRatio = sum(monthlyLucro) / max(1, LAIRAnoBase)` — evita distorção quando margem muda vs ano-base. `forecast.ts:97-99`

**Depreciação:** média anual (`sum(depreciacao)/12`) — evita distorção por ativações no meio do ano (Auditoria #6). `forecast.ts:92`

### Outputs do Forecast

| Campo                           | Descrição                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `meses[]`                       | Array de `ForecastMonth` com receita, EBITDA, LL, NCG, ΔNCG, FCL, saldoCaixa acumulado |
| `totalReceita/Ebitda/Lucro/Fcl` | Somas do período                                                                       |
| `vpl`                           | VPL via WACC — `vplClassico(i_m, [-capexInicial, ...fcl])` usando `external.ts`        |
| `tir`                           | TIR via Newton-Raphson + bisseção (`irrDetailed`) — %a.m.                              |
| `paybackMeses`                  | Primeiro mês em que o fluxo acumulado ≥ 0                                              |
| `taxaDescontoMensal`            | WACC mensal equivalente usado no VPL                                                   |

**TIR:** Newton-Raphson (80 iterações) → fallback bisseção (200 iterações). Retorna `null` quando não converge ou fluxos sem sinais opostos. `forecast.ts:262-296`

---

## 12. Biblioteca Externa Centralizada

- **Arquivo:** `src/engines/finance/external.ts`
- **Propósito:** Camada de tradução única para `@formulajs/formulajs` e `simple-statistics`. Trocar de biblioteca = alterar apenas este arquivo.

### Funções Financeiras (formulajs)

| Nome PT-BR               | Origem         | Descrição                                               |
| ------------------------ | -------------- | ------------------------------------------------------- |
| `vplExcel`               | `NPV`          | VPL estilo Excel — desconta a partir do período 1       |
| `vplClassico`            | `NPV` + ajuste | VPL com fluxo[0] no presente (período 0 não descontado) |
| `tir`                    | `IRR`          | TIR — fluxo[0] = investimento (negativo)                |
| `tirModificada`          | `MIRR`         | TIR Modificada (tx reinvestimento ≠ tx financiamento)   |
| `vplDatasIrregulares`    | `XNPV`         | VPL com datas irregulares                               |
| `tirDatasIrregulares`    | `XIRR`         | TIR com datas irregulares                               |
| `parcela`                | `PMT`          | Parcela de financiamento                                |
| `valorPresente`          | `PV`           | Valor presente                                          |
| `valorFuturo`            | `FV`           | Valor futuro                                            |
| `numeroPeriodos`         | `NPER`         | Número de períodos                                      |
| `taxaJuros`              | `RATE`         | Taxa de juros por período                               |
| `jurosParcela`           | `IPMT`         | Juros de parcela específica                             |
| `amortizacaoParcela`     | `PPMT`         | Amortização de parcela específica                       |
| `jurosAcumulados`        | `CUMIPMT`      | Juros acumulados entre períodos                         |
| `amortizacaoAcumulada`   | `CUMPRINC`     | Amortização acumulada entre períodos                    |
| `depreciacaoLinear`      | `SLN`          | Depreciação linear (Straight-Line)                      |
| `depreciacaoSaldoFixo`   | `DB`           | Depreciação por saldo decrescente fixo                  |
| `depreciacaoSaldoDuplo`  | `DDB`          | Depreciação duplo declínio                              |
| `depreciacaoSomaDigitos` | `SYD`          | Depreciação soma dos dígitos                            |

### Funções Estatísticas (simple-statistics)

| Nome PT-BR          | Origem                 | Uso                  |
| ------------------- | ---------------------- | -------------------- |
| `media`             | `mean`                 | Monte Carlo, análise |
| `mediana`           | `median`               | Monte Carlo          |
| `desvioPadrao`      | `standardDeviation`    | Monte Carlo          |
| `variancia`         | `variance`             | —                    |
| `quantil`           | `quantile`             | P5, P25, P75, P95    |
| `correlacao`        | `sampleCorrelation`    | —                    |
| `regressaoLinear`   | `linearRegression`     | —                    |
| `linhaRegressao`    | `linearRegressionLine` | —                    |
| `minimo` / `maximo` | `min` / `max`          | —                    |
| `somatorio`         | `sum`                  | —                    |

**Convenção de fluxo de caixa para VPL/TIR:**

- `flows[0]` = investimento inicial (negativo, período 0)
- `flows[1..n]` = entradas líquidas por período
- `vplExcel` desconta todos a partir do período 1 (convenção Excel)
- `vplClassico` não desconta o período 0

**Quando usar:** sempre que precisar de VPL/TIR/PMT/depreciação ou estatísticas, importar de `external.ts` — não importar diretamente de `@formulajs/formulajs` ou `simple-statistics`.

---

## Anexo A — Mapa de Dependências

```
buildDRE (dre.ts)
├── computeImpostosVendas
│   ├── calcSimples (tax/simples.ts)
│   │   └── simplesAliquotaEfetiva → getSimplesTable (taxDefaults.ts)
│   ├── calcPresumido (tax/presumido.ts)
│   │   ├── getPresumidoBases (taxDefaults.ts)
│   │   ├── adicionalIrpjTrimestral (tax/shared.ts)
│   │   └── getReformaRates (tax/reforma.ts)
│   └── calcReal (tax/real.ts)
│       ├── adicionalIrpjTrimestral (tax/shared.ts)
│       └── getReformaRates (tax/reforma.ts)
├── classifyCosts
│   └── effectiveMonthValues (costs.ts)
├── computeDepreciacao
│   └── fill12 (format.ts)
├── computeImpostosLucro
│   └── calcReal (tax/real.ts) [só Lucro Real]
└── shared.ts: outrasDeducoesMensal, splitReceitasFinanceiras

calcIndicators (indicators.ts)
├── DRE (buildDRE output)
├── irShieldForRegime (tax/real.ts)
├── resolveEffectiveRegime (regime.ts)
├── computeNetDebt (shared.ts) [SSOT-1]
└── folhaAnual (regime.ts)

buildCashFlow (cashflow.ts)
├── buildDRE (dre.ts)
├── shiftByDaysSplit / shiftByDaysSplitMonthly
├── computeRecebimentos / computeFornecedores / computeImpostos
├── computePagamentosOperacionais
├── computeFluxos / computeSaldos / computeAlertas
└── splitReceitasFinanceiras (shared.ts)

buildValuation (valuation.ts)
├── buildDRE (dre.ts)
├── calcIndicators (indicators.ts)
├── buildForecast (forecast.ts)
│   ├── buildDRE (dre.ts)
│   ├── calcIndicators (indicators.ts)
│   └── vplClassico (external.ts)
├── computeStrategic (strategic.ts)
├── buildMultiples [interno]
├── buildDCF [interno]
│   └── vplExcel (external.ts)
└── computeNetDebt (shared.ts) [SSOT-1]

runMonteCarlo (montecarlo.ts)
├── choleskyDecompose [interno]
├── shockState [interno]
├── buildDRE (dre.ts)
├── buildCashFlow (cashflow.ts)
└── resolveEffectiveRegime (regime.ts)

runSensitivity (sensitivity.ts)
├── applyDriver [interno]
├── buildDRE (dre.ts)
├── calcIndicators (indicators.ts)
└── buildCashFlow (cashflow.ts)

--- Calculadoras Avulsas (sem dependência da engine principal) ---

compararCltVsPj (cltVsPj.ts)
├── calcularCLT → calcularINSS, calcularIRRF (rescisao.ts)
├── calcularPJ → aliquotaSimplesAnexoIII [interno]
└── irrfPlr [interno]

calcularCustoFuncionario (custoFuncionario.ts)
└── round2 (utils.ts)

calcularRescisao (rescisao.ts)
├── calcularINSS, calcularIRRF [internos]
├── diasAvisoProporcional [interno]
└── round2 (utils.ts)

simularSacPrice (sacPrice.ts)
├── calcularSAC / calcularPRICE [internos]
├── parcela / PMT (external.ts via import)
└── round2 (utils.ts)
```

---

## Anexo B — Convenções

### Sinais

| Regra                                        | Detalhe                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Entradas (receitas, rendimentos)             | **positivo**                                                      |
| Saídas (custos, impostos, capex, dividendos) | **positivo** (o sinal negativo é aplicado na composição do fluxo) |
| Resultado Financeiro                         | pode ser negativo (empresa alavancada: juros > rendimentos)       |
| Dívida Líquida                               | `D − Caixa`; negativo = caixa > dívida (posição de caixa líquida) |
| Fluxo de Investimento                        | sempre negativo na DFC (`−capex[i]`)                              |

### Unidades

| Tipo                  | Unidade                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| Valores monetários    | R$ (reais)                                                                |
| Percentuais           | % (0 a 100, não frações) — exceto internamente onde `mcFrac = margem/100` |
| Prazos (PMR, PMP)     | dias                                                                      |
| Taxas (WACC, Ke, Kd)  | % ao ano                                                                  |
| Alíquotas tributárias | % (0 a 100)                                                               |

### Períodos

| Conceito              | Convenção                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| Série mensal          | Array `number[12]`, índice 0 = Janeiro                                  |
| Anual                 | `sum(array12)` via `format.ts:sum()`                                    |
| Período DRE           | Ano-calendário configurado                                              |
| Forecast              | t=0 = primeiro mês após o ano-base                                      |
| VPL (Excel)           | t=0 = hoje (não descontado em `vplClassico`); t=1 em diante descontados |
| Apuração IRPJ/CSLL    | Trimestral (Q1=Jan–Mar, Q2=Abr–Jun, Q3=Jul–Set, Q4=Out–Dez)             |
| Parcela DARF impostos | Deslocamento de 30 dias (apuração + pagamento)                          |

### Arredondamento

- **`round2(n)`** (`utils.ts`): `Math.round(n × 100) / 100` — arredondamento a 2 casas decimais (centavos).
- Usado em: todas as calculadoras avulsas.
- **DRE/Indicadores:** não arredondam internamente (preservam precisão); arredondamento é responsabilidade da UI.
- **`safeDivide(a, b, fallback?)`** (`safeMath.ts`): divisão segura que retorna 0 (ou fallback) quando `b = 0`.
- **`safePct(num, den)`** (`safeMath.ts`): `safeDivide(num, den) × 100`.

### Regime Efetivo vs Nominal

- **`resolveEffectiveRegime(state)`** (`regime.ts`): determina o regime tributário EFETIVO considerando a RBT12. Se a receita bruta anual excede o limite do Simples, o regime efetivo é rebaixado para Presumido ou Real.
- **SSOT:** todos os módulos (DRE, Indicadores, Valuation, Monte Carlo, Forecast, Sensibilidade) usam `resolveEffectiveRegime()` — nunca o campo nominal diretamente.
- **Impacto:** empresas com RBT12 acima de R$ 4,8M que ainda têm `taxRegime = "simples"` no state são tratadas como Presumido nos cálculos.

### Outros

- **`computeNetDebt(state)`** (`shared.ts`): SSOT-1 para Dívida Líquida — `dividaOnerosa − max(caixaOcioso, disponibilidades)`. Usado por Indicadores, Valuation e Forecast.
- **PDD como custo variável:** `inadimplência × receita_bruta` escala com a receita — classificada em `custosVariaveis` para preservar MC e PE corretos.
- **Custos não-caixa:** PDD (CPC 47/IFRS 9) é removida dos pagamentos operacionais na DFC; a perda já está nos recebimentos (inadimplência deduzida da receita bruta recebível).
- **Depreciação não-caixa:** D&A é somada no EBITDA → EBIT mas não integra os pagamentos operacionais do DFC.
- **Caps e tetos de segurança:** Liquidez max 99×; cobertura de juros max 999×; dívida/EBITDA max ±99×; payback max 99 anos; GAO/qualidadeLucro max ±99/±9.

---

_Fim do documento — FinancePRO INDICADORES.md_
