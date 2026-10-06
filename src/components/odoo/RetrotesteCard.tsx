// ============================================================================
// Retroteste no cockpit: as premissas de projeção aplicadas ao ano anterior
// contra o que aconteceu de fato, com o modelo "repetir o ano anterior" ao lado.
// ============================================================================
import { useMemo } from "react";
import { History } from "lucide-react";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { DEFAULT_FORECAST_CFG } from "@/engines/finance/forecast";
import { fmtBRL, fmtNum } from "@/engines/finance/format";
import { backtest } from "@/engines/odoo/backtest";
import { useOdooCockpitContext } from "./cockpit";
import { cn } from "@/lib/utils";

const ym = (m: string) => {
  const [y, mm] = m.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mm) - 1]}/${y.slice(2)}`;
};

export function RetrotesteCard() {
  const state = useFinanceState();
  const cockpit = useOdooCockpitContext();
  const r = useMemo(() => {
    if (!cockpit?.snapshot || !cockpit.entity || !cockpit.entityReady) return null;
    try {
      return backtest(
        cockpit.snapshot,
        cockpit.entity,
        state,
        DEFAULT_FORECAST_CFG,
        cockpit.endMonth,
      );
    } catch {
      return null;
    }
    // O estado entra só pelas premissas (regime, setor, anexo); o realizado vem
    // do retrato. Trocar o regime refaz o retroteste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cockpit?.snapshot,
    cockpit?.entity,
    cockpit?.entityReady,
    cockpit?.endMonth,
    state.tax.regime,
    state.tax.simplesAnexo,
    state.businessType,
  ]);
  if (!r) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-card" aria-label="Retroteste">
      <header className="border-b border-border/60 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" /> Retroteste da projeção
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {r.disponivel
            ? `Premissas de projeção aplicadas a ${ym(r.base.inicio)}–${ym(r.base.fim)} contra o realizado de ${ym(r.teste.inicio)}–${ym(r.teste.fim)}.`
            : r.motivo}
        </p>
      </header>
      {r.disponivel && (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="py-1.5 text-left font-medium">Métrica (12 meses)</th>
                <th className="py-1.5 text-right font-medium">Previsto</th>
                <th className="py-1.5 text-right font-medium">Realizado</th>
                <th className="py-1.5 text-right font-medium">Erro</th>
              </tr>
            </thead>
            <tbody>
              {r.metricas.map((m) => (
                <tr key={m.metrica} className="border-b border-border/20">
                  <td className="py-1.5">{m.metrica}</td>
                  <td className="num py-1.5 text-right">{fmtBRL(m.previsto)}</td>
                  <td className="num py-1.5 text-right">{fmtBRL(m.realizado)}</td>
                  <td
                    className={cn(
                      "num py-1.5 text-right",
                      m.erroPct !== null &&
                        Math.abs(m.erroPct) > 10 &&
                        "font-semibold text-warning",
                    )}
                  >
                    {m.erroPct === null
                      ? "—"
                      : `${m.erroPct > 0 ? "+" : ""}${fmtNum(m.erroPct, 1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
              <span>Erro médio mensal da receita — premissas</span>
              <span className="num font-semibold">{fmtNum(r.mapeReceita, 1)}%</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
              <span>Erro médio mensal — repetir o ano anterior</span>
              <span className="num">{fmtNum(r.mapeIngenuo, 1)}%</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {r.mapeReceita <= r.mapeIngenuo
                ? "As premissas acertaram mais que simplesmente repetir o ano anterior."
                : "Repetir o ano anterior teria acertado mais: revise crescimento e sazonalidade na Análise."}{" "}
              Meta de qualidade: erro médio da receita abaixo de 10%.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
