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

# Copia apenas o output do Nitro (auto-contido)
COPY --from=builder /app/.output ./.output

# Copia o .env para o runtime — o SSR lê variáveis sem prefixo
# (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_*, RESEND_*, etc.)
# em process.env. O docker-compose também monta via env_file:
# manter ambos garante que a imagem rode standalone (docker run).
COPY --from=builder /app/.env ./.env

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", ".output/server/index.mjs"]
