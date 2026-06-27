# Refactor `pdfExport` para renderer puro (sem duplicar call-sites de domínio)

## Problema

`src/engines/finance/pdfExport.ts` é hoje um **segundo call-site** de:

- `diagnose(state, dre, ind)` — diagnóstico de saúde financeira
- `buildPrescriptiveCards(state, { dre, tax, ind, cf })` — recomendações priorizadas
- `buildBriefing(state, dre, ind)` + IA (`loadConfig`, `isAIConfigured`, `gerarDiagnostico`, cache)

A tela já calcula tudo isso por hooks/selectors. Se algum dia mudar a assinatura, parâmetro obrigatório, ou ordem de chamada de uma dessas funções, **PDF e tela podem divergir silenciosamente**. Hoje produzem o mesmo número porque são funções puras; amanhã, não há garantia.

## Objetivo

`pdfExport` vira **render-only**: recebe os resultados já calculados; não invoca lógica de domínio. O call-site (`src/routes/app.tsx`, o único existente) passa a montar o payload com as mesmas funções/hooks que a UI consome — uma SSOT por execução.

## Mudanças

### 1. Novo contrato de `exportFinancePDF`

```ts
// src/engines/finance/pdfExport.ts
import type { DiagnoseItem } from "@/engines/finance/diagnose";
import type { PrescriptiveCard } from "@/engines/finance/prescriptive";
import type { DiagnosticoResult } from "@/engines/ai/diagnostico";

export interface ExportPDFInput {
  state: AppState;
  model: FinancialModel;
  diags: DiagnoseItem[];               // já calculado pelo caller
  prescriptive: PrescriptiveCard[];    // já calculado pelo caller
  aiDiagnostico?: DiagnosticoResult | null; // opcional, vindo do hook useDiagnosticoIA
}
```

- Remove os imports executáveis: `diagnose`, `buildPrescriptiveCards`, `buildBriefing`, `briefingCacheKey`, `loadConfig`, `isAIConfigured`, `gerarDiagnostico`, `getCached`, `setCached`, `PROMPT_VERSION`.
- Mantém apenas `type`-only imports.
- A seção "Diagnóstico Executivo IA" só renderiza se `aiDiagnostico` chegar preenchido. O exportador **não busca, não chama provedor, não toca em cache** — isso é responsabilidade do hook na UI.

### 2. Call-site único em `src/routes/app.tsx`

No `onClick` do botão de exportar:

```ts
const [
  { exportFinancePDF },
  { buildFinancialModel },
  { diagnose },
  { buildPrescriptiveCards },
] = await Promise.all([
  import("@/engines/finance/pdfExport"),
  import("@/engines/finance/financialModel"),
  import("@/engines/finance/diagnose"),
  import("@/engines/finance/prescriptive"),
]);

const model = buildFinancialModel(state);
const { dre, ind, tax, cf } = model;
const diags = diagnose(state, dre, ind);
const prescriptive = buildPrescriptiveCards(state, { dre, tax, ind, cf });

// IA: reusa o resultado já presente no hook useDiagnosticoIA (cache compartilhado).
// Se ainda não houver, passa null — o PDF omite a página, sem fallback de chamada.
const aiDiagnostico = diagnosticoIA.data ?? null;

await exportFinancePDF({ state, model, diags, prescriptive, aiDiagnostico });
```

O hook `useDiagnosticoIA` (já consumido pelo Dashboard/Strategic) passa a ser também chamado no nível do `app.tsx` para que o botão consiga ler `diagnosticoIA.data` no clique. Como o hook é memoizado por `briefingCacheKey`, isso não dispara nova chamada à IA quando já está em cache.

### 3. Guardrail arquitetural (novo teste)

Adicionar em `src/__tests__/architecture.test.ts`:

```ts
it("pdfExport é render-only (não importa lógica de domínio executável)", () => {
  const src = readFileSync(join(ROOT, "src/engines/finance/pdfExport.ts"), "utf8");
  const forbidden = [
    /\bfrom\s+["']@\/engines\/finance\/diagnose["']/,
    /\bfrom\s+["']@\/engines\/finance\/prescriptive["']/,
    /\bfrom\s+["']@\/engines\/finance\/briefing["']/,
    /\bfrom\s+["']@\/engines\/ai\/diagnostico["']/,
    /\bfrom\s+["']@\/engines\/ai\/diagnosticoCache["']/,
    /\bfrom\s+["']@\/engines\/ai\/providers["']/,
  ];
  // Permitido apenas `import type { ... } from`
  for (const re of forbidden) {
    const match = src.match(re);
    if (!match) continue;
    const line = src.slice(0, match.index!).split("\n").pop() ?? "";
    expect(line.trim().startsWith("import type"), `pdfExport importa runtime de ${match[0]}`).toBe(true);
  }
});
```

### 4. Testes existentes

Todos os 343 testes seguem verdes. A suíte não testava o conteúdo do PDF, apenas o boundary — a nova regra acima é o que protege a SSOT daqui pra frente.

## Não-objetivos

- Não mexer no layout/visual do PDF.
- Não alterar o conjunto de páginas geradas (apêndice, narrativa, KPIs).
- Não mover/renomear `pdfExport.ts` de novo (já está em `src/engines/finance/`).
- Não mexer em `pdfCalculadora.ts` (escopo distinto).

## Riscos & mitigações

- **Risco:** `diagnosticoIA.data` ainda não disponível no momento do clique → PDF sem página IA. **Mitigação:** comportamento idêntico ao atual quando a IA falha (página é omitida silenciosamente). Aceito porque pré-cache via hook é o caso comum.
- **Risco:** caller esquecer de passar `diags`/`prescriptive`. **Mitigação:** ambos são obrigatórios no tipo — typecheck quebra build.

## Entregáveis

1. `src/engines/finance/pdfExport.ts` — assinatura e imports atualizados.
2. `src/routes/app.tsx` — novo call-site computa tudo antes de chamar.
3. `src/__tests__/architecture.test.ts` — novo guardrail.
4. `bun run test` verde (343 passa → 344 passa).