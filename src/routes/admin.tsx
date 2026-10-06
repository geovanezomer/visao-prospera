// ============================================================================
// Painel Administrativo v2 — visível apenas para usuários com papel admin.
// Abas: Usuários · Sistema · E-mails · Webhooks · Provider.
// ============================================================================
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  ArrowLeft,
  Users,
  Settings,
  Mail,
  Webhook,
  CreditCard,
  LayoutDashboard,
  FileClock,
  Flag,
  Megaphone,
  Package,
  Activity,
  FileText,
  Search,
} from "lucide-react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";

import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { lazyNamed } from "@/components/common/LazyTab";
import {
  AdminCommandPalette,
  useAdminCommandShortcut,
} from "@/components/admin/AdminCommandPalette";

// Abas do Admin carregadas sob demanda — ver src/components/common/LazyTab.tsx.
// Cada aba vira chunk próprio; reduz o bundle do /admin de ~524KB para
// apenas o shell + a aba ativa.
const DashboardTab = lazyNamed(
  () => import("@/components/admin/tabs/DashboardTab"),
  "DashboardTab",
);
const UsersTab = lazyNamed(() => import("@/components/admin/tabs/UsersTab"), "UsersTab");
const SystemTab = lazyNamed(() => import("@/components/admin/tabs/SystemTab"), "SystemTab");
const EmailsTab = lazyNamed(() => import("@/components/admin/tabs/EmailsTab"), "EmailsTab");
const WebhooksTab = lazyNamed(() => import("@/components/admin/tabs/WebhooksTab"), "WebhooksTab");
const ProviderTab = lazyNamed(() => import("@/components/admin/tabs/ProviderTab"), "ProviderTab");
const AuditTab = lazyNamed(() => import("@/components/admin/tabs/AuditTab"), "AuditTab");
const FlagsTab = lazyNamed(() => import("@/components/admin/tabs/FlagsTab"), "FlagsTab");
const BroadcastsTab = lazyNamed(
  () => import("@/components/admin/tabs/BroadcastsTab"),
  "BroadcastsTab",
);
const PlansTab = lazyNamed(() => import("@/components/admin/tabs/PlansTab"), "PlansTab");
const StatusTab = lazyNamed(() => import("@/components/admin/tabs/StatusTab"), "StatusTab");
const LegalTab = lazyNamed(() => import("@/components/admin/tabs/LegalTab"), "LegalTab");

const TAB_KEYS = [
  "dashboard",
  "usuarios",
  "planos",
  "sistema",
  "emails",
  "broadcasts",
  "webhooks",
  "provider",
  "flags",
  "status",
  "auditoria",
  "legal",
] as const;
const searchSchema = z.object({
  tab: fallback(z.enum(TAB_KEYS), "dashboard").default("dashboard"),
  // Período do DashboardTab (7 / 30 / 90 dias). Preservado na URL.
  period: fallback(z.union([z.literal(7), z.literal(30), z.literal(90)]), 30).default(30),
  // ID de usuário para abrir o drawer via command palette (?user=<uuid>).
  user: fallback(z.string().uuid().optional(), undefined).optional(),
});

export const Route = createFileRoute("/admin")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [{ title: "Administração — Finnance" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, hydrated } = useAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Atalho ⌘K / Ctrl+K — ativo apenas enquanto /admin está montada.
  useAdminCommandShortcut(() => setPaletteOpen((v) => !v));

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/login" });
    else if (hydrated && user && !isAdmin) navigate({ to: "/app" });
  }, [hydrated, user, isAdmin, navigate]);

  if (!hydrated || !user || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Verificando permissões…
      </div>
    );
  }

  const setTab = (t: string) =>
    navigate({ to: "/admin", search: { tab: t as (typeof TAB_KEYS)[number] }, replace: true });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <header className="sticky top-0 z-30 border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="ghost" className="h-8">
              <Link to="/app">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Voltar
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <h1 className="text-sm font-semibold">Administração</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Descoberta do atalho: mesmo botão abre o palette. */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted sm:flex"
              aria-label="Abrir command palette"
            >
              <Search className="h-3 w-3" />
              <span>Buscar…</span>
              <kbd className="rounded border border-border/60 bg-background px-1 text-[10px]">
                ⌘K
              </kbd>
            </button>
            <Badge variant="outline" className="text-[10px]">
              {user.email}
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] p-4 sm:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 grid w-full grid-cols-3 gap-1 sm:grid-cols-6 lg:w-auto lg:grid-cols-11 lg:inline-flex">
            <TabsTrigger value="dashboard">
              <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="usuarios">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Usuários
            </TabsTrigger>
            <TabsTrigger value="planos">
              <Package className="mr-1.5 h-3.5 w-3.5" />
              Planos
            </TabsTrigger>
            <TabsTrigger value="sistema">
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Sistema
            </TabsTrigger>
            <TabsTrigger value="emails">
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              E-mails
            </TabsTrigger>
            <TabsTrigger value="broadcasts">
              <Megaphone className="mr-1.5 h-3.5 w-3.5" />
              Broadcasts
            </TabsTrigger>
            <TabsTrigger value="webhooks">
              <Webhook className="mr-1.5 h-3.5 w-3.5" />
              Webhooks
            </TabsTrigger>
            <TabsTrigger value="provider">
              <CreditCard className="mr-1.5 h-3.5 w-3.5" />
              Provider
            </TabsTrigger>
            <TabsTrigger value="flags">
              <Flag className="mr-1.5 h-3.5 w-3.5" />
              Flags
            </TabsTrigger>
            <TabsTrigger value="status">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Status
            </TabsTrigger>
            <TabsTrigger value="auditoria">
              <FileClock className="mr-1.5 h-3.5 w-3.5" />
              Auditoria
            </TabsTrigger>
            <TabsTrigger value="legal">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Termos / Privacidade
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="usuarios">
            <UsersTab />
          </TabsContent>
          <TabsContent value="planos">
            <PlansTab />
          </TabsContent>
          <TabsContent value="sistema">
            <SystemTab />
          </TabsContent>
          <TabsContent value="emails">
            <EmailsTab />
          </TabsContent>
          <TabsContent value="broadcasts">
            <BroadcastsTab />
          </TabsContent>
          <TabsContent value="webhooks">
            <WebhooksTab />
          </TabsContent>
          <TabsContent value="provider">
            <ProviderTab />
          </TabsContent>
          <TabsContent value="flags">
            <FlagsTab />
          </TabsContent>
          <TabsContent value="status">
            <StatusTab />
          </TabsContent>
          <TabsContent value="auditoria">
            <AuditTab />
          </TabsContent>
          <TabsContent value="legal">
            <LegalTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
