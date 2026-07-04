import { useEffect, useMemo, useRef } from "react";
import { useFinance, usePatchCashflow, useFinanceReadOnly } from "@/engines/finance/AppStateContext";
import { toast } from "sonner";
import { fmtBRL, MESES } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { MoneyInput, SectionTitle, StatCard } from "@/components/sim/shared/primitives";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DFCTable } from "@/components/sim/cashflow/DFCTable";
import { PermutasCard } from "@/components/sim/tax/PermutasCard";


// Estilo padrão do tooltip dos gráficos (DRY)
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;
const TOOLTIP_ITEM = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--popover-foreground)", fontWeight: 600 } as const;

// Orquestrador da aba Cashflow — KPIs, alertas, NonOpTable, DFCTable, runway e gráfico.
// As tabelas detalhadas vivem em src/components/sim/cashflow/*.tsx.
export function CashflowTab() {
  const { state } = useFinance();
  const patchCashflow = usePatchCashflow();
  // Em modo somente leitura (link compartilhado), escondemos seções
  // de edição e o gráfico de projeção para focar no resumo.
  const readOnly = useFinanceReadOnly();
  // SSOT: reusa o cf do FinancialModel (cacheado por WeakMap), evita 2ª passada.
  const { cf, ind } = useFinanceModel(state);
  

  const setCaixaMin = (v: number) => patchCashflow({ caixaMinimo: v });

  const limiar = state.cashflow.limiarAlerta ?? -10000;
  const setLimiar = (v: number) => patchCashflow({ limiarAlerta: v });

  const mesesCriticos = useMemo(
    () =>
      MESES.map((mes, i) => ({ mes, saldo: cf.saldoFinal[i], idx: i })).filter(
        (m) => m.saldo <= limiar,
      ),
    [cf.saldoFinal, limiar],
  );

  // Chave estável para o useEffect
  const mesesCriticosKey = useMemo(
    () => mesesCriticos.map((m) => `${m.mes}:${m.saldo}`).join("|"),
    [mesesCriticos],
  );

  // Toast discreto quando há novo mês crítico
  const lastNotifiedRef = useRef<string>("");
  useEffect(() => {
    if (mesesCriticos.length === 0) {
      lastNotifiedRef.current = "";
      return;
    }
    const key = mesesCriticos.map((m) => m.mes).join(",");
    if (key !== lastNotifiedRef.current) {
      lastNotifiedRef.current = key;
      const primeiro = mesesCriticos[0];
      toast.warning(`Atenção — saldo projetado cai abaixo do limiar em ${primeiro.mes}`, {
        description: `Saldo previsto: ${fmtBRL(primeiro.saldo)} · Limiar: ${fmtBRL(limiar)}`,
      });
    }
  }, [mesesCriticosKey, limiar, mesesCriticos]);





  // Usar cf.alertas e cf.totais.pioresMes (já calculados pela engine)
  const alertas = cf.alertas;
  const piorMes = cf.totais.pioresMes;

  // Mapa de meses críticos: destaca pontos no gráfico.
  const criticalByMes = useMemo(() => {
    const map: Record<string, "negativo" | "abaixoMinimo"> = {};
    alertas.forEach((a) => {
      if (map[a.mes] !== "negativo") map[a.mes] = a.tipo;
    });
    return map;
  }, [alertas]);

  const chart = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        saldo: cf.saldoFinal[i],
        minimo: state.cashflow.caixaMinimo,
        critical: criticalByMes[m] ?? null,
      })),
    [cf.saldoFinal, state.cashflow.caixaMinimo, criticalByMes],
  );

  const burnRunway = useMemo(() => {
    const burnMensal = cf.fluxoOperacional.map((v) => -v);
    const burnMedio12 = burnMensal.reduce((a, b) => a + b, 0) / 12;
    const burnMedio3 = burnMensal.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const colchao = state.capital.disponibilidades + (state.capital.contasReceber || 0);
    const queimando = burnMedio3 > 0;
    const runwayMeses = queimando ? colchao / burnMedio3 : Infinity;
    return { burnMedio12, burnMedio3, runwayMeses, queimando };
  }, [cf.fluxoOperacional, state.capital.disponibilidades, state.capital.contasReceber]);

  const caixaAtual = state.capital.disponibilidades;
  const recebiveis = state.capital.contasReceber || 0;
  const runwayLabel = !burnRunway.queimando
    ? "∞ (operação gera caixa)"
    : burnRunway.runwayMeses >= 24
      ? "24+ meses"
      : `${burnRunway.runwayMeses.toFixed(1)} meses`;
  const runwayTone: "pos" | "neg" | "warn" = !burnRunway.queimando
    ? "pos"
    : burnRunway.runwayMeses >= 12
      ? "pos"
      : burnRunway.runwayMeses >= 6
        ? "warn"
        : "neg";

  // Top 3 meses mais críticos: menores saldos do ano (independente de bater o mínimo).
  const top3Criticos = useMemo(
    () =>
      MESES.map((mes, i) => ({
        mes,
        saldo: cf.saldoFinal[i],
        deficitVsMin: state.cashflow.caixaMinimo - cf.saldoFinal[i],
      }))
        .sort((a, b) => a.saldo - b.saldo)
        .slice(0, 3),
    [cf.saldoFinal, state.cashflow.caixaMinimo],
  );

  // Tone do "Saldo final (Dez)" reflete o PRÓPRIO valor de dez.
  const saldoDez = cf.totais.saldoFinal;
  const saldoDezTone: "pos" | "neg" | "warn" =
    saldoDez < 0 ? "neg" : saldoDez < state.cashflow.caixaMinimo ? "warn" : "pos";

  return (
    <div className="space-y-6">

      {/* Sumário — KPIs no topo */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Recebimentos no ano"
          value={fmtBRL(cf.totais.recebimentos)}
          tone="pos"
          hint={{
            description:
              "Total efetivamente recebido em caixa no ano, já descontada a inadimplência e respeitando o PMR (prazo médio de recebimento).",
            formula: "Σ Recebimentos mensais (Receita Líquida defasada pelo PMR)",
            calc: `Σ 12 meses\n= ${fmtBRL(cf.totais.recebimentos)}`,
          }}
        />
        <StatCard
          label="Despesas no ano"
          value={fmtBRL(cf.totais.pagamentosTotais)}
          tone="neg"
          hint={{
            description:
              "Total de saídas operacionais de caixa no ano: fornecedores (PMP), custos fixos e variáveis, despesas financeiras e impostos pagos (defasados em 1 mês).",
            formula: "Σ (Fornecedores + Fixos + Variáveis + Financeiros + Impostos)",
            calc: `Σ 12 meses\n= ${fmtBRL(cf.totais.pagamentosTotais)}`,
          }}
        />
        <StatCard
          label="Fluxo Operacional"
          value={fmtBRL(cf.totais.fluxoOperacional)}
          tone={cf.totais.fluxoOperacional >= 0 ? "pos" : "neg"}
          hint={{
            description:
              "Caixa gerado (ou consumido) pela operação no ano. Já considera PMR/PMP e impostos pagos com 1 mês de defasagem.",
            formula: "Recebimentos − Pagamentos Operacionais − Impostos pagos",
            calc: `${fmtBRL(cf.totais.recebimentos)} − ${fmtBRL(cf.totais.pagamentosTotais)}\n= ${fmtBRL(cf.totais.fluxoOperacional)}`,
          }}
        />
        <div className="relative">
          {mesesCriticos.length > 0 && (
            <Badge variant="destructive" className="absolute right-2 top-2 z-10 gap-1">
              <AlertTriangle className="h-3 w-3" />
              Crítico
            </Badge>
          )}
          <StatCard
            label="Saldo final (Dez)"
            value={fmtBRL(saldoDez)}
            tone={saldoDezTone}
            sub={piorMes ? `Pior mês: ${piorMes.mes} = ${fmtBRL(piorMes.saldo)}` : undefined}
            hint={{
              description:
                "Saldo de caixa projetado para dezembro. Deve ficar acima do caixa mínimo de segurança definido na configuração.",
              formula: "Saldo Inicial + Σ Variações mensais de caixa",
              calc: `Saldo projetado em Dez\n= ${fmtBRL(saldoDez)}`,
            }}
          />
        </div>
      </div>

      {/* Permutas simples — movimentações de caixa não operacionais (sem juros,
          contrato ou amortização). Logo após os KPIs. */}
      {!readOnly && <PermutasCard />}

      {/* Movimentações de caixa não operacionais foram movidas para a aba Retiradas e Aportes. */}


      {/* Tabela detalhada */}
      <DFCTable state={state} cf={cf} />

      {/* Resumo: 3 meses mais críticos */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">3 meses mais críticos do ano</h4>
          <span className="text-[10px] text-muted-foreground">
            menor saldo projetado · déficit vs. caixa mínimo
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {top3Criticos.map((c, idx) => {
            const negativo = c.saldo < 0;
            const abaixoMin = !negativo && c.saldo < state.cashflow.caixaMinimo;
            const tone = negativo
              ? "var(--destructive)"
              : abaixoMin
                ? "var(--warning)"
                : "var(--success)";
            const status = negativo
              ? "Caixa negativo"
              : abaixoMin
                ? "Abaixo do mínimo"
                : "Dentro do mínimo";
            return (
              <div
                key={c.mes}
                className="rounded-md border bg-background/40 p-3"
                style={{ borderColor: `color-mix(in oklab, ${tone} 40%, transparent)` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-[10px] font-bold text-muted-foreground">
                      {idx + 1}º
                    </span>
                    <span className="text-sm font-semibold">{c.mes}</span>
                  </div>
                  <span
                    className="text-[9.5px] font-semibold uppercase tracking-wider"
                    style={{ color: tone }}
                  >
                    {status}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                      Saldo
                    </div>
                    <div className="num font-semibold" style={{ color: tone }}>
                      {fmtBRL(c.saldo)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                      Déficit vs. mín.
                    </div>
                    <div
                      className={`num font-semibold ${c.deficitVsMin > 0 ? "text-neg" : "text-muted-foreground"}`}
                    >
                      {c.deficitVsMin > 0 ? fmtBRL(c.deficitVsMin) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Burn Rate & Runway */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <SectionTitle hint="Burn rate é o ritmo de consumo de caixa pela operação. Runway estima por quantos meses o caixa atual + recebíveis sustentam a empresa, considerando o burn médio dos últimos 3 meses.">
          Burn Rate & Runway
        </SectionTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <StatCard
            label="Burn rate médio (12m)"
            value={
              burnRunway.burnMedio12 > 0
                ? `${fmtBRL(burnRunway.burnMedio12)}/mês`
                : `+${fmtBRL(-burnRunway.burnMedio12)}/mês`
            }
            tone={burnRunway.burnMedio12 > 0 ? "neg" : "pos"}
            sub={burnRunway.burnMedio12 > 0 ? "Caixa consumido por mês" : "Operação gerou caixa"}
            hint={{
              description: "Média mensal de consumo (ou geração) operacional de caixa no ano.",
              formula: "Σ (Pagamentos Operacionais − Recebimentos) ÷ 12",
              calc: `(${fmtBRL(cf.totais.pagamentosTotais)} − ${fmtBRL(cf.totais.recebimentos)}) ÷ 12\n= ${fmtBRL(burnRunway.burnMedio12)}/mês`,
            }}
          />
          <StatCard
            label="Burn rate (últimos 3m)"
            value={
              burnRunway.burnMedio3 > 0
                ? `${fmtBRL(burnRunway.burnMedio3)}/mês`
                : `+${fmtBRL(-burnRunway.burnMedio3)}/mês`
            }
            tone={burnRunway.burnMedio3 > 0 ? "neg" : "pos"}
            sub="Base de cálculo do runway"
            hint={{
              description:
                "Média de queima de caixa nos últimos 3 meses do horizonte projetado. Mais sensível ao momento atual da operação.",
              formula: "Σ (−Fluxo Operacional dos últimos 3 meses) ÷ 3",
              calc: `Média dos 3 meses finais\n= ${fmtBRL(burnRunway.burnMedio3)}/mês`,
            }}
          />
          <StatCard
            label="Runway"
            value={runwayLabel}
            tone={runwayTone}
            sub={`Caixa ${fmtBRL(caixaAtual)} + CR ${fmtBRL(recebiveis)}`}
            hint={{
              description:
                "Quantos meses o colchão de caixa + recebíveis sustenta a empresa, mantido o burn médio dos últimos 3 meses.",
              formula: "(Disponibilidades + Contas a Receber) ÷ Burn médio 3m",
              calc:
                burnRunway.burnMedio3 > 0
                  ? `(${fmtBRL(caixaAtual)} + ${fmtBRL(recebiveis)}) ÷ ${fmtBRL(burnRunway.burnMedio3)}\n= ${runwayLabel}`
                  : "Sem burn (operação gerando caixa) — runway indefinido",
            }}
          />
        </div>
        {burnRunway.queimando && burnRunway.runwayMeses < 6 && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-semibold text-destructive">Runway curto: menos de 6 meses</div>
              <div className="mt-0.5 text-muted-foreground">
                Considere reduzir custos, captar capital ou acelerar recebimentos para estender a
                sobrevida operacional.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Gráfico de saldo — escondido em modo somente leitura */}
      {!readOnly && (
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Saldo de caixa projetado (12 meses)</h4>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Caixa mínimo:</span>
              <div className="w-32">
                <MoneyInput value={state.cashflow.caixaMinimo} onChange={setCaixaMin} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Limiar crítico:</span>
              <div className="w-32">
                <MoneyInput value={limiar} onChange={setLimiar} />
              </div>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chart}>
            <defs>
              <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={TOOLTIP_ITEM}
              labelStyle={TOOLTIP_LABEL}
              formatter={(v: number) => fmtBRL(v)}
            />
            <ReferenceLine
              y={state.cashflow.caixaMinimo}
              stroke="var(--warning)"
              strokeDasharray="4 4"
              label={{ value: "mínimo", fill: "var(--warning)", fontSize: 10, position: "right" }}
            />
            <ReferenceLine
              y={limiar}
              stroke="var(--destructive)"
              strokeDasharray="6 3"
              label={{
                value: "limiar",
                fill: "var(--destructive)",
                fontSize: 10,
                position: "right",
              }}
            />
            <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="saldo"
              stroke="var(--success)"
              strokeWidth={2}
              fill="url(#gSaldo)"
              dot={(props: {
                cx?: number;
                cy?: number;
                payload?: { critical?: "negativo" | "abaixoMinimo" | null };
                index?: number;
              }) => {
                const { cx, cy, payload, index } = props;
                const tipo = payload?.critical as "negativo" | "abaixoMinimo" | null;
                if (!tipo) return <circle key={`dot-${index}`} cx={cx} cy={cy} r={0} />;
                const color = tipo === "negativo" ? "var(--destructive)" : "var(--warning)";
                return (
                  <circle
                    key={`dot-${index}`}
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={color}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 6, stroke: "var(--background)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--destructive)" }} />
            Caixa negativo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--warning)" }} />
            Abaixo do mínimo
          </span>
        </div>
      </div>
      )}
    </div>
  );
}
