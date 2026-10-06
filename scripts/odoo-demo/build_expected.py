# -*- coding: utf-8 -*-
"""
Gera expected.json a partir do próprio Odoo (API JSON-2), depois de rodar seed_group.py.

Uso:
    ODOO_URL=http://127.0.0.1:8069 ODOO_DB=lab20 ODOO_KEY=<api key> \
        python3 build_expected.py > expected.json

Usa somente `formatted_read_group(domain, groupby, aggregates)` em account.move.line
(no Odoo 20 o `read_group` mudou de assinatura e não deve ser usado).
"""
import json
import os
import sys
import urllib.request

URL = os.environ.get("ODOO_URL", "http://127.0.0.1:8069")
DB = os.environ.get("ODOO_DB", "lab20")
KEY = os.environ.get("ODOO_KEY") or open(os.environ.get("ODOO_KEY_FILE", "/tmp/claude-0/odoo_key")).read().strip()
NOMES = ["Grupo Alfa Comércio Ltda", "Grupo Alfa Comércio Ltda - Filial SP", "Beta Serviços Ltda"]
CORTE_BALANCO = "2026-09-30"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(model, method, **kw):
    req = urllib.request.Request(
        "%s/json/2/%s/%s" % (URL, model, method), data=json.dumps(kw).encode(),
        headers={"Authorization": "bearer " + KEY, "X-Odoo-Database": DB,
                 "Content-Type": "application/json"})
    return json.loads(_opener.open(req).read())


empresas = call("res.company", "search_read", domain=[("name", "in", NOMES)],
                fields=["id", "name", "vat", "parent_id", "fiscalyear_lock_date",
                        "user_fiscalyear_lock_date", "partner_id", "currency_id"])
ids = [c["id"] for c in empresas]
CTX = {"allowed_company_ids": ids}
partners_grupo = [c["partner_id"][0] for c in empresas]
POSTED = [("parent_state", "=", "posted"), ("company_id", "in", ids)]


def frg(domain, groupby, aggregates):
    """Executa formatted_read_group empresa a empresa.

    Quirk do Odoo 20: account.account.code é company-dependent e o display_name da
    conta NÃO traz mais o código. Filtros/leitura por código usam env.company (= a
    primeira de allowed_company_ids), por isso consultamos uma empresa por vez."""
    res = []
    for cid in ids:
        ctx = {"allowed_company_ids": [cid]}
        for g in call("account.move.line", "formatted_read_group",
                      domain=domain + [("company_id", "=", cid)],
                      groupby=groupby, aggregates=aggregates, context=ctx):
            g.setdefault("company_id", [cid, None])
            res.append(g)
    return res


_codigos = {}


def codigo(acc):
    """Código da conta (lido de account.account no contexto da empresa dona)."""
    if acc[0] not in _codigos:
        for cid in ids:
            for a in call("account.account", "search_read", domain=[("company_ids", "in", cid)],
                          fields=["code"], context={"allowed_company_ids": [cid]}):
                _codigos.setdefault(a["id"], a["code"])
    return _codigos[acc[0]]


def nome_conta(acc):
    # O display_name da conta traz ou não o código conforme o usuário (no lab: o
    # admin recebe só o nome, o usuário de integração recebe "código nome").
    cod = codigo(acc)
    return acc[1] if acc[1].startswith(cod + " ") else "%s %s" % (cod, acc[1])


def bucket(cod):
    """Classifica a conta de resultado pelo prefixo do código ECD (l10n_br)."""
    if cod.startswith("3.01.01.01.01"):
        return "receita_bruta"
    if cod.startswith("3.01.01.01.02"):
        return "deducoes"
    if cod.startswith("3.01.01.03"):
        return "cpv"
    if cod.startswith("3.01.01.05"):
        return "receitas_financeiras"
    if cod[:16] in ("3.01.01.07.01.01", "3.01.01.07.01.02", "3.01.01.07.01.03",
                    "3.01.01.07.01.05", "3.01.01.07.01.06", "3.01.01.07.01.07"):
        return "pessoal"
    if cod.startswith("3.01.01.07"):
        return "despesas_operacionais"
    if cod.startswith("3.01.01.09"):
        return "despesas_financeiras"
    if cod.startswith("3.02"):
        return "ir_csll"
    return None


# Sinal de apresentação: receitas positivas (−saldo), despesas positivas (+saldo)
SINAL = {"receita_bruta": -1, "receitas_financeiras": -1}
CAMPOS = ["receita_bruta", "deducoes", "cpv", "pessoal", "despesas_operacionais",
          "despesas_financeiras", "receitas_financeiras", "ir_csll"]

out = {"gerado_de": URL, "database": DB, "moeda": "BRL",
       "observacoes": [
           "Valores de resultado com sinal de apresentação: receitas e despesas positivas; "
           "lucro_liquido = receita_bruta - deducoes - cpv - pessoal - despesas_operacionais "
           "- despesas_financeiras + receitas_financeiras - ir_csll.",
           "Dados obtidos via JSON-2 account.move.line/formatted_read_group (parent_state=posted).",
           "IRPJ/CSLL do CNPJ Alfa é apurado na matriz (inclui a receita da filial).",
           "Balanço: soma de balance (débito - crédito) por account_type até %s, inclusive as contas "
           "de resultado ainda não encerradas (income*/expense*)." % CORTE_BALANCO,
       ],
       "empresas": [], "dre_mensal": {}, "intercompany": {}, "balanco_%s" % CORTE_BALANCO.replace("-", "_"): {},
       "balancete_zerado": {}}

nome_de = {c["id"]: c["name"] for c in empresas}
for c in sorted(empresas, key=lambda c: c["id"]):
    out["empresas"].append({
        "id": c["id"], "name": c["name"], "vat": c["vat"],
        "parent_id": c["parent_id"][0] if c["parent_id"] else None,
        "partner_id": c["partner_id"][0],
        "fiscalyear_lock_date": c["fiscalyear_lock_date"] or None,
        "lock_date_efetiva": c["user_fiscalyear_lock_date"] or None,
    })

# ---- DRE mensal por empresa ----
dre = {}
for g in frg(POSTED, ["company_id", "date:month", "account_id"], ["balance:sum"]):
    b = bucket(codigo(g["account_id"]))
    if not b:
        continue
    mes = g["date:month"][0][:7]
    d = dre.setdefault(nome_de[g["company_id"][0]], {}).setdefault(mes, {k: 0.0 for k in CAMPOS})
    d[b] += SINAL.get(b, 1) * g["balance:sum"]
for emp, meses in dre.items():
    for mes, d in meses.items():
        for k in CAMPOS:
            d[k] = round(d[k], 2)
        d["lucro_liquido"] = round(d["receita_bruta"] - d["deducoes"] - d["cpv"] - d["pessoal"]
                                   - d["despesas_operacionais"] - d["despesas_financeiras"]
                                   + d["receitas_financeiras"] - d["ir_csll"], 2)
    tot = {k: round(sum(m[k] for m in meses.values()), 2) for k in CAMPOS + ["lucro_liquido"]}
    out["dre_mensal"][emp] = {"meses": dict(sorted(meses.items())), "total_12m": tot}

# ---- Intercompany ----
ic = {}
# (a) resultado com parceiros do grupo (CNPJs distintos: serviços e juros de mútuo)
for g in frg(POSTED + [("partner_id", "in", partners_grupo)],
             ["company_id", "date:month", "account_id"], ["balance:sum"]):
    b = bucket(codigo(g["account_id"]))
    if not b:
        continue
    mes = g["date:month"][0][:7]
    d = ic.setdefault(nome_de[g["company_id"][0]], {}).setdefault(mes, {})
    chave = {"receita_bruta": "ic_receita_servicos", "despesas_operacionais": "ic_despesa_servicos",
             "receitas_financeiras": "ic_receita_juros_mutuo", "despesas_financeiras": "ic_despesa_juros_mutuo"}[b]
    d[chave] = round(d.get(chave, 0) + SINAL.get(b, 1) * g["balance:sum"], 2)
# (b) transferências entre estabelecimentos (diário TRF)
for prefixo, chave in (("TRF-MATRIZ-FILIAL-%", "transferencia_mercadorias_matriz_filial"),
                       ("TRF-CAIXA-FILIAL-MATRIZ-%", "repasse_caixa_filial_matriz"),
                       ("IC-MUTUO-ALFA-BETA-%", "mutuo_principal")):
    for g in frg(POSTED + [("move_id.ref", "=like", prefixo)], ["company_id", "date:month"], ["debit:sum"]):
        mes = g["date:month"][0][:7]
        d = ic.setdefault(nome_de[g["company_id"][0]], {}).setdefault(mes, {})
        d[chave] = round(g["debit:sum"], 2)
out["intercompany"] = {
    "como_identificar": {
        "matriz_filial": "diário code 'TRF' (Transferências Matriz/Filial); refs 'TRF-MATRIZ-FILIAL-AAAA-MM' "
                         "(mercadorias) e 'TRF-CAIXA-FILIAL-MATRIZ-AAAA-MM' (repasse de caixa); "
                         "partner_id = partner da outra empresa; contas 1.01.02.09.97 / 2.01.01.17.97",
        "entre_cnpjs": "diário code 'INTC' (Operações Intercompany); refs 'IC-BETA-ALFA-SERV-AAAA-MM', "
                       "'IC-BETA-ALFA-PGTO-AAAA-MM', 'IC-MUTUO-ALFA-BETA-2026-01', 'IC-MUTUO-JUROS-AAAA-MM'; "
                       "partner_id = partner da empresa contraparte",
        "partners_das_empresas": {c["name"]: c["partner_id"][0] for c in empresas},
    },
    "mensal": {e: dict(sorted(m.items())) for e, m in ic.items()},
}
# saldos IC no balanço
sal_ic = {}
CONTAS_IC = {"1.01.02.09.97", "2.01.01.17.97", "1.02.01.01.03", "2.02.01.11.03",
             "1.01.02.02.03", "2.01.01.03.03"}
for g in frg(POSTED + [("date", "<=", CORTE_BALANCO)], ["company_id", "account_id"], ["balance:sum"]):
    if codigo(g["account_id"]) not in CONTAS_IC or abs(g["balance:sum"]) < 0.005:
        continue
    sal_ic.setdefault(nome_de[g["company_id"][0]], {})[nome_conta(g["account_id"])] = round(g["balance:sum"], 2)
out["intercompany"]["saldos_em_%s" % CORTE_BALANCO] = sal_ic

# ---- Balanço por account_type ----
bal = {}
for g in frg(POSTED + [("date", "<=", CORTE_BALANCO)], ["company_id", "account_id.account_type"], ["balance:sum"]):
    bal.setdefault(nome_de[g["company_id"][0]], {})[g["account_id.account_type"]] = round(g["balance:sum"], 2)
out["balanco_%s" % CORTE_BALANCO.replace("-", "_")] = bal

# ---- Balancete (deve somar zero) ----
for g in frg(POSTED, ["company_id"], ["debit:sum", "credit:sum", "balance:sum"]):
    out["balancete_zerado"][nome_de[g["company_id"][0]]] = {
        "debito": round(g["debit:sum"], 2), "credito": round(g["credit:sum"], 2),
        "saldo": round(g["balance:sum"], 2), "ok": abs(g["balance:sum"]) < 0.005}

json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
print()
