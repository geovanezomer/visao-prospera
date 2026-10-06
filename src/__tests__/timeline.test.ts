// ============================================================================
// Testes de aggregateTimeline — visão 360° do cliente.
//
// Cobre:
//   • Agregação de fontes mistas → normaliza para o mesmo shape
//   • Ordenação por data desc, limite de 100
//   • Filtro por tipo (indireto: verifica kinds retornados)
//   • Ausência de email_log NÃO quebra (fonte opcional)
// ============================================================================
import { describe, expect, test } from "vitest";
import { aggregateTimeline } from "@/lib/admin/timeline.functions";

type Row = Record<string, unknown>;

/**
 * Cria admin mock que responde a .from(table).select().eq/order/limit/in/or
 * seguindo o fluxo do lifecycleEmails.test.ts. `emailLogPresent=false` faz
 * a checagem de existência falhar (tableExists → false), simulando schema
 * antigo sem email_log.
 */
function makeAdmin(opts: {
  subscriptions?: Row[];
  webhooks?: Row[];
  emailLog?: Row[] | null; // null = tabela inexistente
  audit?: Row[];
  checkouts?: Row[];
}) {
  const data = {
    subscriptions: opts.subscriptions ?? [],
    webhook_events: opts.webhooks ?? [],
    email_log: opts.emailLog,
    admin_audit_log: opts.audit ?? [],
    checkout_intents: opts.checkouts ?? [],
  } as Record<string, Row[] | null | undefined>;

  const chain = (table: string) => {
    const rows = data[table] === null ? null : (data[table] ?? []);
    const err = rows === null ? { message: `relation "${table}" does not exist` } : null;
    const result = { data: rows, error: err };
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      then: (r: any) => Promise.resolve(result).then(r),
    };
    return q;
  };

  return { from: chain } as any;
}

describe("aggregateTimeline", () => {
  test("normaliza fontes mistas e ordena por data desc", async () => {
    const admin = makeAdmin({
      subscriptions: [
        {
          id: "s1",
          plan: "pro",
          status: "active",
          provider: "stripe",
          stripe_subscription_id: "sub_1",
          created_at: "2026-01-01T10:00:00Z",
          updated_at: "2026-01-01T10:00:00Z",
          cancel_at_period_end: false,
        },
      ],
      webhooks: [
        {
          id: "w1",
          provider: "stripe",
          event_type: "invoice.paid",
          status: "processed",
          subscription_id: "sub_1",
          received_at: "2026-06-15T09:00:00Z",
          error: null,
        },
      ],
      emailLog: [
        {
          id: "e1",
          kind: "payment_failed",
          subscription_id: "sub_1",
          sent_at: "2026-06-20T12:00:00Z",
        },
      ],
      audit: [
        {
          id: "a1",
          action: "plan.grant_manual",
          resource: "subscription",
          actor_email: "root@x.com",
          created_at: "2026-07-01T00:00:00Z",
          metadata: null,
        },
      ],
      checkouts: [
        {
          id: "c1",
          status: "paid",
          plan_slug: "pro",
          provider: "stripe",
          created_at: "2026-01-01T09:00:00Z",
          updated_at: "2026-01-01T09:30:00Z",
          confirmed_at: "2026-01-01T09:30:00Z",
          last_error: null,
        },
      ],
    });

    const items = await aggregateTimeline(admin, "00000000-0000-0000-0000-000000000001", "u@x.com");

    // Ordenação desc
    const dates = items.map((i) => i.at);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);

    // Kinds presentes
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has("webhook")).toBe(true);
    expect(kinds.has("email")).toBe(true);
    expect(kinds.has("admin")).toBe(true);
    expect(kinds.has("checkout")).toBe(true);
    expect(kinds.has("assinatura")).toBe(true);

    // Shape normalizado
    for (const it of items) {
      expect(it).toHaveProperty("at");
      expect(it).toHaveProperty("kind");
      expect(it).toHaveProperty("title");
      expect(it).toHaveProperty("tone");
    }
  });

  test("ausência de email_log não quebra (fonte opcional)", async () => {
    const admin = makeAdmin({
      subscriptions: [],
      webhooks: [],
      emailLog: null, // tabela inexistente
      audit: [
        {
          id: "a1",
          action: "x",
          resource: "y",
          actor_email: null,
          created_at: "2026-01-01T00:00:00Z",
          metadata: null,
        },
      ],
      checkouts: [],
    });

    const items = await aggregateTimeline(admin, "00000000-0000-0000-0000-000000000001", "u@x.com");
    expect(items.some((i) => i.kind === "admin")).toBe(true);
    expect(items.some((i) => i.kind === "email")).toBe(false);
  });

  test("limita a 100 itens", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `a${i}`,
      action: "x",
      resource: "y",
      actor_email: null,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      metadata: null,
    }));
    const admin = makeAdmin({ audit: many, emailLog: [] });
    const items = await aggregateTimeline(admin, "00000000-0000-0000-0000-000000000001", null);
    expect(items.length).toBe(100);
  });
});
