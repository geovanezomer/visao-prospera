## Página `/calculadoras` com sistema de abas + 1ª calculadora: Custo de Funcionário CLT

### Estrutura

Refatorar `src/routes/calculadoras.tsx` para usar Tabs (`shadcn/ui`) preparado para receber várias calculadoras. Hoje só a aba **Custo de Funcionário** ativa; demais ficam como placeholders ("Em breve").

```
src/routes/calculadoras.tsx           → shell com <Tabs>
src/components/calculadoras/
  CustoFuncionarioCalc.tsx            → UI da calculadora
src/lib/calculadoras/
  custoFuncionario.ts                 → engine pura (pure functions + Zod)
  custoFuncionario.test.ts            → testes dos cenários (Simples / Geral / com benefícios)
```

### Integração com o regime do menu lateral

O regime tributário já existe no SSOT em `state.tax.regime` (`"simples" | "presumido" | "real"`) do `useFinanceModel`. A calculadora **lê** esse valor e pré-seleciona o regime — o usuário ainda pode trocar manualmente só para simular, mas o default vem do app.

- `simples` → "Simples Nacional" (INSS patronal + Terceiros embutidos no DAS; recolhe à parte: FGTS 8 % e RAT)
- `presumido` / `real` → "Regime Geral" (folha cheia: INSS 20 % + RAT 1–3 % + Terceiros 5,8 % + FGTS 8 %)

### Engine financeira (normas vigentes — CLT + Decreto 3.048/99 + LC 123/2006)

**Encargos patronais (Regime Geral):**
- INSS Patronal: 20 % sobre salário bruto (art. 22, I, Lei 8.212/91)
- RAT (Risco de Acidente de Trabalho): 1 % / 2 % / 3 % conforme grau de risco (input do usuário, default 1 %)
- Terceiros (Sistema S — SENAI/SESC/SEBRAE/INCRA/Salário-Educação): 5,8 % (default; varia por CNAE)
- FGTS: 8 % (art. 15, Lei 8.036/90)

**Encargos patronais (Simples Nacional):**
- INSS Patronal e Terceiros: 0 % (substituídos pelo DAS — exceto Anexo IV)
- RAT: 1 %/2 %/3 % (continua devido à parte)
- FGTS: 8 % (continua devido à parte)

**Provisões mensais (1/12 avos):**
- 13º salário: 8,3333 % (1/12)
- FGTS sobre 13º: 8 % × 8,3333 % = 0,6667 %
- Férias + 1/3 constitucional: 11,1111 % (1/12 × 4/3)
- FGTS sobre férias: 8 % × 11,1111 % = 0,8889 %

**Benefícios (opcionais, inputs):**
- Vale-Transporte: empresa banca o que exceder 6 % do salário (Lei 7.418/85, art. 4º). UI: usuário informa custo mensal do VT; sistema calcula `max(0, custoVT − 0,06 × salário)`.
- Vale-Refeição/Alimentação: input livre (custo integral para a empresa, dedutível IRPJ/CSLL no Lucro Real)
- Plano de Saúde: input livre
- Outros Benefícios: input livre

**Fórmula final:**
```
custoMensal = salário
            + (salário × (alíquotaPatronal + RAT + FGTS))
            + (salário × (provisão13 + FGTSsobre13 + provisãoFérias + FGTSsobreFérias))
            + benefícios
custoAnual  = custoMensal × 12
fatorMultiplicador = custoMensal / salário
```

Todos os números calculados com `Math.round(x*100)/100` ao final; cálculos internos em centavos para evitar floating-point.

Validação Zod: salário ≥ R$ 1.000 (não checa salário-mínimo dinâmico — só sanity), RAT ∈ {1,2,3}, benefícios ≥ 0.

### UI (melhorada vs. mockup)

Layout em 2 colunas (desktop) / stack (mobile), seguindo design tokens (sem cores hardcoded):

- **Coluna esquerda** — Card "Remuneração": Salário Bruto, Regime (Select pré-preenchido do SSOT com badge "vindo do seu plano" + botão "sobrescrever"), Grau de Risco RAT (Select 1/2/3 %), % Terceiros (input avançado, recolhido por padrão).
- **Coluna direita** — Card "Benefícios": VT (checkbox + valor), VR/VA, Plano de Saúde, Outros.
- **Resultado** (full-width, card destaque com gradient sutil dos tokens): Custo Mensal Total em display grande, fator multiplicador (ex. "1,68× o salário bruto"), badge do regime.
- **Breakdown** em 3 cards menores: Encargos Patronais, Provisões Mensais, Benefícios, Custo Anual.
- **Detalhamento** em accordion expansível com tabela linha-a-linha (base, alíquota, valor) — substitui os 3 cards grandes do mockup, mais limpo.
- **"Entenda a calculadora"** em `<Collapsible>` no fim com fórmula + dicas (texto similar ao do mockup, atualizado com referências legais).

Cálculo **reativo** (sem botão "Calcular") — atualiza a cada mudança via `useMemo`. O botão "Limpar" mantém-se.

### Fora de escopo (não muda)

- Sidebar, outras rotas, engine financeira principal (`lib/finance/*`) ficam intocados.
- Não cria persistência — calculadora é stateless por sessão.
- Reforma CBS/IBS não afeta folha de pagamento (mantida fora do escopo desta calc).

### Próximas calculadoras (placeholders nas abas, implementação futura)

Sugiro slots para: Pró-labore, Rescisão CLT, Simples vs Presumido vs Real (mini), VPL/TIR rápido, Markup. Confirma se quer esses títulos ou outros antes de eu reservar as abas?
