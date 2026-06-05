# Plano: Consultor IA Completo — Módulos Invisíveis + Upload de Documentos

## Visão geral

Sua intuição está certa: os 3 módulos **não precisam de UI própria** — eles vivem como **camadas de dados/serviços** que o chat acessa via *tool calling*. Isso mantém a interface limpa e dá superpoderes ao CFO conversacional.

Adicionamos também **upload de imagens e PDFs** direto no chat (balancetes, contratos, notas, prints de relatórios externos).

---

## 1. Módulo: Benchmark Setorial + Macro (invisível)

**O que faz:** dá ao chat respostas tipo *"sua margem de 12% está acima da mediana do varejo (8%)"* e *"com Selic projetada em 10%, seu WACC deveria ser ~14%"*.

**Implementação:**
- `src/services/benchmark/sectors.ts` — base estática JSON com medianas/quartis por setor CNAE (margem bruta, EBITDA, líquida, giro, endividamento, prazo médio). Fontes: Sebrae/Serasa/IBGE consolidadas manualmente em ~20 setores principais.
- `src/services/macro/bcb.ts` — fetch das séries do **Banco Central (API SGS pública, sem chave)**: Selic, IPCA, CDI, câmbio USD/EUR. Cache de 6h em localStorage.
- Exposto ao chat via novas tools: `get_benchmark(setor, indicador)`, `get_macro(serie, periodo)`, `comparar_com_setor(indicador)`.

## 2. Módulo: Cenários Versionados (invisível ao usuário, visível ao chat)

**O que faz:** o chat consegue *"salve este cenário como 'Otimista Q1'"*, *"compare base vs otimista"*, *"projete 24 meses com crescimento de 5% a.m."*.

**Implementação:**
- `src/services/scenarios/store.ts` — persistência em localStorage por empresa: `{ id, nome, criadoEm, alavancas, dreProjetado, indicadores }`.
- `src/services/scenarios/projector.ts` — engine de projeção 12/24/60 meses usando alavancas atuais + curva configurável.
- `src/services/scenarios/sensitivity.ts` — análise de sensibilidade (varia ±20% cada premissa, mede impacto no valuation/EBITDA).
- Tools: `salvar_cenario(nome)`, `listar_cenarios()`, `comparar_cenarios(a, b)`, `projetar(meses, premissas)`, `sensibilidade(metrica)`.

## 3. Módulo: Plano de Ação + Compliance (invisível)

**O que faz:** rastreia decisões e dá checklist tributário/fiscal sob demanda.

**Implementação:**
- `src/services/actions/store.ts` — localStorage: `{ id, titulo, origem (alerta/chat), responsavel, prazo, status, criadoEm, resolvidoEm, impactoEsperado }`.
- `src/services/compliance/tax.ts` — simulador de regime tributário (Simples × Presumido × Real) com break-even por faturamento/margem.
- `src/services/compliance/checklist.ts` — lista de obrigações (DEFIS, ECF, SPED, eSocial) com periodicidade.
- Tools: `criar_acao(titulo, prazo, responsavel)`, `listar_acoes(status)`, `marcar_concluida(id)`, `simular_regime_tributario()`, `checklist_compliance()`.

## 4. Upload de Documentos no Chat

**O que faz:** anexar PDFs (balancete, contrato, NF), imagens (print de relatório, foto de documento) e a IA lê o conteúdo.

**Implementação:**
- Botão de clipe no `AIChatSheet.tsx` → `<input type="file" accept="image/*,application/pdf">`.
- **Imagens:** convertidas para base64 e enviadas como `image_url` nas mensagens (OpenAI Vision via gpt-4o / LM Studio com modelo vision local).
- **PDFs:** extração client-side via `pdfjs-dist` (texto) — anexado como bloco de contexto na mensagem. Para PDFs escaneados, avisa o usuário que precisa OCR (futuro).
- Limite: 10MB por arquivo, max 3 arquivos por mensagem.
- Indicador visual de arquivos anexados (chips removíveis) antes de enviar.
- Arquivos ficam apenas em memória da conversa (não persistem em localStorage para evitar estourar quota).

## 5. Integração com o systemPrompt

Atualizar `systemPrompt.ts` para informar ao modelo:
- Quais tools novas existem e quando usar (ex: *"sempre que o usuário perguntar 'isso é bom?' chame `comparar_com_setor`"*).
- Que pode receber imagens/PDFs e deve extrair números relevantes para o snapshot.
- Glossário expandido com termos tributários (Fator R, Anexo III/V, PIS/COFINS cumulativo vs não-cumulativo).

---

## Estrutura de arquivos

```text
src/
├── services/
│   ├── ai/
│   │   ├── tools.ts                    # EXPANDIR — registrar novas tools
│   │   ├── systemPrompt.ts             # EXPANDIR — instruir uso + glossário
│   │   └── attachments.ts              # NOVO — processar imagens/PDFs
│   ├── benchmark/
│   │   ├── sectors.ts                  # NOVO — base setorial
│   │   └── sectors.data.json           # NOVO — dados
│   ├── macro/
│   │   └── bcb.ts                      # NOVO — API BCB SGS
│   ├── scenarios/
│   │   ├── store.ts                    # NOVO
│   │   ├── projector.ts                # NOVO
│   │   └── sensitivity.ts              # NOVO
│   ├── actions/
│   │   └── store.ts                    # NOVO
│   └── compliance/
│       ├── tax.ts                      # NOVO
│       └── checklist.ts                # NOVO
└── components/ai/
    ├── AIChatSheet.tsx                 # EDITAR — botão upload + chips
    └── AttachmentChip.tsx              # NOVO — UI dos anexos
```

## Dependências novas

- `pdfjs-dist` (extração de texto de PDF no browser)

## Ordem de implementação (entrego tudo num único batch)

1. Tools registry expandido + systemPrompt atualizado
2. Benchmark + Macro (mais imediato em ROI)
3. Cenários + projetor
4. Plano de ação + Compliance tributário
5. Upload de imagens (Vision) e PDFs no chat
6. Sanity check: testar fluxo "envie balancete PDF → IA lê → compara com setor → sugere ação → salva no plano"

## Observações importantes

- **Tudo em localStorage** mantém a arquitetura sem backend, fiel ao seu setup Docker/local.
- **Benchmarks** começam com ~20 setores; fácil expandir depois.
- **Vision** funciona nativo no OpenAI (`gpt-4o`); no LM Studio depende do modelo carregado (ex: `llava`, `qwen2-vl`). Detectamos e avisamos.
- **Modelos invisíveis ≠ inacessíveis ao usuário**: se ele quiser, pode pedir *"liste meus cenários salvos"* ou *"mostre meu plano de ação"* — a IA responde formatado.
- Mantém compatibilidade total com o que já foi construído (snapshot, threads, auditor mode, etc.).

Posso implementar?
