// Confere o conector contra o expected.json do laboratório.
//   ODOO_URL=http://127.0.0.1:8069 ODOO_DB=lab20 ODOO_KEY=... DATABASE_URL=... \
//     bun scripts/odoo-demo/validate-connector.ts
import { readFileSync } from "node:fs";
import { buildSnapshot, fetchCompanies } from "@/lib/odoo/sync.server";
import { buildEntityData, listEntities } from "@/engines/odoo/toAppState";

const cfg = {
  url: process.env.ODOO_URL!,
  database: process.env.ODOO_DB!,
  apiKey: process.env.ODOO_KEY!,
};
const expected = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
// Seleciona as empresas do grupo pelo nome (os ids variam de banco para banco).
const all = await fetchCompanies(cfg);
const roots = all.filter(
  (c) => !c.parentId && expected.empresas.some((e: { name: string }) => e.name === c.name),
);
const snap = await buildSnapshot(cfg, {
  companyIds: roots.map((c) => c.id),
  historyMonths: 24,
  ref: new Date("2026-10-15"),
});
console.log("empresas:", snap.companies.map((c) => `${c.id}:${c.name}`).join(", "));
const entities = listEntities(snap);
console.log("entidades:", entities.map((e) => e.key).join(", "));

let fails = 0;
const check = (label: string, got: number, want: number) => {
  const ok = Math.abs(got - want) < 0.05;
  if (!ok) fails++;
  console.log(
    `${ok ? "ok  " : "ERRO"} ${label}: conector ${got.toFixed(2)} × esperado ${want.toFixed(2)}`,
  );
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

for (const c of snap.companies) {
  const exp = expected.dre_mensal[c.name];
  if (!exp) continue;
  const data = buildEntityData(
    snap,
    {
      key: `x:${c.id}`,
      kind: "branch",
      label: c.name,
      companyIds: [c.id],
      rootId: c.parentId ?? c.id,
      vat: c.vat,
    },
    "2026-09",
  );
  // Sem eliminação: compara a empresa isolada.
  const p = data.actuals.pl;
  const tot =
    exp.total_12m ??
    Object.values(exp.meses as Record<string, Record<string, number>>).reduce(
      (acc: Record<string, number>, m) => {
        for (const [k, v] of Object.entries(m)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      },
      {},
    );
  console.log(`\n# ${c.name} (${data.months[0]}..${data.months.at(-1)})`);
  check("receita bruta", sum(p.receita_bruta), tot.receita_bruta);
  check("deduções + impostos s/ vendas", sum(p.deducoes) + sum(p.impostos_vendas), tot.deducoes);
  check("CPV", sum(p.cpv), tot.cpv);
  check(
    "pessoal",
    sum(p.pessoal_salarios) + sum(p.pessoal_encargos) + sum(p.pessoal_beneficios),
    tot.pessoal,
  );
  check(
    "despesas operacionais",
    sum(p.despesa_administrativa) +
      sum(p.despesa_comercial) +
      sum(p.depreciacao) +
      sum(p.outras_despesas),
    tot.despesas_operacionais,
  );
  check("despesas financeiras", sum(p.despesa_financeira), tot.despesas_financeiras);
  check(
    "receitas financeiras",
    sum(p.receita_financeira) + sum(p.outras_receitas),
    tot.receitas_financeiras,
  );
  check("IR/CSLL", sum(p.ir_csll), tot.ir_csll);
  const cl = data.actuals.closing;
  const ativo =
    cl.caixa +
    cl.aplicacoes +
    cl.contas_receber +
    cl.estoques +
    cl.impostos_recuperar +
    cl.despesas_antecipadas +
    cl.outros_ac +
    cl.realizavel_lp +
    cl.investimentos +
    cl.imobilizado +
    cl.depreciacao_acumulada +
    cl.intangivel;
  const passivo =
    cl.fornecedores +
    cl.salarios_encargos +
    cl.impostos_pagar +
    cl.emprestimos_cp +
    cl.adiantamentos_clientes +
    cl.outros_pc +
    cl.emprestimos_lp +
    cl.impostos_parcelados +
    cl.outros_pnc +
    cl.capital_social +
    cl.reservas +
    cl.lucros_acumulados;
  check("balanço fecha (ativo − passivo − PL)", ativo - passivo, 0);
}

const rev = (key: string) => {
  const d = buildEntityData(snap, entities.find((e) => e.key === key)!, "2026-09");
  return { d, receita: sum(d.actuals.pl.receita_bruta) };
};
const idOf = (name: string) => snap.companies.find((c) => c.name === name)!.id;
const alfa = rev(`e:${idOf("Grupo Alfa Comércio Ltda")}`);
const beta = rev(`e:${idOf("Beta Serviços Ltda")}`);
const grupo = rev("group");
console.log("\n# Consolidado");
// Serviços Beta → Alfa (R$ 15 mil/mês) saem da receita do grupo.
check(
  "receita do grupo = Alfa + Beta − serviços internos",
  grupo.receita,
  alfa.receita + beta.receita - 180_000,
);
const g = grupo.d.actuals.closing;
// Mútuo Alfa → Beta (R$ 218 mil com juros) eliminado nos dois lados.
check(
  "mútuo eliminado: realizável LP do grupo",
  g.realizavel_lp,
  alfa.d.actuals.closing.realizavel_lp - 218_000,
);
console.log(fails ? `\n${fails} divergência(s)` : "\nTudo confere.");
process.exit(fails ? 1 : 0);
