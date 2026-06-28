/**
 * ProlaboreTab — página dedicada ao card Pró-labore × Distribuição de Lucros.
 * Inclui 4 cards de KPI no topo, no mesmo padrão da página Fluxo de Caixa.
 */
import { useEffect, useMemo } from "react";
import { SociosCard } from "./SociosCard";
import { SectionTitle, StatCard } from "@/components/sim/shared/primitives";
import { useFinance, usePatchCashflow, useFinanceReadOnly } from "@/engines/finance/AppStateContext";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { buildDRE } from "@/engines/finance/dre";
import { syncSociosToCosts } from "@/engines/finance/socios";
import { fmtBRL, MESES } from "@/engines/finance/format";
import { NonOpTable } from "@/components/sim/cashflow/NonOpTable";
import { NonOpKey } from "@/components/sim/cashflow/tableHelpers";

export function ProlaboreTab() {
  const { state } = useFinance();
  const patchCashflow = usePatchCashflow();
  const readOnly = useFinanceReadOnly();
  const regime = resolveEffectiveRegime(state);

  const setNonOp = (key: NonOpKey, monthIdx: number, value: number) =>
    patchCashflow((cur) => ({
      [key]: cur[key].map((v, i) => (i === monthIdx ? value : v)),
    }));

  const setNonOpAll = (key: NonOpKey, v: number) =>
    patchCashflow({ [key]: MESES.map(() => v) });


  const payoutPct = state.payoutPolicyPct ?? 100;
  const reservaMin = state.reservaMinimaMensal ?? 0;

  const { lucroBruto, disponivel, reserva, payoutRS } = useMemo(() => {
    try {
      // Lucro Bruto = Lucro Líquido projetado SEM o impacto dos sócios
      // (para refletir o "bolo" disponível antes da política de retiradas).
      const semSocios = syncSociosToCosts({ ...state, socios: [] }, regime);
      const { dre } = buildDRE(semSocios, regime);
      const lucroAno = dre.lucroLiquido.reduce((a, b) => a + b, 0);
      const bruto = Math.max(0, lucroAno / 12);
      const aposReserva = Math.max(0, bruto - reservaMin);
      const disp = (aposReserva * payoutPct) / 100;
      return {
        lucroBruto: bruto,
        disponivel: disp,
        reserva: Math.min(reservaMin, bruto),
        payoutRS: disp,
      };
    } catch {
      return { lucroBruto: 0, disponivel: 0, reserva: 0, payoutRS: 0 };
    }
  }, [state, regime, payoutPct, reservaMin]);

  // SSOT: Distribuição de dividendos no Fluxo de Caixa vem EXCLUSIVAMENTE
  // do cálculo de Pró-labore × Distribuição de Lucros (payout mensal).
  useEffect(() => {
    if (readOnly) return;
    const atual = state.cashflow.dividendos;
    const alvo = MESES.map(() => payoutRS);
    const igual = atual.length === 12 && atual.every((v, i) => Math.abs(v - alvo[i]) < 0.01);
    if (!igual) patchCashflow({ dividendos: alvo as typeof atual });
  }, [payoutRS, readOnly, state.cashflow.dividendos, patchCashflow]);

  const pct = (v: number) =>
    lucroBruto > 0 ? `${((v / lucroBruto) * 100).toFixed(1)}% do Lucro Bruto` : "—";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Lucro Bruto (mensal)"
          value={fmtBRL(lucroBruto)}
          tone={lucroBruto >= 0 ? "pos" : "neg"}
          sub="Base de cálculo"
          hint={{
            description:
              "Lucro Líquido mensal projetado pela DRE, desconsiderando o impacto dos sócios (pró-labore e distribuição). É o 'bolo' total disponível antes da política de retiradas.",
            formula: "Lucro Bruto = (Σ Lucro Líquido DRE sem sócios) ÷ 12",
            calc: `= ${fmtBRL(lucroBruto)} / mês`,
          }}
        />
        <StatCard
          label="Disponível para Distribuição"
          value={fmtBRL(disponivel)}
          tone="pos"
          sub={pct(disponivel)}
          hint={{
            description:
              "Valor mensal que pode ser distribuído aos sócios, já descontada a Reserva de Capital mínima e aplicada a política de Payout configurada na empresa.",
            formula: "Disponível = (Lucro Bruto − Reserva) × Payout%",
            calc: `(${fmtBRL(lucroBruto)} − ${fmtBRL(reservaMin)}) × ${payoutPct}%\n= ${fmtBRL(disponivel)}`,
          }}
        />
        <StatCard
          label="Reserva de Capital"
          value={fmtBRL(reserva)}
          tone="warn"
          sub={pct(reserva)}
          hint={{
            description:
              "Parcela mensal retida na empresa para reinvestimento, capital de giro ou colchão de segurança. Configurável em Configurações → Empresa → Reserva Mínima Mensal.",
            formula: "Reserva = min(Reserva Mínima Mensal, Lucro Bruto)",
            calc: `min(${fmtBRL(reservaMin)}, ${fmtBRL(lucroBruto)})\n= ${fmtBRL(reserva)}`,
          }}
        />
        <StatCard
          label={`Payout (${payoutPct}%)`}
          value={fmtBRL(payoutRS)}
          tone="default"
          sub={pct(payoutRS)}
          hint={{
            description:
              "Valor em reais correspondente à política de Payout aplicada sobre o lucro após reserva. Configurável em Configurações → Empresa → Payout %.",
            formula: "Payout R$ = (Lucro Bruto − Reserva) × Payout%",
            calc: `(${fmtBRL(lucroBruto)} − ${fmtBRL(reserva)}) × ${payoutPct}%\n= ${fmtBRL(payoutRS)}`,
          }}
        />
      </div>
      <SociosCard />

      {/* Movimentações de caixa não operacionais — movido da aba Fluxo de Caixa */}
      {!readOnly && (
        <div className="rounded-lg border border-border/60 border-l-4 border-l-[color:var(--primary)] bg-card/40">
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <SectionTitle hint="Apenas itens SEM fonte em outra aba. CapEx é cadastrado exclusivamente em Capital → Investimentos em equipamentos e ativo. Amortização do principal e juros vêm de Capital → Contratos de Dívida.">
              Movimentações de caixa não operacionais — 12 meses
            </SectionTitle>
          </div>
          <NonOpTable
            rows={[
              {
                key: "aportes",
                label: "Aportes de sócios",
                hint: "Entrada de capital próprio dos sócios na empresa.",
                tone: "pos",
                values: state.cashflow.aportes,
              },
              {
                key: "dividendos",
                label: "Distribuição de dividendos",
                hint: "Saída de caixa para distribuir lucros aos sócios.",
                tone: "neg",
                values: state.cashflow.dividendos,
              },
            ]}
            onMonth={setNonOp}
            onAllMonths={setNonOpAll}
          />
        </div>
      )}

    </div>
  );
}
