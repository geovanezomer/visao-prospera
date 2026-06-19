import { useMemo } from "react";
import { AppState } from "@/engines/finance/types";
import {
  buildDRE,
  calcIndicators,
  diagnose,
  irShieldForRegime,
  resolveEffectiveRegime,
  type DRE,
  type Indicators,
} from "@/engines/finance";
import { buildCashFlow, type CashFlow } from "@/engines/finance/cashflow";
import {
  crossValidate,
  groupBySeverity,
  type ValidationWarning,
} from "@/engines/finance/crossValidation";
import { fmtBRL, fmtPct, sum } from "@/engines/finance/format";
import {
  AlertTriangle,
  TrendingDown,
  Scissors,
  ShieldAlert,
  Info,
  AlertOctagon,
} from "lucide-react";
import { HelpTip, SectionTitle } from "@/components/sim/shared/primitives";

/**
 * Banner de alertas críticos — consolida no topo da aba Análises:
 *  • DSCR (Debt Service Coverage Ratio) = EBITDA / (Juros + Amortizações).
 *  • Pior mês de caixa (saldo final mínimo do ano).
 *  • Diagnósticos `danger` automáticos.
 *  • Break-even dinâmico: corte mínimo de custo fixo para fechar o gap de caixa.
 *
 * Aceita um `model` precomputado para evitar recalcular DRE/indicadores/CF
 * quando a DiagnosisTab já fez isso no pai (corrige duplicação de engine).
 */
export interface CriticalAlertsModel {
  dre: DRE;
  ind: Indicators;
  cf: CashFlow;
  regime: AppState["tax"]["regime"];
}

export function CriticalAlertsBanner({
  state,
  model,
}: {
  state: AppState;
  model?: CriticalAlertsModel;
}) {
  const data = useMemo(() => {
    // Verdade absoluta: regime efetivo (Simples pode ter excedido limite).
    const regime = model?.regime ?? resolveEffectiveRegime(state);
    const dre = model?.dre ?? buildDRE(state, regime).dre;
    const ind = model?.ind ?? calcIndicators(state, dre);
    const cf = model?.cf ?? buildCashFlow(state);
    const diag = diagnose(state, dre, ind);

    const ebitdaAnual = sum(dre.ebitda);
    const jurosAnual = sum(dre.custosFinanceirosTotal);
    const amortAnual = sum(state.cashflow.amortizacoes);
    const servicoDivida = jurosAnual + amortAnual;
    // DSCR só é definido quando há serviço de dívida. Sem dívida, exibimos "—".
    const dscr = servicoDivida > 1 ? ebitdaAnual / servicoDivida : null;

    const pior = cf.totais.pioresMes;
    const caixaMin = state.cashflow.caixaMinimo || 0;
    const gap = pior ? Math.max(0, caixaMin - pior.saldo) : 0;

    // Break-even cut: corte ANUAL em custo fixo para zerar o gap mensal recorrente.
    const custosFixosAnuais = sum(dre.custosFixos);
    const cutPctFixos = custosFixosAnuais > 0 ? (gap / custosFixosAnuais) * 100 : 0;
    // Shield do regime EFETIVO (não o nominal — se Simples virou Presumido, shield muda).
    const shield = irShieldForRegime(regime);
    // Gap é déficit pontual do pior mês — não perpétuo. Tratamos como economia
    // ONE-SHOT: VPL ≈ Corte × (1 − IR). Multiplicar por 1/WACC inflaria 10–20×.
    const vplDelta = gap > 0 ? gap * (1 - shield) : 0;

    const dangers = diag.filter((d) => d.level === "danger");

    // Validação cruzada entre abas: incoerências estruturais/fiscais/operacionais.
    // Reusa o `dre` e `ind` já calculados acima — não há custo extra de engine.
    const crossWarnings = crossValidate(state, { dre, ind });
    const crossGrouped = groupBySeverity(crossWarnings);

    return {
      ind,
      ebitdaAnual,
      jurosAnual,
      amortAnual,
      servicoDivida,
      dscr,
      pior,
      caixaMin,
      gap,
      custosFixosAnuais,
      cutPctFixos,
      shield,
      vplDelta,
      dangers,
      crossWarnings,
      crossGrouped,
    };
  }, [state, model]);

  const {
    ind,
    jurosAnual,
    dscr,
    pior,
    caixaMin,
    gap,
    custosFixosAnuais,
    cutPctFixos,
    shield,
    vplDelta,
    dangers,
    crossGrouped,
  } = data;

  const dscrTone = dscr == null ? "neutral" : dscr < 1.2 ? "danger" : dscr < 1.5 ? "warn" : "ok";
  const piorTone = !pior
    ? "neutral"
    : pior.saldo < 0
      ? "danger"
      : pior.saldo < caixaMin
        ? "warn"
        : "ok";
  // Sem juros (dívida zerada), cobertura não é alerta — vira neutro em vez de cair no ramo "ok" fragilmente.
  const cobTone =
    jurosAnual <= 1
      ? "neutral"
      : ind.coberturaJuros < 2
        ? "danger"
        : ind.coberturaJuros < 3
          ? "warn"
          : "ok";

  const hasAnyAlert =
    dscrTone === "danger" ||
    piorTone === "danger" ||
    cobTone === "danger" ||
    gap > 0 ||
    dangers.length > 0 ||
    crossGrouped.error.length > 0;

  return (
    <section className="space-y-3">
      <SectionTitle
        hint={{
          description:
            "Métricas críticas consolidadas — leitura rápida para decisão imediata em reunião com o cliente.",
        }}
      >
        Alertas críticos
      </SectionTitle>

      <div
        className={`rounded-lg border p-4 ${hasAnyAlert ? "border-[var(--destructive)]/50 bg-[var(--destructive)]/5" : "border-[var(--success)]/40 bg-[var(--success)]/5"}`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          {hasAnyAlert ? (
            <>
              <ShieldAlert className="h-5 w-5 text-neg" /> Riscos imediatos detectados
            </>
          ) : (
            <>
              <ShieldAlert className="h-5 w-5 text-pos" /> Nenhum risco crítico no horizonte de 12
              meses
            </>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric
            icon={<TrendingDown className="h-4 w-4" />}
            label="DSCR"
            value={dscr == null ? "—" : `${dscr.toFixed(2)}×`}
            tone={dscrTone}
            desc="Debt Service Coverage Ratio. Bancos exigem ≥ 1,5× em covenants."
            formula="EBITDA ÷ (Juros + Amortizações)"
            sub={
              dscr == null
                ? "Sem dívida onerosa cadastrada"
                : dscr < 1.5
                  ? "⚠ Abaixo do covenant típico de 1,5×"
                  : "Dentro de faixa segura"
            }
          />
          <Metric
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Cobertura de juros"
            // coberturaJuros é capada em CAP_COB (999) — sempre finita.
            value={jurosAnual <= 1 ? "—" : `${ind.coberturaJuros.toFixed(1)}×`}
            tone={cobTone}
            desc="Quantas vezes o EBIT cobre os juros do ano."
            formula="EBIT ÷ Juros"
            sub={
              jurosAnual <= 1
                ? "Sem juros relevantes no período"
                : ind.coberturaJuros < 2
                  ? "⚠ Risco real de inadimplência financeira"
                  : "OK"
            }
          />
          <Metric
            icon={<TrendingDown className="h-4 w-4" />}
            label="Pior mês de caixa"
            value={pior ? fmtBRL(pior.saldo) : "—"}
            tone={piorTone}
            desc="Menor saldo final projetado nos próximos 12 meses (DFC)."
            formula="min(saldoFinal[i])"
            sub={pior ? `${pior.mes} · mínimo definido: ${fmtBRL(caixaMin)}` : ""}
          />
        </div>

        {gap > 0 && (
          <div className="mt-4 rounded-md border border-[var(--warning)]/50 bg-[var(--warning)]/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Scissors className="h-4 w-4 text-[var(--warning)]" />
              Break-even dinâmico — corte mínimo para fechar o gap
              <HelpTip
                text="Quanto cortar em custos fixos anuais para o saldo do pior mês atingir o caixa mínimo. Impacto em VPL trata o gap como déficit pontual (one-shot), aplicando apenas o escudo fiscal — sem perpetuidade."
                formula="Gap ÷ Custos Fixos · ΔVPL ≈ Gap × (1 − IR)"
              />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">
              <Cell label="Gap a cobrir" v={fmtBRL(gap)} tone="warn" />
              <Cell
                label="Corte em fixos"
                v={
                  custosFixosAnuais > 0
                    ? `${fmtBRL(gap)} (${fmtPct(cutPctFixos / 100)})`
                    : fmtBRL(gap)
                }
                sub={
                  custosFixosAnuais > 0
                    ? `Base: ${fmtBRL(custosFixosAnuais)}/ano`
                    : "Sem custos fixos cadastrados"
                }
              />
              <Cell
                label="Impacto em VPL (one-shot)"
                v={`+${fmtBRL(vplDelta)}`}
                tone="pos"
                sub={`Regime efetivo · shield ${fmtPct(shield)}`}
              />
            </div>
            <p className="mt-3 text-[11px] italic text-muted-foreground">
              Sugestão: priorize cortes em capex não-essencial e despesas administrativas antes de
              mexer em folha operacional. Teste a alavanca na aba <strong>Simulador</strong>.
            </p>
          </div>
        )}

        {dangers.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Outros riscos críticos do diagnóstico
            </div>
            {dangers.map((d, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-[var(--destructive)]/30 bg-background/40 p-2 text-xs"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neg" />
                <div>
                  <span className="font-semibold text-foreground">{d.title}</span>
                  <span className="ml-2 text-muted-foreground">{d.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CrossValidationSection grouped={crossGrouped} />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Validação cruzada entre abas — incoerências estruturais/fiscais/operacionais.
// Renderizada como card separado abaixo do banner de alertas críticos.
// Errors sempre visíveis; warns/info colapsáveis via <details>.
// ─────────────────────────────────────────────────────────────────────
function CrossValidationSection({
  grouped,
}: {
  grouped: { error: ValidationWarning[]; warn: ValidationWarning[]; info: ValidationWarning[] };
}) {
  const totalWarns = grouped.warn.length + grouped.info.length;
  if (grouped.error.length === 0 && totalWarns === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertOctagon className="h-4 w-4 text-primary" />
        Validação cruzada entre abas
        <HelpTip text="Incoerências estruturais, fiscais e operacionais detectadas no estado atual. Diferente do diagnóstico clínico, aqui são problemas de consistência de DADOS — corrija antes de apresentar ao cliente." />
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">
          {grouped.error.length > 0 && (
            <span className="text-destructive font-semibold">{grouped.error.length} erro(s)</span>
          )}
          {grouped.error.length > 0 && totalWarns > 0 && " · "}
          {totalWarns > 0 && <span>{totalWarns} aviso(s)</span>}
        </span>
      </div>

      {grouped.error.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {grouped.error.map((w) => (
            <WarningRow key={w.id} w={w} />
          ))}
        </div>
      )}

      {totalWarns > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
            ▸ Mostrar {totalWarns} aviso(s) e info(s)
          </summary>
          <div className="mt-2 space-y-1.5">
            {grouped.warn.map((w) => (
              <WarningRow key={w.id} w={w} />
            ))}
            {grouped.info.map((w) => (
              <WarningRow key={w.id} w={w} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function WarningRow({ w }: { w: ValidationWarning }) {
  const sevColor =
    w.severity === "error"
      ? "border-destructive/40 bg-destructive/5"
      : w.severity === "warn"
        ? "border-[var(--warning)]/40 bg-[var(--warning)]/5"
        : "border-border/40 bg-background/40";
  const Icon = w.severity === "error" ? AlertOctagon : w.severity === "warn" ? AlertTriangle : Info;
  const iconColor =
    w.severity === "error"
      ? "text-destructive"
      : w.severity === "warn"
        ? "text-[var(--warning)]"
        : "text-muted-foreground";
  return (
    <div className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${sevColor}`}>
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground">{w.title}</div>
        <div className="mt-0.5 text-muted-foreground">{w.detail}</div>
        {w.fixHint && (
          <div className="mt-1 text-[11px] italic text-muted-foreground/80">
            <span className="font-semibold not-italic">Como corrigir:</span> {w.fixHint}
          </div>
        )}
      </div>
    </div>
  );
}

function toneClass(tone: "ok" | "warn" | "danger" | "neutral") {
  if (tone === "danger") return "text-neg";
  if (tone === "warn") return "text-[var(--warning)]";
  if (tone === "ok") return "text-pos";
  return "";
}

function Metric({
  icon,
  label,
  value,
  tone,
  desc,
  formula,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger" | "neutral";
  desc: string;
  formula: string;
  sub: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label} <HelpTip text={desc} formula={formula} />
      </div>
      <div className={`mono mt-1 text-xl font-semibold ${toneClass(tone)}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Cell({
  label,
  v,
  sub,
  tone,
}: {
  label: string;
  v: string;
  sub?: string;
  tone?: "ok" | "warn" | "danger" | "pos";
}) {
  const cls =
    tone === "warn"
      ? "text-[var(--warning)]"
      : tone === "danger"
        ? "text-neg"
        : tone === "pos"
          ? "text-pos"
          : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mono mt-1 text-sm font-semibold ${cls}`}>{v}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
