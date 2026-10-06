#!/bin/sh
# ============================================================================
# Atualização do FinnancePRO na VPS, com backup antes e volta automática.
#
#   ./scripts/ops/update.sh            # git pull + build + troca
#   ./scripts/ops/update.sh --no-pull  # usa o código que já está na pasta
#
# 1. guarda a imagem atual como financepro:rollback;
# 2. constrói a nova imagem com o app ainda no ar (sem parada no build);
# 3. faz um backup do banco (as migrations rodam na subida da versão nova);
# 4. troca o contêiner (alguns segundos fora do ar) e espera o /api/health;
# 5. se a versão nova não responder em 2 min, volta a imagem anterior.
# ============================================================================
set -eu
cd "$(dirname "$0")/../.."

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
log() { printf '[update] %s\n' "$*"; }

if [ "${1:-}" != "--no-pull" ]; then
  log "atualizando o código (git pull)"
  git pull --ff-only
fi

if docker image inspect financepro:latest >/dev/null 2>&1; then
  docker tag financepro:latest financepro:rollback
  log "imagem atual guardada como financepro:rollback"
fi

log "construindo a nova imagem (o app segue no ar)"
docker compose build app

if docker compose ps --status running backup | grep -q backup; then
  log "backup antes da atualização"
  docker compose exec -T backup /ops/backup.sh
else
  log "AVISO: serviço de backup parado; seguindo sem backup prévio"
fi

log "trocando o contêiner do app"
docker compose up -d --no-build app

log "aguardando o app responder em $HEALTH_URL"
i=0
until curl -fsS "$HEALTH_URL" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    log "ERRO: a versão nova não respondeu em 2 minutos"
    if docker image inspect financepro:rollback >/dev/null 2>&1; then
      log "voltando para a versão anterior"
      docker tag financepro:rollback financepro:latest
      docker compose up -d --no-build --force-recreate app
      log "versão anterior no ar. Veja o motivo: docker compose logs --tail=200 app"
      log "Se a migration nova já alterou o banco, restaure o backup feito acima (docs/OPERACAO.md)."
    fi
    exit 1
  fi
  sleep 2
done

log "ok: $(curl -fsS "$HEALTH_URL")"
