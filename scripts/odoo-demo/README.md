# Seed de grupo econômico no Odoo 20 (lab)

Cria um grupo de teste para validar o conector Odoo do Visão Próspera:

| Empresa                              | Tipo                                                 | CNPJ               |
| ------------------------------------ | ---------------------------------------------------- | ------------------ |
| Grupo Alfa Comércio Ltda             | matriz, plano `br` (l10n_br)                         | 11.222.333/0001-81 |
| Grupo Alfa Comércio Ltda - Filial SP | branch (`parent_id` = matriz, usa o plano da matriz) | 11.222.333/0002-62 |
| Beta Serviços Ltda                   | empresa independente, plano `br` próprio             | 44.555.666/0001-99 |

Lançamentos `entry` postados de 2025-10 a 2026-09, mais a abertura em 2025-09-30.
Data de bloqueio global (`fiscalyear_lock_date`) = 2026-08-31 na matriz e na Beta (a
filial herda a da matriz). O usuário `visao-prospera-ro` ganha acesso às 3 empresas.

Pré-requisito: banco com os módulos `account` e `l10n_br` instalados.

## Rodar o seed

```sh
docker cp seed_group.py lab-odoo:/tmp/seed_group.py
docker exec lab-odoo sh -c "odoo shell -d lab20 --db_host=lab-pg \
  --db_user=odoo --db_password=odoo --no-http < /tmp/seed_group.py"
```

O script é idempotente: empresas são localizadas pelo nome e lançamentos pelo par
(empresa, `ref`). Ao final ele imprime o balancete de cada empresa (diferença deve ser 0).

Para mudar valores (ex.: `CMV_PCT`), edite as constantes no topo, defina `RESET = True`
(apaga os lançamentos do seed: refs `SEED-`, `TRF-`, `IC-`) e rode de novo.

## Gerar o `expected.json`

Lê os números do próprio Odoo pela API JSON-2 (`formatted_read_group`):

```sh
ODOO_URL=http://127.0.0.1:8069 ODOO_DB=lab20 ODOO_KEY=<api key rpc> \
  python3 build_expected.py > expected.json
```

## Como identificar o intercompany

- **Matriz ↔ Filial (mesmo CNPJ raiz):** diário `TRF`, refs `TRF-MATRIZ-FILIAL-AAAA-MM`
  (mercadorias, a custo) e `TRF-CAIXA-FILIAL-MATRIZ-AAAA-MM` (repasse de caixa), parceiro =
  partner da outra empresa. Contas `1.01.02.09.97` (matriz) e `2.01.01.17.97` (filial).
- **Alfa ↔ Beta (CNPJs distintos):** diário `INTC`, refs `IC-BETA-ALFA-SERV-*`,
  `IC-BETA-ALFA-PGTO-*`, `IC-MUTUO-ALFA-BETA-2026-01` e `IC-MUTUO-JUROS-*`, parceiro =
  partner da empresa contraparte.

## Observações

- O IRPJ/CSLL (Lucro Presumido, trimestral) do CNPJ Alfa é apurado na matriz e inclui a receita da filial.
- As contas `1.01.02.02.01/03` (Duplicatas a Receber) passam a ter o tipo `asset_receivable`
  nas empresas novas, porque o l10n_br do Odoo 20 só traz "Cash in Transit" com esse tipo.
- Com os parâmetros pedidos (ICMS de 18% sobre a receita bruta e CMV de 52%), a matriz Alfa
  fecha os 12 meses com prejuízo. A Beta dá lucro.
