# -*- coding: utf-8 -*-
"""
Seed de um grupo econômico de teste no Odoo 20 (laboratório).

Executar DENTRO do `odoo shell` (o objeto `env` já existe), por exemplo:

    docker cp seed_group.py lab-odoo:/tmp/seed_group.py
    docker exec lab-odoo sh -c "odoo shell -d lab20 --db_host=lab-pg \
        --db_user=odoo --db_password=odoo --no-http < /tmp/seed_group.py"

O que o script cria (idempotente: rodar de novo não duplica nada):

  * "Grupo Alfa Comércio Ltda"              (matriz, CNPJ 11.222.333/0001-81, plano BR)
  * "Grupo Alfa Comércio Ltda - Filial SP"  (filial = branch, parent_id = matriz,
                                             CNPJ 11.222.333/0002-62, usa o plano da matriz)
  * "Beta Serviços Ltda"                    (empresa independente, CNPJ 44.555.666/0001-99,
                                             plano BR próprio)
  * Lançamentos contábeis (account.move, move_type="entry", postados) de
    2025-10 a 2026-09, mais um lançamento de abertura em 2025-09-30.
  * Intercompany identificável:
      - Matriz <-> Filial: diário "TRF" + ref "TRF-MATRIZ-FILIAL-AAAA-MM",
        parceiro = partner da outra empresa.
      - Beta <-> Alfa (CNPJs distintos): diário "INTC" + refs "IC-...",
        parceiro = partner da empresa contraparte.
  * Data de bloqueio global (fiscalyear_lock_date) = 2026-08-31 na matriz e na Beta.
  * Acesso do usuário de integração somente-leitura às 3 empresas novas.

Detecção de duplicidade: empresas pelo nome; lançamentos pelo par (empresa, ref).
"""
import calendar
from datetime import date

# ---------------------------------------------------------------------------
# Parâmetros gerais
# ---------------------------------------------------------------------------
NOME_MATRIZ = "Grupo Alfa Comércio Ltda"
NOME_FILIAL = "Grupo Alfa Comércio Ltda - Filial SP"
NOME_BETA = "Beta Serviços Ltda"

VAT_MATRIZ = "11222333000181"
VAT_FILIAL = "11222333000262"
VAT_BETA = "44555666000199"  # conforme solicitado (o DV "correto" seria 0001-81)

LOCK_DATE = date(2026, 8, 31)

# CMV como % da receita bruta (matriz e filial). Com ICMS de 18% sobre a receita
# bruta + CMV de 52% (parâmetros pedidos), a matriz opera com prejuízo; ajuste aqui
# se quiser um cenário mais lucrativo (e rode com RESET = True).
CMV_PCT = 0.52

# RESET = True apaga os lançamentos gerados por este seed (refs SEED-/TRF-/IC-) nas
# 3 empresas antes de recriá-los — use quando mudar algum parâmetro de valores.
RESET = False
LOGIN_RO = "visao-prospera-ro"

# 12 meses: índice 0 = 2025-10 ... índice 11 = 2026-09.
# Índices negativos (-1, -2, -3) = jul-set/2025, usados só para calcular os
# saldos de abertura (o que estava "a receber/a pagar" em 30/09/2025).
MESES = list(range(12))


def ano_mes(i):
    """Converte o índice do mês em (ano, mês)."""
    m = 10 + i  # índice 0 = outubro/2025
    ano = 2025 + (m - 1) // 12
    mes = (m - 1) % 12 + 1
    return ano, mes


def fim_mes(i):
    ano, mes = ano_mes(i)
    return date(ano, mes, calendar.monthrange(ano, mes)[1])


def dia(i, d):
    ano, mes = ano_mes(i)
    return date(ano, mes, d)


def tag(i):
    ano, mes = ano_mes(i)
    return "%04d-%02d" % (ano, mes)


def r2(x):
    return round(x + 0.0, 2)


# Sazonalidade do varejo (Black Friday/Natal fortes, jan-fev fracos, Dia das Mães)
SAZ = {1: 0.90, 2: 0.87, 3: 0.95, 4: 1.00, 5: 1.05, 6: 0.98,
       7: 0.97, 8: 1.00, 9: 1.01, 10: 1.00, 11: 1.08, 12: 1.20}


def fator(i, amort=1.0):
    """Sazonalidade (amortecida para serviços) x crescimento de 1% a.m. x ruído leve."""
    _, mes = ano_mes(i)
    s = 1 + (SAZ[mes] - 1) * amort
    ruido = 1 + 0.01 * (((i + 3) * 7) % 5 - 2)  # determinístico, entre -2% e +2%
    return s * (1.01 ** i) * ruido


# Energia elétrica: mais cara no verão (dez-mar)
ENERGIA = {10: 4300, 11: 4600, 12: 5400, 1: 5900, 2: 6000, 3: 5600,
           4: 4900, 5: 4400, 6: 4100, 7: 4000, 8: 4200, 9: 4500}


def energia(i, escala=1.0):
    return r2(ENERGIA[ano_mes(i)[1]] * escala)


# ---------------------------------------------------------------------------
# Modelo de números de cada empresa (puro Python, determinístico)
# ---------------------------------------------------------------------------
IC_SERVICOS = 15000.00      # Beta fatura a Alfa matriz todo mês
MUTUO_VALOR = 200000.00     # Alfa empresta à Beta em 2026-01 (índice 3)
MUTUO_IDX = 3
MUTUO_JUROS = 2000.00       # juros mensais (jan a set/2026), apropriados e não pagos
EMPRESTIMO_INI = 480000.00  # empréstimo bancário de longo prazo da Alfa
EMPRESTIMO_AMORT = 10000.00


def alfa(i):
    """Números mensais da matriz (comércio)."""
    rec = r2(420000 * fator(i))
    sal = r2(60000 + 400 * (i % 3))
    d = {
        "receita": rec,
        "icms": r2(rec * 0.18), "pis": r2(rec * 0.0065), "cofins": r2(rec * 0.03),
        "cmv": r2(rec * CMV_PCT),
        "salarios": sal, "inss": r2(sal * 0.20), "fgts": r2(sal * 0.08),
        "aluguel": 18000.00,
        "energia": energia(i),
        "servicos": r2(5000 + 300 * (i % 4)),
        "deprec": 3000.00,
        "rec_fin": r2(1500 + 50 * (i % 3)),
    }
    saldo_emp = EMPRESTIMO_INI - EMPRESTIMO_AMORT * max(i, 0)
    d["juros"] = r2(saldo_emp * 0.0125)  # ~R$ 6k, decrescente
    d["juros_mutuo"] = MUTUO_JUROS if i >= MUTUO_IDX else 0.0
    return d


def filial(i):
    """Números mensais da Filial SP (mesma estrutura, em escala menor)."""
    rec = r2(145000 * fator(i))
    sal = r2(22000 + 200 * (i % 2))
    return {
        "receita": rec,
        "icms": r2(rec * 0.18), "pis": r2(rec * 0.0065), "cofins": r2(rec * 0.03),
        "cmv": r2(rec * CMV_PCT),
        "salarios": sal, "inss": r2(sal * 0.20), "fgts": r2(sal * 0.08),
        "aluguel": 8000.00,
        "energia": energia(i, 0.35),
        "servicos": 1500.00,
        "deprec": 1000.00,
        "tarifas": 250.00,  # tarifas bancárias (despesa financeira)
    }


def beta(i):
    """Números mensais da Beta (serviços). Receita total inclui o IC com a Alfa."""
    rec_terc = r2(95000 * fator(i, amort=0.5))
    rec_total = r2(rec_terc + IC_SERVICOS)
    pessoal = rec_total * 0.45
    sal = r2(pessoal / 1.28)
    return {
        "receita": rec_terc, "receita_ic": IC_SERVICOS, "receita_total": rec_total,
        "iss": r2(rec_total * 0.05), "pis": r2(rec_total * 0.0065), "cofins": r2(rec_total * 0.03),
        "cpv": r2(rec_total * 0.04),
        "salarios": sal, "inss": r2(sal * 0.20), "fgts": r2(sal * 0.08),
        "aluguel": 7000.00,
        "energia": energia(i, 0.30),
        "telecom": 1200.00,
        "deprec": 1200.00,
        "tarifas": 400.00,
        "rec_fin": 300.00,
        "juros_mutuo": MUTUO_JUROS if i >= MUTUO_IDX else 0.0,
    }


def irpj_csll(base_ir, base_csll):
    """Lucro Presumido trimestral: IRPJ 15% + adicional 10% s/ excedente de R$ 60k; CSLL 9%."""
    ir = base_ir * 0.15 + max(0.0, base_ir - 60000) * 0.10
    return r2(ir), r2(base_csll * 0.09)


def trimestre_alfa(i_fim):
    """IRPJ/CSLL do trimestre que termina em i_fim — apurado na MATRIZ sobre a receita
    de todo o CNPJ (matriz + filial), como manda a legislação (apuração centralizada).
    Comércio: presunção 8% (IRPJ) e 12% (CSLL); receitas financeiras entram integralmente."""
    idx = [i_fim - 2, i_fim - 1, i_fim]
    rec = sum(alfa(k)["receita"] + filial(k)["receita"] for k in idx)
    fin = sum(alfa(k)["rec_fin"] + alfa(k)["juros_mutuo"] for k in idx)
    return irpj_csll(rec * 0.08 + fin, rec * 0.12 + fin)


def trimestre_beta(i_fim):
    """Serviços: presunção de 32% para IRPJ e CSLL."""
    idx = [i_fim - 2, i_fim - 1, i_fim]
    rec = sum(beta(k)["receita_total"] for k in idx)
    fin = sum(beta(k)["rec_fin"] for k in idx)
    return irpj_csll(rec * 0.32 + fin, rec * 0.32 + fin)


def fim_trimestre(i):
    return ano_mes(i)[1] in (3, 6, 9, 12)


# ---------------------------------------------------------------------------
# Helpers de ORM
# ---------------------------------------------------------------------------
Company = env["res.company"].sudo()
BRL = env.ref("base.BRL")
BR = env.ref("base.br")
if not BRL.active:
    BRL.active = True


def garante_empresa(nome, vat, parent=None):
    """Cria a empresa (se não existir) e garante acesso do superusuário/admin."""
    comp = Company.search([("name", "=", nome)], limit=1)
    if not comp:
        vals = {"name": nome, "country_id": BR.id, "currency_id": BRL.id}
        if parent:
            vals["parent_id"] = parent.id
        comp = Company.create(vals)
        print("[empresa] criada:", nome, comp.id)
    else:
        print("[empresa] já existe:", nome, comp.id)
    partner = comp.partner_id.with_context(no_vat_validation=True)
    if partner.country_id != BR:
        partner.country_id = BR
    so_digitos = "".join(ch for ch in (comp.partner_id.vat or "") if ch.isdigit())
    if so_digitos != vat:
        # res.company.vat é related do partner. Odoo 20 valida o DV do CNPJ já no
        # módulo base; 'no_vat_validation' permite gravar o CNPJ fictício da Beta.
        partner.vat = vat
    for login in ("__system__", "admin"):
        u = env["res.users"].sudo().with_context(active_test=False).search([("login", "=", login)], limit=1)
        if u and comp not in u.company_ids:
            u.company_ids = [(4, comp.id)]
    if env.user and comp not in env.user.company_ids:
        env.user.sudo().company_ids = [(4, comp.id)]
    return comp


matriz = garante_empresa(NOME_MATRIZ, VAT_MATRIZ)
if not matriz.chart_template:
    # Odoo 20: try_loading(template_code, company, install_demo=False, force_create=True)
    env["account.chart.template"].try_loading("br", matriz, install_demo=False)
filial_c = garante_empresa(NOME_FILIAL, VAT_FILIAL, parent=matriz)  # branch: herda o plano
beta_c = garante_empresa(NOME_BETA, VAT_BETA)
if not beta_c.chart_template:
    env["account.chart.template"].try_loading("br", beta_c, install_demo=False)


def conta(root, codigo):
    """Busca a conta pelo código no plano da empresa raiz (Odoo 18+: código é company-dependent)."""
    Acc = env["account.account"].sudo().with_company(root)
    acc = Acc.search([("code", "=", codigo), ("company_ids", "in", root.id)], limit=1)
    if not acc:
        raise Exception("Conta %s não encontrada em %s" % (codigo, root.name))
    return acc


def garante_conta(root, codigo, nome, tipo, reconcile=False):
    Acc = env["account.account"].sudo().with_company(root)
    acc = Acc.search([("code", "=", codigo), ("company_ids", "in", root.id)], limit=1)
    if not acc:
        acc = Acc.create({"code": codigo, "name": nome, "account_type": tipo,
                          "reconcile": reconcile, "company_ids": [(6, 0, [root.id])]})
    return acc


def ajusta_receber(root):
    """No l10n_br do Odoo 20 a única conta 'asset_receivable' de curto prazo é
    1.01.01.04.01 (Cash in Transit). Para o Balanço ficar legível, transformamos
    as contas de Duplicatas a Receber (1.01.02.02.01 e .03) em 'asset_receivable'."""
    for cod in ("1.01.02.02.01", "1.01.02.02.03"):
        a = conta(root, cod)
        if a.account_type != "asset_receivable":
            a.write({"account_type": "asset_receivable", "reconcile": True})


ajusta_receber(matriz)
ajusta_receber(beta_c)

# Contas novas para a "conta corrente" entre estabelecimentos do mesmo CNPJ
CC_FILIAL = garante_conta(matriz, "1.01.02.09.97",
                          "Conta Corrente Filial SP (transferências entre estabelecimentos)",
                          "asset_current")
CC_MATRIZ = garante_conta(matriz, "2.01.01.17.97",
                          "Conta Corrente Matriz (transferências entre estabelecimentos)",
                          "liability_current")


def garante_diario(comp, codigo, nome):
    J = env["account.journal"].sudo()
    j = J.search([("company_id", "=", comp.id), ("code", "=", codigo)], limit=1)
    if not j:
        j = J.create({"name": nome, "code": codigo, "type": "general", "company_id": comp.id})
    return j


# Diários: a filial (branch) não ganha diários próprios ao ser criada; criamos os dela.
J = {
    "alfa": {"misc": garante_diario(matriz, "DIV", "Operações Diversas (seed)"),
             "trf": garante_diario(matriz, "TRF", "Transferências Matriz/Filial"),
             "ic": garante_diario(matriz, "INTC", "Operações Intercompany")},
    "filial": {"misc": garante_diario(filial_c, "DIVSP", "Operações Diversas Filial SP (seed)"),
               "trf": garante_diario(filial_c, "TRF", "Transferências Matriz/Filial")},
    "beta": {"misc": garante_diario(beta_c, "DIV", "Operações Diversas (seed)"),
             "ic": garante_diario(beta_c, "INTC", "Operações Intercompany")},
}

# Parceiros genéricos (compartilhados)
Partner = env["res.partner"].sudo()


def garante_parceiro(nome):
    p = Partner.search([("name", "=", nome), ("company_id", "=", False)], limit=1)
    return p or Partner.create({"name": nome, "country_id": BR.id})


P_CLIENTES = garante_parceiro("Clientes Diversos (seed)")
P_FORNEC = garante_parceiro("Fornecedores Diversos (seed)")
P_BANCO = garante_parceiro("Banco Seed S.A.")
P_ALFA = matriz.partner_id
P_FILIAL = filial_c.partner_id
P_BETA = beta_c.partner_id


# Mapa de contas (o plano BR é o mesmo nas duas raízes; buscamos por raiz)
def mapa(root):
    c = lambda cod: conta(root, cod).id
    return {
        "banco": c("1.01.01.02.03"),
        "receber": c("1.01.02.02.01"), "receber_pl": c("1.01.02.02.03"),
        "estoque": c("1.01.03.01.01"),
        "mutuo_ativo": c("1.02.01.01.03"),
        "maq": c("1.02.03.01.06"), "moveis": c("1.02.03.01.07"), "veiculos": c("1.02.03.01.08"),
        "dep_acum": c("1.02.03.01.30"),
        "salarios_pg": c("2.01.01.01.01"), "inss_pg": c("2.01.01.01.03"), "fgts_pg": c("2.01.01.01.04"),
        "fornec": c("2.01.01.03.01"), "fornec_pl": c("2.01.01.03.03"),
        "icms_pg": c("2.01.01.09.03"), "pis_pg": c("2.01.01.09.04"), "cofins_pg": c("2.01.01.09.05"),
        "iss_pg": c("2.01.01.09.08"),
        "irpj_pg": c("2.01.01.15.01"), "csll_pg": c("2.01.01.15.02"),
        "mutuo_passivo": c("2.02.01.11.03"),
        "emprestimo": c("2.02.01.01.06"),
        "capital": c("2.03.01.01.01"), "lucros_acum": c("2.03.04.01.01"),
        # Resultado
        "rec_mercadorias": c("3.01.01.01.01.05"), "rec_servicos": c("3.01.01.01.01.06"),
        "d_icms": c("3.01.01.01.02.03"), "d_cofins": c("3.01.01.01.02.04"),
        "d_pis": c("3.01.01.01.02.05"), "d_iss": c("3.01.01.01.02.06"),
        "cmv": c("3.01.01.03.01.02"), "cpv_serv": c("3.01.01.03.01.03"),
        "rec_fin": c("3.01.01.05.01.05"), "rec_mutuo": c("3.01.01.05.01.27"),
        "salarios": c("3.01.01.07.01.02"), "serv_terceiros": c("3.01.01.07.01.04"),
        "inss": c("3.01.01.07.01.05"), "fgts": c("3.01.01.07.01.06"),
        "aluguel": c("3.01.01.07.01.18"), "deprec": c("3.01.01.07.01.23"),
        "energia": c("3.01.01.07.01.36"), "telecom": c("3.01.01.07.01.38"),
        "juros": c("3.01.01.09.01.08"), "juros_mutuo": c("3.01.01.09.01.23"),
        "csll": c("3.02.01.01.01.01"), "irpj": c("3.02.01.01.01.02"),
    }


A = mapa(matriz)   # usado pela matriz e pela filial (branch compartilha o plano)
B = mapa(beta_c)
A["cc_filial"] = CC_FILIAL.id
A["cc_matriz"] = CC_MATRIZ.id

# ---------------------------------------------------------------------------
# Criação de lançamentos
# ---------------------------------------------------------------------------
Move = env["account.move"].sudo()
criados = {"n": 0, "pulados": 0}
pendentes = []  # (empresa, journal, data, ref, linhas)


def lanc(comp, journal, data, ref, linhas):
    """Agenda um lançamento. linhas = [(conta_id, valor, parceiro|None, histórico)]
    valor > 0 = débito, valor < 0 = crédito. Valores zerados são descartados."""
    linhas = [l for l in linhas if abs(r2(l[1])) >= 0.005]
    soma = r2(sum(l[1] for l in linhas))
    if abs(soma) > 0.001:
        raise Exception("Lançamento desbalanceado %s (%s)" % (ref, soma))
    pendentes.append((comp, journal, data, ref, linhas))


def grava_pendentes():
    for comp, journal, data, ref, linhas in pendentes:
        if Move.search_count([("company_id", "=", comp.id), ("ref", "=", ref)]):
            criados["pulados"] += 1
            continue
        mv = Move.with_company(comp).with_context(allowed_company_ids=[comp.id] + comp.parent_ids.ids).create({
            "move_type": "entry",
            "company_id": comp.id,
            "journal_id": journal.id,
            "date": data,
            "ref": ref,
            "line_ids": [(0, 0, {
                "account_id": acc,
                "debit": r2(v) if v > 0 else 0.0,
                "credit": r2(-v) if v < 0 else 0.0,
                "partner_id": p.id if p else False,
                "name": hist,
            }) for acc, v, p, hist in linhas],
        })
        mv.action_post()
        criados["n"] += 1


# ---------------------------- ABERTURA ------------------------------------
# Os saldos de "a receber/a pagar" em 30/09/2025 equivalem ao movimento de set/2025
# (índice -1), para que a rotina de recebimentos/pagamentos do mês seguinte seja uniforme.
ABERTURA = date(2025, 9, 30)


def fornecedores_alfa(i):
    """Compras + despesas a prazo da matriz no mês i (pagas no mês seguinte)."""
    a, f = alfa(i), filial(i)
    compras = r2(a["cmv"] + f["cmv"])  # repõe o CMV próprio + o que foi transferido à filial
    return r2(compras + a["aluguel"] + a["energia"] + a["servicos"])


def fornecedores_filial(i):
    f = filial(i)
    return r2(f["aluguel"] + f["energia"] + f["servicos"])


def fornecedores_beta(i):
    b = beta(i)
    return r2(b["cpv"] + b["aluguel"] + b["energia"] + b["telecom"])


def abertura():
    a0, f0, b0 = alfa(-1), filial(-1), beta(-1)
    ir_a, cs_a = trimestre_alfa(-1)
    ir_b, cs_b = trimestre_beta(-1)

    # --- Filial SP: o "patrimônio" da filial é a conta corrente com a matriz ---
    lf = [
        (A["banco"], 90000.00, P_BANCO, "Saldo bancário inicial"),
        (A["receber"], f0["receita"], P_CLIENTES, "Clientes - vendas de set/2025"),
        (A["estoque"], 160000.00, None, "Estoque inicial de mercadorias"),
        (A["moveis"], 110000.00, None, "Móveis e instalações comerciais"),
        (A["dep_acum"], -25000.00, None, "Depreciação acumulada"),
        (A["fornec"], -fornecedores_filial(-1), P_FORNEC, "Fornecedores - set/2025"),
        (A["salarios_pg"], -f0["salarios"], None, "Salários a pagar - set/2025"),
        (A["inss_pg"], -f0["inss"], None, "INSS a recolher - set/2025"),
        (A["fgts_pg"], -f0["fgts"], None, "FGTS a recolher - set/2025"),
        (A["icms_pg"], -f0["icms"], None, "ICMS a recolher - set/2025"),
        (A["pis_pg"], -f0["pis"], None, "PIS a recolher - set/2025"),
        (A["cofins_pg"], -f0["cofins"], None, "COFINS a recolher - set/2025"),
    ]
    pl_filial = r2(sum(l[1] for l in lf))
    lf.append((A["cc_matriz"], -pl_filial, P_ALFA, "Conta corrente com a matriz (abertura)"))
    lanc(filial_c, J["filial"]["misc"], ABERTURA, "SEED-ABERTURA-2025-09-30", lf)

    # --- Matriz ---
    la = [
        (A["banco"], 900000.00, P_BANCO, "Saldo bancário inicial"),
        (A["receber"], a0["receita"], P_CLIENTES, "Clientes - vendas de set/2025"),
        (A["estoque"], 950000.00, None, "Estoque inicial de mercadorias"),
        (A["cc_filial"], pl_filial, P_FILIAL, "Conta corrente com a Filial SP (abertura)"),
        (A["moveis"], 300000.00, None, "Móveis e instalações comerciais"),
        (A["veiculos"], 180000.00, None, "Veículos"),
        (A["maq"], 120000.00, None, "Máquinas e equipamentos"),
        (A["dep_acum"], -150000.00, None, "Depreciação acumulada"),
        (A["fornec"], -fornecedores_alfa(-1), P_FORNEC, "Fornecedores - set/2025"),
        (A["fornec_pl"], -IC_SERVICOS, P_BETA, "Beta Serviços - serviços de set/2025 (IC)"),
        (A["salarios_pg"], -a0["salarios"], None, "Salários a pagar - set/2025"),
        (A["inss_pg"], -a0["inss"], None, "INSS a recolher - set/2025"),
        (A["fgts_pg"], -a0["fgts"], None, "FGTS a recolher - set/2025"),
        (A["icms_pg"], -a0["icms"], None, "ICMS a recolher - set/2025"),
        (A["pis_pg"], -a0["pis"], None, "PIS a recolher - set/2025"),
        (A["cofins_pg"], -a0["cofins"], None, "COFINS a recolher - set/2025"),
        (A["irpj_pg"], -ir_a, None, "IRPJ a pagar - 3º tri/2025"),
        (A["csll_pg"], -cs_a, None, "CSLL a pagar - 3º tri/2025"),
        (A["emprestimo"], -EMPRESTIMO_INI, P_BANCO, "Empréstimo bancário (longo prazo)"),
        (A["capital"], -1000000.00, None, "Capital social"),
    ]
    la.append((A["lucros_acum"], -r2(sum(l[1] for l in la)), None, "Lucros acumulados"))
    lanc(matriz, J["alfa"]["misc"], ABERTURA, "SEED-ABERTURA-2025-09-30", la)

    # --- Beta ---
    lb = [
        (B["banco"], 140000.00, P_BANCO, "Saldo bancário inicial"),
        (B["receber"], b0["receita"], P_CLIENTES, "Clientes - serviços de set/2025"),
        (B["receber_pl"], IC_SERVICOS, P_ALFA, "Grupo Alfa - serviços de set/2025 (IC)"),
        (B["maq"], 160000.00, None, "Equipamentos de informática"),
        (B["dep_acum"], -45000.00, None, "Depreciação acumulada"),
        (B["fornec"], -fornecedores_beta(-1), P_FORNEC, "Fornecedores - set/2025"),
        (B["salarios_pg"], -b0["salarios"], None, "Salários a pagar - set/2025"),
        (B["inss_pg"], -b0["inss"], None, "INSS a recolher - set/2025"),
        (B["fgts_pg"], -b0["fgts"], None, "FGTS a recolher - set/2025"),
        (B["iss_pg"], -b0["iss"], None, "ISS a recolher - set/2025"),
        (B["pis_pg"], -b0["pis"], None, "PIS a recolher - set/2025"),
        (B["cofins_pg"], -b0["cofins"], None, "COFINS a recolher - set/2025"),
        (B["irpj_pg"], -ir_b, None, "IRPJ a pagar - 3º tri/2025"),
        (B["csll_pg"], -cs_b, None, "CSLL a pagar - 3º tri/2025"),
        (B["capital"], -150000.00, None, "Capital social"),
    ]
    lb.append((B["lucros_acum"], -r2(sum(l[1] for l in lb)), None, "Lucros acumulados"))
    lanc(beta_c, J["beta"]["misc"], ABERTURA, "SEED-ABERTURA-2025-09-30", lb)


# ---------------------------- MENSAL --------------------------------------
def mes_alfa(i):
    a, ap, f = alfa(i), alfa(i - 1), filial(i)
    t, fm = tag(i), fim_mes(i)
    jm = J["alfa"]["misc"]
    pref = "SEED-ALFA-%s-" % t
    lanc(matriz, jm, fm, pref + "VENDAS", [
        (A["receber"], a["receita"], P_CLIENTES, "Vendas de mercadorias"),
        (A["rec_mercadorias"], -a["receita"], P_CLIENTES, "Receita de revenda de mercadorias"),
    ])
    lanc(matriz, jm, fm, pref + "DEDUCOES", [
        (A["d_icms"], a["icms"], None, "ICMS s/ vendas (18%)"),
        (A["d_pis"], a["pis"], None, "PIS s/ faturamento (0,65%)"),
        (A["d_cofins"], a["cofins"], None, "COFINS s/ faturamento (3%)"),
        (A["icms_pg"], -a["icms"], None, "ICMS a recolher"),
        (A["pis_pg"], -a["pis"], None, "PIS a recolher"),
        (A["cofins_pg"], -a["cofins"], None, "COFINS a recolher"),
    ])
    compras = r2(a["cmv"] + f["cmv"])
    lanc(matriz, jm, dia(i, 5), pref + "COMPRAS", [
        (A["estoque"], compras, P_FORNEC, "Compras de mercadorias"),
        (A["fornec"], -compras, P_FORNEC, "Fornecedores - compras"),
    ])
    lanc(matriz, jm, fm, pref + "CMV", [
        (A["cmv"], a["cmv"], None, "Custo das mercadorias vendidas"),
        (A["estoque"], -a["cmv"], None, "Baixa de estoque"),
    ])
    lanc(matriz, jm, fm, pref + "FOLHA", [
        (A["salarios"], a["salarios"], None, "Salários e ordenados"),
        (A["inss"], a["inss"], None, "INSS patronal (20%)"),
        (A["fgts"], a["fgts"], None, "FGTS (8%)"),
        (A["salarios_pg"], -a["salarios"], None, "Salários a pagar"),
        (A["inss_pg"], -a["inss"], None, "INSS a recolher"),
        (A["fgts_pg"], -a["fgts"], None, "FGTS a recolher"),
    ])
    desp = r2(a["aluguel"] + a["energia"] + a["servicos"])
    lanc(matriz, jm, fm, pref + "DESPESAS", [
        (A["aluguel"], a["aluguel"], P_FORNEC, "Aluguel da loja/CD"),
        (A["energia"], a["energia"], P_FORNEC, "Energia elétrica"),
        (A["serv_terceiros"], a["servicos"], P_FORNEC, "Serviços de terceiros (contabilidade, limpeza)"),
        (A["fornec"], -desp, P_FORNEC, "Fornecedores - despesas"),
    ])
    lanc(matriz, jm, fm, pref + "DEPRECIACAO", [
        (A["deprec"], a["deprec"], None, "Depreciação do mês"),
        (A["dep_acum"], -a["deprec"], None, "Depreciação acumulada"),
    ])
    lanc(matriz, jm, fm, pref + "FINANCEIRO", [
        (A["juros"], a["juros"], P_BANCO, "Juros s/ empréstimo bancário"),
        (A["banco"], a["rec_fin"], P_BANCO, "Rendimento de aplicação financeira"),
        (A["rec_fin"], -a["rec_fin"], P_BANCO, "Receitas financeiras"),
        (A["banco"], -a["juros"], P_BANCO, "Pagamento de juros"),
    ])
    lanc(matriz, jm, dia(i, 20), pref + "AMORTIZACAO", [
        (A["emprestimo"], EMPRESTIMO_AMORT, P_BANCO, "Amortização do empréstimo"),
        (A["banco"], -EMPRESTIMO_AMORT, P_BANCO, "Amortização do empréstimo"),
    ])
    # Recebimentos e pagamentos referentes ao mês anterior
    lanc(matriz, jm, dia(i, 15), pref + "RECEBIMENTOS", [
        (A["banco"], ap["receita"], P_CLIENTES, "Recebimento de clientes"),
        (A["receber"], -ap["receita"], P_CLIENTES, "Baixa de clientes"),
    ])
    pg = [
        (A["fornec"], fornecedores_alfa(i - 1), P_FORNEC, "Pagamento a fornecedores"),
        (A["salarios_pg"], ap["salarios"], None, "Pagamento de salários"),
        (A["inss_pg"], ap["inss"], None, "Recolhimento INSS"),
        (A["fgts_pg"], ap["fgts"], None, "Recolhimento FGTS"),
        (A["icms_pg"], ap["icms"], None, "Recolhimento ICMS"),
        (A["pis_pg"], ap["pis"], None, "Recolhimento PIS"),
        (A["cofins_pg"], ap["cofins"], None, "Recolhimento COFINS"),
    ]
    if fim_trimestre(i - 1):  # paga o IRPJ/CSLL do trimestre anterior
        ir, cs = trimestre_alfa(i - 1)
        pg += [(A["irpj_pg"], ir, None, "Pagamento IRPJ trimestral"),
               (A["csll_pg"], cs, None, "Pagamento CSLL trimestral")]
    pg.append((A["banco"], -r2(sum(l[1] for l in pg)), P_BANCO, "Pagamentos do mês"))
    lanc(matriz, jm, dia(i, 10), pref + "PAGAMENTOS", pg)
    if fim_trimestre(i):
        ir, cs = trimestre_alfa(i)
        lanc(matriz, jm, fm, pref + "IRPJ-CSLL", [
            (A["irpj"], ir, None, "Provisão IRPJ (Lucro Presumido, inclui filial)"),
            (A["csll"], cs, None, "Provisão CSLL (Lucro Presumido, inclui filial)"),
            (A["irpj_pg"], -ir, None, "IRPJ a pagar"),
            (A["csll_pg"], -cs, None, "CSLL a pagar"),
        ])


def mes_filial(i):
    f, fp = filial(i), filial(i - 1)
    t, fm = tag(i), fim_mes(i)
    jm = J["filial"]["misc"]
    pref = "SEED-FILIAL-%s-" % t
    lanc(filial_c, jm, fm, pref + "VENDAS", [
        (A["receber"], f["receita"], P_CLIENTES, "Vendas de mercadorias"),
        (A["rec_mercadorias"], -f["receita"], P_CLIENTES, "Receita de revenda de mercadorias"),
    ])
    lanc(filial_c, jm, fm, pref + "DEDUCOES", [
        (A["d_icms"], f["icms"], None, "ICMS s/ vendas (18%)"),
        (A["d_pis"], f["pis"], None, "PIS s/ faturamento (0,65%)"),
        (A["d_cofins"], f["cofins"], None, "COFINS s/ faturamento (3%)"),
        (A["icms_pg"], -f["icms"], None, "ICMS a recolher"),
        (A["pis_pg"], -f["pis"], None, "PIS a recolher"),
        (A["cofins_pg"], -f["cofins"], None, "COFINS a recolher"),
    ])
    lanc(filial_c, jm, fm, pref + "CMV", [
        (A["cmv"], f["cmv"], None, "Custo das mercadorias vendidas"),
        (A["estoque"], -f["cmv"], None, "Baixa de estoque"),
    ])
    lanc(filial_c, jm, fm, pref + "FOLHA", [
        (A["salarios"], f["salarios"], None, "Salários e ordenados"),
        (A["inss"], f["inss"], None, "INSS patronal (20%)"),
        (A["fgts"], f["fgts"], None, "FGTS (8%)"),
        (A["salarios_pg"], -f["salarios"], None, "Salários a pagar"),
        (A["inss_pg"], -f["inss"], None, "INSS a recolher"),
        (A["fgts_pg"], -f["fgts"], None, "FGTS a recolher"),
    ])
    desp = r2(f["aluguel"] + f["energia"] + f["servicos"])
    lanc(filial_c, jm, fm, pref + "DESPESAS", [
        (A["aluguel"], f["aluguel"], P_FORNEC, "Aluguel da loja"),
        (A["energia"], f["energia"], P_FORNEC, "Energia elétrica"),
        (A["serv_terceiros"], f["servicos"], P_FORNEC, "Serviços de terceiros"),
        (A["fornec"], -desp, P_FORNEC, "Fornecedores - despesas"),
    ])
    lanc(filial_c, jm, fm, pref + "DEPRECIACAO", [
        (A["deprec"], f["deprec"], None, "Depreciação do mês"),
        (A["dep_acum"], -f["deprec"], None, "Depreciação acumulada"),
    ])
    lanc(filial_c, jm, fm, pref + "FINANCEIRO", [
        (A["juros"], f["tarifas"], P_BANCO, "Tarifas bancárias"),
        (A["banco"], -f["tarifas"], P_BANCO, "Tarifas bancárias"),
    ])
    lanc(filial_c, jm, dia(i, 15), pref + "RECEBIMENTOS", [
        (A["banco"], fp["receita"], P_CLIENTES, "Recebimento de clientes"),
        (A["receber"], -fp["receita"], P_CLIENTES, "Baixa de clientes"),
    ])
    pg = [
        (A["fornec"], fornecedores_filial(i - 1), P_FORNEC, "Pagamento a fornecedores"),
        (A["salarios_pg"], fp["salarios"], None, "Pagamento de salários"),
        (A["inss_pg"], fp["inss"], None, "Recolhimento INSS"),
        (A["fgts_pg"], fp["fgts"], None, "Recolhimento FGTS"),
        (A["icms_pg"], fp["icms"], None, "Recolhimento ICMS"),
        (A["pis_pg"], fp["pis"], None, "Recolhimento PIS"),
        (A["cofins_pg"], fp["cofins"], None, "Recolhimento COFINS"),
    ]
    pg.append((A["banco"], -r2(sum(l[1] for l in pg)), P_BANCO, "Pagamentos do mês"))
    lanc(filial_c, jm, dia(i, 10), pref + "PAGAMENTOS", pg)

    # Transferência de mercadorias Matriz -> Filial (mesmo CNPJ raiz), a preço de custo.
    # Um lançamento em cada estabelecimento, mesma ref, diário TRF, parceiro = o outro.
    ref = "TRF-MATRIZ-FILIAL-%s" % t
    v = f["cmv"]
    lanc(matriz, J["alfa"]["trf"], dia(i, 3), ref, [
        (A["cc_filial"], v, P_FILIAL, "Remessa de mercadorias para a Filial SP"),
        (A["estoque"], -v, P_FILIAL, "Saída de estoque por transferência"),
    ])
    lanc(filial_c, J["filial"]["trf"], dia(i, 3), ref, [
        (A["estoque"], v, P_ALFA, "Entrada de mercadorias recebidas da matriz"),
        (A["cc_matriz"], -v, P_ALFA, "Conta corrente matriz - transferência"),
    ])
    # Repasse de caixa Filial -> Matriz (tesouraria centralizada): a filial reembolsa
    # as mercadorias recebidas, pelo mesmo valor de custo. Também no diário TRF.
    ref = "TRF-CAIXA-FILIAL-MATRIZ-%s" % t
    lanc(filial_c, J["filial"]["trf"], dia(i, 25), ref, [
        (A["cc_matriz"], v, P_ALFA, "Repasse de caixa para a matriz"),
        (A["banco"], -v, P_ALFA, "Repasse de caixa para a matriz"),
    ])
    lanc(matriz, J["alfa"]["trf"], dia(i, 25), ref, [
        (A["banco"], v, P_FILIAL, "Repasse de caixa recebido da Filial SP"),
        (A["cc_filial"], -v, P_FILIAL, "Conta corrente Filial SP - repasse"),
    ])


def mes_beta(i):
    b, bp = beta(i), beta(i - 1)
    t, fm = tag(i), fim_mes(i)
    jm = J["beta"]["misc"]
    pref = "SEED-BETA-%s-" % t
    lanc(beta_c, jm, fm, pref + "SERVICOS", [
        (B["receber"], b["receita"], P_CLIENTES, "Serviços prestados"),
        (B["rec_servicos"], -b["receita"], P_CLIENTES, "Receita de prestação de serviços"),
    ])
    lanc(beta_c, jm, fm, pref + "DEDUCOES", [
        (B["d_iss"], b["iss"], None, "ISS (5%)"),
        (B["d_pis"], b["pis"], None, "PIS s/ faturamento (0,65%)"),
        (B["d_cofins"], b["cofins"], None, "COFINS s/ faturamento (3%)"),
        (B["iss_pg"], -b["iss"], None, "ISS a recolher"),
        (B["pis_pg"], -b["pis"], None, "PIS a recolher"),
        (B["cofins_pg"], -b["cofins"], None, "COFINS a recolher"),
    ])
    desp = r2(b["cpv"] + b["aluguel"] + b["energia"] + b["telecom"])
    lanc(beta_c, jm, fm, pref + "CUSTOS-DESPESAS", [
        (B["cpv_serv"], b["cpv"], P_FORNEC, "Custo dos serviços (subcontratados/insumos)"),
        (B["aluguel"], b["aluguel"], P_FORNEC, "Aluguel do escritório"),
        (B["energia"], b["energia"], P_FORNEC, "Energia elétrica"),
        (B["telecom"], b["telecom"], P_FORNEC, "Telefone e internet"),
        (B["fornec"], -desp, P_FORNEC, "Fornecedores"),
    ])
    lanc(beta_c, jm, fm, pref + "FOLHA", [
        (B["salarios"], b["salarios"], None, "Salários e ordenados"),
        (B["inss"], b["inss"], None, "INSS patronal (20%)"),
        (B["fgts"], b["fgts"], None, "FGTS (8%)"),
        (B["salarios_pg"], -b["salarios"], None, "Salários a pagar"),
        (B["inss_pg"], -b["inss"], None, "INSS a recolher"),
        (B["fgts_pg"], -b["fgts"], None, "FGTS a recolher"),
    ])
    lanc(beta_c, jm, fm, pref + "DEPRECIACAO", [
        (B["deprec"], b["deprec"], None, "Depreciação do mês"),
        (B["dep_acum"], -b["deprec"], None, "Depreciação acumulada"),
    ])
    lanc(beta_c, jm, fm, pref + "FINANCEIRO", [
        (B["juros"], b["tarifas"], P_BANCO, "Tarifas bancárias"),
        (B["banco"], b["rec_fin"], P_BANCO, "Rendimento de aplicação"),
        (B["rec_fin"], -b["rec_fin"], P_BANCO, "Receitas financeiras"),
        (B["banco"], -b["tarifas"], P_BANCO, "Tarifas bancárias"),
    ])
    lanc(beta_c, jm, dia(i, 15), pref + "RECEBIMENTOS", [
        (B["banco"], bp["receita"], P_CLIENTES, "Recebimento de clientes"),
        (B["receber"], -bp["receita"], P_CLIENTES, "Baixa de clientes"),
    ])
    pg = [
        (B["fornec"], fornecedores_beta(i - 1), P_FORNEC, "Pagamento a fornecedores"),
        (B["salarios_pg"], bp["salarios"], None, "Pagamento de salários"),
        (B["inss_pg"], bp["inss"], None, "Recolhimento INSS"),
        (B["fgts_pg"], bp["fgts"], None, "Recolhimento FGTS"),
        (B["iss_pg"], bp["iss"], None, "Recolhimento ISS"),
        (B["pis_pg"], bp["pis"], None, "Recolhimento PIS"),
        (B["cofins_pg"], bp["cofins"], None, "Recolhimento COFINS"),
    ]
    if fim_trimestre(i - 1):
        ir, cs = trimestre_beta(i - 1)
        pg += [(B["irpj_pg"], ir, None, "Pagamento IRPJ trimestral"),
               (B["csll_pg"], cs, None, "Pagamento CSLL trimestral")]
    pg.append((B["banco"], -r2(sum(l[1] for l in pg)), P_BANCO, "Pagamentos do mês"))
    lanc(beta_c, jm, dia(i, 10), pref + "PAGAMENTOS", pg)
    if fim_trimestre(i):
        ir, cs = trimestre_beta(i)
        lanc(beta_c, jm, fm, pref + "IRPJ-CSLL", [
            (B["irpj"], ir, None, "Provisão IRPJ (Lucro Presumido 32%)"),
            (B["csll"], cs, None, "Provisão CSLL (Lucro Presumido 32%)"),
            (B["irpj_pg"], -ir, None, "IRPJ a pagar"),
            (B["csll_pg"], -cs, None, "CSLL a pagar"),
        ])


def mes_intercompany(i):
    """Operações entre CNPJs distintos (Beta x Alfa matriz), diário INTC, refs 'IC-'."""
    t, fm = tag(i), fim_mes(i)
    # 1) Beta presta serviços à Alfa: R$ 15k/mês (receita na Beta, despesa na Alfa)
    ref = "IC-BETA-ALFA-SERV-%s" % t
    lanc(beta_c, J["beta"]["ic"], fm, ref, [
        (B["receber_pl"], IC_SERVICOS, P_ALFA, "Serviços prestados ao Grupo Alfa (IC)"),
        (B["rec_servicos"], -IC_SERVICOS, P_ALFA, "Receita de serviços - parte relacionada"),
    ])
    lanc(matriz, J["alfa"]["ic"], fm, ref, [
        (A["serv_terceiros"], IC_SERVICOS, P_BETA, "Serviços tomados da Beta (IC)"),
        (A["fornec_pl"], -IC_SERVICOS, P_BETA, "Fornecedor parte relacionada - Beta"),
    ])
    # Liquidação no mês seguinte (do serviço do mês anterior)
    ref = "IC-BETA-ALFA-PGTO-%s" % t
    lanc(matriz, J["alfa"]["ic"], dia(i, 10), ref, [
        (A["fornec_pl"], IC_SERVICOS, P_BETA, "Pagamento à Beta (serviços do mês anterior)"),
        (A["banco"], -IC_SERVICOS, P_BETA, "Pagamento à Beta"),
    ])
    lanc(beta_c, J["beta"]["ic"], dia(i, 10), ref, [
        (B["banco"], IC_SERVICOS, P_ALFA, "Recebimento do Grupo Alfa"),
        (B["receber_pl"], -IC_SERVICOS, P_ALFA, "Baixa do recebível - Grupo Alfa"),
    ])
    # 2) Mútuo de R$ 200k da Alfa para a Beta em jan/2026
    if i == MUTUO_IDX:
        ref = "IC-MUTUO-ALFA-BETA-%s" % t
        lanc(matriz, J["alfa"]["ic"], dia(i, 5), ref, [
            (A["mutuo_ativo"], MUTUO_VALOR, P_BETA, "Mútuo concedido à Beta Serviços"),
            (A["banco"], -MUTUO_VALOR, P_BETA, "Transferência do mútuo"),
        ])
        lanc(beta_c, J["beta"]["ic"], dia(i, 5), ref, [
            (B["banco"], MUTUO_VALOR, P_ALFA, "Recebimento do mútuo do Grupo Alfa"),
            (B["mutuo_passivo"], -MUTUO_VALOR, P_ALFA, "Mútuo a pagar - Grupo Alfa"),
        ])
    # 3) Juros do mútuo: R$ 2k/mês, apropriados (incorporados ao saldo) de jan a set/2026
    if i >= MUTUO_IDX:
        ref = "IC-MUTUO-JUROS-%s" % t
        lanc(matriz, J["alfa"]["ic"], fm, ref, [
            (A["mutuo_ativo"], MUTUO_JUROS, P_BETA, "Juros s/ mútuo - Beta"),
            (A["rec_mutuo"], -MUTUO_JUROS, P_BETA, "Receita de juros de mútuo - parte relacionada"),
        ])
        lanc(beta_c, J["beta"]["ic"], fm, ref, [
            (B["juros_mutuo"], MUTUO_JUROS, P_ALFA, "Juros s/ mútuo - Grupo Alfa"),
            (B["mutuo_passivo"], -MUTUO_JUROS, P_ALFA, "Juros incorporados ao mútuo"),
        ])


# ---------------------------------------------------------------------------
# RESET opcional: remove os lançamentos do seed para recriá-los com novos valores
# ---------------------------------------------------------------------------
if RESET:
    empresas = matriz | filial_c | beta_c
    for c in (matriz, beta_c):
        c.fiscalyear_lock_date = False
    velhos = Move.search([("company_id", "in", empresas.ids), "|", "|",
                          ("ref", "=like", "SEED-%"), ("ref", "=like", "TRF-%"), ("ref", "=like", "IC-%")])
    print("[reset] removendo %s lançamentos" % len(velhos))
    velhos.button_draft()
    velhos.with_context(force_delete=True).unlink()

abertura()
for i in MESES:
    mes_alfa(i)
    mes_filial(i)
    mes_beta(i)
    mes_intercompany(i)

# ---------------------------------------------------------------------------
# Datas de bloqueio: libera temporariamente se houver lançamento novo em período
# bloqueado (re-execução após mudanças), grava e depois aplica o bloqueio.
# ---------------------------------------------------------------------------
faltando = [p for p in pendentes
            if not Move.search_count([("company_id", "=", p[0].id), ("ref", "=", p[3])])]
if faltando:
    for c in (matriz, beta_c):
        if c.fiscalyear_lock_date and c.fiscalyear_lock_date >= min(p[2] for p in faltando):
            c.fiscalyear_lock_date = False
grava_pendentes()
for c in (matriz, beta_c):
    c.fiscalyear_lock_date = LOCK_DATE  # "Global Lock Date" (bloqueia tudo até a data)

# ---------------------------------------------------------------------------
# Usuário de integração somente-leitura: acesso às 3 empresas novas
# ---------------------------------------------------------------------------
ro = env["res.users"].sudo().with_context(active_test=False).search([("login", "=", LOGIN_RO)], limit=1)
if ro:
    ro.company_ids = [(4, c.id) for c in (matriz, filial_c, beta_c)]
    print("[ro] empresas do usuário de integração:", ro.company_ids.ids)

# ---------------------------------------------------------------------------
# Conferência: balancete de cada empresa precisa zerar
# ---------------------------------------------------------------------------
env.cr.commit()
for c in (matriz, filial_c, beta_c):
    env.cr.execute("""SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(DISTINCT move_id)
                      FROM account_move_line WHERE company_id=%s AND parent_state='posted'""", (c.id,))
    d, cr_, n = env.cr.fetchone()
    print("[balancete] %s (id %s): débitos=%.2f créditos=%.2f diferença=%.2f lançamentos=%s"
          % (c.name, c.id, d, cr_, d - cr_, n))
print("[seed] lançamentos criados=%s já existentes=%s" % (criados["n"], criados["pulados"]))
print("[seed] empresas:", {c.name: c.id for c in (matriz, filial_c, beta_c)})
