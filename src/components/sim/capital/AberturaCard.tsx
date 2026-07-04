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
import { useMemo } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Wallet,
  Receipt,
  Info,
} from "lucide-react";
import type { AppState, BalancoAbertura } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { StepCard, SimpleField } from "@/components/sim/capital/parts";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { useFinance, usePatchTax } from "@/engines/finance/AppStateContext";
import {
  deriveAbertura,
  type AberturaDerivada,
  type AberturaDerivadaSource,
} from "@/engines/finance/aberturaDerivada";


const n = (v: number | undefined) =>
  typeof v === "number" && isFinite(v) ? v : 0;

/** Mantido para compat: usado por outros componentes (briefing, auditoria etc.).
 *  Recebe a série `dre.impostosTotal` explicitamente para evitar a violação de
 *  SSOT anterior (fake state sem DRE → impostosPagar = 0). */
export function calcAberturaTotals(
  state: AppState,
  impostosTotalMensais: number[],
) {
  const d = deriveAbertura({ state, impostosTotalMensais });
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
  hint,
}: {
  source: AberturaDerivadaSource;
  highlight?: "asset" | "liability" | "pl";
  /** Tooltip nativo — explicação + fórmula + memória de cálculo. */
  hint?: string;
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
        <div className="text-[12px] font-medium leading-tight inline-flex items-center gap-1">
          {source.label}
          {hint && (
            <span
              title={hint}
              aria-label="Ajuda"
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] leading-none text-muted-foreground cursor-help"
            >
              ?
            </span>
          )}
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
  const patchTax = usePatchTax();
  const isReal = state.tax.regime === "real";
  const { model } = useFinanceModel(state);

  

  const derived: AberturaDerivada = useMemo(
    () =>
      deriveAbertura({ state, impostosTotalMensais: model.dre.impostosTotal }),
    [state, model.dre.impostos],
  );

  const set = (patch: Partial<BalancoAbertura>) =>
    onChange({ abertura: { ...ab, ...patch } });

  const ajustarLucros = () => {
    const novoLucros = n(ab.lucrosAcumulados) + derived.totals.diferenca;
    set({ lucrosAcumulados: novoLucros });
    toast.success("Lucros acumulados ajustados para equilibrar a abertura", {
      description: `Novo saldo: ${fmtBRL(novoLucros)} (ajuste de ${fmtBRL(derived.totals.diferenca)}).`,
    });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">


      {/* Outras informações de abertura — só faz sentido para Lucro Real */}
      {isReal && (
      <StepCard
        step={3}

        color="var(--primary)"
        title="Outras informações de abertura"
        subtitle="Lucros acumulados, créditos tributários e depreciação mensal"
      >
        <div className="mb-3 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[10.5px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            <strong className="text-foreground">Lucros Acumulados é o único "plug" aceitável.</strong>{" "}
            Se o balanço de abertura não fechar (Ativo ≠ Passivo + PL), esta linha absorve o
            resíduo histórico — não é erro de cálculo, é a contrapartida de exercícios anteriores
            que você não reconstruiu rubrica a rubrica. Use o botão <em>"Ajustar Lucros Acumulados"</em>{" "}
            no painel derivado para zerar a diferença.
          </span>
        </div>
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
            hint="Perda contábil de valor de máquinas, equipamentos e imóveis. Sempre aparece no DRE reduzindo EBIT e LAIR (visão contábil) e nunca sai do caixa. IMPACTO TRIBUTÁRIO: só reduz IR/CSLL no LUCRO REAL — em Simples Nacional e Lucro Presumido o imposto é calculado sobre a receita (presunção), então a depreciação não gera economia fiscal nesses regimes. Junta-se à depreciação automática do CapEx (Ativações de imobilizado)."
            value={n(capital.depreciacaoMensal)}
            onChange={(v) => onChange({ depreciacaoMensal: v })}
          />
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="(−) Depreciação acumulada"
            hint="Total já depreciado sobre o imobilizado existente, antes do exercício. Positivo — entra como redutor. Em greenfield, deixe em zero."
            value={n(ab.depreciacaoAcumulada)}
            onChange={(v) => set({ depreciacaoAcumulada: v })}
          />
          <SimpleField
            icon={<Wallet className="h-4 w-4" />}
            label="(−) Amortização acumulada"
            hint="Total já amortizado sobre intangíveis, antes do exercício. Positivo — entra como redutor. Em greenfield, deixe em zero."
            value={n(ab.amortizacaoAcumulada)}
            onChange={(v) => set({ amortizacaoAcumulada: v })}
          />
          {isReal && (
            <SimpleField
              icon={<Receipt className="h-4 w-4" />}
              label="Prejuízo fiscal acumulado (abertura) — Lucro Real"
              hint="Saldo da parte B do e-Lalur (ECF). É FISCAL — diferente de 'Lucros/prejuízos acumulados' (que é contábil/PL). Compensa até 30% do lucro tributável de cada trimestre (Lei 9.065/95 art. 42). A base negativa de CSLL usa o mesmo saldo. Só se aplica ao Lucro Real."
              value={n(state.tax.prejuizoFiscalAcumuladoAbertura)}
              onChange={(v) => patchTax({ prejuizoFiscalAcumuladoAbertura: Math.max(0, v) })}
            />
          )}
        </div>
      </StepCard>
      )}


      {/* Painel DERIVADO */}
      <StepCard
        step={isReal ? 4 : 3}
        color="var(--success)"
        title="Saldos derivados automaticamente"
        subtitle="Cada rubrica mostra a sua fonte única (SSOT)"
      >

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <DerivedRow
            source={derived.caixa}
            highlight="asset"
            hint={
              "Caixa e equivalentes de abertura — saldo em conta corrente + aplicações de liquidez imediata no dia 1.\n\n" +
              "Fórmula: Card 1 (Balanço) → ativoCirculante.caixaEquivalentes + aplicacoesFinanceirasCP; se vazio, cai para capital.disponibilidades.\n\n" +
              `Memória: valor = ${fmtBRL(derived.caixa.value)}\nFonte: ${derived.caixa.origem}`
            }
          />
          <DerivedRow
            source={derived.contasReceber}
            highlight="asset"
            hint={
              "Contas a receber de clientes na abertura — vendas a prazo ainda não recebidas.\n\n" +
              "Fórmula: Card 1 → ativoCirculante.contasReceberClientes (líquido de PDD); fallback: capital.contasReceber ou Receita × PMR / 360.\n\n" +
              `Memória: valor = ${fmtBRL(derived.contasReceber.value)}\nFonte: ${derived.contasReceber.origem}`
            }
          />
          <DerivedRow
            source={derived.estoques}
            highlight="asset"
            hint={
              "Estoques de abertura — mercadorias, matéria-prima e produtos acabados no dia 1.\n\n" +
              "Fórmula: Card 1 → ativoCirculante.estoques; fallback: capital.estoques.\n\n" +
              `Memória: valor = ${fmtBRL(derived.estoques.value)}\nFonte: ${derived.estoques.origem}`
            }
          />
          <DerivedRow
            source={derived.fornecedores}
            highlight="liability"
            hint={
              "Fornecedores a pagar na abertura — compras a prazo ainda não liquidadas.\n\n" +
              "Fórmula: Card 1 → passivoCirculante.fornecedores; fallback: capital.fornecedores ou CPV × PMP / 360.\n\n" +
              `Memória: valor = ${fmtBRL(derived.fornecedores.value)}\nFonte: ${derived.fornecedores.origem}`
            }
          />
          <DerivedRow
            source={derived.emprestimosCP}
            highlight="liability"
            hint={
              "Empréstimos e financiamentos de curto prazo (vencimento ≤ 12 meses).\n\n" +
              "Fórmula: soma dos saldos dos Contratos de Dívida (Card 2) com prazo remanescente ≤ 12 meses. Sem contratos = R$ 0,00.\n\n" +
              `Memória: valor = ${fmtBRL(derived.emprestimosCP.value)}\nFonte: ${derived.emprestimosCP.origem}`
            }
          />
          <DerivedRow
            source={derived.emprestimosLP}
            highlight="liability"
            hint={
              "Empréstimos e financiamentos de longo prazo (vencimento > 12 meses).\n\n" +
              "Fórmula: soma dos saldos dos Contratos de Dívida (Card 2) com prazo remanescente > 12 meses. Sem contratos = R$ 0,00.\n\n" +
              `Memória: valor = ${fmtBRL(derived.emprestimosLP.value)}\nFonte: ${derived.emprestimosLP.origem}`
            }
          />
          <DerivedRow
            source={derived.impostosPagar}
            highlight="liability"
            hint={
              "Impostos a pagar na abertura — aproximação de 1 mês de DARF em aberto (mês 1 da série de impostos do DRE).\n\n" +
              "Fórmula: dre.impostos[0] (primeiro mês da série mensal de tributos sobre receita + lucro).\n\n" +
              `Memória: valor = ${fmtBRL(derived.impostosPagar.value)}\nFonte: ${derived.impostosPagar.origem}`
            }
          />
          <DerivedRow
            source={derived.salariosEncargos}
            highlight="liability"
            hint={
              "Salários e encargos a pagar na abertura — aproximadamente 1 mês de folha (fixa + variável).\n\n" +
              "Fórmula: soma dos costs mês 1 nas categorias 'fixo' + 'variavel' (folha, comissões, INSS, FGTS).\n\n" +
              `Memória: valor = ${fmtBRL(derived.salariosEncargos.value)}\nFonte: ${derived.salariosEncargos.origem}`
            }
          />
        </div>

        {derived.emprestimosCP.value + derived.emprestimosLP.value === 0 && (
          <div className="mt-3 rounded-md border border-dashed border-muted-foreground/25 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            <div className="font-medium">Nenhum contrato de dívida cadastrado</div>
            <div className="mt-0.5">
              Empréstimos CP/LP ficam em R$ 0,00 até você adicionar contratos.{" "}
              <button
                type="button"
                onClick={() => {
                  document.getElementById("debt-contracts-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                + Adicionar contrato
              </button>
            </div>
          </div>
        )}
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
              <strong>✓ Abertura equilibrada</strong> — Ativo{" "}
              {fmtBRL(derived.totals.ativo)} = Passivo + PL{" "}
              {fmtBRL(derived.totals.passivo + derived.totals.pl)}. O Balanço
              de fechamento será derivado por construção.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>
                  Abertura desequilibrada em {fmtBRL(derived.totals.diferenca)}.
                </strong>{" "}
                Ativo {fmtBRL(derived.totals.ativo)} · Passivo{" "}
                {fmtBRL(derived.totals.passivo)} · PL{" "}
                {fmtBRL(derived.totals.pl)}.
              </span>
            </div>
            <button
              type="button"
              onClick={ajustarLucros}
              title={
                "Lucros/Prejuízos Acumulados é a conta de fechamento histórico do PL. " +
                "O plug representa os resultados de exercícios anteriores não distribuídos " +
                "(pode ser positivo — lucros retidos — ou negativo — prejuízos acumulados). " +
                "Este ajuste absorve a diferença sem alterar rubricas operacionais."
              }
              className="self-start rounded bg-destructive px-2 py-1 text-[10px] font-bold uppercase text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Ajustar Lucros Acumulados (plug: {fmtBRL(derived.totals.diferenca)})
            </button>
            <span className="text-[10px] opacity-80">
              O ajuste vai para Lucros/Prejuízos Acumulados — único plug
              contábil aceitável.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


