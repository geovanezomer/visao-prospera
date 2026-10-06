# Arquitetura do FinnancePRO

Este documento é o contrato de onde cada tipo de código mora.
Mudanças que violarem essas regras são detectadas por:

- **ESLint** (`no-restricted-imports` em `eslint.config.js`)
- **Vitest** (`src/__tests__/architecture.test.ts`)

Antes de criar um arquivo novo, decida a pasta consultando este guia.

---

## Árvore canônica

```
src/
├── routes/              # Rotas TanStack (file-based). UI fina + composição.
├── components/          # Componentes React reutilizáveis (UI).
│   ├── ui/              # shadcn/ui primitives (não editar manualmente).
│   ├── sim/             # Composição das abas do simulador.
│   ├── calculadoras/    # UI das calculadoras (consome engines/calculadoras).
│   └── layout/          # Sidebar, header, shell.
│
├── engines/             # ⚙️ TODA lógica de domínio mora aqui.
│   ├── finance/         # Engine financeira (DRE, indicadores, valuation, fluxo,
│   │                    #   forecast, sensibilidade, monte carlo, tipos AppState).
│   ├── ai/              # Engine de IA (system prompt, snapshot, tools/, providers).
│   │   └── tools/       # Registry de tools, dividido por domínio (finance,
│   │                    #   simulator, benchmark, macro, scenarios, actions,
│   │                    #   compliance). Cada módulo é independente; o index
│   │                    #   agrega TOOLS, runTool, asOpenAITools, asAnthropicTools.
│   ├── benchmark/       # Setores e ranking percentílico.
│   ├── compliance/      # Comparativo de regimes, checklist, transição reforma.
│   ├── macro/           # Snapshot e séries do BCB.
│   ├── scenarios/       # CRUD de cenários salvos.
│   ├── actions/         # Plano de ação (CRUD).
│   └── calculadoras/    # Lógica das calculadoras (CLT×PJ, rescisão, SAC/Price,
│                        #   custo de funcionário).
│
├── lib/                 # 🧰 Utilitários genéricos. SEM lógica de domínio.
│   ├── utils.ts         # cn(), helpers de classes.
│   ├── auth.tsx         # useAuth (Supabase). Reutilizável em qualquer projeto.
│   ├── api/             # Wrappers HTTP genéricos.
│   ├── error-*.ts       # Captura de erro.
│   └── config.server.ts # Config server-only.
│
├── hooks/               # React hooks transversais (useAIChat, etc.).
├── integrations/        # Clientes Supabase auto-gerados (não editar).
└── __tests__/           # Testes globais (ex.: architecture.test.ts).
```

## Regras de import

| De → Para                         | Permitido?           |
| --------------------------------- | -------------------- |
| `components/*` → `engines/*`      | ✅                   |
| `engines/<a>/*` → `engines/<b>/*` | ✅ (com parcimônia)  |
| `engines/*` → `lib/utils`         | ✅                   |
| `lib/*` → `engines/<dominio>`     | 🚫 **bloqueado**     |
| `routes/*` → `engines/*`          | ✅                   |
| `*` → `@/services/*`              | 🚫 **descontinuado** |
| `*` → `@/lib/calculadoras`        | 🚫 **descontinuado** |
| `tools/<x>.ts` → `tools/<y>.ts`   | 🚫 (use o index)     |

Motivação: manter `lib/` reutilizável entre projetos e a engine financeira
testável de forma isolada (pure functions + Zod nos inputs).

## Adicionando algo novo

| Tipo de código                                    | Pasta                                   |
| ------------------------------------------------- | --------------------------------------- |
| Cálculo financeiro / indicador                    | `engines/finance/`                      |
| Nova tool para a IA                               | `engines/ai/tools/<dominio>.ts`         |
| Novo benchmark setorial                           | `engines/benchmark/`                    |
| Nova regra tributária / checklist                 | `engines/compliance/`                   |
| Nova fonte macro                                  | `engines/macro/`                        |
| Nova calculadora (lógica)                         | `engines/calculadoras/`                 |
| Nova calculadora (UI)                             | `components/calculadoras/`              |
| Helper de string/número/classe genérico           | `lib/utils.ts`                          |
| Hook React transversal (não específico a domínio) | `hooks/`                                |
| Hook React específico de uma engine               | junto da engine (`engines/<x>/use*.ts`) |

## Como adicionar uma tool de IA

1. Identifique o domínio (`finance`, `compliance`, etc.) ou crie um novo módulo.
2. Em `src/engines/ai/tools/<dominio>.ts` adicione:
   - Uma entrada em `defs: ToolDef[]` (nome, descrição, JSON schema).
   - Um handler em `handlers: Record<string, ToolHandler>` recebendo `(args, ctx)`.
3. Se for módulo novo, registre-o em `tools/index.ts` no array `MODULES`.

O agregador detecta colisão de nomes (warn em dev) e expõe `TOOLS`, `runTool`,
`asOpenAITools` e `asAnthropicTools` — quem consome a API pública não muda.

## Padrões de código

- **Engine = pure functions** (sem React, sem DOM). Inputs validados com Zod.
- **UI = props + selectors do `AppStateContext`** (sem prop drilling profundo).
- **Componente > 300 linhas** deve ser dividido (regra prática).
- **Comentários em português** explicando _por quê_, não _o quê_.
- **Sinalizar reforma tributária** com `// [CBS/IBS]` quando o cálculo for afetado.

## Garantias automáticas

Toda mudança passa por:

```bash
bunx vitest run                 # 89 testes de engine + architecture.test.ts
bunx eslint src                 # boundary de imports
```

Se quiser quebrar uma regra deste documento, atualize **primeiro** o documento,
o ESLint e o teste — assim o histórico fica explícito.
