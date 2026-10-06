// GET /api/health — HEALTHCHECK do Docker e monitor de disponibilidade.
// 200 enquanto o banco responde (o app funciona); `level` resume backup,
// sincronização do Odoo e erros. Detalhes ficam no painel do admin.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { collectOpsHealth } = await import("@/lib/ops/health.server");
        const h = await collectOpsHealth();
        const db = h.checks.find((c) => c.key === "db");
        const checks = Object.fromEntries(h.checks.map((c) => [c.key, c.level]));
        if (db?.level !== "ok")
          return Response.json({ ok: false, db: "indisponível", checks }, { status: 503 });
        return Response.json(
          { ok: true, level: h.level, checks },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
