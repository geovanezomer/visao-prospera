import { useEffect } from "react";
import { AppState } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { SectionTitle } from "@/components/sim/shared/primitives";
import {
  Banknote,
  Package,
  Users,
  Coins,
  Wallet,
  AlertTriangle,
  Camera,
  Settings2,
} from "lucide-react";
import { StepCard, SimpleField, MiniStat, Field } from "@/components/sim/capital/parts";

// Fotografia do balanço hoje — 3 passos (Ativos · Dívidas+PL · Resumo) +
// lançamentos mensais. Cálculos auxiliares ficam no topo.
export function BalanceSheetCard({
  capital,
  onChange,
  debtContractsSlot,
  capexSlot,
}: {
  capital: AppState["capital"];
  onChange: (patch: Partial<AppState["capital"]>) => void;
  debtContractsSlot?: React.ReactNode;
  capexSlot?: React.ReactNode;
}) {
  const ativoCircCalc =
    (capital.disponibilidades || 0) + (capital.estoques || 0) + (capital.contasReceber || 0);

  // Total de Passivos: evita dupla contagem (passivoCirculante explícito já
  // inclui fornecedores e parcela CP da dívida).
  const totalPassivos =
    (capital.passivoCirculante || 0) > 0
      ? (capital.dividaOnerosa || 0) + (capital.passivoCirculante || 0)
      : (capital.dividaOnerosa || 0) + (capital.fornecedores || 0);

  const plCalculado = (capital.ativoTotal || 0) - totalPassivos;
  const plInformado = capital.patrimonioLiquido || 0;
  const diff = Math.abs(plInformado - plCalculado);
  const hasInconsistencia =
    capital.ativoTotal > 0 && diff > Math.max(100, capital.ativoTotal * 0.02);

  const capitalCirculante =
    ativoCircCalc - (capital.passivoCirculante || capital.fornecedores || 0);
  const dpl = plInformado > 0 ? (capital.dividaOnerosa || 0) / plInformado : 0;
  const solvencia = totalPassivos > 0 ? (capital.ativoTotal || 0) / totalPassivos : 0;

  // Auto-preenche PL quando vazio (= cálculo Ativo − Dívidas). Se o usuário
  // informar manualmente um valor diferente, mantemos e exibimos o alerta.
  useEffect(() => {
    if (plInformado === 0 && capital.ativoTotal > 0 && plCalculado !== 0) {
      onChange({ patrimonioLiquido: plCalculado });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plCalculado, capital.ativoTotal]);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Camera className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <SectionTitle hint="Saldos atuais do balanço — preencha com os últimos números do seu contador. Geram liquidez, ROE, ROA e alavancagem.">
            Fotografia do balanço hoje
          </SectionTitle>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Em 3 passos rápidos você descreve a posição patrimonial da empresa.
          </div>
        </div>
      </div>

      {/* PASSO 1 — ATIVOS */}
      <StepCard
        step={1}
        color="var(--success)"
        title="Dinheiro e bens da empresa"
        subtitle="Tudo que pode virar caixa em algum momento"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleField
            icon={<Banknote className="h-4 w-4" />}
            label="Dinheiro em caixa e bancos"
            hint="Saldo em conta corrente + aplicações de liquidez imediata."
            value={capital.disponibilidades}
            onChange={(n) => onChange({ disponibilidades: n })}
          />
          <SimpleField
            icon={<Package className="h-4 w-4" />}
            label="Estoque (produtos parados)"
            hint="Mercadorias, matéria-prima ou produtos acabados no estoque."
            value={capital.estoques}
            onChange={(n) => onChange({ estoques: n })}
          />
          <SimpleField
            icon={<Users className="h-4 w-4" />}
            label="Clientes que te devem"
            hint="Saldo médio a receber de clientes. Deixe 0 para calcular automaticamente pelo prazo médio (PMR)."
            value={capital.contasReceber}
            onChange={(n) => onChange({ contasReceber: n })}
            placeholder="0 = calculado pelo prazo médio"
          />
          <SimpleField
            icon={<Coins className="h-4 w-4" />}
            label="Total de ativos da empresa"
            hint="Soma de TUDO que a empresa possui: caixa, estoques, máquinas, imóveis, veículos, contas a receber etc."
            value={capital.ativoTotal}
            onChange={(n) => onChange({ ativoTotal: n })}
            emphasis
          />
        </div>

        <div className="mt-3 grid grid-cols-4 overflow-hidden rounded-md border border-border/40 text-center text-[10px]">
          <MiniStat label="Caixa/bancos" value={fmtBRL(capital.disponibilidades)} />
          <MiniStat label="Estoque" value={fmtBRL(capital.estoques)} />
          <MiniStat label="A receber" value={fmtBRL(capital.contasReceber)} />
          <MiniStat label="Ativo circulante" value={fmtBRL(ativoCircCalc)} highlight />
        </div>

        {/* Reconciliação Total de Ativos vs. soma dos componentes circulantes.
            Evita "Balanço consistente" silencioso quando o consultor digita um
            Total que não bate com Caixa+Estoque+Clientes (gap = imobilizado/
            outros ativos não detalhados, ou erro de digitação). */}
        {capital.ativoTotal > 0 && (() => {
          const gap = capital.ativoTotal - ativoCircCalc;
          if (gap < -1) {
            return (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Total de ativos (<strong>{fmtBRL(capital.ativoTotal)}</strong>) é{" "}
                  <strong>menor</strong> que a soma de Caixa + Estoque + Clientes
                  (<strong>{fmtBRL(ativoCircCalc)}</strong>). Revise os valores —
                  Total de Ativos deve incluir, no mínimo, todo o ativo circulante.
                </span>
              </div>
            );
          }
          if (gap > 1) {
            return (
              <div className="mt-2 rounded-md border border-border/40 bg-muted/20 p-2 text-[11px] text-muted-foreground">
                Imobilizado e outros ativos (implícito):{" "}
                <strong className="text-foreground">{fmtBRL(gap)}</strong>{" "}
                <span className="opacity-70">
                  = Total de Ativos − (Caixa + Estoque + Clientes). Se este valor
                  não corresponde a máquinas/imóveis/veículos da empresa, revise
                  o Total de Ativos.
                </span>
              </div>
            );
          }
          return null;
        })()}
      </StepCard>

      {/* PASSO 2 — DÍVIDAS + PL */}
      <StepCard
        step={2}
        color="var(--destructive)"
        title="O que a empresa deve"
        subtitle="Dívidas, contas e obrigações"
      >
        {debtContractsSlot}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SimpleField
            icon={<Users className="h-4 w-4" />}
            label="Fornecedores a pagar"
            hint="Saldo médio que a empresa deve a fornecedores. Deixe 0 para calcular pelo prazo médio (PMP)."
            value={capital.fornecedores}
            onChange={(n) => onChange({ fornecedores: n })}
            placeholder="0 = calculado pelo prazo médio"
          />
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="Patrimônio líquido dos sócios"
            hint="Calculado automaticamente: Ativo Total − Dívidas (empréstimos + fornecedores). Você pode sobrescrever se tiver o valor contábil exato."
            value={capital.patrimonioLiquido}
            onChange={(n) => onChange({ patrimonioLiquido: n })}
            emphasis
          />
        </div>

        {capital.ativoTotal > 0 && plInformado === 0 && (
          <button
            onClick={() => onChange({ patrimonioLiquido: plCalculado })}
            className="mt-2 inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase text-primary hover:bg-primary/25 transition-colors"
          >
            Usar PL calculado: {fmtBRL(plCalculado)}
          </button>
        )}

        {hasInconsistencia && plInformado !== 0 && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                PL informado (<strong>{fmtBRL(plInformado)}</strong>) diverge do PL calculado
                (Ativos − Dívidas = <strong>{fmtBRL(plCalculado)}</strong>). Diferença:{" "}
                <strong>{fmtBRL(diff)}</strong>.
              </span>
            </div>
            <button
              onClick={() => onChange({ patrimonioLiquido: plCalculado })}
              className="self-start rounded bg-warning/20 px-2 py-1 text-[10px] font-bold uppercase hover:bg-warning/30 transition-colors"
            >
              Ajustar PL para {fmtBRL(plCalculado)}
            </button>
          </div>
        )}

      </StepCard>

      {capexSlot}

      {/* PASSO 3 (Resumo do Balanço) movido para a aba dedicada "Balanço"
          — UI completa com 3 modos de profundidade, comparativo N vs N-1
          e validação de fechamento vive em src/components/sim/balanco. */}
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] text-muted-foreground">
        <span className="font-semibold text-primary">Resumo e raio-X patrimonial</span>{" "}
        agora moram na aba <strong className="text-foreground">Balanço</strong> (logo após
        o DRE) — com 3 modos de profundidade, comparativo N vs N-1 e fechamento contábil.
      </div>

      {/* Lançamentos mensais (mantidos para a DRE) */}
      <div className="rounded-md border border-border/40 bg-background/30 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-xs font-semibold text-muted-foreground">
            Outros lançamentos mensais
          </div>
          <span className="text-[10px] text-muted-foreground/70">Entram na DRE todo mês</span>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <Field
            label="Depreciação mensal"
            value={capital.depreciacaoMensal}
            onChange={(n) => onChange({ depreciacaoMensal: n })}
            hint="Perda contábil de valor de máquinas, equipamentos e imóveis no mês. Não sai do caixa, mas reduz o lucro tributável."
          />
        </div>
      </div>
    </div>
  );
}
