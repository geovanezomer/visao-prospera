import {
  LayoutDashboard,
  Receipt,
  ReceiptText,
  Gavel,
  Wallet,
  ShieldCheck,
  FileSpreadsheet,
  Search,
  Wand2,
  BarChart3,
  Bot,
  Activity,
  Landmark,
  Scale,
  Users,
} from "lucide-react";
import { TabKey } from "@/engines/finance/types";

import type { LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  icon: LucideIcon;
  value: TabKey | "ai";
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, value: "dashboard" },
  // Lançar (na ordem do guia de primeiros passos)
  { title: "Regime Tributário", icon: Gavel, value: "tributos" },
  { title: "Receitas", icon: Receipt, value: "receitas" },
  { title: "Despesas", icon: ReceiptText, value: "custos" },
  { title: "Pró-labore", icon: Users, value: "prolabore" },
  { title: "Capital", icon: Wallet, value: "capital" },
  // Ler os resultados
  { title: "DRE", icon: FileSpreadsheet, value: "dre" },
  { title: "Fluxo de Caixa", icon: BarChart3, value: "caixa" },
  { title: "Balanço", icon: Scale, value: "balanco" },
  { title: "Indicadores", icon: Activity, value: "indicadores" },
  { title: "Diagnóstico", icon: Search, value: "resultados" },
  // Decidir
  { title: "Simulador", icon: Wand2, value: "simulador" },
  { title: "Valuation", icon: Landmark, value: "valuation" },
  { title: "Governança", icon: ShieldCheck, value: "governanca" },
  { title: "Consultor IA", icon: Bot, value: "ai" },
];
