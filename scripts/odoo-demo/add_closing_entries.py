# ============================================================================
# Teste do conector: lança ENCERRAMENTOS DO EXERCÍCIO em 31/12/2025, como um
# contador faria para a ECD. O conector deve desconsiderá-los — os números do
# app continuam iguais ao expected.json.
#
#   Beta:  encerramento direto (receita/custo → Lucros acumulados).
#   Alfa:  em duas etapas (receita/custo → "Apuração do Resultado do
#          Exercício"; depois apuração → Lucros acumulados).
#
#   docker compose exec -T odoo odoo shell -d lab20 --db_host=odoo-db \
#     --db_user=odoo --db_password=odoo --no-http < add_closing_entries.py
# Idempotente (refs ENC-*). Só para laboratório.
# ============================================================================
from datetime import date

DIA = date(2025, 12, 31)
Company = env["res.company"].sudo()
Move = env["account.move"].sudo()


def conta(root, codigo):
    acc = env["account.account"].sudo().with_company(root).search(
        [("code", "=", codigo), ("company_ids", "in", root.id)], limit=1)
    assert acc, codigo
    return acc


def saldo(company, acc):
    env.cr.execute("""SELECT COALESCE(SUM(balance),0) FROM account_move_line
                      WHERE company_id=%s AND account_id=%s AND parent_state='posted'
                        AND date<=%s AND date>='2025-10-01'""", (company.id, acc.id, DIA))
    return env.cr.fetchone()[0]


def lancar(company, ref, linhas):
    if Move.search([("company_id", "=", company.id), ("ref", "=", ref)], limit=1):
        print("[enc] já existe", ref)
        return
    journal = env["account.journal"].sudo().search(
        [("company_id", "=", company.id), ("type", "=", "general")], limit=1)
    vals = []
    for acc, bal, nome in linhas:
        if abs(bal) < 0.005:
            continue
        vals.append((0, 0, {"account_id": acc.id, "name": nome,
                            "debit": bal if bal > 0 else 0.0, "credit": -bal if bal < 0 else 0.0}))
    m = Move.with_company(company).create({"move_type": "entry", "date": DIA, "ref": ref,
                                           "journal_id": journal.id, "company_id": company.id,
                                           "line_ids": vals})
    m.action_post()
    print("[enc] lançado", ref, "linhas:", len(vals))


beta = Company.search([("name", "=", "Beta Serviços Ltda")], limit=1)
alfa = Company.search([("name", "=", "Grupo Alfa Comércio Ltda")], limit=1)
locks = {c.id: c.fiscalyear_lock_date for c in (beta, alfa)}
for c in (beta, alfa):
    c.fiscalyear_lock_date = False

# Beta — direto
rec = conta(beta, "3.01.01.01.01.06")
cpv = conta(beta, "3.01.01.03.01.03")
la = conta(beta, "2.03.04.01.01")
r, k = saldo(beta, rec), saldo(beta, cpv)
lancar(beta, "ENC-BETA-2025", [(rec, -r, "Encerramento receita"), (cpv, -k, "Encerramento custo"),
                                (la, r + k, "Resultado para lucros acumulados")])

# Alfa — duas etapas
rec = conta(alfa, "3.01.01.01.01.05")
cmv = conta(alfa, "3.01.01.03.01.02")
la = conta(alfa, "2.03.04.01.01")
Acc = env["account.account"].sudo().with_company(alfa)
are = Acc.search([("code", "=", "3.09.99.01"), ("company_ids", "in", alfa.id)], limit=1) or Acc.create(
    {"code": "3.09.99.01", "name": "Apuração do Resultado do Exercício", "account_type": "expense",
     "company_ids": [(6, 0, [alfa.id])]})
r, k = saldo(alfa, rec), saldo(alfa, cmv)
lancar(alfa, "ENC-ALFA-2025-1", [(rec, -r, "Encerramento receita"), (cmv, -k, "Encerramento CMV"),
                                  (are, r + k, "Apuração do resultado")])
lancar(alfa, "ENC-ALFA-2025-2", [(are, -(r + k), "Apuração → lucros acumulados"),
                                  (la, r + k, "Lucros acumulados")])

for c in (beta, alfa):
    c.fiscalyear_lock_date = locks[c.id]
env.cr.commit()
print("[enc] ok")
