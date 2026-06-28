/**
 * SociosCard — Pró-labore × Distribuição de Lucros (somente leitura).
 *
 * Lista os sócios cadastrados em Configurações → Empresa → Sócios.
 * Aqui apenas exibimos o cálculo derivado (INSS sócio/patronal, IRPF,
 * distribuição isenta/tributável, líquido, custo PJ). Para alterar
 * Nome / Participação / Pró-labore / Dependentes / Operacional, o
 * usuário abre o lightbox de configurações.
 */
import { useMemo } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/engines/finance/AppStateContext";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { buildDRE } from "@/engines/finance/dre";
import { fmtBRL } from "@/engines/finance/format";
import {
  calcRetiradaSocio,
  syncSociosToCosts,
  calcDistribuicaoIsentaBreakdown,
} from "@/engines/finance/socios";
import { SectionTitle, HelpTip } from "@/components/sim/shared/primitives";
import { getSalarioMinimo, getIrpfTable } from "@/engines/finance/taxDefaults";
import { CompanyConfigDialog } from "@/components/sim/shared/CompanyConfigDialog";
import { useState } from "react";

const HINT = {
  description:
    "Cálculo automático a partir dos sócios cadastrados em Configurações → Empresa. Pró-labore, participação e dependentes são fixos (editáveis no cadastro). Aqui você vê INSS, IRPF e distribuição de lucros.",
  formula:
    "Líquido sócio = Pró-labore − INSS sócio − IRPF + Distribuição de Lucros\nCusto PJ = Pró-labore + INSS patronal",
  example:
    "A distribuição de lucros é proporcional à participação de cada sócio, dentro do limite isento de IRPF.",
};

export function SociosCard() {
  const { state } = useFinance();
  const regime = resolveEffectiveRegime(state);
  const socios = state.socios ?? [];
  const salarioMin = getSalarioMinimo(state.tax);
  const [configOpen, setConfigOpen] = useState(false);

  const payoutPct = state.payoutPolicyPct ?? 100;
  const reservaMin = state.reservaMinimaMensal ?? 0;

  const { lucroMensalBruto, lucroMensalDisponivel } = useMemo(() => {
    try {
      const semSocios = syncSociosToCosts({ ...state, socios: [] }, regime);
      const { dre } = buildDRE(semSocios, regime);
      const lucroAno = dre.lucroLiquido.reduce((a, b) => a + b, 0);
      const bruto = Math.max(0, lucroAno / 12);
      const aposReserva = Math.max(0, bruto - reservaMin);
      return { lucroMensalBruto: bruto, lucroMensalDisponivel: (aposReserva * payoutPct) / 100 };
    } catch {
      return { lucroMensalBruto: 0, lucroMensalDisponivel: 0 };
    }
  }, [state, regime, payoutPct, reservaMin]);

  const somaPartic = socios.reduce((a, s) => a + s.participacaoPct, 0);
  const partOk = socios.length === 0 || Math.abs(somaPartic - 100) < 0.01;

  const resultados = socios.map((s) =>
    calcRetiradaSocio(s, state, regime, (lucroMensalDisponivel * s.participacaoPct) / 100),
  );

  // Memória de cálculo do teto de distribuição isenta (Presumido sem escrituração).
  const breakdown = calcDistribuicaoIsentaBreakdown(state, regime);
  const tabela = getIrpfTable(state.tax);
  const aliqTopoPct = tabela[tabela.length - 1][1];
  const totalIsentaMes = resultados.reduce((a, r) => a + r.distribuicaoIsentaMensal, 0);
  const totalTribMes = resultados.reduce((a, r) => a + r.distribuicaoTributavelMensal, 0);

  const isentaHint = Number.isFinite(breakdown.limiteMensal)
    ? {
        description:
          "Teto MENSAL de lucros distribuíveis sem IRPF, no Presumido sem escrituração contábil completa. Calculado como Base presumida − (IRPJ 15% + CSLL 9% sobre base + PIS/COFINS sobre receita) − Adicional IRPJ 10% (sobre lucro trimestral > R$ 60k/trim, Lei 9.249/95 art. 3º §1º).",
        formula:
          "Limite mês = (Base − Tributos federais − Adicional IRPJ) ÷ 12",
        calc: [
          `Base presumida (ano) = ${fmtBRL(breakdown.basePresumida)}`,
          `Base trimestral = ${fmtBRL(breakdown.baseTri)}  (gatilho: ${fmtBRL(breakdown.gatilhoTri)})`,
          `Tributos federais (ano) = ${fmtBRL(breakdown.tributosFed)}`,
          `Adicional IRPJ 10% (ano) = ${fmtBRL(breakdown.adicionalIrpjAno)}`,
          `→ Limite mensal isento = ${fmtBRL(breakdown.limiteMensal)}`,
          `Distribuído isento (mês, todos sócios) = ${fmtBRL(totalIsentaMes)}`,
        ].join("\n"),
      }
    : {
        description:
          "Sem teto regulatório: a empresa tem escrituração contábil completa (RIR/2018 art. 238) ou está em regime que não exige a proxy (Real/Simples). Todo o lucro distribuído sai isento de IRPF para o sócio.",
      };

  const tribHint = {
    description:
      "Parcela da distribuição que EXCEDE o limite isento. Sem escrituração contábil completa, o excedente é rendimento tributável do sócio na PF — soma à renda anual e tributa pelo IRPF (alíquota topo aplicada aqui como proxy).",
    formula: `Tributável = max(0, Distribuído − Limite isento)\nIRPF excedente = Tributável × ${aliqTopoPct.toFixed(1)}%`,
    calc: [
      `Limite isento mensal = ${fmtBRL(breakdown.limiteMensal)}`,
      `Adicional IRPJ 10% já descontado = ${fmtBRL(breakdown.adicionalIrpjAno)}/ano`,
      `Distribuído tributável (mês, todos sócios) = ${fmtBRL(totalTribMes)}`,
      `IRPF aproximado = ${fmtBRL(totalTribMes * (aliqTopoPct / 100))}/mês`,
    ].join("\n"),
    example:
      "Para eliminar o excedente: adote escrituração contábil completa, reduza o payout, ou aumente a reserva mensal.",
  };

  const totaisAno = {
    prolab: resultados.reduce((a, r) => a + r.prolaboreMensal, 0) * 12,
    patronal: resultados.reduce((a, r) => a + r.inssPatronal, 0) * 12,
    inssSocio: resultados.reduce((a, r) => a + r.inssSocio, 0) * 12,
    irpf: resultados.reduce((a, r) => a + r.irpfMensal, 0) * 12,
    distIsenta: resultados.reduce((a, r) => a + r.distribuicaoIsentaMensal, 0) * 12,
    distTrib: resultados.reduce((a, r) => a + r.distribuicaoTributavelMensal, 0) * 12,
    liquido: resultados.reduce((a, r) => a + r.liquidoSocio, 0) * 12,
    custoPJ: resultados.reduce((a, r) => a + r.custoTotalPJ, 0) * 12,
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionTitle hint={HINT}>Pró-labore × Distribuição de Lucros</SectionTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Lucro mensal disponível: <b>{fmtBRL(lucroMensalDisponivel)}</b>
            {(payoutPct !== 100 || reservaMin > 0) && (
              <span className="text-muted-foreground/70">
                {" "}(bruto {fmtBRL(lucroMensalBruto)} − reserva {fmtBRL(reservaMin)} × payout {payoutPct}%)
              </span>
            )}{" "}
            · Regime: <b className="uppercase">{regime}</b> · Piso legal:{" "}
            <b>{fmtBRL(salarioMin)}</b>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
          <Settings className="mr-1 h-3.5 w-3.5" /> Editar sócios
        </Button>
      </div>

      {socios.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nenhum sócio cadastrado. Clique em <b>Editar sócios</b> para abrir o cadastro
          em Configurações → Empresa.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Sócio</th>
                <th className="px-2 py-2 font-medium text-right">Participação</th>
                <th className="px-2 py-2 font-medium text-right">Pró-labore (mês)</th>
                <th className="px-2 py-2 font-medium text-right">INSS sócio</th>
                <th className="px-2 py-2 font-medium text-right">INSS patronal</th>
                <th className="px-2 py-2 font-medium text-right">IRPF</th>
                <th className="px-2 py-2 font-medium text-right">Distribuição isenta</th>
                <th className="px-2 py-2 font-medium text-right">Distribuição tributável</th>
                <th className="px-2 py-2 font-medium text-right">Líquido sócio (mês)</th>
                <th className="px-2 py-2 font-medium text-right">Custo PJ (mês)</th>
              </tr>
            </thead>
            <tbody>
              {socios.map((s, i) => {
                const r = resultados[i];
                const abaixoDoPiso =
                  s.operacional && s.prolaboreMensal > 0 && s.prolaboreMensal < salarioMin;
                return (
                  <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium">{s.nome}</td>
                    <td className="num px-2 py-1.5 text-right">
                      {s.participacaoPct.toFixed(2)}%
                    </td>
                    <td
                      className={`num px-2 py-1.5 text-right ${
                        abaixoDoPiso ? "text-[var(--warning)]" : ""
                      }`}
                      title={
                        abaixoDoPiso
                          ? `Abaixo do piso de ${fmtBRL(salarioMin)} (IN RFB 971/2009)`
                          : undefined
                      }
                    >
                      {fmtBRL(s.prolaboreMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.inssSocio)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.inssPatronal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.irpfMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-pos">
                      {fmtBRL(r.distribuicaoIsentaMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[var(--warning)]">
                      {fmtBRL(r.distribuicaoTributavelMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold text-pos">
                      {fmtBRL(r.liquidoSocio)}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold">
                      {fmtBRL(r.custoTotalPJ)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/60 bg-muted/20 text-[12px] font-semibold">
                <td className="px-2 py-2">Total anual</td>
                <td
                  className={`num px-2 py-2 text-right ${
                    partOk ? "text-foreground" : "text-[var(--warning)]"
                  }`}
                >
                  {somaPartic.toFixed(2)}%
                </td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.prolab)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.inssSocio)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.patronal)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.irpf)}</td>
                <td className="num px-2 py-2 text-right text-pos">{fmtBRL(totaisAno.distIsenta)}</td>
                <td className="num px-2 py-2 text-right text-[var(--warning)]">
                  {fmtBRL(totaisAno.distTrib)}
                </td>
                <td className="num px-2 py-2 text-right text-pos">{fmtBRL(totaisAno.liquido)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.custoPJ)}</td>
              </tr>
            </tfoot>
          </table>

          {!partOk && (
            <div className="mt-3 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[12px] text-[var(--warning)]">
              ⚠️ A soma das participações é <b>{somaPartic.toFixed(2)}%</b> e precisa fechar{" "}
              <b>100%</b>. Ajuste em <b>Configurações → Empresa → Sócios</b>.
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            Para alterar nome, participação, pró-labore, dependentes ou status operacional,
            edite o cadastro em <b>Configurações → Empresa → Sócios</b>.
          </p>
        </div>
      )}

      <CompanyConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
