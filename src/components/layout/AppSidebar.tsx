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
import { useEffect } from "react";


import { Activity, LogOut, Building2, Factory, Store, Briefcase, Users, Save, FolderOpen } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";
import { TabKey, BusinessType, AppState } from "@/lib/finance/types";
import { useAuth } from "@/lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TaxSettingsDialog } from "@/components/sim/TaxSettingsDialog";
import { cn } from "@/lib/utils";


interface AppSidebarProps {
  activeTab: TabKey | "ai";
  setActiveTab: (tab: TabKey | "ai") => void;
  state: AppState;
  update: (patch: Partial<AppState> | ((s: AppState) => AppState)) => void;
  onSave: () => void;
  onOpen: () => void;
  currentFileName: string | null;
  dirty: boolean;
}

export function AppSidebar({ activeTab, setActiveTab, state, update, onSave, onOpen, currentFileName, dirty }: AppSidebarProps) {
  const { user, logout } = useAuth();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    const handleClose = () => setOpenMobile(false);
    document.addEventListener('close-mobile-sidebar', handleClose);
    return () => document.removeEventListener('close-mobile-sidebar', handleClose);
  }, [setOpenMobile]);


  const businessIcon = 
    state.businessType === "industria" ? <Factory className="h-4 w-4" /> : 
    state.businessType === "comercio" ? <Store className="h-4 w-4" /> : 
    <Briefcase className="h-4 w-4" />;


  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border/50 py-4">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold leading-none tracking-tight">
              GZ FINNANCE<span className="text-primary">PRO</span>
            </span>
            <span className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground/80 truncate">Auditoria & Gestão</span>
          </div>

        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarMenu>
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
                    "transition-colors",
                    activeTab === item.value 
                      ? "bg-primary/10 text-primary font-medium" 
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>


        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">Configurações Rápidas</SidebarGroupLabel>
          <div className="space-y-3 px-2 py-2">
            <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2 py-1.5">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={state.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder="Empresa"
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2 py-0.5">
              {businessIcon}
              <Select value={state.businessType} onValueChange={(v) => update({ businessType: v as BusinessType })}>
                <SelectTrigger className="h-7 border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="servicos">Serviços</SelectItem>
                  <SelectItem value="comercio">Comércio</SelectItem>
                  <SelectItem value="industria">Indústria</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2 py-1.5">
              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                type="number"
                min={0}
                value={state.numColaboradores ?? 0}
                onChange={(e) => update({ numColaboradores: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder="Nº de colaboradores"
              />
              <span className="text-[10px] text-muted-foreground shrink-0">colab.</span>
            </div>

            <div className="mt-2 space-y-1.5 border-t border-sidebar-border/50 pt-3">
              {currentFileName && (
                <div className="px-1 pb-1 text-[10px] text-muted-foreground truncate" title={currentFileName}>
                  {dirty && <span className="text-amber-500">● </span>}
                  {currentFileName}
                </div>
              )}
              <Button size="sm" variant="default" onClick={onSave} className="h-8 w-full justify-start" data-meeting-hide="true" title="Salvar arquivo .finnance (Ctrl+S)">
                <Save className="h-3.5 w-3.5 mr-2" />
                <span>Salvar{dirty ? " ●" : ""}</span>
              </Button>
              <Button size="sm" variant="outline" onClick={onOpen} className="h-8 w-full justify-start" data-meeting-hide="true" title="Abrir arquivo .finnance (Ctrl+O)">
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                <span>Abrir</span>
              </Button>
            </div>
          </div>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/50 p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton 
              className="w-full justify-start gap-3"
              onClick={() => { 
                logout(); 
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="group-data-[collapsible=icon]:hidden">Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {user && (
            <div className="mt-2 flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden border-t border-sidebar-border/30 pt-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {user.displayName?.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-xs font-semibold leading-none">{user.displayName}</span>
                <span className="mt-1 truncate text-[10px] text-muted-foreground leading-none">{user.email}</span>
              </div>
            </div>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
