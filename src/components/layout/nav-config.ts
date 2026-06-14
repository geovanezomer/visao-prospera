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
  Activity
} from "lucide-react";
import { TabKey } from "@/lib/finance/types";

export type NavItem = {
  title: string;
  icon: any;
  value: TabKey | "ai";
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Receitas", icon: Receipt, value: "receitas" },
  { title: "Despesas", icon: ReceiptText, value: "custos" },
  { title: "Capital", icon: Wallet, value: "capital" },
  { title: "Fluxo de Caixa", icon: BarChart3, value: "caixa" },
  { title: "Regime Tributário", icon: Gavel, value: "tributos" },
  { title: "Indicadores", icon: Activity, value: "indicadores" },
  { title: "DRE", icon: FileSpreadsheet, value: "dre" },
  { title: "Governança", icon: ShieldCheck, value: "governanca" },
  { title: "Diagnóstico", icon: Search, value: "resultados" },
  { title: "Simulador", icon: Wand2, value: "simulador" },
  { title: "Valuation", icon: LayoutDashboard, value: "valuation" },
  { title: "Consultor IA", icon: Bot, value: "ai" },
];
