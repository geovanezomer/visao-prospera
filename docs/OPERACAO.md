# Manual de operação — FinnancePRO na VPS

Tudo roda no `docker compose` da raiz do repositório. Este manual cobre o dia a dia:
subir, atualizar, conferir a saúde, backup, restauração, ensaio de desastre e troca de
segredos. Comandos executados na pasta do projeto, na VPS.

## Serviços

| Serviço  | O que faz                                                                     |
| -------- | ----------------------------------------------------------------------------- |
| `db`     | PostgreSQL 17, sem porta publicada (só a rede interna do compose)             |
| `app`    | FinnancePRO na porta 3000; aplica as migrations e roda as rotinas agendadas   |
| `backup` | Um dump do banco por dia em `./backups`, 30 dias de retenção, teste mensal de |
|          | restauração                                                                   |

Metas de recuperação: perda máxima de dados de **24 h** (um backup por dia) e serviço de
volta em **até 1 h** seguindo a seção [Restaurar](#restaurar-o-banco).

## Instalação em um comando (recomendado)

Numa VPS com Docker, com o domínio já apontando para ela e as portas 80/443 livres:

```sh
git clone <repositório> finnancepro && cd finnancepro
./scripts/ops/install.sh --dominio app.cliente.com.br --email ti@cliente.com.br
```

O script gera o `.env` com segredos aleatórios, escreve o `Caddyfile` (HTTPS automático
pelo Let's Encrypt), sobe banco, app, backup diário e o proxy HTTPS, e espera o app
responder. A porta 3000 fica restrita à própria VPS. Depois, preencha `SMTP_*` no `.env`
para o envio de e-mails e rode `docker compose up -d app`.

## Primeira subida (manual)

```sh
cp .env.example .env    # preencha POSTGRES_PASSWORD, BETTER_AUTH_SECRET, APP_URL e SMTP_*
docker compose up -d --build
```

Entre com `admin` / `admin`; o app exige a troca da senha. Depois, em
**Administração › Sistema › Notificações do administrador**, preencha o **E-mail destino** que recebe os alertas
de operação (ou defina `ALERT_EMAIL` no `.env`). Sem SMTP configurado, os alertas só
aparecem no log.

HTTPS: coloque um proxy reverso na frente da porta 3000 (Caddy, nginx ou o proxy que já
atende o Odoo) e ajuste `TRUST_PROXY_HEADER` no `.env` conforme o proxy.

## Saúde do sistema

- **Painel:** Administração › Status › **Operação**. Luzes de banco, backup diário, teste
  de restauração, sincronização do Odoo e erros das últimas 24 h, mais a lista de erros
  capturados (servidor, navegador e rotinas), com a pilha de cada um.
- **Endpoint:** `GET /api/health` devolve `200` enquanto o banco responde, com o resumo
  `{"ok":true,"level":"ok|warn|fail","checks":{...}}`. Serve para o HEALTHCHECK do Docker
  e para qualquer monitor de disponibilidade.
- **Alertas por e-mail** (e Slack, se configurado), verificados a cada 15 min:

| Situação                                    | Quando avisa                     |
| ------------------------------------------- | -------------------------------- |
| Backup falhou ou está há mais de 26 h       | na hora; repete a cada 24 h      |
| Teste de restauração falhou                 | na hora; repete a cada 24 h      |
| Sincronização do Odoo falhou ou parou (3 h) | na hora; repete a cada 24 h      |
| Erro novo no sistema (assinatura inédita)   | um aviso por lote de erros novos |
| Item voltou ao normal                       | uma vez, "Normalizado: ..."      |

O botão **Verificar alertas agora** no painel roda a mesma verificação na hora (útil para
testar o e-mail).

## Atualizar

```sh
./scripts/ops/update.sh
```

O script guarda a imagem atual, constrói a nova com o app no ar, faz um backup, troca o
contêiner (alguns segundos fora do ar) e espera o `/api/health`. Se a versão nova não
responder em 2 minutos, volta sozinho para a anterior. Use `--no-pull` para atualizar
com o código que já está na pasta.

Se a versão nova aplicou uma migration e mesmo assim precisou voltar, restaure o backup
feito pelo script (o mais recente em `./backups`) antes de usar a versão anterior.

## Backup

- Arquivos em `./backups/<banco>-AAAAMMDD-HHMMSS.dump` (formato custom do `pg_dump`,
  comprimido, permissão 600). Mudar a pasta: `BACKUP_PATH` no `.env`.
- Horário: `BACKUP_TIME` (UTC; padrão 06:00 = 03:00 de Brasília). Retenção:
  `BACKUP_KEEP_DAYS` (padrão 30).
- Cada dump é conferido (`pg_restore --list`) antes de valer. O resultado fica em
  `./backups/status.json`; o teste de restauração, em `./backups/restore-test.json`.
- Backup na hora: `docker compose exec backup /ops/backup.sh`
- Teste de restauração na hora (base temporária, não toca no banco em uso):
  `docker compose exec backup /ops/restore-test.sh`

Os backups ficam na própria VPS. Se a VPS inteira for perdida, eles vão junto: quando
quiser uma cópia fora, basta copiar a pasta `./backups` (por exemplo, `rsync` para outro
servidor) — nada no app muda.

## Restaurar o banco

1. Escolha o arquivo: `ls -lt backups/`
2. Pare o app: `docker compose stop app`
3. Restaure (um dump do estado atual é salvo antes, por segurança):

   ```sh
   docker compose exec backup /ops/restore.sh /backups/financepro-AAAAMMDD-HHMMSS.dump --confirmar
   ```

4. Suba o app: `docker compose start app` e confira `curl -s localhost:3000/api/health`.
5. Entre no app e confira: usuários, arquivos salvos e, no modo Odoo, rode
   **Sincronizar agora** (o retrato do Odoo é refeito a partir do ERP).

## Ensaio de desastre (a cada 6 meses)

Objetivo: provar que o serviço volta em até 1 h com no máximo 24 h de dados perdidos.

1. Anote a hora de início.
2. Numa máquina de teste (ou na própria VPS, com outro nome de projeto:
   `docker compose -p ensaio ...`), suba o compose do zero com o mesmo `.env`.
3. Copie o dump mais recente para `./backups` da instalação de teste e restaure como na
   seção anterior.
4. Entre com um usuário real, abra um arquivo salvo e, se houver Odoo, sincronize.
5. Anote a hora de fim e a data do dump usado. Registre aqui embaixo.

| Data | Dump usado | Tempo até voltar | Dados perdidos | Responsável |
| ---- | ---------- | ---------------- | -------------- | ----------- |
|      |            |                  |                |             |

## Trocar segredos

| Segredo              | Como trocar                                 | Efeito                                                                                   |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Senha de usuário     | No app: menu do usuário › Trocar senha      | Só aquele usuário                                                                        |
| `BETTER_AUTH_SECRET` | Edite o `.env` e `docker compose up -d app` | Encerra todas as sessões. Sem `ODOO_SECRET_KEY`, exige cadastrar a chave do Odoo de novo |
| `ODOO_SECRET_KEY`    | Edite o `.env` e `docker compose up -d app` | A chave do Odoo salva fica ilegível: cadastre-a de novo em Administração › Odoo          |
| Chave de API do Odoo | Gere outra no Odoo e salve em Administração | A antiga pode ser revogada no Odoo em seguida                                            |
| `POSTGRES_PASSWORD`  | Veja abaixo                                 | O banco e o app precisam da senha nova ao mesmo tempo                                    |

Troca da senha do banco:

```sh
docker compose exec db psql -U financepro -c "ALTER USER financepro PASSWORD 'NOVA_SENHA'"
# edite POSTGRES_PASSWORD no .env com a mesma senha
docker compose up -d app backup
```

## Problemas comuns

- **Sincronização do Odoo falhando:** a mensagem aparece em Administração › Odoo e no
  painel Operação. Causas usuais: chave de API revogada ou sem escopo `rpc`, URL/banco
  alterados, Odoo anterior ao 19 (não suportado) ou Odoo fora do ar.
- **Erros no painel:** abra a linha para ver a pilha. Erros do navegador trazem a página
  onde ocorreram. Registros sem ocorrência há 30 dias são apagados sozinhos.
- **Disco cheio:** `du -sh backups` e reduza `BACKUP_KEEP_DAYS`; `docker image prune` remove
  imagens antigas (a `financepro:rollback` é recriada a cada atualização).
- **Logs:** `docker compose logs --tail=200 app` (ou `backup`, `db`).
