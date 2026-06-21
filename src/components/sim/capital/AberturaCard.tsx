// Card "Saldos de Abertura do Exercício" — Fase 1 do Balanço por Construção.
//
// Coleta o conjunto mínimo de saldos iniciais (fluxo-sensíveis) necessário
// para que o Balanço de fechamento feche por construção via:
//
//     saldoFim = saldoAbertura + movimentoPeríodo (DRE + DFC + PMR/PMP/PME)
//
// Validação: Ativo_ini = Passivo_ini + PL_ini. Quando não fecha, oferece
// ajuste em Lucros Acumulados de abertura — o ÚNICO "plug" aceitável,
// pois representa o histórico de exercícios anteriores que o consultor
// pode não conseguir reconstruir.
import { useMemo } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Banknote,
  Users,
  Package,
  Receipt,
  Wallet,
  Landmark,
  Building2,
} from "lucide-react";
import type { AppState, BalancoAbertura } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { SectionTitle } from "@/components/sim/shared/primitives";
import { StepCard, SimpleField } from "@/components/sim/capital/parts";

const n = (v: number | undefined) => (typeof v === "number" && isFinite(v) ? v : 0);

interface AberturaTotals {
  ativoIni: number;
  passivoIni: number;
  plIni: number;
  diferenca: number;
  fechado: boolean;
}

/** Calcula totais de abertura combinando `abertura` (fluxos) + `balanco`
 *  (itens patrimoniais constantes: Capital Social, Reservas, Imobilizado bruto). */
export function calcAberturaTotals(capital: AppState["capital"]): AberturaTotals {
  const ab = capital.abertura ?? {};
  const bal = capital.balanco ?? {};
  const imo = bal.ativoNaoCirculante?.imobilizado ?? {};
  const pl = bal.patrimonioLiquido ?? {};

  // Imobilizado BRUTO de abertura (assume rubricas inalteradas no período,
  // CAPEX entrará via movimento). Depreciação acumulada da abertura subtrai.
  const imobBruto =
    n(imo.terrenos) +
    n(imo.edificacoes) +
    n(imo.maquinasEquipamentos) +
    n(imo.veiculos) +
    n(imo.moveisUtensilios) +
    n(imo.outrosImobilizados);

  const ativoIni =
    n(ab.caixa) +
    n(ab.contasReceber) +
    n(ab.estoques) +
    n(ab.impostosRecuperar) +
    imobBruto -
    n(ab.depreciacaoAcumulada) -
    n(ab.amortizacaoAcumulada);

  const passivoIni =
    n(ab.fornecedores) +
    n(ab.emprestimosCP) +
    n(ab.emprestimosLP) +
    n(ab.impostosPagar) +
    n(ab.salariosEncargos);

  const plIni =
    n(pl.capitalSocial) +
    n(pl.reservasCapital) +
    n(ab.lucrosAcumulados);

  const diferenca = ativoIni - (passivoIni + plIni);
  const tol = Math.max(100, ativoIni * 0.001);
  const fechado = Math.abs(diferenca) < tol;

  return { ativoIni, passivoIni, plIni, diferenca, fechado };
}

export function AberturaCard({
  capital,
  onChange,
}: {
  capital: AppState["capital"];
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  const ab: BalancoAbertura = capital.abertura ?? {};
  const totals = useMemo(() => calcAberturaTotals(capital), [capital]);

  const set = (patch: Partial<BalancoAbertura>) =>
    onChange({ abertura: { ...ab, ...patch } });

  // Ajuste-plug: joga a diferença em Lucros Acumulados de abertura.
  const ajustarLucros = () => {
    const novoLucros = n(ab.lucrosAcumulados) + totals.diferenca;
    set({ lucrosAcumulados: novoLucros });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <SectionTitle hint="Saldos de início do exercício. Combinados com DRE + DFC + prazos médios, derivam o Balanço de fechamento POR CONSTRUÇÃO — sem precisar editar nada na aba Balanço.">
            Saldos de abertura do exercício
          </SectionTitle>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Posição patrimonial no <strong>1º dia do exercício</strong>. Itens
            constantes (Capital Social, Reservas, Terrenos, Edificações etc.) já
            foram informados acima.
          </div>
        </div>
      </div>

      {/* ATIVOS de abertura */}
      <StepCard
        step={1}
        color="var(--success)"
        title="Ativos no início do exercício"
        subtitle="Caixa, recebíveis, estoques, créditos tributários e depreciação já acumulada"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SimpleField
            icon={<Banknote className="h-4 w-4" />}
            label="Caixa + bancos (abertura)"
            hint="Saldo total em caixa, contas correntes e aplicações de liquidez imediata no 1º dia."
            value={n(ab.caixa)}
            onChange={(v) => set({ caixa: v })}
          />
          <SimpleField
            icon={<Users className="h-4 w-4" />}
            label="Contas a receber (abertura)"
            hint="Clientes que já deviam à empresa no início do exercício."
            value={n(ab.contasReceber)}
            onChange={(v) => set({ contasReceber: v })}
          />
          <SimpleField
            icon={<Package className="h-4 w-4" />}
            label="Estoques (abertura)"
            hint="Mercadoria/MP/produto acabado existente no 1º dia."
            value={n(ab.estoques)}
            onChange={(v) => set({ estoques: v })}
          />
          <SimpleField
            icon={<Receipt className="h-4 w-4" />}
            label="Impostos a recuperar"
            hint="Créditos de PIS/COFINS/ICMS/IRPJ a compensar com débitos futuros."
            value={n(ab.impostosRecuperar)}
            onChange={(v) => set({ impostosRecuperar: v })}
          />
          <SimpleField
            icon={<Building2 className="h-4 w-4" />}
            label="(−) Depreciação acumulada"
            hint="Total de depreciação já lançada sobre o imobilizado existente. POSITIVO — entra como redutor."
            value={n(ab.depreciacaoAcumulada)}
            onChange={(v) => set({ depreciacaoAcumulada: v })}
          />
          <SimpleField
            icon={<Building2 className="h-4 w-4" />}
            label="(−) Amortização acumulada"
            hint="Total de amortização já lançada sobre intangíveis. POSITIVO — entra como redutor."
            value={n(ab.amortizacaoAcumulada)}
            onChange={(v) => set({ amortizacaoAcumulada: v })}
          />
        </div>
      </StepCard>

      {/* PASSIVOS de abertura */}
      <StepCard
        step={2}
        color="var(--destructive)"
        title="Obrigações no início do exercício"
        subtitle="Fornecedores, empréstimos, impostos e salários já devidos"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SimpleField
            icon={<Users className="h-4 w-4" />}
            label="Fornecedores (abertura)"
            hint="Saldo a pagar a fornecedores no 1º dia."
            value={n(ab.fornecedores)}
            onChange={(v) => set({ fornecedores: v })}
          />
          <SimpleField
            icon={<Landmark className="h-4 w-4" />}
            label="Empréstimos CP (abertura)"
            hint="Parcela com vencimento ≤ 12 meses. Se você usa a aba 'Contratos de Dívida', já vem agregado."
            value={n(ab.emprestimosCP)}
            onChange={(v) => set({ emprestimosCP: v })}
          />
          <SimpleField
            icon={<Landmark className="h-4 w-4" />}
            label="Empréstimos LP (abertura)"
            hint="Parcela com vencimento > 12 meses."
            value={n(ab.emprestimosLP)}
            onChange={(v) => set({ emprestimosLP: v })}
          />
          <SimpleField
            icon={<Receipt className="h-4 w-4" />}
            label="Impostos a pagar (abertura)"
            hint="Tributos apurados e ainda não pagos (ISS/ICMS/PIS/COFINS/IRPJ/CSLL etc.)."
            value={n(ab.impostosPagar)}
            onChange={(v) => set({ impostosPagar: v })}
          />
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="Salários e encargos a pagar"
            hint="Folha do mês a pagar + INSS/FGTS/13º proporcional. Tipicamente ~1 mês de folha total."
            value={n(ab.salariosEncargos)}
            onChange={(v) => set({ salariosEncargos: v })}
          />
        </div>
      </StepCard>

      {/* PL de abertura — Lucros Acumulados (plug histórico) */}
      <StepCard
        step={3}
        color="var(--primary)"
        title="Patrimônio acumulado de exercícios anteriores"
        subtitle="Único campo de ajuste contábil aceitável — representa o histórico que falta"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="Lucros / prejuízos acumulados (abertura)"
            hint="Resultados retidos de TODOS os exercícios anteriores (não distribuídos). Pode ser negativo (prejuízo). É o plug que fecha o balanço de abertura — equivale ao histórico contábil que falta reconstruir."
            value={n(ab.lucrosAcumulados)}
            onChange={(v) => set({ lucrosAcumulados: v })}
            emphasis
          />
        </div>
      </StepCard>

      {/* Validação de fechamento */}
      <div
        className={`rounded-lg border p-3 text-[12px] ${
          totals.fechado
            ? "border-pos/30 bg-pos/5 text-pos"
            : "border-warning/40 bg-warning/10 text-warning"
        }`}
      >
        {totals.fechado ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              <strong>Abertura fechada</strong> — Ativo ({fmtBRL(totals.ativoIni)}) = Passivo +
              PL ({fmtBRL(totals.passivoIni + totals.plIni)}). O Balanço de fechamento será
              derivado por construção.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Diferença de <strong>{fmtBRL(totals.diferenca)}</strong> entre Ativo
                ({fmtBRL(totals.ativoIni)}) e Passivo + PL (
                {fmtBRL(totals.passivoIni + totals.plIni)}).
                {totals.diferenca > 0
                  ? " Ativos > Passivos+PL — falta PL ou passivo na abertura."
                  : " Passivos+PL > Ativos — falta ativo ou sobra PL na abertura."}
              </span>
            </div>
            <button
              type="button"
              onClick={ajustarLucros}
              className="self-start rounded bg-warning/20 px-2 py-1 text-[10px] font-bold uppercase hover:bg-warning/30 transition-colors"
            >
              Ajustar Lucros Acumulados ({totals.diferenca > 0 ? "+" : ""}
              {fmtBRL(totals.diferenca)}) para fechar
            </button>
            <span className="text-[10px] opacity-80">
              O ajuste vai para Lucros/Prejuízos Acumulados de abertura — único plug
              contábil aceitável (representa o histórico não reconstruído).
            </span>
          </div>
        )}
      </div>

      {/* Totais */}
      <div className="grid grid-cols-3 gap-3 text-center text-[11px]">
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="text-muted-foreground uppercase tracking-wide text-[9.5px]">
            Ativo abertura
          </div>
          <div className="mt-1 font-semibold tabular-nums">{fmtBRL(totals.ativoIni)}</div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="text-muted-foreground uppercase tracking-wide text-[9.5px]">
            Passivo abertura
          </div>
          <div className="mt-1 font-semibold tabular-nums">{fmtBRL(totals.passivoIni)}</div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="text-muted-foreground uppercase tracking-wide text-[9.5px]">
            PL abertura
          </div>
          <div className="mt-1 font-semibold tabular-nums">{fmtBRL(totals.plIni)}</div>
        </div>
      </div>
    </div>
  );
}
