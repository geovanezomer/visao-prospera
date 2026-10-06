// POST /api/client-error — erros do navegador registrados em error_events.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

const Payload = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  path: z.string().max(300).optional(),
});

export const Route = createFileRoute("/api/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rl = await rlConsume(`client-error:${clientIp(request)}`, 20, 60);
        if (!rl.allowed) return tooManyRequests(rl.retryAfter);
        const parsed = Payload.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response(null, { status: 400 });
        const { recordError } = await import("@/lib/ops/errors.server");
        const err = new Error(parsed.data.message.replace(/^\w*Error:\s*/, ""));
        err.name = /^(\w*Error):/.exec(parsed.data.message)?.[1] ?? "Error";
        await recordError("client", err, { stack: parsed.data.stack, path: parsed.data.path });
        return new Response(null, { status: 204 });
      },
    },
  },
});
