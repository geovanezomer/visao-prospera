import { useEffect } from "react";
import { AppState, BalancoDetalhado } from "@/engines/finance/types";
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
  Building2,
  Landmark,
} from "lucide-react";
import { StepCard, SimpleField, MiniStat } from "@/components/sim/capital/parts";

// Helper: setta valor em path aninhado dentro de capital.balanco (imutável).
function setBalancoAt(
  bal: BalancoDetalhado | undefined,
  path: string,
  value: number,
): BalancoDetalhado {
  const parts = path.split(".");
  const next = JSON.parse(JSON.stringify(bal ?? {})) as Record<string, unknown>;
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return next as BalancoDetalhado;
}

function getBalancoAt(bal: BalancoDetalhado | undefined, path: string): number {
  const parts = path.split(".");
  let cur: unknown = bal;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return 0;
  }
  return typeof cur === "number" && isFinite(cur) ? cur : 0;
}


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

      {/* PASSO 1 — ATIVOS + Detalhes patrimoniais (imobilizado e PL dos sócios) */}
      <StepCard
        step={1}
        color="var(--success)"
        title="Dinheiro e bens da empresa"
        subtitle="Caixa, estoques, recebíveis + imobilizado e patrimônio dos sócios"
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

        {/* Detalhes patrimoniais (antes era StepCard separado — agora unificado aqui) */}
        <div className="mt-5 border-t border-border/40 pt-4">
          <div className="mb-3 text-[11px] text-muted-foreground">
            <strong className="text-foreground">Imobilizado (opcional)</strong> — bens duráveis da empresa. Vão direto para o Balanço.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SimpleField
              icon={<Building2 className="h-4 w-4" />}
              label="Terrenos"
              hint="Valor contábil dos terrenos próprios."
              value={getBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.terrenos")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.terrenos", n) })
              }
            />
            <SimpleField
              icon={<Building2 className="h-4 w-4" />}
              label="Edificações e benfeitorias"
              hint="Imóveis, galpões, salas, reformas capitalizadas."
              value={getBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.edificacoes")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.edificacoes", n) })
              }
            />
            <SimpleField
              icon={<Settings2 className="h-4 w-4" />}
              label="Máquinas e equipamentos"
              hint="Valor contábil de máquinas, equipamentos produtivos e ferramentas."
              value={getBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.maquinasEquipamentos")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.maquinasEquipamentos", n) })
              }
            />
            <SimpleField
              icon={<Package className="h-4 w-4" />}
              label="Veículos"
              hint="Frota da empresa (carros, caminhões, motos)."
              value={getBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.veiculos")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.veiculos", n) })
              }
            />
            <SimpleField
              icon={<Package className="h-4 w-4" />}
              label="Móveis e utensílios"
              hint="Mobiliário, computadores, equipamentos de escritório."
              value={getBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.moveisUtensilios")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "ativoNaoCirculante.imobilizado.moveisUtensilios", n) })
              }
            />
          </div>

          <div className="mt-4 mb-3 text-[11px] text-muted-foreground">
            <strong className="text-foreground">Patrimônio dos sócios (opcional)</strong> — origem do capital da empresa.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SimpleField
              icon={<Landmark className="h-4 w-4" />}
              label="Capital social"
              hint="Valor integralizado pelos sócios no contrato social."
              value={getBalancoAt(capital.balanco, "patrimonioLiquido.capitalSocial")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "patrimonioLiquido.capitalSocial", n) })
              }
            />
            <SimpleField
              icon={<Landmark className="h-4 w-4" />}
              label="Reservas de capital"
              hint="Ágio na emissão de cotas/ações, subvenções, doações."
              value={getBalancoAt(capital.balanco, "patrimonioLiquido.reservasCapital")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "patrimonioLiquido.reservasCapital", n) })
              }
            />
            <SimpleField
              icon={<Wallet className="h-4 w-4" />}
              label="Lucros / prejuízos acumulados"
              hint="Resultados retidos de exercícios anteriores (não distribuídos). Pode ser negativo (prejuízo)."
              value={getBalancoAt(capital.balanco, "patrimonioLiquido.lucrosPrejuizosAcumulados")}
              onChange={(n) =>
                onChange({ balanco: setBalancoAt(capital.balanco, "patrimonioLiquido.lucrosPrejuizosAcumulados", n) })
              }
            />
          </div>

          <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-2 text-[11px] text-muted-foreground">
            Esses valores aparecem <strong className="text-primary">automaticamente</strong> na aba{" "}
            <strong className="text-foreground">Balanço</strong>.
          </div>
        </div>
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




    </div>
  );
}
