# ============================================================================
# Laboratório: atribui PRODUTOS às linhas de receita e de custo já lançadas,
# para demonstrar o "Mix de produtos" do simulador. Distribui as linhas entre
# produtos com pesos diferentes na receita e no custo — o que gera margens
# diferentes por linha. Só para laboratório (grava direto no banco).
#
#   docker compose exec -T odoo odoo shell -d lab20 --db_host=odoo-db \
#     --db_user=odoo --db_password=odoo --no-http < add_products.py
# ============================================================================
Company = env["res.company"].sudo()
Product = env["product.product"].sudo()


def produto(nome):
    p = Product.search([("name", "=", nome)], limit=1)
    return p or Product.create({"name": nome, "type": "consu"})


def conta(root, codigo):
    return env["account.account"].sudo().with_company(root).search(
        [("code", "=", codigo), ("company_ids", "in", root.id)], limit=1)


def distribuir(company, conta_codigo, produtos_pesos, root):
    acc = conta(root, conta_codigo)
    env.cr.execute("""SELECT id FROM account_move_line WHERE company_id=%s AND account_id=%s
                      AND parent_state='posted' ORDER BY date, id""", (company.id, acc.id))
    ids = [r[0] for r in env.cr.fetchall()]
    # Sequência cíclica pelos pesos (ex.: 4,3,2,1 → A A A A B B B C C D ...).
    seq = [p for p, w in produtos_pesos for _ in range(w)]
    for i, line_id in enumerate(ids):
        env.cr.execute("UPDATE account_move_line SET product_id=%s WHERE id=%s",
                       (seq[i % len(seq)].id, line_id))
    print("[prod]", company.name, conta_codigo, len(ids), "linhas")


alfa = Company.search([("name", "=", "Grupo Alfa Comércio Ltda")], limit=1)
filial = Company.search([("name", "=", "Grupo Alfa Comércio Ltda - Filial SP")], limit=1)
beta = Company.search([("name", "=", "Beta Serviços Ltda")], limit=1)

prem, pad, eco, ace = (produto(n) for n in ("Linha Premium", "Linha Padrão", "Linha Econômica", "Acessórios"))
for c in (alfa, filial):
    distribuir(c, "3.01.01.01.01.05", [(prem, 4), (pad, 3), (eco, 2), (ace, 1)], alfa)
    distribuir(c, "3.01.01.03.01.02", [(prem, 3), (pad, 4), (eco, 2), (ace, 1)], alfa)

cons, impl, sup = (produto(n) for n in ("Consultoria", "Implantação", "Suporte mensal"))
distribuir(beta, "3.01.01.01.01.06", [(cons, 3), (impl, 2), (sup, 2)], beta)
distribuir(beta, "3.01.01.03.01.03", [(cons, 2), (impl, 3), (sup, 2)], beta)
env.cr.commit()
print("[prod] ok")
