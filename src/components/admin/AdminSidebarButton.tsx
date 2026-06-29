// ============================================================================
// Botão "Administração" da sidebar — visível APENAS para o admin.
// Renderiza acima do "Salvar / Compartilhar". Usa SidebarMenuButton para
// que, no modo colapsado (icon-only), o ícone permaneça visível com tooltip.
// ============================================================================

import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export function AdminSidebarButton() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip="Administração"
        className="h-8 border border-amber-500/40 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
      >
        <Link to="/admin" data-meeting-hide="true">
          <ShieldCheck className="h-4 w-4" />
          <span>Administração</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
