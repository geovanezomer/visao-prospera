
# Sistema de Arquivos .finnance (estilo Excalidraw)

Transformar o FinancePRO num app file-based: estado do trabalho vira um arquivo `.finnance` (JSON) que o consultor salva no disco, abre, compartilha por e-mail/Drive/WhatsApp — sem depender do `localStorage` daquele navegador específico.

## Como o Excalidraw faz (referência)

1. **Estado em memória + autosave no localStorage** como rede de segurança (recupera se fechar a aba).
2. **Save to file** → serializa cena em JSON com `type`, `version`, `source`, payload → `Blob` → `<a download="nome.excalidraw">`.
3. **Open** → `<input type="file">` (ou drag-drop) → lê JSON → valida `type === "excalidraw"` → migra por `version` → carrega no estado.
4. **Nome do arquivo no header** + indicador "modificado" (●) quando há mudanças não salvas.
5. **Atalhos** Ctrl+S / Ctrl+O, e prompt `beforeunload` quando há alterações não salvas.

Vamos replicar isso 1:1, adaptado ao nosso `AppState` + `Scenario[]`.

## Formato do arquivo `.finnance`

```json
{
  "type": "gz-finnance",
  "version": 1,
  "source": "GZ FinnancePRO",
  "savedAt": "2026-06-14T12:00:00.000Z",
  "app": { "name": "FinancePRO", "version": "1.x" },
  "state": { /* AppState completo */ },
  "scenarios": [ /* Scenario[] salvos */ ],
  "meta": {
    "companyName": "ACME LTDA",
    "businessType": "servicos",
    "notes": ""
  }
}
```

- `type` + `version` permitem migração futura (mesma estratégia de `migrateState` que já existe em `defaults.ts`).
- Nome default do arquivo: `{companyName}-{YYYY-MM-DD}.finnance` (sanitizado).

## Mudanças de UX

**Sidebar → Configurações Rápidas** (substituindo o botão "Exportar" atual, que hoje só chama `window.print`):

- 💾 **Salvar** — baixa `.finnance` (Ctrl+S).
- 📂 **Abrir** — file picker para `.finnance` (Ctrl+O); confirma sobrescrever se houver mudanças não salvas.
- 📄 **Novo** — reseta para `DEFAULT_STATE` (com confirmação).
- 🖨️ **Exportar PDF** — mantém o `window.print()` antigo, renomeado, para preservar a função de relatório.

**Header**: nome do arquivo atual + indicador `●` de "dirty" (não salvo).
**beforeunload**: aviso nativo se `dirty === true`.

## Arquitetura técnica

### Novos arquivos

- `src/lib/finance/fileFormat.ts` — schema Zod `FinnanceFile`, `serialize(state, scenarios, meta)`, `parse(json)`, `migrateFile(raw)`. Reusa `migrateState` de `defaults.ts`.
- `src/lib/finance/fileIO.ts` — helpers browser-only:
  - `downloadFinnanceFile(payload, filename)` — Blob + `<a download>`.
  - `pickFinnanceFile(): Promise<FinnanceFile>` — abre `<input type="file" accept=".finnance,application/json">`, lê com `FileReader`, valida com Zod.
  - `sanitizeFilename(name)`.
- `src/lib/finance/useFinnanceFile.ts` — hook que orquestra:
  - `currentFileName`, `dirty`, `save()`, `saveAs()`, `open()`, `newFile()`.
  - Marca `dirty=true` ao detectar mudança em `state`/`scenarios` (compara com snapshot do último save).
  - Registra `beforeunload` quando `dirty`.
  - Registra atalhos Ctrl+S / Ctrl+O em `window`.

### Arquivos alterados

- `src/routes/index.tsx` — instancia `useFinnanceFile`, passa handlers para a `AppSidebar`, exibe nome de arquivo + indicador dirty no header.
- `src/components/layout/AppSidebar.tsx` — substitui `onExport` por `onSave`, `onOpen`, `onNew`, `onExportPdf`; ajusta ícones (`Save`, `FolderOpen`, `FilePlus`, `Printer`).
- `src/lib/finance/store.ts` — **mantém** o autosave no localStorage como rede de segurança (igual Excalidraw). Adiciona um `loadFromFile(file)` que aceita um `FinnanceFile` validado e substitui `state` + `scenarios` atomicamente.

### Validação e segurança

- Zod schema rigoroso em `fileFormat.ts` rejeita arquivos sem `type: "gz-finnance"` ou com `version` desconhecida.
- Migrations versionadas: `migrateFile(raw)` aplica transformações entre versões antes de validar.
- Toast (`sonner`) para feedback: "Arquivo salvo", "Arquivo inválido", "Versão futura — atualize o app".
- Confirmação (`ConfirmDialog` já existe) antes de Abrir/Novo quando `dirty`.

## Compatibilidade

- LocalStorage continua sendo a fonte de dados ao abrir o app (autosave + persistência entre sessões), como no Excalidraw.
- Usuários antigos não precisam fazer nada — o app abre como antes; agora ganham Salvar/Abrir.
- Cenários salvos viajam junto com o arquivo (hoje ficam isolados no navegador).

## Fora de escopo (próximos passos possíveis)

- Compartilhamento por link (server-side storage no Cloud).
- Versionamento/histórico de arquivos.
- Import de `.xlsx` ou outros formatos.

## Resumo dos arquivos

```text
NOVOS:
  src/lib/finance/fileFormat.ts       # schema + serialize/parse/migrate
  src/lib/finance/fileIO.ts           # download/pick browser helpers
  src/lib/finance/useFinnanceFile.ts  # hook orquestrador

EDITADOS:
  src/routes/index.tsx                # wire-up + header file indicator
  src/components/layout/AppSidebar.tsx# botões Salvar/Abrir/Novo/PDF
  src/lib/finance/store.ts            # loadFromFile()
```
