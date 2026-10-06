#!/bin/sh
# ============================================================================
# Instalação de uma instância do FinnancePRO numa VPS, com um comando.
#
#   ./scripts/ops/install.sh --dominio app.cliente.com.br --email ti@cliente.com.br
#
# Pré-requisitos: Docker com o plugin compose, e o domínio apontando (DNS A/AAAA)
# para esta VPS, portas 80 e 443 livres.
#
# O que faz:
#   1. gera o .env com segredos aleatórios (senha do banco, sessões, chave do Odoo);
#   2. escreve o Caddyfile: HTTPS automático (Let's Encrypt) para o domínio;
#   3. sobe banco, app, backup diário e o proxy HTTPS (perfil "https");
#   4. espera o /api/health e mostra o resumo.
# Rodar de novo não troca segredos (o .env existente é mantido).
# ============================================================================
set -eu
cd "$(dirname "$0")/../.."

DOMINIO=""
EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dominio) DOMINIO="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DOMINIO" ] || { echo "Informe --dominio (ex.: app.cliente.com.br)" >&2; exit 2; }
[ -n "$EMAIL" ] || { echo "Informe --email (avisos do certificado HTTPS)" >&2; exit 2; }

log() { printf '[install] %s\n' "$*"; }
command -v docker >/dev/null || { echo "Docker não encontrado." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Plugin 'docker compose' não encontrado." >&2; exit 1; }

segredo() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [ -f .env ]; then
  log ".env já existe: mantendo os segredos atuais"
else
  log "gerando .env com segredos aleatórios"
  cp .env.example .env
  set_env() {
    # Substitui (ou acrescenta) CHAVE="valor" no .env.
    if grep -qE "^#? ?$1=" .env; then
      sed -i.bak -E "s|^#? ?$1=.*|$1=\"$2\"|" .env && rm -f .env.bak
    else
      printf '%s="%s"\n' "$1" "$2" >>.env
    fi
  }
  set_env POSTGRES_PASSWORD "$(segredo)"
  set_env BETTER_AUTH_SECRET "$(segredo)$(segredo)"
  set_env ODOO_SECRET_KEY "$(segredo)$(segredo)"
  set_env CRON_SECRET "$(segredo)"
  set_env APP_URL "https://$DOMINIO"
  set_env VITE_APP_URL "https://$DOMINIO"
  set_env ALERT_EMAIL "$EMAIL"
  # Atrás do Caddy: o IP do cliente vem na última entrada do X-Forwarded-For.
  set_env TRUST_PROXY_HEADER "x-forwarded-for"
  set_env APP_BIND "127.0.0.1"
  chmod 600 .env
fi

log "escrevendo o Caddyfile para $DOMINIO"
cat >Caddyfile <<CADDY
{
	email $EMAIL
}

$DOMINIO {
	encode zstd gzip
	reverse_proxy app:3000
}
CADDY

mkdir -p backups
log "construindo e subindo os serviços (alguns minutos na primeira vez)"
docker compose --profile https up -d --build

log "aguardando o app responder"
i=0
until docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 90 ] || { log "ERRO: o app não respondeu em 3 minutos. Veja: docker compose logs app"; exit 1; }
  sleep 2
done

cat <<FIM

[install] pronto.
  Endereço:      https://$DOMINIO   (o certificado sai em alguns segundos)
  Primeiro acesso: usuário admin / senha admin (o app exige a troca)
  Backup diário: ./backups (03:00 de Brasília, 30 dias)
  Alertas:       $EMAIL (configure SMTP_* no .env para o envio de e-mails)
  Manual:        docs/OPERACAO.md
FIM
