#!/bin/sh
# ============================================================
# Entrypoint do container de produção.
# 1) Roda o bootstrap do banco (idempotente — aplica migrations
#    pendentes; pula se SUPABASE_DB_URL não estiver definida).
# 2) Inicia o servidor SSR do TanStack Start (Nitro/Node).
# ============================================================
set -e

/app/scripts/db-bootstrap.sh || {
  echo "[entrypoint] Falha no bootstrap do banco. Abortando."
  exit 1
}

echo "[entrypoint] Iniciando servidor em http://${HOST:-0.0.0.0}:${PORT:-3000}"
exec node .output/server/index.mjs
