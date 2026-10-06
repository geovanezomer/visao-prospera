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

# 2) Copia o .env ANTES do código — Vite lê em build-time as variáveis
#    VITE_* (flags públicas como VITE_LANDING_PAGE). Segredos não vão para
#    o bundle: são lidos em runtime.
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

# wget é usado pelo HEALTHCHECK.
RUN apk add --no-cache wget

# Copia apenas o output do Nitro (auto-contido)
COPY --from=builder /app/.output ./.output

# O .env NÃO é copiado para a imagem final: segredos gravados numa
# camada ficam legíveis para quem tiver a imagem. As variáveis de
# runtime (DATABASE_URL, BETTER_AUTH_SECRET, SMTP_*, STRIPE_*, etc.) chegam
# por process.env — via `env_file` no docker-compose ou
# `docker run --env-file .env`.

# Migrations do banco: aplicadas pelo próprio app na primeira requisição
# (src/db/bootstrap.server.ts), junto com o administrador inicial.
COPY --from=builder /app/db/migrations ./db/migrations
ENV MIGRATIONS_DIR=/app/db/migrations

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", ".output/server/index.mjs"]
