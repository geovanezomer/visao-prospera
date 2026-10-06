// ============================================================================
// Cockpit (tela inicial do modo Odoo): os instrumentos que um CEO/CFO lê em
// segundos. Todos os números vêm do modelo ancorado no razão; cada
// instrumento diz a fonte (ERP, cálculo ou premissa) e leva à aba de detalhe.
// ============================================================================
import { useMemo, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Gauge,
  Landmark,
  Receipt,
  RefreshCw,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { getFinancialModelCached } from "@/engines/finance/financialModel";
import { diagnose } from "@/engines/finance/diagnose";
import { fmtBRL, fmtBRLCompact } from "@/engines/finance/format";
import { buildEntityData } from "@/engines/odoo/toAppState";
import { computeTrust } from "@/engines/odoo/trust";
import { useOdooCockpitContext } from "./cockpit";
import { usePeriodLabels } from "./usePeriodLabels";
import { ConciliacaoCard } from "./ConciliacaoCard";
import { RetrotesteCard } from "./RetrotesteCard";
import { cn } from "@/lib/utils";

const sum = (a: number[]) => a.reduce((x, y) => x + (y || 0), 0);
const pct = (v: number, d = 1) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
const go = (tab: string) => window.dispatchEvent(new CustomEvent("gz-set-tab", { detail: tab }));

type Fonte = "ERP" | "Cálculo" | "Premissa";

function Instrument({
  title,
  icon,
  fonte,
  tab,
  children,
  className,
}: {
  title: string;
  icon: ReactNode;
  fonte: Fonte;
  tab?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => tab && go(tab)}
      className={cn(
        "group flex flex-col rounded-lg border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/50",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
            fonte === "ERP" && "bg-primary/15 text-primary",
            fonte === "Cálculo" && "border border-border text-muted-foreground",
            fonte === "Premissa" && "bg-amber-500/15 text-amber-600",
          )}
          title={
            fonte === "ERP"
              ? "Número do razão do Odoo"
              : fonte === "Cálculo"
                ? "Calculado a partir dos números do Odoo"
                : "Depende de premissa configurada no app"
          }
        >
          {fonte}
        </span>
      </div>
      {children}
    </button>
  );
}

function Spark({ values, className }: { values: number[]; className?: string }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const pts = values.map(
    (v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${30 - ((v - min) / span) * 28 - 1}`,
  );
  const zero = 30 - ((0 - min) / span) * 28 - 1;
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className={cn("h-10 w-full", className)}
      aria-hidden
    >
      <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-border" strokeWidth="0.5" />
      <polyline
        points={pts.join(" ")}
        fill="none"
        className="stroke-primary"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Big({ children, tone }: { children: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div
      className={cn(
        "text-2xl font-semibold tabular-nums",
        tone === "pos" && "text-emerald-600",
        tone === "neg" && "text-destructive",
      )}
    >
      {children}
    </div>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular-nums font-medium",
          tone === "pos" && "text-emerald-600",
          tone === "neg" && "text-destructive",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function CockpitHome() {
  const state = useFinanceState();
  const cockpit = useOdooCockpitContext();
  const MESES = usePeriodLabels();
  const model = getFinancialModelCached(state);
  const { dre, cf, ind, val } = model;

  const trust = useMemo(
    () =>
      cockpit?.snapshot && cockpit.entity && cockpit.data
        ? computeTrust(cockpit.snapshot, cockpit.entity, cockpit.data, {
            lastError: cockpit.lastError,
          })
        : null,
    [cockpit?.snapshot, cockpit?.entity, cockpit?.data, cockpit?.lastError],
  );

  // Receita dos 12 meses anteriores (mesma entidade), quando o retrato tem histórico.
  const anterior = useMemo(() => {
    const s = cockpit?.snapshot;
    const e = cockpit?.entity;
    const months = cockpit?.data?.months;
    if (!s || !e || !months?.length) return null;
    const endIdx = s.months.indexOf(months[months.length - 1]) - 12;
    if (endIdx < 11) return null;
    const d = buildEntityData(s, e, s.months[endIdx]);
    const rb = sum(d.actuals.pl.receita_bruta);
    return rb > 0 ? rb : null;
  }, [cockpit?.snapshot, cockpit?.entity, cockpit?.data]);

  const alertas = useMemo(
    () =>
      diagnose(state, dre, ind)
        .filter((d) => d.level !== "ok")
        .slice(0, 5),
    [state, dre, ind],
  );

  if (!cockpit?.active) return null;

  const receitaBruta = sum(dre.receitaBruta);
  const receitaLiq = sum(dre.receitaLiquida);
  const ebitda = sum(dre.ebitda);
  const ll = sum(dre.lucroLiquido);
  const caixa = cf.saldoFinal[11] ?? 0;
  const caixaIni = cf.saldoInicial[0] ?? 0;
  const burn3 = (cf.fluxoOperacional[9] + cf.fluxoOperacional[10] + cf.fluxoOperacional[11]) / 3;
  const runway = burn3 < 0 ? caixa / -burn3 : Infinity;
  const margemMensal = dre.ebitda.map((e, i) =>
    dre.receitaLiquida[i] ? (e / dre.receitaLiquida[i]) * 100 : 0,
  );
  const impostos = sum(dre.impostosTotal);
  const yoy = anterior ? ((receitaBruta - anterior) / anterior) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* 1 Caixa */}
        <Instrument
          title="Caixa"
          icon={<Banknote className="h-3.5 w-3.5" />}
          fonte="ERP"
          tab="caixa"
        >
          <Big tone={caixa < 0 ? "neg" : undefined}>{fmtBRLCompact(caixa)}</Big>
          <Spark values={cf.saldoFinal} />
          <Line
            label={`Variação desde ${MESES[0]}`}
            value={`${caixa - caixaIni >= 0 ? "+" : ""}${fmtBRLCompact(caixa - caixaIni)}`}
            tone={caixa - caixaIni >= 0 ? "pos" : "neg"}
          />
          <Line
            label="Fôlego (ritmo dos últimos 3 meses)"
            value={Number.isFinite(runway) ? `${runway.toFixed(1)} meses` : "operação gera caixa"}
            tone={Number.isFinite(runway) && runway < 6 ? "neg" : "pos"}
          />
        </Instrument>

        {/* 2 EBITDA */}
        <Instrument
          title="EBITDA (12 meses)"
          icon={<Activity className="h-3.5 w-3.5" />}
          fonte="ERP"
          tab="dre"
        >
          <Big tone={ebitda < 0 ? "neg" : undefined}>{fmtBRLCompact(ebitda)}</Big>
          <Spark values={margemMensal} />
          <Line label="Margem EBITDA" value={pct(receitaLiq ? (ebitda / receitaLiq) * 100 : 0)} />
          <Line label="Lucro líquido" value={fmtBRLCompact(ll)} tone={ll < 0 ? "neg" : "pos"} />
        </Instrument>

        {/* 3 Receita */}
        <Instrument
          title="Receita bruta (12 meses)"
          icon={<Receipt className="h-3.5 w-3.5" />}
          fonte="ERP"
          tab="receitas"
        >
          <Big>{fmtBRLCompact(receitaBruta)}</Big>
          <Spark values={dre.receitaBruta} />
          <Line
            label="vs. 12 meses anteriores"
            value={yoy === null ? "sem histórico comparável" : `${yoy >= 0 ? "+" : ""}${pct(yoy)}`}
            tone={yoy === null ? undefined : yoy >= 0 ? "pos" : "neg"}
          />
          <Line
            label="Melhor mês"
            value={MESES[dre.receitaBruta.indexOf(Math.max(...dre.receitaBruta))]}
          />
        </Instrument>

        {/* 4 Saúde dos dados */}
        <Instrument
          title="Saúde dos dados"
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          fonte="ERP"
        >
          {trust && (
            <>
              <div className="flex items-center gap-2">
                {trust.level === "ok" ? (
                  <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                ) : trust.level === "warn" ? (
                  <AlertTriangle className="h-7 w-7 text-amber-500" />
                ) : (
                  <XCircle className="h-7 w-7 text-destructive" />
                )}
                <span className="text-sm font-semibold">
                  {trust.level === "ok"
                    ? "Conferidos"
                    : trust.level === "warn"
                      ? "Com ressalvas"
                      : "Com problema"}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {trust.checks
                  .filter((c) => c.level !== "ok")
                  .slice(0, 3)
                  .map((c) => (
                    <li key={c.id} className="text-[11px] text-muted-foreground">
                      • {c.title}
                    </li>
                  ))}
                {trust.checks.every((c) => c.level === "ok") && (
                  <li className="text-[11px] text-muted-foreground">
                    {trust.checks.length} conferências OK — detalhes na barra do topo.
                  </li>
                )}
              </ul>
            </>
          )}
        </Instrument>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 5 Ciclo de caixa */}
        <Instrument
          title="Capital de giro"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          fonte="Cálculo"
          tab="indicadores"
        >
          <Line
            label="Prazo médio de recebimento"
            value={`${Math.round(state.revenue.pmr)} dias`}
          />
          <Line label="Prazo médio de pagamento" value={`${Math.round(state.revenue.pmp)} dias`} />
          <Line
            label="Ciclo financeiro"
            value={`${Math.round(ind.cicloFinanceiro)} dias`}
            tone={ind.cicloFinanceiro > 60 ? "warn" : undefined}
          />
          <Line label="Necessidade de capital de giro" value={fmtBRLCompact(ind.ncg)} />
          <Line
            label="Liquidez corrente"
            value={`${ind.liquidezCorrente.toFixed(2)}×`}
            tone={ind.liquidezCorrente < 1 ? "neg" : "pos"}
          />
        </Instrument>

        {/* 6 Endividamento */}
        <Instrument
          title="Endividamento"
          icon={<Landmark className="h-3.5 w-3.5" />}
          fonte="ERP"
          tab="capital"
        >
          <Line label="Dívida bruta" value={fmtBRLCompact(ind.dividaOnerosa)} />
          <Line
            label="Dívida líquida (− caixa)"
            value={fmtBRLCompact(ind.dividaLiquida)}
            tone={ind.dividaLiquida > 0 ? undefined : "pos"}
          />
          <Line
            label="Dívida líquida / EBITDA"
            value={ebitda > 0 ? `${ind.dividaLiqEbitda.toFixed(2)}×` : "EBITDA negativo"}
            tone={ebitda <= 0 || ind.dividaLiqEbitda > 3 ? "neg" : undefined}
          />
          <Line
            label="Cobertura de juros"
            value={ind.coberturaJuros ? `${ind.coberturaJuros.toFixed(1)}×` : "sem juros"}
            tone={ind.coberturaJuros && ind.coberturaJuros < 2 ? "neg" : undefined}
          />
          <Line
            label="DSCR"
            value={ind.dscr === null ? "sem serviço de dívida" : `${ind.dscr.toFixed(2)}×`}
            tone={ind.dscr !== null && ind.dscr < 1.25 ? "neg" : undefined}
          />
        </Instrument>

        {/* 7 Carga tributária */}
        <Instrument
          title="Carga tributária"
          icon={<Scale className="h-3.5 w-3.5" />}
          fonte="ERP"
          tab="consolidado"
        >
          <Big>{pct(receitaBruta ? (impostos / receitaBruta) * 100 : 0)}</Big>
          <Line label="Tributos sobre vendas" value={fmtBRLCompact(sum(dre.impostosVendas))} />
          <Line label="IRPJ + CSLL" value={fmtBRLCompact(sum(dre.impostos))} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Contabilizado no Odoo. Conciliação com o regime na aba Consolidado.
          </p>
        </Instrument>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 8 DRE ponte */}
        <Instrument
          title="Da receita ao lucro"
          icon={<Gauge className="h-3.5 w-3.5" />}
          fonte="ERP"
          tab="dre"
          className="lg:col-span-2"
        >
          <DreBridge
            linhas={[
              { label: "Receita bruta", valor: receitaBruta, total: true },
              { label: "Deduções e tributos s/ vendas", valor: -(receitaBruta - receitaLiq) },
              { label: "Custo dos produtos/serviços", valor: -sum(dre.cpv) },
              {
                label: "Despesas operacionais",
                valor: -(sum(dre.despesasOperacionais) - sum(dre.outrasReceitasOperacionais)),
              },
              { label: "Depreciação", valor: -sum(dre.depreciacao) },
              { label: "Resultado financeiro", valor: sum(dre.resultadoFinanceiro) },
              { label: "Não operacional", valor: sum(dre.resultadoNaoOperacional) },
              { label: "IRPJ + CSLL", valor: -sum(dre.impostos) },
              { label: "Lucro líquido", valor: ll, total: true },
            ]}
          />
        </Instrument>

        {/* 9 Alertas + valor */}
        <div className="space-y-3">
          <Instrument
            title="Alertas"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            fonte="Cálculo"
            tab="resultados"
          >
            {alertas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum alerta relevante nos indicadores.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {alertas.map((a, i) => (
                  <li key={i} className="flex gap-1.5 text-xs">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        a.level === "danger" ? "bg-destructive" : "bg-amber-500",
                      )}
                    />
                    <span>
                      <strong>{a.title}</strong> —{" "}
                      <span className="text-muted-foreground">{a.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Instrument>
          <Instrument
            title="Valor da empresa (estimado)"
            icon={<Landmark className="h-3.5 w-3.5" />}
            fonte="Premissa"
            tab="valuation"
          >
            <Big>{fmtBRLCompact(val.equityValue.base)}</Big>
            <p className="text-[11px] text-muted-foreground">
              Valor do patrimônio (EV {fmtBRLCompact(val.enterpriseValue.base)} − dívida líquida).
              Depende de múltiplos e custo de capital — revise em Valuation.
            </p>
          </Instrument>
        </div>
      </div>
      <ConciliacaoCard exibido={{ receitaBruta, lucroLiquido: ll }} />
      <RetrotesteCard />
      <p className="text-center text-[11px] text-muted-foreground">
        Período: {MESES[0]} a {MESES[11]} · {fmtBRL(receitaBruta)} de receita bruta · clique em um
        instrumento para o detalhe.
      </p>
    </div>
  );
}

function DreBridge({ linhas }: { linhas: { label: string; valor: number; total?: boolean }[] }) {
  let acc = 0;
  const rows = linhas.map((l) => {
    if (l.total) {
      acc = l.valor;
      return { ...l, de: 0, ate: l.valor };
    }
    const de = acc;
    acc += l.valor;
    return { ...l, de, ate: acc };
  });
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.de, r.ate)));
  const hi = Math.max(0, ...rows.map((r) => Math.max(r.de, r.ate)));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[170px_1fr_90px] items-center gap-2 text-xs">
          <span className={cn("truncate", r.total && "font-semibold")}>{r.label}</span>
          <div className="relative h-4 rounded bg-muted/40">
            <div
              className={cn(
                "absolute inset-y-0.5 rounded-sm",
                r.total
                  ? "bg-primary/70"
                  : r.valor >= 0
                    ? "bg-emerald-500/80"
                    : "bg-destructive/70",
              )}
              style={{
                left: `${pos(Math.min(r.de, r.ate))}%`,
                width: `${Math.max(0.5, Math.abs(pos(r.ate) - pos(r.de)))}%`,
              }}
            />
          </div>
          <span className={cn("text-right tabular-nums", r.total && "font-semibold")}>
            {fmtBRLCompact(r.valor)}
          </span>
        </div>
      ))}
    </div>
  );
}
