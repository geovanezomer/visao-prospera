# ============================================================
# GZ FinancePRO — Build de produção (multi-stage)
# Gera o servidor Node a partir do TanStack Start (Nitro)
# ============================================================

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Instala deps com cache de layer
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Copia o restante do código
COPY . .

# Força o preset do Nitro para Node (default do template é Cloudflare).
# Isso faz o build gerar .output/server/index.mjs rodável em Node.
ENV NITRO_PRESET=node-server

RUN npm run build


# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copia somente o output do Nitro (auto-contido, sem node_modules extra)
COPY --from=builder /app/.output ./.output

EXPOSE 3000

# Healthcheck simples
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", ".output/server/index.mjs"]
