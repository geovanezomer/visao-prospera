import { AppState, BalancoDetalhado } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";

import { useEffect } from "react";
import {
  Banknote,
  Package,
  Users,
  Wallet,
  AlertTriangle,
  Settings2,
  Building2,
  Landmark,
} from "lucide-react";

import { StepCard, SimpleField, MiniStat } from "@/components/sim/capital/parts";

// Helper: seta valor em path aninhado dentro de capital.balanco (imutável).
// Usa structuredClone (preserva tipos não-serializáveis, evita O(n²) de JSON).
function setBalancoAt(
  bal: BalancoDetalhado | undefined,
  path: string,
  value: number,
): BalancoDetalhado {
  const parts = path.split(".");
  const next = (bal ? structuredClone(bal) : {}) as Record<string, unknown>;
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

  // CFO #5 — soma do imobilizado detalhado (líquido de depreciação acumulada)
  // + intangíveis. Permite derivar Ativo Total quando o detalhe está preenchido.
  const imob = capital.balanco?.ativoNaoCirculante?.imobilizado;
  const intang = capital.balanco?.ativoNaoCirculante?.intangivel;
  const imobBruto =
    (imob?.terrenos || 0) +
    (imob?.edificacoes || 0) +
    (imob?.maquinasEquipamentos || 0) +
    (imob?.veiculos || 0) +
    (imob?.moveisUtensilios || 0) +
    (imob?.outrosImobilizados || 0);
  const imobLiquido = imobBruto - (imob?.depreciacaoAcumulada || 0);
  const intangLiquido =
    (intang?.software || 0) +
    (intang?.marcasPatentes || 0) +
    (intang?.goodwill || 0) +
    (intang?.outrosIntangiveis || 0) -
    (intang?.amortizacaoAcumulada || 0);
  const ativoNaoCircCalc = Math.max(0, imobLiquido) + Math.max(0, intangLiquido);
  const ativoTotalDerivado = ativoCircCalc + ativoNaoCircCalc;
  

  // Ativo Total agora é SEMPRE derivado (soma automática de circulante +
  // imobilizado líq. + intangível líq.). Sincroniza silenciosamente no state
  // para preservar compatibilidade com cálculos que ainda leem capital.ativoTotal.
  useEffect(() => {
    if (Math.abs((capital.ativoTotal || 0) - ativoTotalDerivado) > 0.5) {
      onChange({ ativoTotal: ativoTotalDerivado });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativoTotalDerivado]);


  // CFO #2 — soma do PL detalhado. Quando preenchido, vira a fonte derivada.
  const plDet = capital.balanco?.patrimonioLiquido;
  const plDetalhado =
    (plDet?.capitalSocial || 0) +
    (plDet?.reservasCapital || 0) +
    (plDet?.reservasLucros || 0) +
    (plDet?.lucrosPrejuizosAcumulados || 0) +
    (plDet?.resultadoExercicio || 0) +
    (plDet?.ajustesAvaliacaoPatrimonial || 0) -
    (plDet?.acoesEmTesouraria || 0);
  const temPlDetalhado =
    (plDet?.capitalSocial || 0) > 0 ||
    (plDet?.reservasCapital || 0) > 0 ||
    (plDet?.lucrosPrejuizosAcumulados || 0) !== 0;

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



  // Sugestão de PL: cálculo on-demand (não auto-aplica). O usuário escolhe
  // explicitamente via botão "Usar PL calculado" ou "Ajustar PL para X".
  // Removido useEffect que sobrescrevia silenciosamente (causa race conditions).



  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">


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
        </div>

        <div className="mt-3 grid grid-cols-4 overflow-hidden rounded-md border border-border/40 text-center text-[10px]">
          <MiniStat label="Caixa/bancos" value={fmtBRL(capital.disponibilidades)} />
          <MiniStat label="Estoque" value={fmtBRL(capital.estoques)} />
          <MiniStat label="A receber" value={fmtBRL(capital.contasReceber)} />
          <MiniStat label="Total de ativos" value={fmtBRL(ativoTotalDerivado)} highlight />
        </div>


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
            {/* "Lucros / prejuízos acumulados" REMOVIDO daqui — SSOT única em
                Capital → Saldos de Abertura → Outras informações
                (campo `abertura.lucrosAcumulados`). Evita duplicidade. */}

          </div>

          {/* CFO #2 — sugestão de PL agregado quando o detalhe está preenchido. */}
          {temPlDetalhado && Math.abs(plInformado - plDetalhado) > Math.max(100, Math.abs(plDetalhado) * 0.02) && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px]">
              <span className="text-muted-foreground">
                PL <strong className="text-foreground">derivado</strong> do detalhe (Capital Social + Reservas + Lucros){" "}
                = <strong className="text-primary">{fmtBRL(plDetalhado)}</strong>.
                {plInformado !== 0 && (
                  <> Divergência vs. PL agregado: <strong>{fmtBRL(Math.abs(plInformado - plDetalhado))}</strong>.</>
                )}
              </span>
              <button
                onClick={() => onChange({ patrimonioLiquido: plDetalhado })}
                className="self-start rounded bg-primary/20 px-2 py-1 text-[10px] font-bold uppercase text-primary hover:bg-primary/30 transition-colors"
              >
                Usar PL derivado: {fmtBRL(plDetalhado)}
              </button>
            </div>
          )}

          <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-2 text-[11px] text-muted-foreground">
            Esses valores aparecem <strong className="text-primary">automaticamente</strong> na aba{" "}
            <strong className="text-foreground">Balanço</strong>.
          </div>

        </div>
      </StepCard>

      {capexSlot}

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





    </div>
  );
}
