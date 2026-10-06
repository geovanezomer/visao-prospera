# FinancePRO — Deploy com Docker (VPS)

Aplicação **TanStack Start** (React 19 + Vite 7 + Nitro) usando **Bun** como
gerenciador de pacotes. Esta configuração permite buildar e rodar em qualquer
VPS com Docker, sem precisar de Node ou Bun no host.

## Arquivos

| Arquivo              | Função                                                |
| -------------------- | ----------------------------------------------------- |
| `Dockerfile`         | Build de produção multi-stage (gera servidor Node 22) |
| `Dockerfile.dev`     | Container de desenvolvimento com hot reload           |
| `docker-compose.yml` | Serviços `app` (prod) e `app-dev` (dev)               |
| `.dockerignore`      | Reduz o contexto enviado ao Docker daemon             |

## Pré-requisitos

- Docker 24+ e Docker Compose v2
- Arquivo **`.env`** na raiz (copie de `.env.example` e preencha com
  credenciais do Supabase, Stripe/Asaas, Resend, etc.).
  **Sem ele o bundle sai quebrado** — as `VITE_*` são injetadas em
  build-time pelo Vite.

```bash
docker --version
docker compose version
test -f .env && echo "OK .env presente" || cp .env.example .env
```

Edite `.env` antes de buildar.

## Variáveis de ambiente

Dois grupos lidos a partir do mesmo `.env`:

| Prefixo               | Quando é lida                             | Exemplos                                                      |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `VITE_*`              | **Build-time** (bundlada no JS do client) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`          |
| Sem prefixo (runtime) | **Runtime SSR** (`process.env`)           | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, etc. |

O Dockerfile **copia o `.env` no estágio de build E no runtime**, então a
imagem roda standalone (`docker run`). O `docker-compose.yml` também usa
`env_file: .env` no runtime — manter ambos é redundância segura.

> Mudou uma `VITE_*`? Rebuilde a imagem (`--build`). Mudou só uma var de
> runtime? Basta reiniciar o container.

---

## Produção

```bash
docker compose up app -d --build
```

Acesse: **http://SEU_IP:3000**

Logs:

```bash
docker compose logs -f app
```

Parar:

```bash
docker compose down
```

### O que o build faz

1. **Stage `builder`** (`oven/bun:1-alpine`) — `bun install --frozen-lockfile`,
   copia `.env` para que o Vite leia as `VITE_*`, define
   `NITRO_PRESET=node-server` (o template default é Cloudflare Workers, aqui
   forçamos Node) e roda `bun run build`. Saída: `.output/server/index.mjs`.
2. **Stage `runner`** (`node:22-alpine`) — copia `.output/` + `.env`.
   Sem `node_modules` extra. Imagem final ~150 MB.

---

## Desenvolvimento (hot reload)

```bash
docker compose --profile dev up app-dev --build
```

Acesse: **http://localhost:5173**

Código montado via volume — qualquer alteração recarrega.

### Hot reload lento no Windows/macOS

```bash
docker compose --profile dev run --rm \
  -e CHOKIDAR_USEPOLLING=true -e WATCHPACK_POLLING=true \
  app-dev
```

---

## Build manual (sem compose)

```bash
docker build -t financepro:latest .
docker run -d --name financepro -p 3000:3000 --env-file .env financepro:latest
```

---

## Deploy em VPS — checklist

1. Clonar o repositório no VPS.
2. Criar `.env` com as credenciais reais (`cp .env.example .env && nano .env`).
3. `docker compose up app -d --build`.
4. Confirmar saúde: `docker compose ps` (status `healthy`) e
   `curl -I http://127.0.0.1:3000`.
5. Subir Nginx/Caddy na frente do container fazendo proxy para `:3000`
   com TLS (Let's Encrypt).

Exemplo mínimo de Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name app.seu-dominio.com.br;

  ssl_certificate     /etc/letsencrypt/live/app.seu-dominio.com.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/app.seu-dominio.com.br/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

Lembre-se de ajustar `APP_URL` no `.env` para a URL pública final
(usado nos `return_url`/`success_url` do checkout).

---

## Backend

Este projeto usa **Supabase** (hospedado) como backend — banco, auth,
storage e edge runtime ficam fora do VPS. O container Docker roda apenas
o servidor SSR + bundle do client. Cenários e configurações de usuário
são persistidos no Supabase quando autenticado, ou em `localStorage` para
uso anônimo.

---

## Troubleshooting

**Build falha no Nitro com erro de Cloudflare/Wrangler**
Confirme que `NITRO_PRESET=node-server` está no Dockerfile (já está).

**Bundle gerado mas o app quebra no browser com `Missing Supabase environment variable`**
O `.env` não estava presente no build. Confirme `test -f .env` antes do
`docker compose build` — o `.dockerignore` permite que ele seja enviado ao daemon.

**Porta 3000 ocupada no VPS**
Mude o mapeamento em `docker-compose.yml` para `"8080:3000"`.

**Imagem muito grande**
Já usa `node:22-alpine` (~50 MB base) + `.output/` (~80–100 MB). Para enxugar,
troque a base por `gcr.io/distroless/nodejs20`.
