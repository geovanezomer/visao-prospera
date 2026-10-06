#!/bin/sh
# ============================================================================
# Teste de restauração: restaura o dump mais recente (ou o informado) numa
# base TEMPORÁRIA, confere se as tabelas principais vieram com dados e apaga
# a base. Não toca no banco em uso. Resultado em $BACKUP_DIR/restore-test.json.
#
# Uso: restore-test.sh [arquivo.dump]
# ============================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB="${PGDATABASE:?defina PGDATABASE}"
file="${1:-$(ls -1t "$BACKUP_DIR"/"$DB"-*.dump 2>/dev/null | head -n1)}"
tmpdb="${DB}_restore_test"

result() {
  printf '{"ok":%s,"at":"%s","file":"%s","message":"%s"}\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "${file:-}")" \
    "$(printf %s "$2" | tr '"\n' "' ")" >"$BACKUP_DIR/restore-test.json"
}

if [ -z "${file:-}" ] || [ ! -f "$file" ]; then
  result false "nenhum backup encontrado em $BACKUP_DIR"
  echo "[restore-test] ERRO: nenhum backup" >&2
  exit 1
fi

cleanup() { dropdb --if-exists "$tmpdb" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
createdb "$tmpdb"

if ! pg_restore --no-owner --no-privileges --exit-on-error --dbname="$tmpdb" "$file" 2>/tmp/restore-test.err; then
  result false "pg_restore falhou: $(head -c 300 /tmp/restore-test.err)"
  echo "[restore-test] ERRO na restauração" >&2
  exit 1
fi

# Conferência: tabelas essenciais existem e o administrador está lá.
users="$(psql -d "$tmpdb" -tAc 'select count(*) from "user"' 2>/dev/null || echo erro)"
migr="$(psql -d "$tmpdb" -tAc 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo 0)"
tables="$(psql -d "$tmpdb" -tAc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$users" = erro ] || [ "$users" -lt 1 ] || [ "$tables" -lt 5 ]; then
  result false "restaurou, mas a conferência falhou (usuários=$users, tabelas=$tables)"
  echo "[restore-test] ERRO na conferência" >&2
  exit 1
fi

result true "restauração conferida: $tables tabelas, $users usuários, $migr migrations"
echo "[restore-test] ok $(basename "$file"): $tables tabelas, $users usuários"
