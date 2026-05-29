import { AppState, CostLine } from "./types";
import { fill12 } from "./format";

const baseRevenue = [13000, 14000, 15500, 15000, 16000, 17000, 15500, 14500, 16000, 17500, 18500, 21000];

const cost = (id: string, label: string, value: number, group: "operacional" | "financeiro" = "operacional", variavel = false): CostLine => ({
  id,
  label,
  group,
  values: fill12(value),
  fixed: true,
  variavel,
});

export const DEFAULT_STATE: AppState = {
  businessType: "servicos",
  companyName: "Minha Empresa LTDA",
  revenue: {
    bruta: baseRevenue,
    inadimplencia: fill12(5),
    pmr: 30,
    pmp: 30,
  },
  costs: [
    cost("aluguel", "Aluguel", 2500),
    cost("salarios", "Salários e encargos (CLT)", 4500),
    cost("prolabore", "Pró-labore (sócios)", 3000),
    cost("contabilidade", "Contabilidade", 450),
    cost("marketing", "Marketing e publicidade", 800, "operacional", true),
    cost("tecnologia", "Tecnologia / Software", 350),
    cost("utilities", "Energia, água, internet", 600),
    cost("manutencao", "Manutenção e reparos", 200),
    cost("insumos", "Materiais e insumos", 500, "operacional", true),
    cost("fretes", "Fretes e logística", 150, "operacional", true),
    cost("outros_op", "Outros custos operacionais", 250),
    cost("juros", "Juros sobre empréstimos", 300, "financeiro"),
    cost("iof", "IOF / Tarifas bancárias", 120, "financeiro"),
    cost("antecipacao", "Antecipação de recebíveis", 0, "financeiro"),
    cost("outros_fin", "Outros custos financeiros", 0, "financeiro"),
  ],
  capital: {
    proprio: 60,
    ke: 15,
    kd: 18,
    capitalGiroDisponivel: 15000,
    depreciacaoMensal: 400,
    jurosRecebidosMensal: 50,
    patrimonioLiquido: 60000,
    ativoTotal: 100000,
    estoques: 5000,
    disponibilidades: 18000,
  },
  tax: {
    regime: "simples",
    simplesAnexo: "III",
    fatorR: 30,
    presumidoBaseIRPJ: 32,
    presumidoBaseCSLL: 32,
    issIcms: 5,
    pisCreditos: 0,
    cofinsCreditos: 0,
  },
  guided: false,
};
