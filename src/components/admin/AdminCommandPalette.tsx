// ============================================================================
// AdminCommandPalette — command palette global do painel admin (padrão
// Linear/Stripe). Abre com ⌘K / Ctrl+K a partir do admin.tsx.
//
// Grupos:
//   • Navegação — as 12 abas do admin
//   • Usuários  — busca live via listAdminUsers (debounce 300ms)
//   • Ações rápidas — sobre o usuário selecionado (magic link, timeline, CSV)
//
// A11y: cmdk/shadcn cuidam do focus trap, aria-label do input, retorno de
// foco ao fechar. O rodapé com hint de teclas é meramente informativo.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Package,
  Settings,
  Mail,
  Megaphone,
  Webhook,
  CreditCard,
  Flag,
  Activity,
  FileClock,
  FileText,
  Loader2,
  Send,
  ListTree,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { listAdminUsers, resendMagicLink, type AdminUserRow } from "@/lib/admin/admin.functions";
import { exportUsersCsv } from "@/lib/admin/export.functions";

type TabKey =
  | "dashboard"
  | "usuarios"
  | "planos"
  | "sistema"
  | "emails"
  | "broadcasts"
  | "webhooks"
  | "provider"
  | "flags"
  | "status"
  | "auditoria"
  | "legal";

const TABS: { key: TabKey; label: string; Icon: typeof Users }[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "usuarios", label: "Usuários", Icon: Users },
  { key: "planos", label: "Planos", Icon: Package },
  { key: "sistema", label: "Sistema", Icon: Settings },
  { key: "emails", label: "E-mails", Icon: Mail },
  { key: "broadcasts", label: "Broadcasts", Icon: Megaphone },
  { key: "webhooks", label: "Webhooks", Icon: Webhook },
  { key: "provider", label: "Provider", Icon: CreditCard },
  { key: "flags", label: "Feature Flags", Icon: Flag },
  { key: "status", label: "Status", Icon: Activity },
  { key: "auditoria", label: "Auditoria", Icon: FileClock },
  { key: "legal", label: "Termos / Privacidade", Icon: FileText },
];

export function AdminCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset ao fechar para não vazar contexto entre aberturas.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected(null);
    }
  }, [open]);

  // Debounce de 300ms: só chama listAdminUsers após pausa na digitação e
  // com 3+ caracteres (evita hit no backend por letra digitada).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await listAdminUsers({ data: { search: query.trim(), perPage: 5, page: 1 } });
        setResults((r.users ?? []).slice(0, 5));
      } catch (e) {
        console.warn("[palette] busca falhou:", e);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const goToTab = (tab: TabKey, extra?: Record<string, unknown>) => {
    navigate({ to: "/admin", search: { tab, ...(extra ?? {}) } as never, replace: true });
    onOpenChange(false);
  };

  const openUser = (u: AdminUserRow) => {
    goToTab("usuarios", { user: u.id });
  };

  const actResendMagic = async (u: AdminUserRow) => {
    onOpenChange(false);
    try {
      await resendMagicLink({ data: { userId: u.id } });
      toast.success(`Magic link enviado para ${u.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar magic link.");
    }
  };

  const actExportCsv = async () => {
    onOpenChange(false);
    try {
      const r = await exportUsersCsv();
      const blob = new Blob([r.csv ?? ""], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `usuarios-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar CSV.");
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Buscar aba, usuário ou ação…"
        value={query}
        onValueChange={setQuery}
        aria-label="Command palette do painel admin"
      />
      <CommandList>
        <CommandEmpty>
          {searching ? (
            <span className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando…
            </span>
          ) : query.length > 0 && query.length < 3 ? (
            "Digite 3+ caracteres para buscar usuários"
          ) : (
            "Nenhum resultado."
          )}
        </CommandEmpty>

        <CommandGroup heading="Navegação">
          {TABS.map(({ key, label, Icon }) => (
            <CommandItem key={key} value={`nav ${label}`} onSelect={() => goToTab(key)}>
              <Icon className="mr-2 h-4 w-4" />
              <span>Ir para {label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {results.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Usuários">
              {results.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`user ${u.email} ${u.displayName ?? ""}`}
                  onSelect={() => {
                    setSelected(u);
                    openUser(u);
                  }}
                >
                  <Users className="mr-2 h-4 w-4" />
                  <div className="flex flex-1 flex-col">
                    <span>{u.displayName ?? u.email}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {u.email} · {u.plan ?? "free"}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {(selected || results.length > 0) && (
          <>
            <CommandSeparator />
            <CommandGroup
              heading={selected ? `Ações rápidas · ${selected.email}` : "Ações rápidas"}
            >
              {selected && (
                <>
                  <CommandItem
                    value={`act-magic ${selected.email}`}
                    onSelect={() => void actResendMagic(selected)}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    <span>Reenviar magic link</span>
                  </CommandItem>
                  <CommandItem
                    value={`act-timeline ${selected.email}`}
                    onSelect={() => openUser(selected)}
                  >
                    <ListTree className="mr-2 h-4 w-4" />
                    <span>Ver linha do tempo</span>
                  </CommandItem>
                </>
              )}
              <CommandItem value="act-export-csv" onSelect={() => void actExportCsv()}>
                <Download className="mr-2 h-4 w-4" />
                <span>Exportar usuários (CSV)</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>

      <div className="flex items-center justify-end gap-3 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>
          <kbd className="rounded border border-border/60 px-1">↑↓</kbd> navegar
        </span>
        <span>
          <kbd className="rounded border border-border/60 px-1">↵</kbd> abrir
        </span>
        <span>
          <kbd className="rounded border border-border/60 px-1">esc</kbd> fechar
        </span>
      </div>
    </CommandDialog>
  );
}

/**
 * Hook: registra o atalho ⌘K / Ctrl+K enquanto o componente estiver montado.
 * Use no admin.tsx para deixar o listener ativo apenas na rota /admin.
 */
export function useAdminCommandShortcut(onToggle: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggle]);
}
