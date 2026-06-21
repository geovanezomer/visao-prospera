## Diagnóstico de redundâncias na aba CAPITAL

Hoje a aba Capital coleta informação **três vezes** sobre as mesmas rubricas:

| Rubrica | Card 1 (Balanço) | Card 2 (Contratos) | Card 3 (Abertura) |
|---|---|---|---|
| Caixa + bancos | ✔ (`balanco.ativoCirculante.caixaEquivalentes`) | — | ✔ (`abertura.caixa`) |
| Contas a receber | ✔ | — | ✔ |
| Estoques | ✔ | — | ✔ |
| Empréstimos CP | ✔ (`dividaOnerosa` agregada) | ✔ (contrato a contrato) | ✔ (`emprestimosCP`) |
| Empréstimos LP | ✔ | ✔ | ✔ (`emprestimosLP`) |
| Depreciação acumulada | — | — | ✔ (manual) |
| Impostos a pagar | — | — | ✔ (manual) |
| Salários a pagar | — | — | ✔ (manual) |

Além disso a linha sintética **"Juros sobre contratos de dívida"** já é gerada em `Despesas` a partir dos contratos — confirmado em `CapitalTab.tsx:65-72` (`DEBT_CONTRACTS_COST_ID`). Não há duplicação real aí, mas o usuário tem razão de que isso precisa ficar explícito.

## Princípio SSOT a adotar

Cada saldo de abertura tem **uma única fonte**:

- **Caixa, CR, Estoques** → vêm do `BalanceSheetCard` (Card 1). Removidos da Abertura.
- **Empréstimos CP/LP** → derivados de `debtContracts`: parcela com vencimento ≤ 12 meses = CP, > 12 meses = LP. Calculado pela função `splitDebtByMaturity(contracts, hoje)`.
- **Depreciação acumulada** → calculada de `imobilizado bruto × idade média × taxa anual` (ou simplificação: `Σ depreciação mensal × meses decorridos antes do exercício`). Campo escondido com override opcional.
- **Amortização acumulada** → análogo, derivada da soma de juros/amortização já paga dos contratos com `dataInicio < início do exercício`.
- **Impostos a pagar (abertura)** → `impostos do 1º mês de DRE` (proxy do que está "em aberto" no regime de competência).
- **Salários e encargos a pagar** → `folha do 1º mês` (despesa de pessoal do mês 1).
- **Lucros acumulados** → permanece como **único plug** manual (histórico contábil que falta).

## Mudanças

### 1. `src/components/sim/capital/AberturaCard.tsx`
Reduzir o card para **apenas dois campos editáveis**:
- Lucros / prejuízos acumulados (plug).
- Impostos a recuperar (crédito tributário — não é derivável).

Os demais saldos ficam visíveis como **"derivados de…"** em um painel read-only, mostrando a fonte:

```text
Caixa (abertura)            R$ ...    ← Card 1 · Caixa & equivalentes
Contas a receber (abertura) R$ ...    ← Card 1 · CR
Estoques (abertura)         R$ ...    ← Card 1 · Estoques
Empréstimos CP (abertura)   R$ ...    ← Contratos com vencimento ≤ 12m
Empréstimos LP (abertura)   R$ ...    ← Contratos com vencimento > 12m
Depreciação acumulada       R$ ...    ← Imobilizado × idade × taxa
Impostos a pagar            R$ ...    ← Impostos do mês 1 da DRE
Salários a pagar            R$ ...    ← Folha do mês 1
```

### 2. `src/engines/finance/balancoFechamento.ts` + nova função em `debtContracts.ts`
- Adicionar `splitDebtByMaturity(contracts, refDate): { cp, lp }` baseada em `dataVencimento` ou `prazoMeses` restantes do contrato.
- `deriveAberturaDerivada(state)` retorna o objeto com os valores derivados acima, usado pela UI e por `deriveBalancoFechamento` (que hoje lê `capital.abertura.*` direto).
- `calcAberturaTotals` passa a usar o objeto derivado + apenas `lucrosAcumulados` + `impostosRecuperar` do estado.

### 3. `src/components/sim/capital/CapitalTab.tsx`
Sem mudança estrutural — continua compondo `BalanceSheetCard` → `AberturaCard` → `WaccRoicMeter`. O texto explicativo do Card 2 sobre dívidas será reforçado: *"Use o vencimento de cada contrato. ≤ 12 meses entra em CP, > 12 em LP — automaticamente."*

### 4. Testes
- Atualizar fixtures de `balancoFechamento` que ainda chamam `abertura.caixa/emprestimosCP/etc`.
- Adicionar teste para `splitDebtByMaturity`.

## Não-mudanças
- `balanco.ativoCirculante.*` (Card 1) continua sendo editável — é a fonte primária dos saldos.
- `DebtContractsCard` continua sendo o único lugar onde se digita contrato de dívida.
- Linha "Juros sobre contratos de dívida" em Despesas continua sintética (já está correto).

## Confirmar antes de implementar
1. **OK substituir os 6 campos da Abertura por painel read-only derivado?** Mantenho só Lucros Acumulados + Impostos a Recuperar editáveis.
2. **Critério para CP/LP**: usar `prazoMeses restante` calculado de `dataInicio + nParcelas − hoje`. OK?
3. **Idade do imobilizado**: você quer um único campo "idade média do imobilizado (anos)" no Card 1, ou derivo de uma taxa default de depreciação anual aplicada sobre o bruto?
