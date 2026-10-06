#!/bin/sh
# ============================================================================
# Backup do banco do FinnancePRO (uma execução).
#
# Gera um dump comprimido (formato custom do pg_dump), confere se ele é
# legível, apaga os mais antigos que BACKUP_KEEP_DAYS e grava o resultado em
# $BACKUP_DIR/status.json (lido pelo /api/health e pelo painel do admin).
#
# Variáveis: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (padrão do libpq),
#            BACKUP_DIR (padrão /backups), BACKUP_KEEP_DAYS (padrão 30).
# ============================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
DB="${PGDATABASE:?defina PGDATABASE}"
mkdir -p "$BACKUP_DIR"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
status() {
  # $1 ok|erro  $2 arquivo  $3 bytes  $4 mensagem
  tmp="$BACKUP_DIR/.status.json.tmp"
  printf '{"ok":%s,"at":"%s","file":"%s","bytes":%s,"message":"%s","keepDays":%s}\n' \
    "$([ "$1" = ok ] && echo true || echo false)" "$(now)" "$2" "${3:-0}" \
    "$(printf %s "$4" | tr '"\n' "' ")" "$KEEP_DAYS" >"$tmp"
  mv "$tmp" "$BACKUP_DIR/status.json"
}

stamp="$(date -u +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/${DB}-${stamp}.dump"
part="$file.partial"

if ! pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$part" "$DB" 2>"$BACKUP_DIR/.last_error"; then
  status erro "" 0 "pg_dump falhou: $(head -c 300 "$BACKUP_DIR/.last_error")"
  rm -f "$part"
  echo "[backup] ERRO no pg_dump" >&2
  exit 1
fi

# Confere o arquivo: o índice precisa ser legível e, se o banco tem tabelas,
# trazer os dados delas.
tem_tabelas="$(psql -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)"
if ! pg_restore --list "$part" >"$BACKUP_DIR/.last_list" 2>"$BACKUP_DIR/.last_error" \
  || { [ "${tem_tabelas:-0}" -gt 0 ] && ! grep -q "TABLE DATA" "$BACKUP_DIR/.last_list"; }; then
  status erro "" 0 "dump ilegível: $(head -c 300 "$BACKUP_DIR/.last_error")"
  rm -f "$part"
  echo "[backup] ERRO: dump ilegível" >&2
  exit 1
fi
mv "$part" "$file"
chmod 600 "$file"
rm -f "$BACKUP_DIR/.last_error" "$BACKUP_DIR/.last_list"

# Retenção: remove dumps mais antigos que KEEP_DAYS (mantém sempre o atual).
find "$BACKUP_DIR" -maxdepth 1 -name "${DB}-*.dump" -type f -mtime +"$KEEP_DAYS" ! -path "$file" -delete

bytes="$(wc -c <"$file" | tr -d ' ')"
status ok "$(basename "$file")" "$bytes" "backup concluído"
echo "[backup] ok $(basename "$file") ($bytes bytes)"
