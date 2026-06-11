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


import { Activity, LogOut, Building2, Factory, Store, Briefcase, ChevronDown } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";
import { TabKey, BusinessType } from "@/lib/finance/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";


interface AppSidebarProps {
  activeTab: TabKey | "ai";
  setActiveTab: (tab: TabKey | "ai") => void;
  state: any;
  update: any;
}

export function AppSidebar({ activeTab, setActiveTab, state, update }: AppSidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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

  const groups = ["Entradas", "Configurações", "Análises", "Estratégia"] as const;

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
        <Accordion type="multiple" defaultValue={[...groups]} className="w-full border-none">
          {groups.map((group) => (
            <AccordionItem key={group} value={group} className="border-none px-2">
              <AccordionTrigger className="py-2 hover:no-underline group-data-[collapsible=icon]:hidden">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <SidebarMenu>
                  {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
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
              </AccordionContent>
              
              {/* Fallback para quando o sidebar está colapsado (ícone apenas) */}
              <div className="hidden group-data-[collapsible=icon]:block space-y-1">
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                  <SidebarMenuItem key={item.value} className="list-none">
                    <SidebarMenuButton
                      isActive={activeTab === item.value}
                      onClick={() => setActiveTab(item.value)}
                      tooltip={item.title}
                    >
                      <item.icon className="h-4 w-4" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </div>
            </AccordionItem>
          ))}
        </Accordion>


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
          </div>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/50 p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton 
              className="w-full justify-start gap-3"
              onClick={async () => { 
                await logout(); 
                navigate({ to: "/login" }); 
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
