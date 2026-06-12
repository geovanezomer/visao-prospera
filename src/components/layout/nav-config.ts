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
  { title: "DRE", icon: FileSpreadsheet, value: "dre", group: "Análises" },
  { title: "Receitas", icon: Receipt, value: "receitas", group: "Entradas" },
  { title: "Custos e Despesas", icon: PiggyBank, value: "custos", group: "Entradas" },
  { title: "Capital", icon: Wallet, value: "capital", group: "Entradas" },
  { title: "Regime Tributário", icon: Gavel, value: "tributos", group: "Configurações" },
  { title: "Governança", icon: ShieldCheck, value: "governanca", group: "Configurações" },
  { title: "Fluxo de Caixa", icon: Presentation, value: "caixa", group: "Análises" },
  { title: "Diagnóstico", icon: Search, value: "resultados", group: "Análises" },
  { title: "Simulador", icon: Wand2, value: "simulador", group: "Estratégia" },
  { title: "Valuation", icon: LayoutDashboard, value: "valuation", group: "Estratégia" },
  { title: "Consultor IA", icon: Bot, value: "ai", group: "Estratégia" },
];
