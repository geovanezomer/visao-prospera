// Mede o tempo da sincronização (buildSnapshot) contra um Odoo.
//   ODOO_URL=... ODOO_DB=... ODOO_KEY=... DATABASE_URL=... bun scripts/odoo-demo/perf-sync.ts
import { buildSnapshot } from "@/lib/odoo/sync.server";

const cfg = {
  url: process.env.ODOO_URL!,
  database: process.env.ODOO_DB!,
  apiKey: process.env.ODOO_KEY!,
};
const t0 = performance.now();
const snap = await buildSnapshot(cfg, { companyIds: [], historyMonths: 24 });
const ms = Math.round(performance.now() - t0);
const contas = Object.values(snap.perCompany).reduce((s, c) => s + c.accounts.length, 0);
console.log(
  JSON.stringify({ ms, empresas: snap.companies.length, contas, meses: snap.months.length }),
);
process.exit(0);
