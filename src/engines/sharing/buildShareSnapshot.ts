// Gera o snapshot read-only a partir do AppState atual.
// Chamado UMA VEZ no clique em "Compartilhar" — o resultado é o que
// fica congelado no link público.
import { buildFinancialModel } from "@/engines/finance/financialModel";
import { diagnose } from "@/engines/finance/diagnose";
import type { AppState } from "@/engines/finance/types";
import { type ShareSnapshot, SHARE_SNAPSHOT_VERSION } from "./types";

export function buildShareSnapshot(state: AppState, shareId: string): ShareSnapshot {
  const model = buildFinancialModel(state);
  const diagnostics = diagnose(state, model.dre, model.ind);

  return {
    version: SHARE_SNAPSHOT_VERSION,
    shareId,
    companyName: state.companyName,
    ramoAtuacao: state.ramoAtuacao,
    businessType: state.businessType,
    regime: model.regime,
    generatedAt: Date.now(),
    fiscalYear: state.fiscalYear,
    dre: {
      receitaBruta: model.dre.receitaBruta,
      receitaLiquida: model.dre.receitaLiquida,
      impostosVendas: model.dre.impostosVendas,
      cpv: model.dre.cpv,
      lucroBruto: model.dre.lucroBruto,
      custosFixos: model.dre.custosFixos,
      custosVariaveis: model.dre.custosVariaveis,
      custosOperacionaisTotal: model.dre.custosOperacionaisTotal,
      despesasOperacionais: model.dre.despesasOperacionais,
      ebitda: model.dre.ebitda,
      depreciacao: model.dre.depreciacao,
      ebit: model.dre.ebit,
      resultadoFinanceiro: model.dre.resultadoFinanceiro,
      custosFinanceirosTotal: model.dre.custosFinanceirosTotal,
      lair: model.dre.lair,
      impostos: model.dre.impostos,
      lucroLiquido: model.dre.lucroLiquido,
    },
    cashflow: {
      saldoInicial: model.cf.saldoInicial,
      saldoFinal: model.cf.saldoFinal,
      fluxoOperacional: model.cf.fluxoOperacional,
      fluxoInvestimento: model.cf.fluxoInvestimento,
      fluxoFinanciamento: model.cf.fluxoFinanciamento,
      variacaoCaixa: model.cf.variacaoCaixa,
      limiarAlerta: state.cashflow.limiarAlerta ?? -10000,
    },
    indicators: model.ind,
    diagnostics,
  };
}
