# Golden Set — Avaliação Automatizada da IA

Suíte que protege a **engine de IA** contra regressões, análoga aos 407
testes que protegem a engine de cálculo. A cada mudança em `systemPrompt.ts`,
`REGRAS`, blocos de modo ou `description` de tools, rode a suíte.

## Arquitetura

- `fixtures/*.ts` — 6 empresas-fixture (`AppState`) encarnando arquétipos
  com verdade conhecida (dívida crítica, caixa apertado, saudável,
  Simples estourado, margem baixa, serviços/Fator R).
- `goldenSet.ts` — casos `EvalCase` combinando fixture + pergunta + modo
  - expectativas (`deveConter`, `naoPodeConter`, `toolsEsperadas`,
    `numChavePayload`).
- `runner.ts` — dois níveis de execução.
- `goldenset-static.test.ts` — vitest do Nível A (roda no CI).
- `../../../../scripts/eval-ai.ts` — script Nível B (dev sob demanda).

## Nível A — determinístico (CI)

Roda como qualquer vitest: `bun run test`. Para cada caso:

1. Confere que `toolsEsperadas` existem no registry.
2. Compila `buildSystemPromptParts` no modo pedido.
3. Executa cada tool esperada contra a fixture, sem lançar.
4. Valida que o payload combinado contém `numChavePayload`.

Não gasta API, roda em milissegundos, protege contra:

- Rename/remoção de tool que quebra menções nas REGRAS.
- Fixture que quebra por mudança de schema.
- Tool que passa a lançar em cenários limite.

## Nível B — end-to-end com LLM (dev sob demanda)

```bash
export AI_EVAL_BASEURL=http://localhost:1234/v1   # LM Studio
export AI_EVAL_MODEL=qwen2.5-coder-7b-instruct
# export AI_EVAL_APIKEY=sk-...                    # opcional (OpenAI-compat)
bun run eval:ai
```

Executa o loop real de tool-calling por caso, aplica
`deveConter` / `naoPodeConter` / `toolsEsperadas` e grava
`.eval-reports/{PROMPT_VERSION}-{timestamp}.json` com score por caso.
Imprime diff de score vs o último relatório da mesma PROMPT_VERSION quando
existir.

**Rode o Nível B sempre que mudar:**

- `src/engines/ai/systemPrompt.ts` (SISTEMA, REGRAS, GLOSSARIO, PERSONA)
- Blocos de modo (`MODE_BLOCKS` em systemPrompt)
- `description` de qualquer tool em `src/engines/ai/tools/*.ts`
- `PROMPT_VERSION` em `diagnosticoPrompt.ts`

## Adicionando um caso

1. Se precisar de arquétipo novo, crie a fixture em `fixtures/<slug>.ts` e
   registre em `fixtures/index.ts`.
2. Adicione o `EvalCase` em `goldenSet.ts` com:
   - `deveConter`: 1-3 regex do que a IA **precisa** dizer.
   - `naoPodeConter`: 1-2 regex de proibições semânticas (armadilhas
     conhecidas — ex.: recomendar dívida nova para DSCR<1).
   - `toolsEsperadas`: nomes reais do registry (`get_indicadores`, etc.).
   - `numChavePayload`: padrões que devem aparecer no payload das tools.
3. Rode `bun run test src/engines/ai/__evals__/goldenset-static.test.ts`.

## Não rodamos o Nível B no CI porque

- Custa API (ou depende de LM Studio local).
- É não-determinístico — score varia por sampling do modelo.
- Latência de vários minutos.

O Nível A garante os invariantes; o Nível B é a régua qualitativa que o
desenvolvedor puxa antes de fazer PR de mudança de prompt.
