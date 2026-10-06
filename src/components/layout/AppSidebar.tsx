import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";

import { LogOut, Share2, FolderOpen, Calculator, KeyRound, Network, Gauge } from "lucide-react";
import { logoAsset } from "@/lib/brandAssets";
import { BrandedLogo } from "@/components/BrandedLogo";
import { useBranding } from "@/hooks/useBranding";

import { NAV_ITEMS } from "./nav-config";
import { TabKey } from "@/engines/finance/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AdminSidebarButton } from "@/components/admin/AdminSidebarButton";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";

import { cn } from "@/lib/utils";

type SidebarTab = TabKey | "ai" | "calculadoras" | "consolidado" | "cockpit";

interface AppSidebarProps {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  /** Modo Odoo: mostra o atalho para o consolidado do grupo. */
  showConsolidado?: boolean;
  /** Salvar/abrir arquivo .finnance (oculto no modo Odoo). */
  fileActions?: boolean;
  onSave: () => void;
  onOpenRestore: () => void;
  currentFileName: string | null;
  dirty: boolean;
}

export function AppSidebar({
  activeTab,
  setActiveTab,
  onSave,
  onOpenRestore,
  currentFileName,
  dirty,
  showConsolidado = false,
  fileActions = true,
}: AppSidebarProps) {
  const { user, logout } = useAuth();
  const { setOpenMobile } = useSidebar();
  const { branding, isReady } = useBranding();
  const [changePwdOpen, setChangePwdOpen] = useState(false);

  useEffect(() => {
    const handleClose = () => setOpenMobile(false);
    document.addEventListener("close-mobile-sidebar", handleClose);
    return () => document.removeEventListener("close-mobile-sidebar", handleClose);
  }, [setOpenMobile]);

  // (Removido) Alerta "Dados salvos no navegador" — irrelevante após backup em nuvem.

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border/50 py-4">
        <div className="flex items-center gap-3 px-2">
          {isReady ? (
            <BrandedLogo
              src={branding.logoUrl ?? logoAsset.url}
              alt={branding.systemName}
              recolor={branding.recolorLogo}
              className="h-8 w-8 shrink-0 rounded-md object-contain group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:w-6 [&>svg]:h-8 [&>svg]:w-8 group-data-[collapsible=icon]:[&>svg]:h-6 group-data-[collapsible=icon]:[&>svg]:w-6"
              imgProps={{
                className:
                  "h-8 w-8 shrink-0 rounded-md object-contain group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:w-6",
              }}
            />
          ) : (
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-sidebar-accent group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:w-6" />
          )}
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            {isReady ? (
              <>
                <span className="truncate text-base font-bold leading-none tracking-tight">
                  {branding.systemName}
                </span>
                <span className="mt-1 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                  Auditoria & Gestão
                </span>
              </>
            ) : (
              <>
                <div className="h-4 w-28 animate-pulse rounded bg-sidebar-accent" />
                <div className="mt-1 h-2.5 w-20 animate-pulse rounded bg-sidebar-accent" />
              </>
            )}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarMenu className="gap-0.5">
            {showConsolidado && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "cockpit"}
                  onClick={() => {
                    setActiveTab("cockpit");
                    setOpenMobile(false);
                  }}
                  tooltip="Cockpit"
                  className={cn(
                    "h-7 transition-colors",
                    activeTab === "cockpit"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Gauge className="h-4 w-4" />
                  <span>Cockpit</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {NAV_ITEMS.filter((it) => it.value !== "ai" || user?.aiEnabled !== false).map(
              (item) => (
                <SidebarMenuItem key={item.value}>
                  <SidebarMenuButton
                    isActive={activeTab === item.value}
                    onClick={() => {
                      setActiveTab(item.value);
                      setOpenMobile(false);
                    }}
                    tooltip={item.title}
                    className={cn(
                      "h-7 transition-colors",
                      activeTab === item.value
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ),
            )}
            {showConsolidado && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === "consolidado"}
                  onClick={() => {
                    setActiveTab("consolidado");
                    setOpenMobile(false);
                  }}
                  tooltip="Consolidado & Conciliação"
                  className={cn(
                    "h-7 transition-colors",
                    activeTab === "consolidado"
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Network className="h-4 w-4" />
                  <span>Consolidado</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <li className="my-1 border-t border-sidebar-border/50" aria-hidden="true" />
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === "calculadoras"}
                onClick={() => {
                  setActiveTab("calculadoras");
                  setOpenMobile(false);
                }}
                tooltip="Calculadoras"
                className={cn(
                  "h-7 transition-colors",
                  activeTab === "calculadoras"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Calculator className="h-4 w-4" />
                <span>Calculadoras</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <li className="my-1 border-t border-sidebar-border/50" aria-hidden="true" />
              <AdminSidebarButton />
              {fileActions && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={onSave}
                      tooltip="Salvar / Compartilhar"
                      className="h-8 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                      data-meeting-hide="true"
                    >
                      <Share2 className="h-4 w-4" />
                      <span>Salvar / Compartilhar{dirty ? " ●" : ""}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={onOpenRestore}
                      tooltip="Abrir / Restaurar"
                      className="h-8 border border-sidebar-border"
                      data-meeting-hide="true"
                    >
                      <FolderOpen className="h-4 w-4" />
                      <span>Abrir / Restaurar</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/50 p-2">
        <SidebarMenu>
          {user && (
            <li className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
              <button
                type="button"
                onClick={() => logout()}
                title="Sair"
                aria-label="Sair"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-destructive/15 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-xs font-semibold leading-none">
                  {user.displayName}
                </span>
                <span className="mt-1 truncate text-[10px] text-muted-foreground leading-none">
                  {user.email}
                </span>
              </div>
            </li>
          )}
          {user && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Trocar senha"
                className="h-8 w-full justify-start gap-3 text-xs"
                onClick={() => setChangePwdOpen(true)}
              >
                <KeyRound className="h-4 w-4" />
                <span>Trocar senha</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem className="group-data-[collapsible=icon]:block hidden">
            <SidebarMenuButton
              tooltip="Sair"
              className="w-full justify-start gap-3"
              onClick={() => logout()}
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <ChangePasswordDialog open={changePwdOpen} onOpenChange={setChangePwdOpen} />
    </Sidebar>
  );
}
