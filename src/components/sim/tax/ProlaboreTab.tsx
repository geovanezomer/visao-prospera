/**
 * ProlaboreTab — página dedicada ao card Pró-labore × Distribuição de Lucros.
 * Inclui 4 cards de KPI no topo, no mesmo padrão da página Fluxo de Caixa.
 */
import { useMemo } from "react";
import { SociosCard } from "./SociosCard";

import { StatCard } from "@/components/sim/shared/primitives";
import { useFinance } from "@/engines/finance/AppStateContext";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { buildDRE } from "@/engines/finance/dre";
import { syncSociosToCosts } from "@/engines/finance/socios";
import { fmtBRL } from "@/engines/finance/format";

export function ProlaboreTab() {
  const { state } = useFinance();

  const regime = resolveEffectiveRegime(state);

  const payoutPct = state.payoutPolicyPct ?? 100;
  const reservaMin = state.reservaMinimaMensal ?? 0;

  const { lucroBruto, disponivel, reserva, payoutRS } = useMemo(() => {
    try {
      // Lucro Bruto = Lucro Líquido projetado SEM o impacto dos sócios
      // (para refletir o "bolo" disponível antes da política de retiradas).
      const semSocios = syncSociosToCosts({ ...state, socios: [] }, regime);
      const { dre } = buildDRE(semSocios, regime);
      const lucroAno = dre.lucroLiquido.reduce((a, b) => a + b, 0);
      // Preserva o sinal — prejuízo precisa aparecer como negativo na UI,
      // não zerado (bug pré-existente que escondia cenários deficitários).
      const bruto = lucroAno / 12;
      const brutoPos = Math.max(0, bruto);
      const aposReserva = Math.max(0, brutoPos - reservaMin);
      const disp = (aposReserva * payoutPct) / 100;
      return {
        lucroBruto: bruto,
        disponivel: disp,
        reserva: Math.min(reservaMin, brutoPos),
        payoutRS: disp,
      };
    } catch {
      return { lucroBruto: 0, disponivel: 0, reserva: 0, payoutRS: 0 };
    }
  }, [state, regime, payoutPct, reservaMin]);

  // [SSOT] Não há mais sincronização manual `distribuicaoRealizada → cashflow.dividendos`.
  // O `buildCashFlow` deriva dividendos direto de `state.distribuicaoRealizada`.




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

      {/* Empréstimos PJ→PF (mútuo ativo a sócios) foram movidos para a aba Receitas
          — os juros do mútuo são receita financeira e o cadastro vive lá. */}

      {/* Mútuos PF→PJ (sócio empresta para a empresa / AFAC) foram
          unificados no card "O que a empresa deve" da aba Capital,
          selecionando "Sócio (mútuo PF→PJ / AFAC)" como tipo de credor. */}
      {/* PermutasCard movido para o topo da aba Fluxo de Caixa. */}


    </div>
  );
}
