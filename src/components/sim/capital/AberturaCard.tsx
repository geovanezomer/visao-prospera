// Card "Saldos de Abertura do Exercício" — versão SIMPLIFICADA (SSOT).
//
// Antes este card tinha 12 inputs manuais que duplicavam dados já presentes
// em Balanço (Card 1), Contratos de Dívida e Despesas. Foi reduzido a:
//   • Painel READ-ONLY com 11 rubricas derivadas (cada uma mostra de ONDE
//     veio o valor).
//   • 2 campos editáveis: Lucros Acumulados (plug histórico) e Impostos
//     a Recuperar (crédito tributário, não derivável).
//   • 2 overrides avançados opcionais: Depreciação/Amortização acumulada
//     (default 0, ajustáveis para empresas em operação há vários anos).
//
// Toda derivação vive em engines/finance/aberturaDerivada.ts (SSOT).
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Wallet,
  Receipt,
  Info,
} from "lucide-react";
import type { AppState, BalancoAbertura } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { SectionTitle } from "@/components/sim/shared/primitives";
import { StepCard, SimpleField } from "@/components/sim/capital/parts";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { useFinance } from "@/engines/finance/AppStateContext";
import {
  deriveAbertura,
  type AberturaDerivada,
  type AberturaDerivadaSource,
} from "@/engines/finance/aberturaDerivada";

const n = (v: number | undefined) =>
  typeof v === "number" && isFinite(v) ? v : 0;

/** Mantido para compat: usado por outros componentes (briefing, auditoria etc.). */
export function calcAberturaTotals(capital: AppState["capital"]) {
  // Fallback simples — usa o derivador sem DRE/impostos (impostosPagar = 0).
  const fakeState = { capital } as AppState;
  const d = deriveAbertura({ state: fakeState });
  return {
    ativoIni: d.totals.ativo,
    passivoIni: d.totals.passivo,
    plIni: d.totals.pl,
    diferenca: d.totals.diferenca,
    fechado: d.totals.fechado,
  };
}

/** Linha read-only do painel "derivado de…". */
function DerivedRow({
  source,
  highlight,
}: {
  source: AberturaDerivadaSource;
  highlight?: "asset" | "liability" | "pl";
}) {
  const tone =
    highlight === "asset"
      ? "border-l-success/60"
      : highlight === "liability"
        ? "border-l-destructive/50"
        : "border-l-primary/50";
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border border-border/40 border-l-2 ${tone} bg-background/40 px-3 py-2`}
    >
      <div className="min-w-0">
        <div className="text-[12px] font-medium leading-tight">
          {source.label}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          ← {source.origem}
        </div>
      </div>
      <div className="font-mono text-[12.5px] tabular-nums shrink-0">
        {fmtBRL(source.value)}
      </div>
    </div>
  );
}

export function AberturaCard({
  capital,
  onChange,
}: {
  capital: AppState["capital"];
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  const ab: BalancoAbertura = capital.abertura ?? {};
  const { state } = useFinance();
  const { model } = useFinanceModel(state);
  const [showOverrides, setShowOverrides] = useState(false);

  const derived: AberturaDerivada = useMemo(
    () =>
      deriveAbertura({ state, impostosMensais: model.dre.impostos }),
    [state, model.dre.impostos],
  );

  const set = (patch: Partial<BalancoAbertura>) =>
    onChange({ abertura: { ...ab, ...patch } });

  const ajustarLucros = () => {
    const novoLucros = n(ab.lucrosAcumulados) + derived.totals.diferenca;
    set({ lucrosAcumulados: novoLucros });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <SectionTitle hint="Saldos no 1º dia do exercício. Todos derivados automaticamente do Balanço (Card 1), Contratos de Dívida e do 1º mês da DRE/Despesas. Só dois campos exigem digitação — os demais são puxados de onde já foram informados.">
            Saldos de abertura do exercício
          </SectionTitle>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            <strong>SSOT</strong> — Estes saldos são <em>derivados</em> das
            outras seções (Balanço, Contratos, DRE). Você só preenche o que
            não tem fonte: <em>Lucros Acumulados</em> (histórico) e{" "}
            <em>Impostos a Recuperar</em>.
          </div>
        </div>
      </div>

      {/* Outras informações de abertura — campos sem fonte derivável (vem ANTES dos derivados) */}
      <StepCard
        step={1}
        color="var(--primary)"
        title="Outras informações de abertura"
        subtitle="Lucros acumulados, créditos tributários e depreciação mensal"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="Lucros / prejuízos acumulados (abertura)"
            hint="Resultados retidos de TODOS os exercícios anteriores (não distribuídos). Pode ser negativo. É o ÚNICO plug aceitável — representa o histórico contábil não reconstruído."
            value={n(ab.lucrosAcumulados)}
            onChange={(v) => set({ lucrosAcumulados: v })}
            emphasis
          />
          <SimpleField
            icon={<Receipt className="h-4 w-4" />}
            label="Impostos a recuperar (abertura)"
            hint="Créditos de PIS/COFINS/ICMS/IRPJ a compensar com débitos futuros. Sem modelo automático — informe o saldo conhecido."
            value={n(ab.impostosRecuperar)}
            onChange={(v) => set({ impostosRecuperar: v })}
          />
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="Depreciação mensal"
            hint="Perda contábil de valor de máquinas, equipamentos e imóveis no mês. Não sai do caixa, mas reduz o lucro tributável. Entra na DRE todo mês."
            value={n(capital.depreciacaoMensal)}
            onChange={(v) => onChange({ depreciacaoMensal: v })}
          />
        </div>
      </StepCard>

      {/* Painel DERIVADO */}
      <StepCard
        step={2}
        color="var(--success)"
        title="Saldos derivados automaticamente"
        subtitle="Cada rubrica mostra a sua fonte única (SSOT)"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <DerivedRow source={derived.caixa} highlight="asset" />
          <DerivedRow source={derived.contasReceber} highlight="asset" />
          <DerivedRow source={derived.estoques} highlight="asset" />
          <DerivedRow source={derived.fornecedores} highlight="liability" />
          <DerivedRow source={derived.emprestimosCP} highlight="liability" />
          <DerivedRow source={derived.emprestimosLP} highlight="liability" />
          <DerivedRow source={derived.impostosPagar} highlight="liability" />
          <DerivedRow source={derived.salariosEncargos} highlight="liability" />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[10.5px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Para corrigir um destes valores, edite na <strong>fonte</strong>{" "}
            (Balanço, Contratos de Dívida, Receitas ou Despesas) — não aqui.
            Os contratos com prazo <strong>≤ 12 meses</strong> entram em
            Empréstimos CP; <strong>&gt; 12 meses</strong> em Empréstimos LP.
          </span>
        </div>
      </StepCard>



      {/* Overrides avançados (collapsable) */}
      <div className="rounded-md border border-border/40 bg-background/30">
        <button
          type="button"
          onClick={() => setShowOverrides((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {showOverrides ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Ajustes avançados (raros) — Depreciação / Amortização acumulada
          </span>
          <span className="text-[10px] opacity-60">
            {showOverrides ? "ocultar" : "mostrar"}
          </span>
        </button>
        {showOverrides && (
          <div className="border-t border-border/40 p-3 space-y-2">
            <p className="text-[10.5px] text-muted-foreground">
              Use apenas se a empresa já opera há vários anos e você dispõe do
              saldo de depreciação/amortização <em>já acumulada</em> até o
              início do exercício. Em greenfield, deixe em zero.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <SimpleField
                icon={<Wallet className="h-4 w-4" />}
                label="(−) Depreciação acumulada"
                hint="Total já depreciado sobre o imobilizado existente, antes do exercício. Positivo — entra como redutor."
                value={n(ab.depreciacaoAcumulada)}
                onChange={(v) => set({ depreciacaoAcumulada: v })}
              />
              <SimpleField
                icon={<Wallet className="h-4 w-4" />}
                label="(−) Amortização acumulada"
                hint="Total já amortizado sobre intangíveis, antes do exercício. Positivo — entra como redutor."
                value={n(ab.amortizacaoAcumulada)}
                onChange={(v) => set({ amortizacaoAcumulada: v })}
              />
            </div>
          </div>
        )}
      </div>

      {/* Validação de fechamento */}
      <div
        className={`rounded-lg border p-3 text-[12px] ${
          derived.totals.fechado
            ? "border-pos/30 bg-pos/5 text-pos"
            : "border-warning/40 bg-warning/10 text-warning"
        }`}
      >
        {derived.totals.fechado ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              <strong>Abertura fechada</strong> — Ativo (
              {fmtBRL(derived.totals.ativo)}) = Passivo + PL (
              {fmtBRL(derived.totals.passivo + derived.totals.pl)}). O Balanço
              de fechamento será derivado por construção.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Diferença de{" "}
                <strong>{fmtBRL(derived.totals.diferenca)}</strong> entre Ativo
                ({fmtBRL(derived.totals.ativo)}) e Passivo + PL (
                {fmtBRL(derived.totals.passivo + derived.totals.pl)}).
                {derived.totals.diferenca > 0
                  ? " Ativos > Passivos+PL — falta PL ou passivo."
                  : " Passivos+PL > Ativos — falta ativo ou sobra PL."}
              </span>
            </div>
            <button
              type="button"
              onClick={ajustarLucros}
              className="self-start rounded bg-warning/20 px-2 py-1 text-[10px] font-bold uppercase hover:bg-warning/30 transition-colors"
            >
              Ajustar Lucros Acumulados (
              {derived.totals.diferenca > 0 ? "+" : ""}
              {fmtBRL(derived.totals.diferenca)}) para fechar
            </button>
            <span className="text-[10px] opacity-80">
              O ajuste vai para Lucros/Prejuízos Acumulados — único plug
              contábil aceitável.
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
          <div className="mt-1 font-semibold tabular-nums">
            {fmtBRL(derived.totals.ativo)}
          </div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="text-muted-foreground uppercase tracking-wide text-[9.5px]">
            Passivo abertura
          </div>
          <div className="mt-1 font-semibold tabular-nums">
            {fmtBRL(derived.totals.passivo)}
          </div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="text-muted-foreground uppercase tracking-wide text-[9.5px]">
            PL abertura
          </div>
          <div className="mt-1 font-semibold tabular-nums">
            {fmtBRL(derived.totals.pl)}
          </div>
        </div>
      </div>
    </div>
  );
}
