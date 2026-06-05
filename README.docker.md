# GZ FinnancePRO — Build local com Docker

Este projeto é uma aplicação **TanStack Start** (React 19 + Vite 7 + Nitro) que utiliza **Bun** como gerenciador de pacotes.
Os arquivos abaixo permitem buildar e rodar localmente em qualquer máquina com
Docker instalado, sem precisar do Node nem Bun no host.

## Arquivos incluídos

| Arquivo              | Função                                                |
| -------------------- | ----------------------------------------------------- |
| `Dockerfile`         | Build de produção (multi-stage, gera servidor Node)   |
| `Dockerfile.dev`     | Container de desenvolvimento com hot reload           |
| `docker-compose.yml` | Orquestra os serviços `app` (prod) e `app-dev` (dev)  |
| `.dockerignore`      | Reduz o contexto enviado ao Docker daemon             |

## Pré-requisitos

- Docker 24+
- Docker Compose v2 (já vem com o Docker Desktop)
- Arquivo **`.env`** na raiz do projeto (copie de `.env.example` e preencha
  com suas credenciais do Lovable Cloud / Supabase). **Sem ele o build
  gera bundle quebrado** — as `VITE_*` são injetadas em build-time.

Verifique:

```bash
docker --version
docker compose version
test -f .env && echo "OK .env presente" || echo "FALTA .env — copie de .env.example"
```

---

## Modo PRODUÇÃO

Build da imagem e subida do container:

```bash
docker compose up app -d --build
```

Acesse: **http://localhost:3000**

Logs:
```bash
docker compose logs -f app
```

Parar:
```bash
docker compose down
```

### O que o build faz

1. **Stage `builder`** — usa a imagem `oven/bun:1-alpine` para instalar dependências
   com `bun install --frozen-lockfile`, define `NITRO_PRESET=node-server`
   (o template default é Cloudflare Workers, aqui forçamos Node) e roda
   `bun run build`. O Nitro gera `.output/server/index.mjs` auto-contido.
2. **Stage `runner`** — imagem `node:20-alpine` mínima copiando apenas
   `.output/`. Sem `node_modules` extra. Container final ~150MB.

---

## Modo DESENVOLVIMENTO (hot reload)

```bash
docker compose --profile dev up app-dev --build
```

Acesse: **http://localhost:5173**

O código-fonte é montado via volume — qualquer alteração no host recarrega
automaticamente. `node_modules` fica isolado em volume anônimo (não conflita
com o que está no host).

---

## Build manual (sem compose)

Produção:
```bash
docker build -t gzfinancepro:latest .
docker run -d --name gzfinancepro -p 3000:3000 gzfinancepro:latest
```

Desenvolvimento:
```bash
docker build -f Dockerfile.dev -t gzfinancepro:dev .
docker run --rm -it -p 5173:5173 -v "$(pwd)":/app -v /app/node_modules \
  gzfinancepro:dev
```

---

## Persistência de dados

A aplicação armazena cenários, autenticação e configurações no **`localStorage`
do navegador** — não há banco de dados no container. Não é preciso configurar
volume para dados; cada navegador mantém seus próprios cenários.

Usuários padrão (definidos em código):
- `adminfinancepro` / `admin7184#`
- `clientefinancepro` / `cliente7184#`

---

## Troubleshooting

**Build falha na etapa do Nitro com erro de Cloudflare/Wrangler:**
Confirme que a variável `NITRO_PRESET=node-server` está no Dockerfile (já está).

**Porta 3000 já em uso:**
Altere o mapeamento no `docker-compose.yml` para `"8080:3000"` e acesse em
`http://localhost:8080`.

**Hot reload não funciona no Windows/macOS:**
Em alguns hosts o file-watching via volume é lento. Force polling:
```bash
docker compose --profile dev run --rm \
  -e CHOKIDAR_USEPOLLING=true -e WATCHPACK_POLLING=true \
  app-dev
```

**Imagem muito grande:**
A imagem final usa `node:20-alpine` (~50MB base) + `.output/` (~80–100MB).
Para enxugar ainda mais, troque a base por `gcr.io/distroless/nodejs20`.
