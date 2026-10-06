# Roteiro de teste — FinnancePRO

O app tem dois cockpits:

| Modo       | Para quê                                              | De onde vêm os números                          |
| ---------- | ----------------------------------------------------- | ----------------------------------------------- |
| **Manual** | consultoria: análises genéricas, estudos e simulações | digitados por você                              |
| **Odoo**   | instância dedicada a um cliente, em produção          | lidos do Odoo 19/20 do cliente, somente leitura |

A chave fica em **Administração › Odoo** e vale para a instância inteira. No modo Odoo,
cada usuário ainda pode alternar para **Simulação livre** (o espaço manual) pela barra do
topo, sem afetar nada do ERP.

## 1. Subir o app (PostgreSQL 17, sem serviços de terceiros)

```bash
cp .env.example .env
# edite POSTGRES_PASSWORD e BETTER_AUTH_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

Acesse `http://localhost:3000` e entre com `admin` / `admin`. O app exige a troca da senha
no primeiro acesso.

## 2. Testar o modo Manual

1. Preencha **Receitas**, **Despesas** e **Capital**. **DRE**, **Fluxo de Caixa**,
   **Balanço**, **Indicadores** e **Diagnóstico** recalculam na hora.
2. No **Simulador**, mexa nas alavancas (preço, volume, custos, prazos) e compare com o
   cenário base. Teste também o **Valuation**.
3. Em **Salvar / Compartilhar**, gere o arquivo `.finnance` e reabra-o em
   **Abrir / Restaurar**. O PDF sai pelo ícone de impressora.

## 3. Testar o modo Odoo com o laboratório

### 3.1 Subir um Odoo 20 de teste

Siga `scripts/odoo-demo/README.md`. São quatro comandos, uns 5 minutos. No fim você terá:

- o Odoo em `http://127.0.0.1:8069`;
- o grupo Alfa (matriz + filial SP) e a Beta, com 12 meses lançados;
- a chave de API do usuário somente leitura.

Para o contêiner do app enxergar o Odoo do laboratório, ligue-o à rede do lab:

```bash
docker network connect finnancepro-odoo-lab_default financepro
```

### 3.2 Conectar

Em **Administração › Odoo**:

1. Preencha URL `http://odoo:8069` (ou `http://127.0.0.1:8069` se o app roda fora do
   Docker), banco `lab20` e a chave de API.
2. Clique em **Testar conexão**. Aparecem as empresas com CNPJ e data de bloqueio.
3. Marque **Grupo Alfa Comércio Ltda** e **Beta Serviços Ltda** (a filial acompanha a
   matriz) e clique em **Salvar**.
4. Tente ligar a chave **Odoo**. O app recusa: "faça a primeira sincronização".
5. Clique em **Sincronizar agora** (1 a 2 segundos) e ligue a chave **Odoo**.
6. Confira a tabela **Classificação das contas**. Você pode mudar a linha de qualquer
   conta, e o ajuste vale na hora, sem nova sincronização.

### 3.3 Usar o cockpit

Volte ao app. A barra do topo agora mostra:

- **Odoo | Simulação livre**;
- a empresa: _Grupo Alfa (matriz + filiais)_, _Filial SP (visão gerencial)_, _Beta_ ou
  _Consolidado do grupo_;
- a janela de 12 meses (padrão: até o último mês fechado no Odoo).

O que conferir:

| Onde                          | O que esperar                                                    |
| ----------------------------- | ---------------------------------------------------------------- |
| Receitas / Despesas / Capital | números do Odoo, com aviso e todos os campos travados            |
| DRE                           | receita bruta, CMV, folha etc. iguais ao balancete do Odoo       |
| Regime Tributário             | sugerido pelos dados (aqui, Presumido), mas editável por empresa |
| **Consolidado** (menu)        | DRE por CNPJ, eliminações, consolidado, conciliação e filiais    |
| Simulação livre               | volta ao espaço manual, com tudo editável                        |

Números de referência do laboratório (out/2025 a set/2026, `scripts/odoo-demo/expected.json`):

|             | Receita bruta                                               | Lucro líquido contábil |
| ----------- | ----------------------------------------------------------- | ---------------------- |
| Alfa matriz | R$ 5.325.955,77                                             | −R$ 315.920,72         |
| Filial SP   | R$ 1.838.722,84                                             | −R$ 4.217,55           |
| Beta        | R$ 1.384.814,07                                             | R$ 309.207,04          |
| Consolidado | R$ 8.369.492,68 (já sem os R$ 180 mil de serviços internos) |                        |

**Conciliação tributária.** Ela compara o contabilizado com o que o motor calcula pelo
regime configurado:

- impostos sobre vendas: devem bater (diferença ≈ 0%);
- IRPJ/CSLL: compare com mês final em fim de trimestre (set/26). A apuração
  contabilizada cobre o trimestre inteiro.

### 3.4 Voltar ao modo Manual

Em **Administração › Odoo**, clique em **Manual**. A barra do Odoo e o menu
**Consolidado** somem, e o cockpit volta a ser 100% editável. As premissas que você
salvou para cada empresa do Odoo continuam guardadas para quando o modo voltar.

## 4. Em produção, num cliente

1. No Odoo do cliente, crie um usuário só para a integração, com o perfil
   **Contabilidade – somente leitura**, acesso às empresas do grupo e uma chave de API
   com escopo `rpc` (Preferências › Segurança da conta).
2. Mantenha a data de bloqueio do Odoo em dia: ela define o "último mês fechado" que o
   cockpit usa por padrão.
3. Com o modo Odoo ligado, o app sincroniza sozinho a cada hora. O botão
   **Sincronizar agora** força uma sincronização na hora.

O conector só usa métodos de leitura (lista branca no código). Com o perfil somente
leitura, o próprio Odoo recusa qualquer escrita.

## 5. Limitações conhecidas desta versão

- **Dívidas:** os contratos são estimados a partir dos saldos de empréstimos (CP/LP). A
  taxa sai dos juros do período e os prazos são de 12 e 36 meses.
- **Fluxo de caixa:** projetado pelo motor a partir do realizado; ainda não é o extrato
  bancário do Odoo.
- **Setor:** inferido pelo peso do CMV (comércio × serviços). Indústria precisa ser
  ajustada à mão em "Regime Tributário".
- **Moeda:** só BRL. Empresas em outra moeda entram sem conversão.
