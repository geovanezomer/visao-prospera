# FinancePRO — Deploy com Docker (VPS)

Aplicação **TanStack Start** (React 19 + Vite 7 + Nitro) com **PostgreSQL 17**
próprio e login **Better Auth** rodando dentro do app. Sem serviços de
terceiros obrigatórios e sem custo de backend: tudo sobe com um
`docker compose up`.

## Arquivos

| Arquivo              | Função                                                   |
| -------------------- | -------------------------------------------------------- |
| `Dockerfile`         | Build de produção multi-stage (servidor Node 22)         |
| `Dockerfile.dev`     | Container de desenvolvimento com hot reload              |
| `docker-compose.yml` | Serviços `db` (Postgres 17), `app` (prod), `app-dev`     |
| `db/migrations/`     | Esquema do banco (Drizzle), aplicado pelo app na subida  |

## Primeira subida

```bash
cp .env.example .env
# edite: POSTGRES_PASSWORD, BETTER_AUTH_SECRET, APP_URL e, se tiver, SMTP_*
openssl rand -hex 24   # sugestão para POSTGRES_PASSWORD
openssl rand -hex 32   # sugestão para BETTER_AUTH_SECRET
docker compose up -d --build
```

Acesse **http://SEU_IP:3000** e entre com **usuário `admin` / senha `admin`**.
O app exige a troca da senha nesse primeiro acesso.

Na subida, o app:

1. aplica as migrations pendentes do banco (falha alta: se uma migration
   quebrar, o app responde erro em vez de subir com esquema inconsistente);
2. cria o administrador inicial, se ainda não existir nenhum.

## Variáveis de ambiente

| Prefixo               | Quando é lida         | Exemplos                                              |
| --------------------- | --------------------- | ----------------------------------------------------- |
| `VITE_*`              | **Build** (bundle)    | `VITE_LANDING_PAGE`, `VITE_PAYMENTS_ENABLED`          |
| Sem prefixo (runtime) | **Runtime** (servidor)| `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SMTP_*`, `STRIPE_*` |

O `.env` é usado só no estágio de build (para as `VITE_*`). A imagem final
não contém o `.env`: as variáveis de runtime entram por `env_file` no compose
ou por `docker run --env-file .env`.

> Mudou uma `VITE_*`? Rebuilde (`--build`). Mudou só runtime? `docker compose restart app`.

## Banco de dados

- Serviço `db` (Postgres 17) com volume `pgdata`, sem porta exposta: só o app
  o acessa, pela rede interna do compose.
- **Usar um Postgres existente** (por exemplo, o mesmo servidor do Odoo):
  crie um banco e um usuário **separados** para o FinancePRO, defina
  `DATABASE_URL` no `.env` e remova o serviço `db` do compose. Nunca use o
  banco do Odoo.
- Backup: `docker compose exec db pg_dump -U financepro financepro > backup.sql`.
- Migrations manuais (opcional): `DATABASE_URL=... bun run db:migrate`.
- Alterou `src/db/schema.ts`? Gere a migration: `bun run db:generate`.

## E-mail

Reset de senha e links de acesso saem por **SMTP** (`SMTP_HOST` etc.) — pode
ser o mesmo servidor de e-mail configurado no Odoo. Resend é opcional. Sem
nenhum dos dois, o e-mail não é enviado e o aviso aparece no log.

## Produção

```bash
docker compose up -d --build
docker compose logs -f app
docker compose ps        # app e db devem ficar "healthy"
```

O healthcheck consulta `GET /api/health`, que confere o acesso ao banco.

## Desenvolvimento (hot reload)

```bash
docker compose --profile dev up app-dev db --build
```

Acesse **http://localhost:5173**.

## Deploy em VPS — checklist

1. Clonar o repositório no VPS.
2. `cp .env.example .env` e preencher (senha do banco, `BETTER_AUTH_SECRET`,
   `APP_URL` com a URL pública final, SMTP).
3. `docker compose up -d --build`.
4. Entrar com `admin` / `admin` e trocar a senha.
5. Nginx/Caddy na frente fazendo proxy para `:3000` com TLS, e
   `TRUST_PROXY_HEADER="x-real-ip"` no `.env`.

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

## Troubleshooting

**`DATABASE_URL não configurada`** — o compose monta a URL a partir de
`POSTGRES_*`; confira se `POSTGRES_PASSWORD` está no `.env`.

**`BETTER_AUTH_SECRET ausente ou curto`** — defina um valor com 32+ caracteres.

**Login não mantém a sessão atrás do proxy** — confira `APP_URL` (precisa ser
a URL pública com `https://`) e o `proxy_set_header Host`.

**Build falha no Nitro com erro de Cloudflare/Wrangler** — confirme
`NITRO_PRESET=node-server` no Dockerfile (já está).
