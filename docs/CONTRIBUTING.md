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

## Mensagens de commit

Curto, em português, no imperativo:

```
engines/finance: corrige fórmula do WACC quando dívida == 0
ai/tools: extrai módulo de compliance do registry
```
