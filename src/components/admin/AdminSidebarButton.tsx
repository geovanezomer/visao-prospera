// ============================================================================
// Botão "Administração" da sidebar — visível APENAS para o admin.
// Renderiza acima do "Salvar / Compartilhar".
// ============================================================================

import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export function AdminSidebarButton() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) return null;

  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="h-8 w-full justify-start border-amber-500/40 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
      data-meeting-hide="true"
      title="Painel administrativo — gerenciar usuários e assinaturas"
    >
      <Link to="/admin">
        <ShieldCheck className="h-3.5 w-3.5 mr-2" />
        <span>Administração</span>
      </Link>
    </Button>
  );
}
