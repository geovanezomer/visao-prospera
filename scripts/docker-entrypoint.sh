#!/bin/sh
# ============================================================
# Entrypoint do container de produção.
# 1) Preflight: confere variáveis críticas e avisa cedo.
# 2) Bootstrap do banco (best-effort — NUNCA derruba o container).
# 3) Inicia o servidor SSR do TanStack Start (Nitro/Node).
#
# IMPORTANTE: este script NÃO usa `set -e`. Qualquer falha
# intermediária deve ser logada e ignorada — só o servidor é
# crítico. Container em restart-loop é pior que feature ausente.
# ============================================================

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
  echo "[entrypoint] Aguardando 30s antes de sair para evitar restart-loop agressivo..."
  sleep 30
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ "$SUPABASE_SERVICE_ROLE_KEY" = "REPLACE_WITH_YOUR_SERVICE_ROLE_KEY" ]; then
  echo "[entrypoint] AVISO: SUPABASE_SERVICE_ROLE_KEY ausente/placeholder — admin, webhooks e backup ficarão indisponíveis."
fi

# ---------- Bootstrap do banco (best-effort) ----------
/app/scripts/db-bootstrap.sh || echo "[entrypoint] db-bootstrap retornou erro — seguindo mesmo assim."

# ---------- Servidor ----------
echo "[entrypoint] Iniciando servidor em http://${HOST:-0.0.0.0}:${PORT:-3000}"
exec node .output/server/index.mjs
