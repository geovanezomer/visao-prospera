// ============================================================================
// Export de usuários em CSV.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}

export const exportUsersCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type AuthUser = Awaited<
      ReturnType<typeof supabaseAdmin.auth.admin.listUsers>
    >["data"]["users"][number] & {
      banned_until?: string | null;
    };
    const all: AuthUser[] = [];
    for (let p = 1; p <= 25; p++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: p, perPage: 200 });
      if (error) throw new Error(error.message);
      all.push(...((data.users ?? []) as AuthUser[]));
      if ((data.users ?? []).length < 200) break;
    }

    const ids = all.map((u) => u.id);
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan, status, current_period_end, provider, created_at")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });
    type SubRow = NonNullable<typeof subs>[number];
    const sub = new Map<string, SubRow>();
    for (const s of subs ?? []) if (!sub.has(s.user_id)) sub.set(s.user_id, s);

    const headers = [
      "id",
      "email",
      "display_name",
      "phone",
      "created_at",
      "last_sign_in_at",
      "active",
      "plan",
      "status",
      "current_period_end",
      "provider",
    ];
    const lines = [headers.join(",")];
    for (const u of all) {
      const s = sub.get(u.id);
      const banned = u.banned_until && new Date(u.banned_until).getTime() > Date.now();
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name =
        (typeof meta.display_name === "string" && meta.display_name) ||
        (typeof meta.full_name === "string" && meta.full_name) ||
        "";
      lines.push(
        [
          u.id,
          u.email ?? "",
          name,
          u.phone ?? "",
          u.created_at ?? "",
          u.last_sign_in_at ?? "",
          banned ? "false" : "true",
          s?.plan ?? "",
          s?.status ?? "",
          s?.current_period_end ?? "",
          s?.provider ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "users.export_csv",
      resource: "user",
      metadata: { rows: all.length },
    });

    return { csv: lines.join("\n"), rows: all.length };
  });
