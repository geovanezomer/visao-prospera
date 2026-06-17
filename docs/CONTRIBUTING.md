# Guia rápido de contribuição

Leitura obrigatória: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Checklist antes de abrir mudanças

1. **Onde mora?** Decidi a pasta consultando a tabela do `ARCHITECTURE.md`?
2. **Engine vs UI.** Cálculo financeiro está em `src/engines/finance/` (pure
   function) e só a UI mora em `src/components/`?
3. **Lib limpa.** Nenhum arquivo em `src/lib/` importa de `@/engines/<dominio>/`?
4. **Imports válidos.** Não estou usando `@/services/*` nem `@/lib/calculadoras`?
5. **Tools de IA.** Se adicionei tool nova, ela está num módulo de domínio em
   `src/engines/ai/tools/<dominio>.ts` e registrada no `tools/index.ts`?
6. **Validação.** Inputs financeiros novos têm schema Zod?
7. **Reforma tributária.** Marquei trechos afetados com `// [CBS/IBS]`?
8. **Testes.**
   ```bash
   bunx vitest run
   ```
   Verde, incluindo `architecture.test.ts`?
9. **Lint.**
   ```bash
   bunx eslint src
   ```
   Sem violações de `no-restricted-imports`?

## Anti-padrões que serão revertidos

- Lógica financeira em `src/components/*` ou `src/lib/*`.
- Componente novo com mais de 300 linhas misturando UI + cálculo + formulário.
- Tool da IA solta dentro de `tools/index.ts` em vez de um módulo de domínio.
- `useFinance()` em componente grande quando só precisava de uma fatia
  (use `useFinanceSelector(s => s.tab)`).
- Hardcode de cor sem token semântico.
- Importar `client.server.ts` no topo de arquivo client-reachable.
- Editar `fileFormat/schema.ts` sem bump de versão + migrator (ver abaixo).

## Bump de versão do `.finnance`/`.finnance`

O envelope do arquivo é versionado (`CURRENT_VERSION` em
`src/engines/finance/fileFormat/schema.ts`). Sempre que o schema mudar de
forma que **arquivos antigos não passariam mais** no `FinnanceFileSchema`
atual (campo renomeado, estrutura alterada, default novo obrigatório), faça
o bump junto da mudança — nunca depois.

Passo a passo:

1. **Antes de mudar o schema**, exporte um `.finnance` real da versão atual e
   salve em `src/engines/finance/fileFormat/__tests__/fixtures/vN.json`
   (onde N = `CURRENT_VERSION` atual). Essa fixture vira o contrato vivo da
   versão antiga.
2. **Crie o migrator** `src/engines/finance/fileFormat/migrations/vN_to_vN+1.ts`:
   ```ts
   import type { Migration } from "./types";
   export const v1_to_v2: Migration = {
     from: 1,
     to: 2,
     run: (raw) => {
       const r = raw as Record<string, unknown>;
       // transforme a forma antiga na nova (puro, sem efeito colateral)
       return { ...r, version: 2 };
     },
   };
   ```
3. **Registre** no array `MIGRATIONS` de `migrations/index.ts`, em ordem
   crescente. APPEND-ONLY — nunca edite um migrator já publicado.
4. **Bump** `CURRENT_VERSION` em `schema.ts` para N+1 e atualize o
   `FinnanceFileSchema` com a nova forma.
5. **Valide**:
   ```bash
   bunx vitest run fileFormat
   ```
   O teste `migrations.test.ts` abre **todas** as fixtures (`v1.json`,
   `v2.json`, ...) e garante que cada uma chega ao schema corrente sem erro.

Regra de ouro: se um cliente com `.finnance` antigo no disco não consegue abrir
no app novo, o bug é nosso — todo bump precisa do migrator + fixture
correspondente.

## Mensagens de commit

Curto, em português, no imperativo:

```
engines/finance: corrige fórmula do WACC quando dívida == 0
ai/tools: extrai módulo de compliance do registry
fileFormat: bump v1→v2 (renomeia pis_cofins para cbs)
```
