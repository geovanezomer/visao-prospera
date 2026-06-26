#!/bin/sh
# ============================================================
# FinancePRO — Bootstrap do banco (executado no boot do container)
#
# Aplica TODAS as migrations em supabase/migrations/ na ordem
# (lexicográfica = cronológica, pelo prefixo de timestamp).
# Idempotente: usa a tabela public._lovable_migrations para
# registrar o que já foi aplicado e nunca reaplica.
#
# Requer: SUPABASE_DB_URL no ambiente.
#   Formato: postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
#   Obter em: Supabase Dashboard → Project Settings → Database →
#             Connection string → URI (use a "Direct connection").
#
# Se SUPABASE_DB_URL não estiver definida, o bootstrap é PULADO
# (assume que o banco já está provisionado externamente).
# ============================================================
set -e

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/app/supabase/migrations}"

if [ -z "$SUPABASE_DB_URL" ]; then
  echo "[db-bootstrap] SUPABASE_DB_URL não definida — pulando migrations."
  echo "[db-bootstrap] Defina-a no .env para aplicar o schema automaticamente."
  exit 0
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "[db-bootstrap] Diretório $MIGRATIONS_DIR não existe — pulando."
  exit 0
fi

echo "[db-bootstrap] Conectando ao banco..."

# Cria tabela de controle (idempotente)
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS public._lovable_migrations (
  filename     text PRIMARY KEY,
  applied_at   timestamptz NOT NULL DEFAULT now()
);
SQL

APPLIED=0
SKIPPED=0

for file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  name=$(basename "$file")

  # Verifica se já foi aplicada
  exists=$(psql "$SUPABASE_DB_URL" -tAc \
    "SELECT 1 FROM public._lovable_migrations WHERE filename = '$name' LIMIT 1")

  if [ "$exists" = "1" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "[db-bootstrap] Aplicando: $name"

  # Cada migration roda em transação única; se falhar, aborta tudo.
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$file"

  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO public._lovable_migrations (filename) VALUES ('$name')"

  APPLIED=$((APPLIED + 1))
done

echo "[db-bootstrap] Concluído. Aplicadas: $APPLIED | Já existentes: $SKIPPED"
