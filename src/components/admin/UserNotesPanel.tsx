// ============================================================================
// UserNotesPanel — CRM leve dentro do UserDetailDrawer.
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, Pin, PinOff, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  listUserNotes,
  createUserNote,
  toggleNotePin,
  deleteUserNote,
  type UserNote,
} from "@/lib/admin/userNotes.functions";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

export function UserNotesPanel({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listUserNotes({ data: { userId } });
      setNotes(r.notes);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [userId]);

  const add = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await createUserNote({ data: { userId, body: body.trim() } });
      setBody("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Nova nota interna (não visível pro usuário)…"
        />
        <Button size="sm" onClick={add} disabled={saving || !body.trim()}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Adicionar
        </Button>
      </div>
      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem notas.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div
              key={n.id}
              className={`rounded border p-2 text-xs ${n.pinned ? "border-amber-500/40 bg-amber-500/5" : "border-border/40"}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground">
                  {n.authorEmail ?? "—"} · {fmt(n.createdAt)}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1"
                    onClick={async () => {
                      await toggleNotePin({ data: { id: n.id, pinned: !n.pinned } });
                      void load();
                    }}
                  >
                    {n.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1"
                    onClick={async () => {
                      if (confirm("Excluir nota?")) {
                        await deleteUserNote({ data: { id: n.id } });
                        void load();
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
