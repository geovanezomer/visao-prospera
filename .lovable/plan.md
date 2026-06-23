## Objetivo

Transformar o botão "Salvar" da sidebar em **"Salvar / Compartilhar"**, que abre um diálogo com 3 cards (mesma estética da imagem de referência, mas usando os tokens do design system FinnancePRO — nada de cores hard-coded):

1. **Salvar no computador** — exporta `.finnance` (já existe)
2. **Salvar na nuvem** — backup no Supabase Storage (já existe, hoje é silencioso)
3. **Compartilhar (link somente leitura)** — gera URL pública que carrega o sistema inteiro em modo read-only (novo)

---

## Arquitetura analisada

- **Botão atual:** `src/components/layout/AppSidebar.tsx` (linhas 135-141) — chama `onSave` vindo de `src/routes/index.tsx`.
- **Engine de save:** `src/engines/finance/useFinnanceFile.ts` — `save()` hoje faz **download local + backup nuvem** acoplados (debounce 1500 ms). Precisa ser **desacoplado** em três operações independentes.
- **Cloud backup:** `src/lib/api/cloudBackup.ts` já tem `uploadBackup/listBackups/downloadBackup` no bucket `backups` (privado, por `userId`).
- **Infra de compartilhamento já existe no banco** (mas sem código):
  - Tabela `public.shared_reports` (share_id, owner_id, storage_path, company_name, expires_at, revoked_at) com policy `SELECT TO public` (leitura pública) e CRUD restrito ao owner.
  - Bucket `shared-reports` (privado — usaremos signed URL ou download via server fn).
- **Serialização:** `serialize(state, scenarios, extras)` em `fileFormat/index.ts` produz o JSON canônico — reusar idêntico para os 3 fluxos.

---

## Plano de implementação

### 1. Refatorar `useFinnanceFile.ts` (desacoplar operações)

Substituir o `save()` monolítico por três callbacks expostos:

- `saveToDisk()` — só faz download local + limpa dirty/draft.
- `saveToCloud()` — só faz upload no bucket `backups` (sem debounce, com toast de progresso/sucesso/erro; usa `onBackupStatus`). Requer `userId`.
- `createShareLink()` — gera `shareId` (nanoid 12 chars), faz upload em `shared-reports/{ownerId}/{shareId}.finnance`, insere linha em `shared_reports`, retorna `{ shareId, url }`.

Manter `save()` como atalho que chama `saveToDisk()` + (se logado) `saveToCloud()` em background — preserva o atalho **Ctrl+S** sem regressão.

### 2. Novo componente `SaveShareDialog.tsx`

Em `src/components/sim/shared/SaveShareDialog.tsx`. Usa `shadcn Dialog` + 3 cards (ícones `HardDrive`, `Cloud`, `Link2` de lucide-react). Tokens do design system (`bg-card`, `text-primary`, `bg-primary/10` para os badges circulares). Estados de loading por card; após gerar link, mostra input com URL + botão "Copiar".

### 3. Atualizar `AppSidebar.tsx` e `src/routes/index.tsx`

- Botão renomeado para **"Salvar / Compartilhar"** (label + ícone `Share2`).
- `onSave` vira `onOpenSaveShare` → abre o dialog.
- `fileApi` agora expõe os 3 callbacks; passar todos via props.

### 4. Nova rota pública read-only `/shared/$shareId`

Arquivo `src/routes/shared.$shareId.tsx` (rota pública, fora de `_authenticated`):

- **Loader** chama server fn `getSharedReport({ shareId })` (em `src/lib/api/sharedReports.functions.ts`) que: lê linha em `shared_reports` (policy pública), valida `revoked_at`/`expires_at`, faz `supabaseAdmin.storage.from('shared-reports').download(path)` e devolve `{ payload, companyName }`.
- Renderiza a aplicação inteira em modo somente leitura (ver passo 5).
- `head()` com OG tags (título = nome da empresa) para links compartilháveis.

### 5. Modo read-only global

Adicionar `readOnly: boolean` ao `AppStateContext`:

- Quando `true`, os setters (`setState`, mutators de cenários, ações, etc.) viram no-ops e disparam `toast.info("Modo somente leitura")`.
- Hook auxiliar `useReadOnly()` para componentes que precisam desabilitar botões/inputs visualmente (`disabled`, opacity).
- Rota pública monta `<AppStateProvider initialState={payload.state} readOnly>`; a app normal continua com `readOnly={false}`.
- Esconder controles destrutivos quando readOnly: botão Salvar/Compartilhar, Reset, plano de ação (edição), config da empresa, dialogs de cenário. Mostrar badge fixo no topo: **"📖 Visualização compartilhada — somente leitura"**.

### 6. Server functions e segurança

`src/lib/api/sharedReports.functions.ts`:

- `createShareLink` — `requireSupabaseAuth`, gera `shareId`, upload (admin client lazy-importado), insert na tabela.
- `getSharedReport` — pública (sem middleware), valida revoked/expires, download via admin client, retorna JSON.
- `revokeShareLink` — `requireSupabaseAuth`, set `revoked_at = now()` no `share_id` do owner.

Carregar `supabaseAdmin` com `await import(...)` dentro do handler (conforme regra `tanstack-supabase-import-graph`).

### 7. Testes manuais

- Salvar no disco: arquivo baixa, dirty zera.
- Salvar na nuvem: aparece no `listBackups`.
- Gerar link: abrir em janela anônima → carrega read-only, edições bloqueadas.
- Revogar link: 404 amigável.

---

## Arquivos afetados

**Editados:**
- `src/engines/finance/useFinnanceFile.ts`
- `src/components/layout/AppSidebar.tsx`
- `src/routes/index.tsx`
- `src/engines/finance/AppStateContext.tsx` (flag readOnly)
- `src/engines/scenarios/store.ts` (guarda readOnly nos mutators)
- `src/engines/actions/store.ts` (idem)

**Novos:**
- `src/components/sim/shared/SaveShareDialog.tsx`
- `src/components/sim/shared/ReadOnlyBanner.tsx`
- `src/lib/api/sharedReports.functions.ts`
- `src/routes/shared.$shareId.tsx`

Sem migrations — tabela e bucket já existem.

---

## Fora de escopo (perguntar depois se necessário)

- Expiração configurável do link (default: sem expiração, revogável).
- Página de gerenciamento de links compartilhados (listar/revogar).
- Proteção por senha do link.
