// Tipos do snapshot read-only compartilhado com o cliente.
// O snapshot é gerado UMA vez no momento do clique em "Compartilhar"
// e fica congelado no storage — a página pública nunca recalcula a partir
// de inputs editáveis (que não existem nela).
import type { Indicators } from "@/engines/finance/indicators";
import type { Diagnostic } from "@/engines/finance/diagnose";

export const SHARE_SNAPSHOT_VERSION = 1;

export interface ShareSnapshot {
  version: number;
  shareId: string;
  companyName: string;
  ramoAtuacao?: string;
  businessType?: string;
  regime?: string;
  generatedAt: number;
  fiscalYear?: number;

  // Séries mensais (12 posições) — a página compartilhada aplica
  // aggregateByPeriod() no client.
  dre: {
    receitaBruta: number[];
    receitaLiquida: number[];
    impostosVendas: number[];
    cpv: number[];
    lucroBruto: number[];
    custosFixos: number[];
    custosVariaveis: number[];
    custosOperacionaisTotal: number[];
    despesasOperacionais: number[];
    ebitda: number[];
    depreciacao: number[];
    ebit: number[];
    resultadoFinanceiro: number[];
    custosFinanceirosTotal: number[];
    lair: number[];
    impostos: number[];
    lucroLiquido: number[];
  };
  cashflow: {
    saldoInicial: number[];
    saldoFinal: number[];
    fluxoOperacional: number[];
    fluxoInvestimento: number[];
    fluxoFinanciamento: number[];
    variacaoCaixa: number[];
    limiarAlerta: number;
  };
  indicators: Indicators;
  diagnostics: Diagnostic[];
}
