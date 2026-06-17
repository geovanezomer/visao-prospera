# Fixtures de versões do .finnance

Cada `vN.json` é um arquivo **congelado** representando exatamente a forma do
envelope na versão N. Use estas fixtures como contrato vivo: o teste
`migrations.test.ts` abre todas elas e garante que continuam passando no
`CurrentSchema` após percorrer o pipeline de migrators.

## Regras

- **Não edite uma fixture publicada.** Se o schema mudou, crie uma nova fixture
  (`vN+1.json`) — a antiga continua testando o caminho de migração.
- Mantenha as fixtures pequenas (só campos necessários para o caso).
- Cobre casos representativos: estado mínimo, cenários, extras, regimes
  tributários relevantes (Simples, Lucro Real/Presumido, Reforma CBS/IBS).

## Como adicionar uma fixture nova (bump de versão)

1. Salve um `.finnance` real (exportado do app) **na versão antiga** como
   `vN.json` aqui, antes do bump.
2. Bump `CURRENT_VERSION` em `../../schema.ts`.
3. Implemente `../migrations/vN_to_vN+1.ts` + registre em `migrations/index.ts`.
4. Rode `bunx vitest run fileFormat`.
