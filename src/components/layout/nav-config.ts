import { 
  LayoutDashboard, 
  Receipt, 
  PiggyBank, 
  Gavel, 
  Wallet, 
  ShieldCheck, 
  FileSpreadsheet, 
  Search, 
  Wand2, 
  Presentation,
  Bot
} from "lucide-react";
import { TabKey } from "@/lib/finance/types";

export type NavItem = {
  title: string;
  icon: any;
  value: TabKey | "ai";
};

export const NAV_ITEMS: NavItem[] = [
  { title: "DRE", icon: FileSpreadsheet, value: "dre" },
  { title: "Receitas", icon: Receipt, value: "receitas" },
  { title: "Despesas", icon: PiggyBank, value: "custos" },
  { title: "Capital", icon: Wallet, value: "capital" },
  { title: "Regime Tributário", icon: Gavel, value: "tributos" },
  { title: "Governança", icon: ShieldCheck, value: "governanca" },
  { title: "Fluxo de Caixa", icon: Presentation, value: "caixa" },
  { title: "Diagnóstico", icon: Search, value: "resultados" },
  { title: "Simulador", icon: Wand2, value: "simulador" },
  { title: "Valuation", icon: LayoutDashboard, value: "valuation" },
  { title: "Consultor IA", icon: Bot, value: "ai" },
];
