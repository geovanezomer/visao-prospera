// Aplica migrations e cria o admin inicial. Uso: DATABASE_URL=... bun run db:migrate
import { runMigrations, seedInitialAdmin } from "../src/db/bootstrap.server";

await runMigrations();
const created = await seedInitialAdmin();
console.log(created ? "Migrations aplicadas; admin inicial criado." : "Migrations aplicadas.");
process.exit(0);
