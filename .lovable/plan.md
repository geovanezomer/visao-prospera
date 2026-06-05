## Objetivo

Chat lateral embarcado (fechado por padrão) que conversa sobre **TUDO** que o sistema calcula, com **persona especialista** (CFO + Contador + Economista) e suporte a dois provedores: **LM Studio local** e **OpenAI API**.

---

## 1. Provedores selecionáveis

`src/services/ai/providers.ts`

```ts
type Provider = "lmstudio" | "openai";
interface AIConfig {
  provider: Provider;
  baseUrl: string;        // lmstudio: http://127.0.0.1:1234/v1 | openai: https://api.openai.com/v1
  apiKey: string;         // vazio em lmstudio
  model: string;
  temperature: number;
  includeSnapshot: boolean;
}
```

Persistido em `localStorage` (`gz-finance-ai-config`). Chave OpenAI também em localStorage (uso local Docker, conforme aceito).

Ambos provedores usam a **mesma API OpenAI-compatible** (`/chat/completions` com SSE). Só muda `baseUrl` + header `Authorization`.

---

## 2. System Prompt — Persona Especialista + Contexto do Sistema

```
Você é um especialista sênior em finanças corporativas, atuando simultaneamente como:
- CFO (Chief Financial Officer) com 20+ anos de experiência em empresas de médio porte
- Contador (CRC ativo) com domínio de CPC, IFRS e legislação fiscal brasileira
- Economista (CORECON) com foco em análise de investimentos e valuation

SOBRE O SISTEMA QUE VOCÊ ESTÁ ANALISANDO:
Este é o "Visão Próspera", uma plataforma de simulação financeira e valuation
para PMEs brasileiras. Ele constrói, a partir das premissas do usuário:
- DRE mensal do ano-base e DRE anual projetada (até N anos)
- Fluxo de caixa mensal com identificação do pior mês e runway
- Indicadores: EBITDA, margens, ROE, ROIC, liquidez, endividamento, DSCR, cobertura de juros
- Valuation por DCF (WACC, g, valor terminal) e múltiplos
- Diagnóstico de saúde financeira com alertas de risco (default, capital de giro, custos fixos)
- Análise de sensibilidade (tornado) e simulação Monte Carlo
- Recomendações prescritivas para o consultor apresentar ao cliente

Seu trabalho é ajudar o consultor a interpretar esses números em reuniões com clientes:
explicar o porquê, apontar riscos, sugerir ações e quantificar impactos.

REGRAS INVIOLÁVEIS:
1. Responda SOMENTE com base nos números do <SNAPSHOT> abaixo. Nunca invente valores.
2. Se a informação não estiver no snapshot, diga claramente "não disponível nos dados".
3. Sempre cite o número exato (R$ ou %) e a fonte (ex: "DRE Ano 2", "Indicadores", "Fluxo Mês 7").
4. Tom: direto, executivo, em português brasileiro. Sem jargão desnecessário.
5. Quando sugerir ações, quantifique o impacto esperado (ex: "cortar R$ Xk libera Y meses de caixa").
6. Use markdown para tabelas e listas quando aumentar clareza.

<SNAPSHOT>
{snapshot markdown completo gerado dinamicamente}
</SNAPSHOT>
```

---

## 3. Snapshot COMPLETO dos dados

`src/services/ai/snapshot.ts` — serializa em markdown estruturado **tudo** que o sistema calcula:

- **Empresa & premissas**: nome, setor, regime tributário, ano-base, horizonte, WACC, g, alíquotas
- **DRE completa**: 12 meses ano-base + N anos projeção (`buildDRE`, `forecastDRE`)
- **Receita**: por produto/serviço, sazonalidade, crescimento
- **Custos**: CPV (folha + não-folha), fixos, variáveis, capex
- **Fluxo de caixa**: mensal completo + pior mês + runway (`buildCashFlow`)
- **Indicadores**: todos de `calcIndicators`
- **Valuation**: VPL, TIR, valor terminal, múltiplos (`valuation`)
- **Saúde**: score + riscos (`health`)
- **Diagnóstico**: alertas e gargalos (`diagnose`)
- **Monte Carlo**: percentis (se calculado)
- **Sensibilidade**: tornado
- **Prescritivo**: recomendações
- **Estratégico**: cenários

Tudo com seções markdown claras, números formatados em R$ e %. Auto-resume seções secundárias se exceder o limite do modelo, mantendo DRE + indicadores + valuation sempre completos.

---

## 4. UI — Barra lateral fechada por padrão

- `src/components/ai/AIFab.tsx` — botão flutuante (canto inferior direito), ícone de chat
- `src/components/ai/AIChatSheet.tsx` — `Sheet` shadcn lado direito (~440px):
  - Header: provedor ativo + ⚙️ config + 🗑️ limpar histórico
  - Mensagens renderizadas com `react-markdown`
  - Indicador "pensando…" durante stream
  - Input com Enter para enviar, Shift+Enter quebra linha
  - Sugestões iniciais ("Qual o VPL e o que ele significa?", "Por que o caixa fica negativo no mês X?", "O DSCR é saudável?", "O que cortar para melhorar o EBITDA?")
- `src/components/ai/AIConfigDialog.tsx`:
  - Select de provedor (LM Studio / OpenAI)
  - Base URL (auto-preenchida, editável)
  - API Key (campo seguro, só relevante em OpenAI)
  - Select de modelo (lista via `GET /v1/models`)
  - Slider temperatura (default 0.3 para precisão)
  - Toggle "incluir snapshot de dados" (default ON)
  - Botão "Testar conexão"

Montado no layout raiz (ou em `routes/index.tsx`) para ficar disponível em todas as abas do simulador.

Histórico em `localStorage` por empresa: `gz-finance-ai-chat-{companyName}` (últimas 50 msgs).

---

## 5. Cliente unificado com streaming

`src/services/ai/client.ts`

```ts
async function* streamChat(config, messages) {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      model: config.model, messages,
      temperature: config.temperature, stream: true,
    }),
  });
  // parse SSE → yield delta.content
}
```

Idêntico para LM Studio e OpenAI (mesma API).

---

## Arquivos a criar

- `src/services/ai/providers.ts`
- `src/services/ai/client.ts`
- `src/services/ai/snapshot.ts`
- `src/services/ai/systemPrompt.ts` (persona + contexto do sistema)
- `src/components/ai/AIFab.tsx`
- `src/components/ai/AIChatSheet.tsx`
- `src/components/ai/AIConfigDialog.tsx`

## Arquivos a editar

- Layout/rota raiz do simulador — montar `<AIFab />` + `<AIChatSheet />`
- `package.json` — adicionar `react-markdown`

## Não faz parte

- Sem backend / sem server function (100% client-side, roda no Docker do usuário)
- Sem persistência em banco
- Sem tool-calling (read-only: LLM lê snapshot e responde)

---

## Garantias

1. **Persona especialista** (CFO + Contador + Economista) + contexto explícito do Visão Próspera embutidos no system prompt.
2. Snapshot inclui **todos os outputs** dos módulos `finance/*`.
3. Prompt obriga citar fonte exata e proíbe inventar números.
4. Toggle "incluir snapshot" ligado por padrão; temperatura default baixa (0.3).
5. Botão "Testar conexão" valida endpoint + modelo antes do uso.
6. Sugestões iniciais mostram o alcance das perguntas possíveis.
