## Wizard v2 — Mais realismo

### Novos passos (de 7 → 10)

| # | Passo atual / novo | Pergunta principal | Campos |
|---|---|---|---|
| 1 | Tipo de negócio | (mantém) | businessType, companyName |
| 2 | Receita | "Quanto fatura por mês?" + sazonalidade | faturamentoMensal, seasonality, **crescimentoAA** (só se seasonality="crescimento") |
| 3 | **🆕 Margem** | "A cada R$100 vendidos, quanto custa o produto/serviço?" | **margemCustoVendasPct** (slider 0–90, presets por setor: serviços 30 / comércio 65 / indústria 55) |
| 4 | **🆕 Vendas & recebimentos** | "Como você recebe?" | pmr, pmp, **inadimplenciaPct**, **inadimplenciaComoPDD** (toggle), **percentualCartao**, **taxaCartaoPct** |
| 5 | Equipe CLT | (mantém) | funcionarios, salarioMedio |
| 6 | **🆕 Sócios** | "Você e os sócios retiram pró-labore?" | **numeroSocios**, **proLaboreMedio**, **comissaoVendasPct** |
| 7 | Custos fixos | (mantém) | aluguel, software, marketing, outrosFixos |
| 8 | **🆕 Estoque** (só comércio/indústria — pulado em serviços) | "Quantos dias de estoque você mantém?" | **diasEstoque** (default: comércio 30, indústria 45) |
| 9 | Regime tributário | (mantém) | regimeEscolha |
| 10 | Capital | (mantém) | temEmprestimo, saldoDivida, taxaMensal, capitalProprio |
| Final | Resumo | (mantém) | Mostra 8 indicadores-chave |

### Mapeamento para AppState

- **margemCustoVendasPct** → injetado na linha de custo `custo_vendas` correspondente (mercadoria / matéria-prima / mão-obra-direta), com `values = fill12(faturamento × pct / 100)` e `fixed: false`.
- **inadimplenciaPct** → `revenue.inadimplencia = fill12(pct)`, `revenue.inadimplenciaComoPDD = toggle`.
- **percentualCartao + taxaCartaoPct** → nova linha de custo variável `taxa_cartao` (categoria `variavel`, `fixed: false`) com `values = fill12(faturamento × %cartao × taxa / 10000)`.
- **comissaoVendasPct** → linha `comissoes` (variável) com `values = fill12(faturamento × pct / 100)`.
- **numeroSocios + proLaboreMedio** → linha `pro_labore` (fixa, sem encargosAuto — pró-labore tem INSS de 11% só, não 70%) com `values = fill12(numeroSocios × proLaboreMedio)`.
- **diasEstoque** → `capital.estoques = (CMV mensal médio) × diasEstoque / 30`.
- **crescimentoAA** → nova função `buildRevenueCurve(monthly, "crescimento", taxa)` que aplica `(1+taxa)^(i/12)` mês a mês, com média anual = `monthly`.

### Arquivos a alterar

1. **`src/lib/finance/guided/wizardToState.ts`**
   - Estender `wizardSchema` com novos campos + validações (zod min/max).
   - Atualizar `WIZARD_DEFAULTS`.
   - `buildRevenueCurve` aceita `taxaAA?: number` para modo crescimento custom.
   - `applyWizard`: injetar novas linhas de custo via `overrides`, popular `revenue.inadimplencia`, `capital.estoques`.
   - Defaults por setor para `margemCustoVendasPct` e `diasEstoque`.

2. **`src/components/sim/guided/GuidedWizard.tsx`**
   - `STEP_COUNT = 10` (ou dinâmico: 9 se serviços, pula estoque).
   - Adicionar 3 novos blocos de UI (Margem, Vendas & Recebimentos expandido, Sócios, Estoque).
   - Validação por passo via `wizardSchema.pick(...)` por campo.
   - Lógica condicional: passo "Estoque" só renderiza se `businessType !== "servicos"`.
   - Lógica condicional: campo `crescimentoAA` só aparece se `seasonality === "crescimento"`.

3. **`src/lib/finance/defaults.ts`** (verificar)
   - Confirmar se `defaultCostsFor` já tem linhas `pro_labore`, `comissoes`, `taxa_cartao`. Se não, adicionar entradas-base (zeradas) para que os overrides funcionem; ou criar via push se ausentes.

### UX do wizard

- Presets clicáveis em cada novo campo (ex: inadimplência 0% / 2% / 5% / 10%).
- HelpTip explicando o conceito (ex: "PDD = Provisão Devedores Duvidosos: lança o calote como despesa em vez de reduzir receita, mantendo a base de PIS/COFINS/ISS").
- Barra de progresso passa a refletir 10 passos.
- Botão "Pular este passo" mantém defaults sensatos.

### Validação (zod)

```ts
margemCustoVendasPct: z.number().min(0).max(95),
inadimplenciaPct: z.number().min(0).max(50),
inadimplenciaComoPDD: z.boolean(),
percentualCartao: z.number().min(0).max(100),
taxaCartaoPct: z.number().min(0).max(15),
numeroSocios: z.number().int().min(0).max(20),
proLaboreMedio: z.number().min(0).max(500_000),
comissaoVendasPct: z.number().min(0).max(30),
diasEstoque: z.number().int().min(0).max(365),
crescimentoAA: z.number().min(-50).max(300),
```

### Critérios de aceite

- Wizard completa em ≤ 2 min com defaults.
- Após aplicar, DRE mostra Lucro Bruto coerente com a margem informada.
- Inadimplência aparece corretamente (dedução de receita OU PDD) conforme toggle.
- Pró-labore aparece como linha separada da folha CLT.
- NCG no Capital reflete dias de estoque para comércio/indústria.
- Modo "crescimento" usa a taxa informada (mês 1 ≈ mês 12 / (1+taxa)).
- Wizard de serviços pula passo de estoque automaticamente (mostra "9 de 9" no contador).
