#!/bin/sh
# ============================================================
# Provisiona/sincroniza o usuário admin a partir do .env.
#
# Usa a Supabase Admin API (service_role) para criar o usuário
# se não existir, ou atualizar a senha caso já exista. Idempotente:
# pode rodar em todo boot. Falha em silêncio (apenas loga) se faltar
# alguma variável — não derruba o container.
#
# Requer: ADMIN_EMAIL, ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# ============================================================

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "[admin-bootstrap] ADMIN_EMAIL/ADMIN_PASSWORD ausentes — pulando."
  exit 0
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] \
   || [ "$SUPABASE_SERVICE_ROLE_KEY" = "REPLACE_WITH_YOUR_SERVICE_ROLE_KEY" ]; then
  echo "[admin-bootstrap] SUPABASE_SERVICE_ROLE_KEY ausente — admin não será provisionado."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[admin-bootstrap] curl não disponível — pulando."
  exit 0
fi

BASE="${SUPABASE_URL%/}/auth/v1/admin"
DISPLAY="${ADMIN_DISPLAY_NAME:-Administrador}"

# Escapa aspas no JSON (suficiente para os campos esperados).
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
EMAIL_ESC=$(esc "$ADMIN_EMAIL")
PASS_ESC=$(esc "$ADMIN_PASSWORD")
NAME_ESC=$(esc "$DISPLAY")

# 1) Procura usuário pelo e-mail.
LIST=$(curl -sS -G "$BASE/users" \
  --data-urlencode "filter=email.eq.$ADMIN_EMAIL" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

# Extrai o primeiro id retornado (sem jq).
USER_ID=$(printf '%s' "$LIST" | sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' | head -n1)

if [ -z "$USER_ID" ]; then
  echo "[admin-bootstrap] Criando admin $ADMIN_EMAIL ..."
  BODY=$(printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"display_name":"%s"}}' \
    "$EMAIL_ESC" "$PASS_ESC" "$NAME_ESC")
  RESP=$(curl -sS -w '\n%{http_code}' -X POST "$BASE/users" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$BODY")
  CODE=$(printf '%s' "$RESP" | tail -n1)
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    echo "[admin-bootstrap] Admin criado com sucesso."
  else
    echo "[admin-bootstrap] Falha ao criar admin (HTTP $CODE):"
    printf '%s\n' "$RESP" | sed '$d'
  fi
else
  echo "[admin-bootstrap] Admin já existe ($USER_ID) — sincronizando senha..."
  BODY=$(printf '{"password":"%s","email_confirm":true}' "$PASS_ESC")
  RESP=$(curl -sS -w '\n%{http_code}' -X PUT "$BASE/users/$USER_ID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$BODY")
  CODE=$(printf '%s' "$RESP" | tail -n1)
  if [ "$CODE" = "200" ]; then
    echo "[admin-bootstrap] Senha sincronizada."
  else
    echo "[admin-bootstrap] Falha ao atualizar admin (HTTP $CODE):"
    printf '%s\n' "$RESP" | sed '$d'
  fi
fi

exit 0
