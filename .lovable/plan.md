# Modo Guiado — v1

Transforma o CfoPRO em uma experiência acessível para usuários leigos sem tirar o poder do modo livre. Três pilares: **wizard de setup**, **cenários prontos** e **botão persistente no header**.

## Escopo aprovado

- Wizard inicial (5–7 perguntas) que pré-popula todas as abas
- Botão fixo no header para ativar/desativar
- Biblioteca de cenários sugeridos prontos para simular
- *Fora desta v1:* tour com coach marks, modo "linguagem leiga" global, relatório PDF

## 1. Botão no Header

Novo botão `Modo Guiado` ao lado de "Resetar" / "Exportar", com ícone (Sparkles/Compass) e estado visual ativo quando ligado.

- **Clique 1ª vez:** abre o wizard (modal grande, 7 passos)
- **Clique seguinte:** reabre o wizard para refazer (com confirmação se houver dados já preenchidos)
- **Toggle persistente:** estado salvo em `localStorage` via `useAppState`; quando ativo, exibe um banner discreto no topo das abas com atalhos ("Próximo passo recomendado: preencha Capital").

## 2. Wizard de Setup (7 passos)

Modal full-screen com progresso visual (1/7 … 7/7), botões Voltar/Próximo e "Pular esta etapa". Cada passo tem **1 pergunta principal + presets clicáveis + campo livre opcional**.

| # | Pergunta | Tipo | Onde aplica |
|---|---|---|---|
| 1 | Tipo de negócio | 3 cards (Serviços / Comércio / Indústria) | `state.businessType` |
| 2 | Faturamento médio mensal | Input R$ + slider de sazonalidade (Estável / Sazonal / Crescimento 20% a.a.) | Gera curva de 12 meses em `revenue.bruta` |
| 3 | Como você recebe e paga? | Presets ("À vista", "30 dias", "30/60/90", "Custom") | `revenue.pmr`, `revenue.pmp`, `pme` |
| 4 | Equipe (CLT) | Nº de funcionários + salário médio | Cria linha de folha em `costs` com `encargosAuto: true` |
| 5 | Custos fixos mensais agregados | Aluguel, software, marketing, outros (4 inputs) | Cria linhas em `costs` categoria `fixo` |
| 6 | Regime tributário | 4 opções (Simples / Presumido / Real / "Não sei — sugira") | `tax.regime`. Se "Não sei", roda `compareRegimes` e escolhe o de menor carga |
| 7 | Capital e dívida | "Tem empréstimo?" Sim → saldo + taxa; "Capital próprio aproximado" | `capital.dividaOnerosa`, `capital.kd`, `capital.patrimonioLiquido` |

**Final do wizard:** tela de resumo mostrando os 8 indicadores-chave já calculados (EBITDA, Margem Líquida, ROIC×WACC, Necessidade de Capital de Giro, etc.) com mensagem "Tudo pronto! Você pode ajustar qualquer campo nas abas a qualquer momento."

## 3. Biblioteca de Cenários Prontos

Novo card "Simulações sugeridas" na aba **Análise & Cenários** (visível sempre, mas destacado no Modo Guiado).

Cenários incluídos:

1. **Aumento de preço (+10%)** — multiplica `revenue.bruta` por 1.10
2. **Perda do maior cliente (-20% receita)** — multiplica por 0.80
3. **Selic +2 p.p.** — aumenta `capital.kd` em 2
4. **Contratação de +3 pessoas** (salário médio do estado atual) — adiciona linha de folha
5. **Redução de 10% nos 3 maiores custos fixos** — reusa lógica de `prescriptive.ts`
6. **Migração para o regime tributário ótimo** — usa `compareRegimes`
7. **Antecipação de recebíveis (PMR -15 dias, custo 2% a.m.)** — ajusta `pmr` e adiciona despesa financeira

Cada cenário tem botão **"Simular"** (abre o `SimulateDialog` existente, comparando antes/depois) e **"Salvar como cenário"** (usa `useScenarios.save`).

## 4. Estado e Persistência

Adicionar em `AppState`:
```ts
guided: {
  enabled: boolean;
  completedWizard: boolean;
  dismissedBanner: boolean;
}
```

Persiste em `localStorage` junto com o resto do estado (já existe via `useAppState`).

## Arquivos a criar / editar

**Criar:**
- `src/components/sim/guided/GuidedWizard.tsx` — modal com os 7 passos
- `src/components/sim/guided/WizardSteps.tsx` — componentes de cada passo
- `src/components/sim/guided/GuidedBanner.tsx` — banner persistente no topo
- `src/components/sim/guided/ScenarioLibrary.tsx` — biblioteca de cenários prontos
- `src/lib/finance/guided/wizardToState.ts` — converte respostas do wizard em `AppState`
- `src/lib/finance/guided/scenarios.ts` — definições dos 7 cenários prontos (reusa helpers de `prescriptive.ts`)

**Editar:**
- `src/lib/finance/types.ts` — adicionar `guided` em `AppState`
- `src/lib/finance/defaults.ts` — `guided` default (`enabled: false, completedWizard: false`)
- `src/lib/finance/store.ts` — expor `setGuided`
- `src/routes/index.tsx` — botão "Modo Guiado" no header + montagem do wizard/banner
- `src/components/sim/AnalysisTab.tsx` — incluir `<ScenarioLibrary />` no topo

## Detalhes técnicos

- **Validação:** todos os inputs do wizard usam `zod` (string trim, números com min/max, R$ não-negativos, salário ≤ R$ 1M, nº funcionários ≤ 9999) antes de virarem `AppState`.
- **Sazonalidade:** "Estável" = valor constante; "Sazonal" = curva senoidal ±15% com pico em dezembro; "Crescimento 20%" = rampa linear.
- **Confirmação:** se o usuário ativar o wizard com dados já preenchidos, usar o `ConfirmDialog` existente avisando que os campos serão sobrescritos (com opção "Manter o que já preenchi" para fazer merge inteligente em campos vazios).
- **Acessibilidade:** modal usa `Dialog` do shadcn (já no projeto); navegação por teclado (Enter avança, Esc fecha com confirmação).
- **i18n:** textos em pt-BR no arquivo de cada componente (sem framework de tradução nesta fase).

## Critérios de aceite

- Botão "Modo Guiado" visível no header em todas as resoluções ≥ 768px
- Wizard completo em < 90s para usuário médio (7 passos, cada com presets clicáveis)
- Ao concluir o wizard, todas as abas mostram dados coerentes e o Diagnóstico CFO já dispara cards
- Biblioteca de cenários abre, simula e salva sem regressão na aba Análise
- Estado do Modo Guiado persiste entre reloads
- Nenhum input do wizard aceita valores inválidos (validação `zod` com mensagens em pt-BR)
