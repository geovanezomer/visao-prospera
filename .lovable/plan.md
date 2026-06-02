## Tornar a aba Capital amigável para leigos

A aba hoje despeja jargão financeiro (WACC, Ke, Kd, ROIC, NCG, CGD, Capital Próprio/Terceiros, Passivo Circulante, Dívida Onerosa) sem contexto narrativo. Para quem não é da área, é intimidador. Vou manter toda a potência analítica, mas adicionar camadas de tradução e contexto. **Sem mudanças de cálculo** — apenas UI/UX e textos.

### 1. Painel de boas-vindas / "O que é esta aba" (topo)
Card discreto e dispensável (com botão "Entendi, ocultar"), explicando em linguagem simples:

> **Capital é o "combustível" da empresa.** Aqui você responde 3 perguntas:
> 1. **De onde vem o dinheiro?** (sócios vs. bancos)
> 2. **Quanto custa esse dinheiro?** (juros que sócios e bancos cobram)
> 3. **Quanto a empresa precisa para girar?** (capital de giro)
>
> Os indicadores no final mostram se o negócio está **gerando ou queimando valor**.

Estado persistido em localStorage por usuário (`capital_intro_dismissed`).

### 2. Renomear seções com linguagem humana
Manter o termo técnico como subtítulo (para quem é da área), mas título principal em PT-BR claro:

- "Estrutura de Capital" → **"De onde vem o dinheiro da empresa"** (subtítulo: Estrutura de Capital)
- "Posição Patrimonial" → **"Fotografia do balanço hoje"** (subtítulo: Posição Patrimonial)
- "Capex · Ativação de Imobilizado no ano" → **"Investimentos em equipamentos / ativos"** (subtítulo: Capex)

### 3. Apresentação visual da divisão de capital
Atualmente é só um slider 60% / 40%. Adicionar:

- **Barra visual horizontal** dividida (igual ao gráfico de "tanque"): metade verde = "sócios", metade laranja = "bancos", com ícones e valores absolutos em R$ (calculados a partir do PL e da Dívida Onerosa).
- Microcopy abaixo: _"Sua empresa é financiada hoje por R$ X dos sócios e R$ Y de bancos."_
- Indicador de saúde: se Dívida/PL > 2× → mensagem âmbar "Endividamento alto"; se < 0.5× → "Pouco alavancada — pode crescer mais usando dívida".

### 4. Inputs Ke e Kd com presets sugeridos
Em vez de só pedir um número:
- Botão "Sugerir Ke" → abre tooltip com tabela rápida: "Empresa estável: 12–15% / Em crescimento: 18–22% / Alto risco: 25%+"
- Para Kd, mostrar "Selic atual ≈ X% · spread típico PJ +6 a +12%" (valores fixos, sem API).

### 5. WACC × ROIC: termômetro visual
Hoje mostra "WACC 15% / ROIC 0% — destruindo valor". Trocar por **componente de termômetro / barra dupla** comparando os dois lado a lado, com mensagem grande:

- ROIC ≥ WACC: ✅ "Sua empresa gera R$ X de retorno acima do custo do capital — está criando valor"
- ROIC < WACC: ⚠ "Cada R$ investido rende menos do que o custo do dinheiro — está destruindo valor. Diferença: −X pp"

### 6. Posição patrimonial — agrupar e explicar
Hoje é uma grade plana de 11 inputs misturando ativos e passivos. Reorganizar visualmente em 3 mini-grupos com cabeçalho colorido:

- 🟢 **O que a empresa tem (Ativos)**: Ativo Total, Disponibilidades, Estoques, Ativo Circulante, Contas a Receber
- 🔴 **O que a empresa deve (Passivos)**: Dívida Onerosa, Passivo Circulante, Fornecedores a Pagar
- 🔵 **Sobra dos sócios (Patrimônio)**: Patrimônio Líquido
- ⚙️ **Outros mensais**: Depreciação, Juros recebidos

Cada grupo com 1 frase de contexto no header. Inputs ganham placeholder amigável ("ex: R$ 50.000").

### 7. KPIs do rodapé — frase de impacto + ação recomendada
Os 4 cards (Ciclo Financeiro, NCG, CGD, Gap) ganham uma frase curta acionável:

- Gap > 0: "Você precisa de R$ X em capital de giro. Sugestões: negociar prazos com fornecedores, antecipar recebíveis, captar giro."
- Gap ≤ 0: "Folga de R$ X — sobra para investir ou amortizar dívidas."

### 8. CapEx — exemplo concreto na seção vazia
Hoje diz "Nenhuma ativação cadastrada. Use para máquinas, software, reformas etc." Adicionar exemplo clicável: **"+ Exemplo: Notebook R$ 5.000 / 36 meses"** que pré-preenche um item para o usuário entender.

### Arquivos afetados
- `src/components/sim/CapitalTab.tsx` — todas as mudanças. Pode crescer para ~450 linhas; se passar disso, extraio 2-3 sub-componentes (`CapitalStructureCard`, `BalanceSheetCard`, `WaccRoicMeter`) para arquivos `src/components/sim/capital/*.tsx`.
- Sem mudanças em cálculos (`calculations.ts`), tipos (`types.ts`) ou outros arquivos.

### O que NÃO muda
- Toda a lógica de cálculo (WACC, ROIC, NCG, Gap).
- Os campos persistidos no `state.capital`.
- A capacidade de quem entende de finanças editar tudo livremente.