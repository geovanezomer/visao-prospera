# ============================================================
# FinancePRO — Build de produção (multi-stage)
# Stack: TanStack Start (Vite + Nitro) + Bun + React 19
# Alvo: VPS (Docker), runtime Node 20
# ============================================================

# ---------- Stage 1: build ----------
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# 1) Instala dependências (cache de layer)
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# 2) Copia o .env ANTES do código — Vite lê em build-time e bundla
#    as variáveis VITE_* no client. Sem isso o bundle sai sem
#    SUPABASE_URL/KEY e a aplicação quebra no browser.
#    O .env precisa existir na raiz do projeto (copie de .env.example).
COPY .env ./.env

# 3) Restante do código
COPY . .

# 4) Força preset do Nitro para Node (template default é Cloudflare).
#    Gera .output/server/index.mjs auto-contido.
ENV NITRO_PRESET=node-server
ENV NODE_ENV=production

RUN bun run build


# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# psql é necessário para o bootstrap aplicar as migrations no boot.
# wget é usado pelo HEALTHCHECK.
RUN apk add --no-cache postgresql-client wget curl

# Copia apenas o output do Nitro (auto-contido)
COPY --from=builder /app/.output ./.output

# O .env NÃO é copiado para a imagem final: segredos gravados numa
# camada ficam legíveis para quem tiver a imagem. As variáveis de
# runtime (SUPABASE_SERVICE_ROLE_KEY, STRIPE_*, RESEND_*, etc.) chegam
# por process.env — via `env_file` no docker-compose ou
# `docker run --env-file .env`.

# Migrations + scripts de bootstrap (rodam no entrypoint)
COPY --from=builder /app/supabase/migrations ./supabase/migrations
COPY --from=builder /app/scripts ./scripts
RUN chmod +x /app/scripts/db-bootstrap.sh /app/scripts/docker-entrypoint.sh /app/scripts/admin-bootstrap.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
