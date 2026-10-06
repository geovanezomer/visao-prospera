#!/bin/sh
# ============================================================================
# Restauração REAL do banco a partir de um dump (substitui os dados atuais).
#
# Uso (dentro do serviço de backup):
#   docker compose exec backup restore.sh /backups/financepro-AAAAMMDD-HHMMSS.dump --confirmar
#
# Pare o app antes (docker compose stop app) e suba de novo depois. O banco é
# apagado e recriado a partir do dump.
# Antes de restaurar, um dump de segurança do estado atual é gravado.
# ============================================================================
set -eu

file="${1:-}"
DB="${PGDATABASE:?defina PGDATABASE}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

if [ -z "$file" ] || [ ! -f "$file" ] || [ "${2:-}" != "--confirmar" ]; then
  echo "Uso: restore.sh <arquivo.dump> --confirmar" >&2
  echo "Backups disponíveis:" >&2
  ls -1t "$BACKUP_DIR"/"$DB"-*.dump 2>/dev/null | head -n 10 >&2 || true
  exit 2
fi

pg_restore --list "$file" >/dev/null

safety="$BACKUP_DIR/${DB}-antes-da-restauracao-$(date -u +%Y%m%d-%H%M%S).dump"
echo "[restore] salvando o estado atual em $safety"
pg_dump --format=custom --no-owner --no-privileges --file="$safety" "$DB"
chmod 600 "$safety"

# Restaura num banco RECRIADO (mesmo caminho do restore-test.sh). Com
# --clean por cima do banco atual, uma tabela criada por migração posterior ao
# dump (com FK para "user") travava o DROP — justamente no rollback de uma
# atualização — e o histórico de migrações ficaria inconsistente.
echo "[restore] recriando $DB e restaurando $file"
dropdb --force --if-exists "$DB"
createdb "$DB"
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
  --dbname="$DB" "$file"
echo "[restore] concluído. Suba o app: docker compose start app"
