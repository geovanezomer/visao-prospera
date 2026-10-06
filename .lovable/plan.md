# Plano de correção — 24 achados da auditoria

Divido em **4 ondas** por criticidade e afinidade técnica. Cada onda termina com `npx vitest run` verde antes de avançar.

---

## 🌊 Onda 1 — Precisão numérica (P0/P1) — 8 fixes

Impacto direto em números exibidos ao usuário.

1. **C1** `cashflowProjection.ts:161` — incluir `pagamentosFolha` na projeção multi-ano
2. **A1** `cashflowProjection.ts:20` — trocar juros nominal `aa/12` por equivalente composto `(1+ia)^(1/12)−1`
3. **A2** `forecast.ts:209` — IRPJ/CSLL sobre **LAIR** (EBIT + ResultadoFinanceiro), não EBIT
4. **A3** `cashflow.ts:599` — renomear `pagamentosFixos` → `pagamentosFixosSemFolha` ou incluir folha
5. **M1** `indicatorCalc.ts` — anualizar numeradores de margens vs RL anual
6. **M2** `indicatorCalc.ts` — GAF: LAIR = EBIT − juros **+ receitas financeiras**
7. **M9** `balancoFechamento.ts:175` — recalcular ratio CP/LP **após** amortizações
8. **M10** `montecarlo.ts:86` — Box-Muller aproveitar `sin` (metade das chamadas `Math.random()`)

**Testes:** rodar suíte completa + adicionar regressão para C1/A2.

---

## 🌊 Onda 2 — Consistência UI/tooltip — 5 fixes

9. **A4** tooltip de "Pagamentos Fixos" (esclarecer escopo folha)
10. **A5** labels de margens (indicar anualização)
11. **A6** helper "GAF" (fórmula LAIR completa)
12. **M8** `aberturaDerivada.ts:126` — passivos tributários de abertura: média trimestral, não `mês[0]`
13. **B5** `breakEvenDinamico.ts:64` — remover máscara `ebitda_positivo` quando EBIT/FCL negativos

---

## 🌊 Onda 3 — Correções contábeis — 6 fixes

14. **M3** `socios.ts:285` — IRPF sócio: tabela progressiva (não 27,5% flat)
15. **M4** `mutuosSocios.ts` — juros PJ→PF → Receita Financeira na DRE
16. **M5** validação de rateio de dividendos por participação
17. **M6** consistência de sinal em contas retificadoras
18. **M7** ordem de compensação prejuízo fiscal × adicional IRPJ
19. **B7** conciliação DFC indireta ↔ direta (tolerância R$ 0,01)

---

## 🌊 Onda 4 — Refinamentos — 5 fixes

20-24. **B1–B4, B6** — tooltips residuais, formatação, edge cases de Simples anexo V, arredondamento em covenants, cache miss em sensitivity.

---

## Critérios de aceite

- Cada onda: `npx vitest run` **verde** (775+ testes) antes de commitar a próxima
- Onda 1 adiciona **3 testes de regressão** (C1, A2, M9)
- Números do dashboard antes/depois documentados em `AUDITORIA-DELTAS.md` para o usuário validar
- Nenhuma alteração em fórmulas fora do escopo dos achados

---

## Estimativa

- **Onda 1:** ~40 min (crítica, mexe em núcleo)
- **Onda 2:** ~20 min
- **Onda 3:** ~35 min (contábil, exige atenção)
- **Onda 4:** ~15 min

**Início pela Onda 1** assim que aprovar.
