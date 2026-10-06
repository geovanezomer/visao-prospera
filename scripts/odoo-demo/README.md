# Laboratório Odoo 20 para testar o modo Odoo

Sobe um Odoo 20 descartável com um grupo econômico fictício, para testar o conector
do FinnancePRO sem tocar no ERP de nenhum cliente.

| Empresa                              | Tipo                                          | CNPJ               |
| ------------------------------------ | --------------------------------------------- | ------------------ |
| Grupo Alfa Comércio Ltda             | matriz, plano `br` (l10n_br), Lucro Presumido | 11.222.333/0001-81 |
| Grupo Alfa Comércio Ltda - Filial SP | filial (branch da matriz, usa o plano dela)   | 11.222.333/0002-62 |
| Beta Serviços Ltda                   | coligada com CNPJ próprio, Lucro Presumido    | 44.555.666/0001-99 |

São 463 lançamentos postados: abertura em 30/09/2025 e movimento de out/2025 a set/2026
(vendas, ICMS/PIS/COFINS/ISS, CMV, folha e encargos, aluguel, energia, depreciação,
empréstimo bancário, IRPJ/CSLL trimestral). Data de bloqueio: **30/09/2026**.

Operações entre empresas do grupo, para testar as eliminações:

- matriz ↔ filial: transferência de mercadorias a custo e repasse de caixa
  (diário `TRF`, contas `1.01.02.09.97` / `2.01.01.17.97`);
- Beta → Alfa: R$ 15 mil/mês de serviços (diário `INTC`);
- Alfa → Beta: mútuo de R$ 200 mil em jan/2026 com juros de R$ 2 mil/mês.

Com os parâmetros escolhidos (ICMS de 18% e CMV de 52%), a matriz fecha os 12 meses com
prejuízo e a Beta com lucro, um cenário útil para o diagnóstico.

## Subir (≈ 5 minutos)

Rode a partir desta pasta (`scripts/odoo-demo`):

```sh
# 1) banco + instalação de Contabilidade e da localização Brasil
docker compose up -d odoo-db
docker compose run --rm odoo odoo -d lab20 -i account,l10n_br --stop-after-init

# 2) Odoo no ar em http://127.0.0.1:8069 (porta mudável com ODOO_PORT=…)
docker compose up -d odoo

# 3) grupo de teste e usuário de integração somente leitura
DB="--db_host=odoo-db --db_user=odoo --db_password=odoo"
docker compose exec -T odoo odoo shell -d lab20 $DB --no-http < seed_group.py
docker compose exec -T odoo odoo shell -d lab20 $DB --no-http < setup_ro_user.py
```

O último comando imprime `APIKEY=...`. Essa é a chave de API (escopo `rpc`) do usuário
`visao-prospera-ro`, que tem só o perfil _Contabilidade – somente leitura_. Ela aparece
uma vez só; para gerar outra, rode o script de novo.

O seed é idempotente: rodar de novo não duplica nada. Para mudar valores (ex.: `CMV_PCT`),
edite as constantes no topo, ponha `RESET = True` e rode de novo.

## Conferir o conector (opcional)

O script lê o Odoo pelo próprio conector do app e compara com `expected.json`: DRE por
empresa, balanço fechando, receita do grupo sem os serviços internos, mútuo eliminado.

```sh
# na raiz do repositório
ODOO_URL=http://127.0.0.1:8069 ODOO_DB=lab20 ODOO_KEY=<chave> \
DATABASE_URL=postgres://usuario:senha@127.0.0.1:5432/financepro \
  bun scripts/odoo-demo/validate-connector.ts
```

`build_expected.py` regenera o `expected.json` a partir do Odoo, via API JSON-2.

## Testar a exclusão dos lançamentos de encerramento (opcional)

`add_closing_entries.py` lança encerramentos do exercício em 31/12/2025, como um
contador faria para a ECD: direto na Beta (resultado → lucros acumulados) e em duas
etapas na Alfa (resultado → "Apuração do Resultado do Exercício" → lucros acumulados).
O conector os desconsidera, e a conferência acima continua batendo.

```sh
docker compose exec -T odoo odoo shell -d lab20 $DB --no-http < add_closing_entries.py
```

## Produtos para o "Mix de produtos" (opcional)

`add_products.py` atribui produtos às linhas de receita e de custo já lançadas
(Linha Premium/Padrão/Econômica/Acessórios no grupo Alfa; Consultoria/Implantação/
Suporte na Beta), com pesos diferentes na receita e no custo para gerar margens
diferentes. Depois, sincronize no app e abra Simulador › Insights › Mix de produtos.

```sh
docker compose exec -T odoo odoo shell -d lab20 $DB --no-http < add_products.py
```

## Desligar

```sh
docker compose down        # mantém os dados
docker compose down -v     # apaga tudo
```

## Particularidades do Odoo 20 encontradas

- O servidor escuta só em `127.0.0.1` por padrão. Em contêiner é preciso
  `--http-interface=0.0.0.0`, e o compose já faz isso.
- O código da conta (`account.account.code`) depende da empresa ativa. O conector
  consulta uma empresa por vez.
- A localização Brasil só traz "Cash in Transit" como conta `asset_receivable`. Nas
  empresas do seed, as Duplicatas a Receber (`1.01.02.02.01/03`) passam a ser recebíveis.
- A validação do CNPJ fica no módulo `base`. O CNPJ pedido para a Beta tem dígito
  verificador inválido e foi gravado com `no_vat_validation`.
