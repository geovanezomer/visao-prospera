#!/bin/sh
# ============================================================================
# Laço do serviço de backup: um backup por dia no horário BACKUP_TIME (UTC,
# HH:MM, padrão 06:00 = 03:00 de Brasília) e um teste de restauração no
# dia 1 de cada mês. Na subida faz um backup se não houver nenhum de hoje.
# ============================================================================
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_TIME="${BACKUP_TIME:-06:00}"
here="$(dirname "$0")"

until pg_isready -q; do sleep 2; done

today_done() { ls "$BACKUP_DIR"/"$PGDATABASE"-"$(date -u +%Y%m%d)"-*.dump >/dev/null 2>&1; }

run() {
  "$here/backup.sh" || echo "[backup-loop] backup falhou; nova tentativa em 1 h" >&2
  if [ "$(date -u +%d)" = "01" ] || [ ! -f "$BACKUP_DIR/restore-test.json" ]; then
    "$here/restore-test.sh" || true
  fi
}

today_done || run

while true; do
  sleep 60
  if [ "$(date -u +%H:%M)" = "$BACKUP_TIME" ]; then
    run
    sleep 60
  elif ! today_done && [ "$(date -u +%H%M)" -gt "$(echo "$BACKUP_TIME" | tr -d :)" ] \
    && [ "$(date -u +%M)" = "00" ]; then
    # Backup de hoje faltando depois do horário (falha ou serviço parado): tenta de hora em hora.
    run
  fi
done
