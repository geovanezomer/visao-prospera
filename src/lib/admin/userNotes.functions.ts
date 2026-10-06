// ============================================================================
// Admin · User Notes (CRM leve) — apenas admin lê/escreve via service_role.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

export type UserNote = {
  id: string;
  userId: string;
  authorId: string | null;
  authorEmail: string | null;
  body: string;
  pinned: boolean;
  createdAt: string;
};

type DbNoteRow = {
  id: string;
  user_id: string;
  author_id: string | null;
  author_email: string | null;
  body: string;
  pinned: boolean;
  created_at: string;
};

function rowToNote(r: DbNoteRow): UserNote {
  return {
    id: r.id,
    userId: r.user_id,
    authorId: r.author_id,
    authorEmail: r.author_email,
    body: r.body,
    pinned: r.pinned,
    createdAt: r.created_at,
  };
}

export const listUserNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("user_notes")
      .select("*")
      .eq("user_id", data.userId)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { notes: (rows ?? []).map(rowToNote) };
  });

export const createUserNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string; body: string }) =>
    z.object({ userId: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("user_notes")
      .insert({
        user_id: data.userId,
        author_id: context.userId,
        author_email: (context.claims as AuthClaims | undefined)?.email ?? null,
        body: data.body,
      })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { note: row ? rowToNote(row) : null };
  });

export const toggleNotePin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id: string; pinned: boolean }) =>
    z.object({ id: z.string().uuid(), pinned: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_notes")
      .update({ pinned: data.pinned })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUserNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
