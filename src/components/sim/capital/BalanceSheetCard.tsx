import { AppState, BalancoDetalhado } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { sumContractSaldos } from "@/engines/finance/debtContracts";

import { useEffect } from "react";
import {
  Banknote,
  Package,
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
  /** Contas a Receber estimadas via PMR (calculado no parent com receita anual e PMR).
   *  Necessário porque o card zera capital.contasReceber para forçar a engine a usar
   *  PMR — sem esse valor derivado, ativoTotal ficaria subavaliado. */
  crEstimado?: number;
}) {
  const ativoCircCalc =
    (capital.disponibilidades || 0) +
    (capital.estoques || 0) +
    // capital.contasReceber é sempre 0 (ver useEffect abaixo); usamos a estimativa PMR.
    (crEstimado ?? capital.contasReceber ?? 0);

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
  const _dividaContratos = sumContractSaldos(capital.debtContracts);
  const totalPassivos =
    (capital.passivoCirculante || 0) > 0
      ? _dividaContratos + (capital.passivoCirculante || 0)
      : _dividaContratos + (capital.fornecedores || 0);

  // Usa ativoTotalDerivado (mesmo render) — capital.ativoTotal é atualizado
  // por useEffect e ficaria 1 render atrás, propagando PL/WACC/ROIC errados.
  const plCalculado = ativoTotalDerivado - totalPassivos;

  // PL final: usa detalhe (Capital Social + Reservas + Lucros) se preenchido,
  // senão cai no cálculo Ativo − Dívidas.
  const plFinal = temPlDetalhado ? plDetalhado : plCalculado;

  // Sincroniza PL, fornecedores e contas a receber com os valores derivados —
  // todos os três inputs foram escondidos e agora são sempre calculados:
  //   • contasReceber → 0 (força engine a usar PMR)
  //   • fornecedores  → 0 (força engine a usar PMP)
  //   • patrimonioLiquido → plFinal (Ativo − Dívidas ou detalhado)
  useEffect(() => {
    const patch: Partial<AppState["capital"]> = {};
    if ((capital.contasReceber || 0) !== 0) patch.contasReceber = 0;
    if ((capital.fornecedores || 0) !== 0) patch.fornecedores = 0;
    if (Math.abs((capital.patrimonioLiquido || 0) - plFinal) > 0.5) {
      patch.patrimonioLiquido = plFinal;
    }
    if (Object.keys(patch).length > 0) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plFinal, capital.contasReceber, capital.fornecedores]);





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
          {/* "Clientes que te devem" (contasReceber) escondido — sempre derivado
              via PMR na engine (fallback: Receita × PMR/360). */}

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

          {/* Sugestão de PL removida — PL agora é sempre derivado via useEffect. */}





        {/* Régua de resumo — rodapé do Card 1. Total de ativos com memória de cálculo. */}
        <div className="mt-5 grid grid-cols-4 overflow-hidden rounded-md border border-border/40 text-center text-[10px]">
          <MiniStat label="Caixa/bancos" value={fmtBRL(capital.disponibilidades)} />
          <MiniStat label="Estoque" value={fmtBRL(capital.estoques)} />
          <MiniStat
            label="A receber"
            value="auto (PMR)"
            hint="Calculado automaticamente pela engine: Receita Bruta × PMR / 360. Configure o PMR na aba Receitas."
          />

          <MiniStat
            label="Total de ativos"
            value={fmtBRL(ativoTotalDerivado)}
            highlight
            hint={
              "Soma automática de tudo que a empresa possui.\n\n" +
              "Fórmula: Ativo Circulante + Imobilizado líq. + Intangível líq.\n\n" +
              `Memória de cálculo:\n` +
              `• Caixa/bancos: ${fmtBRL(capital.disponibilidades)}\n` +
              `• Estoque: ${fmtBRL(capital.estoques)}\n` +
              `• Contas a receber: ${fmtBRL(capital.contasReceber)}\n` +
              `  = Ativo Circulante: ${fmtBRL(ativoCircCalc)}\n\n` +
              `• Imobilizado bruto: ${fmtBRL(imobBruto)}\n` +
              `  (−) Depreciação acum.: ${fmtBRL(imob?.depreciacaoAcumulada || 0)}\n` +
              `  = Imobilizado líq.: ${fmtBRL(Math.max(0, imobLiquido))}\n\n` +
              `• Intangível líq.: ${fmtBRL(Math.max(0, intangLiquido))}\n\n` +
              `TOTAL: ${fmtBRL(ativoTotalDerivado)}`
            }
          />
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

        {/* "Fornecedores a pagar" e "Patrimônio líquido dos sócios" escondidos —
            ambos são sempre derivados:
              • fornecedores  = CPV × PMP/360 (engine, fallback quando input = 0)
              • patrimonioLiq = Ativo Total − Dívidas (sincronizado via useEffect) */}


      </StepCard>





    </div>
  );
}
