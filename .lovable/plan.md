# Plano: Eliminar Flash of Default Content (FODC) e Otimizar Performance

## Objetivo
Acabar com o "flash" do conteúdo mock na Landing/Login/App, reduzir refetches desnecessários e diminuir o bundle inicial. O usuário deve ver apenas: **cache → real** (se mudou). Nunca **default → real**.

---

## Fase 1 — Correção do FODC (raiz do problema)

### 1.1 `useBranding.ts` — separar "defaults de fallback" de "defaults de render"
- Remover `initialDataUpdatedAt: 0` (força refetch imediato).
- Subir `staleTime` para `60 * 60_000` (1h). Settings mudam raramente.
- Expor `isReady` real: `true` somente quando `data !== undefined` (cache OU fetch).
- DEFAULTS continuam existindo, mas usados apenas como último recurso (primeiro deploy / banco offline).
- Componentes que sofrem FODC vão **aguardar `isReady`** antes de renderizar conteúdo dinâmico (logo, nome, textos, vídeo).

### 1.2 Loaders pré-hidratam o React Query (SSR-first)
Já existe parcialmente em `__root.tsx`. Garantir o mesmo em todas as rotas que mostram branding:
- `src/routes/index.tsx` (Landing)
- `src/routes/landing.tsx`
- `src/routes/login.tsx`
- `src/routes/termos.tsx` / `src/routes/privacidade.tsx`

Padrão: `loader: ({ context }) => context.queryClient.ensureQueryData({ queryKey: ["app_settings"], queryFn: getAppSettings, staleTime: 60*60_000 })`.

### 1.3 Cache localStorage como `initialData` (já existe) + sincronização
- Manter `readSettingsCache` como `initialData` (cold start client).
- Persistência cross-tab via `storage` event já está OK.
- Garantir que **toda escrita do admin** invalide a query (`invalidateQueries(["app_settings"])`) e refaça `writeSettingsCache`.

### 1.4 Skeletons em vez de mock durante `!isReady`
Na Landing, Login e Header:
- Logo: `<Skeleton className="h-10 w-32" />` enquanto `!branding.logoUrl && !isReady`.
- Textos do hero/CTA: `<Skeleton>` em vez de strings DEFAULT.
- Assim que `isReady=true`, renderiza o real **uma única vez**.

---

## Fase 2 — React Query: cache estável e persistente

### 2.1 Configuração global do QueryClient (`src/router.tsx`)
```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})
```

### 2.2 Persist plugin (opcional, recomendado)
- Adicionar `@tanstack/react-query-persist-client` + `createSyncStoragePersister` (localStorage).
- Whitelist apenas `["app_settings"]` e outras queries "frias" (planos públicos, legal).
- Evita refetch entre sessões e elimina FODC em 100% das navegações.

### 2.3 Invalidação no admin
Após `updateAppSetting` em `SystemTab`/`LegalTab`/`PlansTab`:
- `queryClient.invalidateQueries({ queryKey: ["app_settings"] })`
- `writeSettingsCache(newData)` (já feito) — manter.

---

## Fase 3 — Bundle e renderização da Landing

### 3.1 Code splitting da `LandingPage`
Hoje é um único arquivo de ~48KB. Quebrar em:
- `LandingHero` (eager — acima da dobra, LCP)
- `HowItWorks`, `Features`, `Pricing`, `FAQ`, `Authority`, `Footer` → `React.lazy` + `<Suspense>`.

### 3.2 Memoização
- `React.memo` nos blocos estáticos (FAQ, HowItWorks, Footer).
- `useMemo` para listas de features/planos derivadas.

### 3.3 Ícones Lucide
- Importar individualmente (já é o padrão do projeto). Auditar para garantir que não há `import * as Icons`.

### 3.4 Lightbox de vídeo
- Dialog do YouTube já é montado on-demand. Garantir que o `<iframe>` só é criado quando `open=true`.

---

## Fase 4 — Auditoria pós-correção (checklist de lançamento)

- [ ] LCP Landing < 2.5s (medir com Lighthouse)
- [ ] CLS < 0.1 (skeletons com dimensões fixas)
- [ ] INP < 200ms
- [ ] Nenhum refetch em navegação SPA entre `/`, `/login`, `/termos`
- [ ] Network tab: `app_settings` chamado no máximo 1x por sessão (após persist)
- [ ] Bundle inicial da Landing reduzido (medir antes/depois com `vite build --report`)
- [ ] Componentes abaixo da dobra carregam via `Suspense`

---

## Detalhes técnicos

### Arquivos modificados
- `src/hooks/useBranding.ts` — staleTime, isReady, remover `initialDataUpdatedAt: 0`
- `src/router.tsx` — defaultOptions do QueryClient
- `src/routes/login.tsx`, `landing.tsx`, `termos.tsx`, `privacidade.tsx` — `ensureQueryData` no loader
- `src/components/landing/LandingPage.tsx` — split em sub-componentes lazy + skeletons + memo
- `src/components/admin/tabs/SystemTab.tsx` (e demais) — invalidate após save
- (Opcional) `bun add @tanstack/react-query-persist-client` + setup em `__root.tsx`

### Critério de aceite
Abrir a Landing em janela anônima → ver logo real (ou skeleton) → **nunca** ver "Finnance" + headline default piscando antes do conteúdo do admin.

---

## Fora de escopo (próxima rodada)
- Revisão de RLS/índices Supabase (item 10 da auditoria) — fazer em plano separado.
- Migração para `@tanstack/react-query-persist-client` é opcional na Fase 1; se quiser, faço já na Fase 2.

Confirma para eu executar as Fases 1–3? A Fase 4 é validação após implementação.