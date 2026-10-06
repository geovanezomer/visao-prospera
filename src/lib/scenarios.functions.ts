// ============================================================================
// Cenários do simulador: o usuário salva um conjunto de alavancas com nome e
// volta a ele depois, em qualquer navegador. Separados por empresa (namespace).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";

const MAX_POR_EMPRESA = 30;
const ns = z.string().min(1).max(200);
// Alavancas do simulador: valores simples (números, textos curtos, booleanos).
const params = z
  .record(z.string().max(60), z.union([z.number(), z.string().max(60), z.boolean(), z.null()]))
  .refine((p) => Object.keys(p).length <= 120, "Parâmetros demais.");

type ParamValue = string | number | boolean | null;
export type SimScenario = {
  id: string;
  name: string;
  /** Alavancas em JSON (objeto de valores simples). */
  paramsJson: string;
  createdAt: string;
};

export const listScenarios = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ namespace: ns }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, schema } = await import("@/db/client.server");
    const { and, desc, eq } = await import("drizzle-orm");
    const t = schema.simScenarios;
    const rows = await db()
      .select()
      .from(t)
      .where(and(eq(t.userId, context.userId), eq(t.namespace, data.namespace)))
      .orderBy(desc(t.createdAt))
      .limit(MAX_POR_EMPRESA);
    return rows.map(
      (r): SimScenario => ({
        id: r.id,
        name: r.name,
        paramsJson: JSON.stringify(r.params as Record<string, ParamValue>),
        createdAt: r.createdAt,
      }),
    );
  });

export const saveScenario = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ namespace: ns, name: z.string().trim().min(1).max(60), params }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db, schema } = await import("@/db/client.server");
    const { and, count, eq } = await import("drizzle-orm");
    const t = schema.simScenarios;
    const [{ n }] = await db()
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.userId, context.userId), eq(t.namespace, data.namespace)));
    if (Number(n) >= MAX_POR_EMPRESA)
      throw new Error(`Limite de ${MAX_POR_EMPRESA} cenários por empresa. Apague algum antes.`);
    const [row] = await db()
      .insert(t)
      .values({
        userId: context.userId,
        namespace: data.namespace,
        name: data.name,
        params: data.params,
      })
      .returning({ id: t.id });
    return { id: row.id };
  });

export const deleteScenario = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, schema } = await import("@/db/client.server");
    const { and, eq } = await import("drizzle-orm");
    const t = schema.simScenarios;
    await db()
      .delete(t)
      .where(and(eq(t.id, data.id), eq(t.userId, context.userId)));
    return { ok: true };
  });
