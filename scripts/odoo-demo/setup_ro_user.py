# ============================================================================
# Usuário de integração somente leitura + chave de API (escopo "rpc").
#
# Rodar no shell do Odoo (depois do seed_group.py):
#   docker compose -f scripts/odoo-demo/docker-compose.yml exec -T odoo \
#     odoo shell -d lab20 --no-http < scripts/odoo-demo/setup_ro_user.py
#
# Imprime a chave UMA vez ("APIKEY=..."). Cole-a em Administração › Odoo.
# Rodar de novo cria outra chave (as anteriores continuam válidas até serem
# revogadas em Preferências › Segurança da conta).
# ============================================================================
LOGIN = "visao-prospera-ro"

Users = env["res.users"].sudo().with_context(active_test=False, no_reset_password=True)
user = Users.search([("login", "=", LOGIN)], limit=1)
companies = env["res.company"].sudo().search([])
groups = env.ref("base.group_user") | env.ref("account.group_account_readonly")
# Odoo 19+ renomeou groups_id → group_ids.
gfield = "group_ids" if "group_ids" in Users._fields else "groups_id"
vals = {
    "name": "Visão Próspera (integração, somente leitura)",
    "login": LOGIN,
    "company_id": companies[0].id,
    "company_ids": [(6, 0, companies.ids)],
    gfield: [(6, 0, groups.ids)],
}
if user:
    user.write(vals)
else:
    user = Users.create(vals)
print(f"[ro] usuário {LOGIN} (id {user.id}) com {len(companies)} empresa(s)")

key = env["res.users.apikeys"].with_user(user).sudo()._generate("rpc", "visao-prospera", False)
env.cr.commit()
print("APIKEY=" + key)
