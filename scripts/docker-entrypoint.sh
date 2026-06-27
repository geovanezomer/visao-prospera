#!/bin/sh
# ============================================================
# Entrypoint do container de produção.
# 1) Preflight: confere variáveis críticas e avisa cedo.
# 2) Bootstrap do banco (idempotente — aplica migrations pendentes;
#    pula se SUPABASE_DB_URL não estiver definida).
# 3) Inicia o servidor SSR do TanStack Start (Nitro/Node).
# ============================================================
set -e

# ---------- Preflight ----------
missing=""
for var in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY; do
  eval "val=\${$var}"
  if [ -z "$val" ]; then
    missing="$missing $var"
  fi
done

if [ -n "$missing" ]; then
  echo "[entrypoint] ERRO: variáveis obrigatórias ausentes:$missing"
  echo "[entrypoint] Preencha o .env (copie de .env.example) e rebuilde a imagem."
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ "$SUPABASE_SERVICE_ROLE_KEY" = "REPLACE_WITH_YOUR_SERVICE_ROLE_KEY" ]; then
  echo "[entrypoint] AVISO: SUPABASE_SERVICE_ROLE_KEY ausente — painel admin, webhooks e backup ficarão indisponíveis."
fi

# ---------- Bootstrap do banco ----------
/app/scripts/db-bootstrap.sh || {
  echo "[entrypoint] Falha no bootstrap do banco. Abortando."
  exit 1
}

# ---------- Servidor ----------
echo "[entrypoint] Iniciando servidor em http://${HOST:-0.0.0.0}:${PORT:-3000}"
exec node .output/server/index.mjs
