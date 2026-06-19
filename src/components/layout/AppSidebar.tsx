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

import {
  LogOut,
  Building2,
  Factory,
  Store,
  Briefcase,
  Save,
  FolderOpen,
  Calculator,
} from "lucide-react";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";

import { NAV_ITEMS } from "./nav-config";
import { useFinance } from "@/engines/finance/AppStateContext";
import { TabKey } from "@/engines/finance/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { getRamoLabel } from "@/engines/finance/companyProfile";

import { cn } from "@/lib/utils";

interface AppSidebarProps {
  activeTab: TabKey | "ai" | "calculadoras";
  setActiveTab: (tab: TabKey | "ai" | "calculadoras") => void;
  onSave: () => void;
  onOpen: () => void;
  currentFileName: string | null;
  dirty: boolean;
}

export function AppSidebar({
  activeTab,
  setActiveTab,
  onSave,
  onOpen,
  currentFileName,
  dirty,
}: AppSidebarProps) {
  const { state } = useFinance();
  const { user, logout } = useAuth();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    const handleClose = () => setOpenMobile(false);
    document.addEventListener("close-mobile-sidebar", handleClose);
    return () => document.removeEventListener("close-mobile-sidebar", handleClose);
  }, [setOpenMobile]);

  const businessIcon =
    state.businessType === "industria" ? (
      <Factory className="h-4 w-4" />
    ) : state.businessType === "comercio" ? (
      <Store className="h-4 w-4" />
    ) : (
      <Briefcase className="h-4 w-4" />
    );

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border/50 py-4">
        <div className="flex items-center gap-3 px-2">
          <img
            src={logoAsset.url}
            alt="FinnancePRO"
            className="h-8 w-8 shrink-0 rounded-md object-contain"
          />
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold leading-none tracking-tight">
              FINNANCE<span className="text-primary">PRO</span>
            </span>
            <span className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground/80 truncate">
              Auditoria & Gestão
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarMenu className="gap-0.5">
            {NAV_ITEMS.map((item) => (
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
            ))}
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

        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
          <div className="space-y-3 px-2 py-2">
            {/* Cartão resumo da empresa — clique abre o dialog de configuração. */}
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="group/card flex w-full items-start gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
              title="Configurar empresa"
            >
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">
                    {state.companyName || "Empresa não configurada"}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {businessIcon}
                  <span className="truncate">
                    {state.ramoAtuacao
                      ? getRamoLabel(state.businessType, state.ramoAtuacao)
                      : state.businessType}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {state.numColaboradores ?? 0} colab. ·{" "}
                  {state.tax.regime === "simples"
                    ? "Simples"
                    : state.tax.regime === "presumido"
                      ? "Presumido"
                      : "Real"}
                </div>
              </div>
              <Settings className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100" />
            </button>

            <div className="mt-2 space-y-1.5 border-t border-sidebar-border/50 pt-3">
              {currentFileName && (
                <div
                  className="px-1 pb-1 text-[10px] text-muted-foreground truncate"
                  title={currentFileName}
                >
                  {dirty && <span className="text-amber-500">● </span>}
                  {currentFileName}
                </div>
              )}
              <Button
                size="sm"
                variant="default"
                onClick={onSave}
                className="h-8 w-full justify-start"
                data-meeting-hide="true"
                title="Salvar arquivo .finnance (Ctrl+S)"
              >
                <Save className="h-3.5 w-3.5 mr-2" />
                <span>Salvar{dirty ? " ●" : ""}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onOpen}
                className="h-8 w-full justify-start"
                data-meeting-hide="true"
                title="Abrir arquivo .finnance (Ctrl+O)"
              >
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                <span>Abrir</span>
              </Button>
            </div>
          </div>
        </SidebarGroup>
      </SidebarContent>

      {/* Dialog de configuração centralizada da empresa. */}
      <CompanyConfigDialog open={configOpen} onOpenChange={setConfigOpen} />

      <SidebarFooter className="border-t border-sidebar-border/50 p-2">
        <SidebarMenu>
          {user && (
            <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
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
            </div>
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
    </Sidebar>
  );
}
