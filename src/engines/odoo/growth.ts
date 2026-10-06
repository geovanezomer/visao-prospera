// ============================================================================
// Crescimento observado no Odoo: receita dos últimos 12 meses contra os 12
// anteriores, convertida em taxa mensal equivalente — a sugestão inicial da
// premissa de crescimento da projeção (editável pelo usuário).
// ============================================================================
import { buildEntityData, type OdooEntity } from "./toAppState";
import type { OdooSnapshot } from "./types";

export type CrescimentoObservado =
  | { disponivel: false; motivo: string }
  | {
      disponivel: true;
      /** (1 + variação anual)^(1/12) − 1, em % a.m. (2 casas). */
      pctMensal: number;
      /** Receita 12m ÷ receita dos 12m anteriores − 1, em %. */
      variacaoAnualPct: number;
      receita12m: number;
      receita12mAnterior: number;
      janela: { inicio: string; fim: string };
    };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function crescimentoObservado(
  snapshot: OdooSnapshot,
  entity: OdooEntity,
  endMonth?: string | null,
): CrescimentoObservado {
  const atual = buildEntityData(snapshot, entity, endMonth);
  const fim = snapshot.months.indexOf(atual.months[atual.months.length - 1]);
  if (atual.months.length < 12 || fim - 23 < 0)
    return { disponivel: false, motivo: "São necessários 24 meses de histórico no Odoo." };
  const anterior = buildEntityData(snapshot, entity, snapshot.months[fim - 12]);
  const r12 = sum(atual.actuals.pl.receita_bruta);
  const r12ant = sum(anterior.actuals.pl.receita_bruta);
  if (r12 <= 0 || r12ant <= 0)
    return { disponivel: false, motivo: "Sem receita em um dos dois períodos de 12 meses." };
  const anual = r12 / r12ant;
  return {
    disponivel: true,
    pctMensal: r2((Math.pow(anual, 1 / 12) - 1) * 100),
    variacaoAnualPct: r2((anual - 1) * 100),
    receita12m: r12,
    receita12mAnterior: r12ant,
    janela: { inicio: anterior.months[0], fim: atual.months[atual.months.length - 1] },
  };
}
