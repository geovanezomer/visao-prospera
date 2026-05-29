
## Análise CFO do MVP atual

O MVP tem uma base sólida — DRE em padrão IFRS/CPC, três regimes tributários, WACC vs ROIC, ponto de equilíbrio, NCG, liquidez. Mas, como ferramenta de consultoria de verdade, ainda tem **gaps críticos** que impedem decisão real em campo:

**O que está bom**
- Estrutura DRE correta até Lucro Líquido.
- Comparador tributário side-by-side.
- Indicadores de criação de valor (ROIC vs WACC) e alavancagem.

**O que falta para virar "raio-X"**
1. **Custos mal categorizados.** Hoje tudo é uma lista plana com flags `fixo/variavel`. Um CFO precisa enxergar 4 grupos contábeis distintos: **Custo de Vendas (CMV/CPV/CSP)**, **Custos/Despesas Fixas**, **Custos/Despesas Variáveis** e **Custos Financeiros**. A divisão atual confunde *custo* (ligado à produção/venda) com *despesa* (estrutura).
2. **Não há subdivisão dentro do Custo de Vendas** (matéria-prima, mão de obra direta, CIF para indústria; mercadoria + frete + ICMS-ST para comércio; salários técnicos + insumos de serviço para serviços).
3. **Tabela rígida** — usuário não consegue adicionar linhas próprias (cada empresa tem rubricas únicas).
4. **Diagnóstico só descreve, não prescreve.** Diz "folha alta" mas não simula "se demitir 2 pessoas, sua margem vai de X para Y".
5. Faltam alavancas de decisão clássicas de consultoria: simulação de empréstimo, renegociação de PMP/PMR, corte de custos, ajuste de preço, redução de quadro.
6. Não há **fluxo de caixa projetado** (DRE ≠ caixa — empresa lucra e quebra por falta de giro).

---

## Plano de implementação

### Fase 1 — Reestruturar Custos (foco do pedido)

**1.1 Novo modelo de dados (`types.ts`)**
- Adicionar campo `category` em `CostLine`:
  `"custo_vendas" | "fixo" | "variavel" | "financeiro"`.
- Adicionar `subcategory?: string` para divisões dentro de Custo de Vendas:
  - Indústria → `materia_prima`, `mao_obra_direta`, `cif` (custos indiretos de fabricação)
  - Comércio → `mercadoria`, `frete_compra`, `icms_st`, `embalagem`
  - Serviços → `mao_obra_direta`, `insumos_servico`, `terceirizacao`
- Adicionar `custom: boolean` para distinguir linhas padrão das adicionadas pelo usuário.
- Manter `fixed` (modo de entrada: valor único vs 12 meses).

**1.2 Defaults sensíveis ao `businessType`**
- Carregar conjunto de linhas pré-configurado conforme indústria/comércio/serviços, com as subcategorias corretas de Custo de Vendas.

**1.3 UI da aba Custos** (`CostsTab.tsx`)
- **4 tabelas/seções colapsáveis**, na ordem que aparecem no DRE:
  1. **Custo de Vendas** (CMV/CPV/CSP — rótulo dinâmico por tipo de empresa) — com sub-headers por subcategoria.
  2. **Custos e Despesas Fixas** (aluguel, pró-labore, contabilidade, software, utilities…).
  3. **Custos e Despesas Variáveis** (marketing %, comissões, fretes de venda…).
  4. **Custos Financeiros** (juros, IOF, antecipação, tarifas).
- Cada seção tem botão **"+ Adicionar linha"** (ícone Plus) que insere uma `CostLine` editável (label + valores) com `custom: true`.
- Linhas custom têm botão de remover (lixeira).
- StatCards no topo: total por grupo + % da receita + indicador de saúde (verde/amarelo/vermelho conforme benchmark do setor).

**1.4 Recalcular DRE (`calculations.ts`)**
- `cpv` passa a somar todas as linhas com `category === "custo_vendas"` (não mais por id hardcoded).
- `custosVariaveis` = soma de `category === "variavel"`.
- `custosFixos` = soma de `category === "fixo"`.
- Ajustar linha do DRE: "(−) CPV / CMV / CSP" com label dinâmico.

### Fase 2 — Elevar o diagnóstico a "raio-X CFO"

**2.1 Aba nova "6. Diagnóstico & Decisões"**
Separar diagnóstico do DRE. Conteúdo:
- **Raio-X em 1 página**: semáforo dos 8 sinais vitais (rentabilidade, liquidez, alavancagem, eficiência, capital de giro, criação de valor, tributação, ponto de equilíbrio).
- **Top 5 alertas prescritivos**, cada um com:
  - O problema (com número).
  - A causa provável.
  - 2–3 ações recomendadas, cada uma com **estimativa de impacto** ("Reduzir PMR de 45 para 30 dias liberaria R$ 22.000 de caixa").
  - Botão "Simular esta ação" → aplica num cenário rascunho.

**2.2 Simulador de alavancas (`LeversTab.tsx`)**
Sliders de "e se?" com recálculo instantâneo do delta vs cenário base:
- Variação de preço (±%)
- Variação de volume (±%)
- Corte de custos fixos (R$ ou %)
- Reduzir quadro CLT (n funcionários × custo médio)
- Tomar empréstimo (valor, prazo, taxa) — gera parcela, impacto em EBIT e DL/EBITDA
- Renegociar PMP (+dias) / Reduzir PMR (−dias) — impacto em NCG e caixa
- Mudar regime tributário
Mostrar painel lateral fixo: "Antes vs Depois" (Lucro, Margem, ROIC, Liquidez, Caixa livre).

**2.3 Fluxo de Caixa Projetado (12 meses)**
- Converter DRE de competência → caixa, aplicando PMR aos recebimentos e PMP aos pagamentos.
- Saldo de caixa mês a mês com linha de "caixa mínimo de segurança".
- Alerta automático se saldo projetado for negativo em algum mês.

**2.4 Diagnóstico com benchmarks setoriais**
Tabela interna de faixas saudáveis por setor (margem bruta serviços 50–70%, comércio 25–40%, indústria 30–45%; folha/receita; etc.) para comparações justas.

### Fase 3 — Polimento de consultoria

- **Relatório executivo imprimível** (1–2 páginas) — capa com nome da empresa, sumário, top 5 ações, anexo com DRE e indicadores.
- **Modo "Antes vs Depois"** entre 2 cenários salvos lado a lado.
- Tooltips de "como interpretar" em cada indicador crítico.

---

## Veredito CFO

**Estão no caminho certo, mas o MVP atual ainda é uma calculadora de DRE — não uma ferramenta de decisão.** Com a Fase 1 (custos estruturados + linhas custom) você passa a refletir a contabilidade real da empresa. Com a Fase 2 (alavancas + caixa projetado + diagnóstico prescritivo) o produto vira o que você descreveu: um consultor pode chegar numa empresa, lançar os dados e sair com um plano de ação quantificado.

Sugiro executar **Fase 1 agora** (atende diretamente o pedido) e em seguida atacar **2.1 + 2.2 + 2.3** numa segunda rodada — é onde mora a diferenciação como ferramenta de consultoria.

---

## Pergunta antes de codar

Posso seguir com a **Fase 1 completa agora** (reestruturação dos custos em 4 grupos, subcategorias por tipo de empresa, linhas personalizáveis com botão "+") e deixar Fases 2 e 3 para a próxima rodada? Ou prefere que eu já inclua nesta entrega o **Fluxo de Caixa Projetado (2.3)** e o **Diagnóstico prescritivo (2.1)**, que são os dois itens que mais aproximam o MVP de uma ferramenta de consultoria real?
