# Previsão × Realizada — Distribuição de Lucros

## Por que mudar

Hoje o sistema confunde **capacidade de distribuir** (cálculo a partir do lucro) com **distribuição efetivamente realizada** (decisão dos sócios). Empresas frequentemente seguram caixa, e isso precisa refletir em DRE/DFC/Balanço com precisão — inclusive no Adicional IRPJ de 10%, que incide sobre o **lucro tributável** (não sobre a retirada), mas o **IRPF do excedente** sim depende do que foi distribuído.

## Proposta refinada (melhorando a sua)

### Card "Pró-labore × Distribuição de Lucros — Previsão"
- Renomear o título.
- A tabela atual continua, mas com rótulo claro de **"Capacidade teórica (planejamento)"**.
- Colunas de Distribuição (isenta/tributável) passam a ser **referência informativa**, com badge "Previsão" — NÃO alimentam mais Caixa/DRE/Balanço.
- Pró-labore, INSS sócio, INSS patronal e IRPF do pró-labore **continuam** alimentando custos/DRE/caixa normalmente (isso é folha, é realizado por natureza).

### Bloco novo "Distribuição Realizada — 12 meses" (no rodapé do mesmo card, com separador)
Linha única por sócio (ou agregada) com:
- **Toggle "Fixar todos os meses"** (igual ao padrão de Receitas/Despesas): ligado → 1 input replica nos 12 meses; desligado → grid mês-a-mês.
- **Botão "Usar Previsão"**: 1-clique copia a capacidade teórica para a Realizada (ajuda quem quer distribuir 100%).
- **Botão "Zerar"**: caso a empresa decida segurar caixa.
- Indicador visual abaixo: *"Distribuído R$ X de R$ Y disponíveis (Z%)"* — verde se ≤ teto isento, amarelo se acima.

### Impactos sistêmicos (auditados)

| Módulo | Antes | Depois |
|---|---|---|
| **DFC** (Atividades de Financiamento → Dividendos) | Lia capacidade calculada via `state.cashflow.dividendos` sincronizado pelo `useEffect` | Lê **Distribuição Realizada** (soma por mês de todos os sócios) |
| **DRE** | Distribuição não afeta DRE (correto — é destinação do lucro). Adicional IRPJ 10% já calculado sobre lucro presumido trimestral | **Inalterado**. Adicional IRPJ continua sobre lucro tributável (não sobre retirada) — está correto pela Lei 9.249/95 |
| **Balanço** | Lucros Acumulados = ∑ Lucro Líquido − Dividendos pagos | Mesma fórmula, mas Dividendos pagos = Realizado (não mais Previsão) |
| **IRPF do excedente** (coluna "Distribuição tributável") | Calculado sobre Previsão | Recalculado sobre **Realizado**: `max(0, Realizado − Limite isento) × alíquota topo` |
| **Líquido sócio** | Pró-labore líq. + Distribuição prevista | Pró-labore líq. + Distribuição **realizada** (isenta + tributável líquida de IRPF) |

### UX — assimilação fácil
1. **Hierarquia visual clara**: bloco Previsão em opacidade 90% + badge cinza "Planejamento". Bloco Realizada em destaque (borda accent) + badge verde "Efetivado em caixa".
2. **Tooltip didático** no separador: *"A Previsão mostra quanto a empresa PODERIA distribuir sem violar limites legais. A Realizada é o que de fato saiu do caixa. DRE, Fluxo de Caixa e Balanço usam a Realizada."*
3. **Alerta inteligente**: se Realizada > Capacidade isenta → banner amarelo *"R$ X excede o limite isento e será tributado a 27,5% IRPF na PF dos sócios."*
4. **Alerta de retenção de caixa**: se Realizada < 50% da capacidade por 3+ meses → badge informativo *"Empresa está fortalecendo caixa (retendo R$ Y)."*

## Arquivos a alterar

1. **`src/engines/finance/types.ts`** — adicionar `distribuicaoRealizada: { id, socioId, values: number[], fixed: boolean }[]` no `AppState` (ou simplificar: `state.distribuicaoRealizada: number[]` agregada de 12 meses, já que rateio segue participação%).
   - Decisão: **agregada 12 meses** (1 array) — replica o padrão de `cashflow.dividendos` que já existia; mais simples, e o rateio por sócio segue `participacaoPct`.

2. **`src/engines/finance/socios.ts`**:
   - Nova função `calcDistribuicaoRealizadaPorSocio(state, regime)` retornando isenta/tributável/IRPF **com base no array realizado**.
   - `syncDistribuicaoToCashflow(state)` passa a usar `state.distribuicaoRealizada` em vez de capacidade.
   - Manter `calcRetiradaSocio` para previsão (UI superior) e criar variante `calcRetiradaSocioRealizada` para o bloco inferior.

3. **`src/components/sim/tax/SociosCard.tsx`**:
   - Renomear título.
   - Adicionar `<Separator />` + novo sub-componente `DistribuicaoRealizadaBlock` (toggle fixo, grid 12m, botões Usar Previsão / Zerar, indicadores).
   - Coluna "Distribuição tributável" passa a refletir Realizada (manter Previsão em tooltip).

4. **`src/components/sim/tax/ProlaboreTab.tsx`** — atualizar KPI "Disponível para Distribuição" para mostrar também "Realizado YTD".

5. **`src/components/sim/cashflow/DFCTable.tsx`** — já lê de `state.cashflow.dividendos`; vamos mantê-lo lendo daí, mas a sincronização passa a vir do realizado (não da previsão).

6. **`src/engines/finance/__tests__/socios.test.ts`** — adicionar testes: realizada=0 → caixa preservado; realizada > teto → IRPF excedente correto; realizada substitui previsão na sincronização.

## Riscos / mitigações
- **Migração de dados existentes**: usuários com `cashflow.dividendos` preenchido → na primeira carga, copiar para `distribuicaoRealizada` (one-shot migration em `defaults.ts` ou loader).
- **Quebra de testes E2E**: `mutuosPassivos.test.ts` e fluxos de balanço — rodar suite após mudança.

## Estimativa
~5 arquivos editados, ~250 linhas líquidas, +6 testes. Sem mudança de schema do backend (puro client state).

**Confirma o plano para eu implementar?**