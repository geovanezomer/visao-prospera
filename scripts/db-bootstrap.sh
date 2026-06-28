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
# Comportamento defensivo (NUNCA derruba o container):
#   • Se SUPABASE_DB_URL estiver vazia ou for placeholder → pula com aviso.
#   • Se a conexão falhar (senha errada, host inalcançável) → pula com
#     aviso. O servidor SSR sobe mesmo assim — assume schema já provisionado.
# ============================================================
# IMPORTANTE: NÃO usar `set -e` aqui. Esse script é chamado pelo
# entrypoint e qualquer falha derrubaria o container em loop.

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/app/supabase/migrations}"

# --- Validação da URL ------------------------------------------------------
if [ -z "$SUPABASE_DB_URL" ]; then
  echo "[db-bootstrap] SUPABASE_DB_URL não definida — pulando migrations."
  echo "[db-bootstrap] (Assumindo schema já provisionado no Supabase.)"
  exit 0
fi

# Detecta placeholders comuns do .env.example
case "$SUPABASE_DB_URL" in
  *YOUR_DB_PASSWORD*|*YOUR_REF*|*REPLACE_*|*your-project*)
    echo "[db-bootstrap] SUPABASE_DB_URL ainda contém placeholder — pulando."
    echo "[db-bootstrap] Edite o .env com a connection string real para aplicar migrations."
    exit 0
    ;;
esac

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "[db-bootstrap] Diretório $MIGRATIONS_DIR não existe — pulando."
  exit 0
fi

# --- Teste de conexão (timeout curto, falha-graciosa) ----------------------
echo "[db-bootstrap] Testando conexão com o banco..."
if ! PGCONNECT_TIMEOUT=8 psql "$SUPABASE_DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[db-bootstrap] AVISO: não foi possível conectar ao banco."
  echo "[db-bootstrap] Verifique SUPABASE_DB_URL (host, senha, porta 5432, IP allowlist)."
  echo "[db-bootstrap] Subindo o servidor mesmo assim — migrations NÃO foram aplicadas."
  exit 0
fi

# --- Atalho: banco vazio + baseline.sql disponível ------------------------
# Se _lovable_migrations não existe E o baseline está presente, aplica o
# baseline de uma vez (recriação rápida do schema em VPS novo).
BASELINE_FILE="${BASELINE_FILE:-/app/supabase/baseline.sql}"
LEDGER_EXISTS=$(psql "$SUPABASE_DB_URL" -tAc \
  "SELECT to_regclass('public._lovable_migrations') IS NOT NULL" 2>/dev/null)
if [ "$LEDGER_EXISTS" = "f" ] && [ -f "$BASELINE_FILE" ]; then
  echo "[db-bootstrap] Banco vazio detectado — aplicando baseline.sql..."
  if psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$BASELINE_FILE"; then
    echo "[db-bootstrap] Baseline aplicado com sucesso."
    exit 0
  else
    echo "[db-bootstrap] AVISO: baseline falhou — tentando migrations incrementais."
  fi
fi

# --- Cria tabela de controle ----------------------------------------------
if ! psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS public._lovable_migrations (
  filename     text PRIMARY KEY,
  applied_at   timestamptz NOT NULL DEFAULT now()
);
SQL
then
  echo "[db-bootstrap] AVISO: falha ao criar _lovable_migrations — pulando."
  exit 0
fi


APPLIED=0
SKIPPED=0
FAILED=0

for file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  name=$(basename "$file")

  exists=$(psql "$SUPABASE_DB_URL" -tAc \
    "SELECT 1 FROM public._lovable_migrations WHERE filename = '$name' LIMIT 1" 2>/dev/null)

  if [ "$exists" = "1" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "[db-bootstrap] Aplicando: $name"

  if psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$file"; then
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO public._lovable_migrations (filename) VALUES ('$name')" >/dev/null 2>&1
    APPLIED=$((APPLIED + 1))
  else
    echo "[db-bootstrap] AVISO: migration $name falhou — continuando."
    FAILED=$((FAILED + 1))
  fi
done

echo "[db-bootstrap] Concluído. Aplicadas: $APPLIED | Já existentes: $SKIPPED | Falhas: $FAILED"
exit 0
