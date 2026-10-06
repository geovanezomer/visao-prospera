// GET /api/health — usado pelo HEALTHCHECK do Docker. Confere o banco.
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { queryRows } = await import("@/db/client.server");
          await queryRows(sql`select 1`);
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false, db: "indisponível" }, { status: 503 });
        }
      },
    },
  },
});
