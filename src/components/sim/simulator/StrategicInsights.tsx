// ============================================================================
// Insights estratégicos do simulador (2.0): leitura executiva, ponte de valor
// por alavanca, sensibilidade, preço × volume, metas, estresse, valor
// econômico e regime. Motor em engines/finance/strategic2.ts.
// ============================================================================
import { useMemo, useState } from "react";
import { Lightbulb, ShieldAlert, Target, TrendingUp } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtBRL, fmtBRLCompact } from "@/engines/finance/format";
import type { AppState } from "@/engines/finance/types";
import type { SimulatorParams } from "@/engines/finance/simulator";
import {
  bridge,
  goalSeek,
  LEVERS,
  METRIC_LABELS,
  narrative,
  priceVolume,
  regimeAdvice,
  stressTests,
  tornado,
  valueCreation,
  type GoalSeekResult,
  type MetricKey,
} from "@/engines/finance/strategic2";
import { usePeriodLabels } from "@/components/odoo/usePeriodLabels";
import { cn } from "@/lib/utils";

const REGIME: Record<string, string> = {
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};

const signed = (v: number) => `${v >= 0 ? "+" : ""}${fmtBRLCompact(v)}`;

export function StrategicInsights({
  state,
  params,
  onApplyParams,
}: {
  state: AppState;
  params: SimulatorParams;
  onApplyParams: (p: SimulatorParams) => void;
}) {
  const MESES = usePeriodLabels();
  const [metric, setMetric] = useState<MetricKey>("lucroLiquido");

  const br = useMemo(() => bridge(state, params), [state, params]);
  const tor = useMemo(() => tornado(state, params, metric), [state, params, metric]);
  const stress = useMemo(() => stressTests(state, params), [state, params]);
  const value = useMemo(() => valueCreation(state, params), [state, params]);
  const regime = useMemo(() => regimeAdvice(state, params), [state, params]);
  const pv = useMemo(() => priceVolume(state), [state]);
  const insights = useMemo(
    () => narrative(br, stress, value, regime, fmtBRLCompact),
    [br, stress, value, regime],
  );

  return (
    <section className="rounded-lg border border-primary/30 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4 text-primary" /> Insights estratégicos
        </h3>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Métrica
          <select
            aria-label="Métrica dos insights"
            className="h-7 rounded border border-border bg-background px-1.5 text-foreground"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
          >
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
              <option key={k} value={k}>
                {METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Leitura executiva */}
      <ul className="mb-4 grid gap-2 md:grid-cols-2">
        {insights.length === 0 && (
          <li className="text-xs text-muted-foreground">
            Mova uma alavanca para ver o efeito de cada decisão.
          </li>
        )}
        {insights.map((it, i) => (
          <li
            key={i}
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              it.nivel === "positivo" && "border-emerald-500/30 bg-emerald-500/5",
              it.nivel === "atencao" && "border-amber-500/30 bg-amber-500/5",
              it.nivel === "risco" && "border-destructive/30 bg-destructive/5",
            )}
          >
            {it.texto}
          </li>
        ))}
      </ul>

      <Tabs defaultValue="ponte">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="ponte">Ponte de valor</TabsTrigger>
          <TabsTrigger value="tornado">Sensibilidade</TabsTrigger>
          <TabsTrigger value="preco">Preço × volume</TabsTrigger>
          <TabsTrigger value="metas">Metas</TabsTrigger>
          <TabsTrigger value="estresse">Estresse</TabsTrigger>
          <TabsTrigger value="valor">Valor econômico</TabsTrigger>
        </TabsList>

        {/* Ponte */}
        <TabsContent value="ponte" className="pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Quanto cada alavanca contribui para {METRIC_LABELS[metric].toLowerCase()}. As
            contribuições somam exatamente a diferença total e não dependem da ordem das decisões
            (interações, como preço × volume, são repartidas por valor de Shapley
            {br.metodo === "amostrado" ? ", estimado por amostragem" : ""}).
          </p>
          <Waterfall
            inicio={{ label: "Base", valor: br.base[metric] }}
            passos={br.itens.map((i) => ({ label: i.label, valor: i[metric] }))}
            fim={{ label: "Simulado", valor: br.simulado[metric] }}
          />
        </TabsContent>

        {/* Tornado */}
        <TabsContent value="tornado" className="pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Efeito de um passo para cada lado em cada alavanca, a partir do cenário atual (
            {METRIC_LABELS[metric]}: {fmtBRL(tor.atual)}). As do topo são onde vale concentrar
            esforço.
          </p>
          <Tornado barras={tor.barras} />
        </TabsContent>

        {/* Preço × volume */}
        <TabsContent value="preco" className="pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Margem de contribuição atual: <strong>{(pv.margem * 100).toFixed(1)}%</strong> da
            receita líquida. A tabela mostra quanto o volume precisa variar para a contribuição
            total ficar igual, e a elasticidade-preço a partir da qual a mudança passa a perder
            dinheiro.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-right">
                <th className="p-2 text-left font-medium">Preço</th>
                <th className="p-2 font-medium">Volume para empatar</th>
                <th className="p-2 font-medium">Elasticidade-limite</th>
                <th className="p-2 text-left font-medium">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {pv.pontos.map((pt) => (
                <tr key={pt.precoPct} className="border-b border-border/20 text-right tabular-nums">
                  <td className="p-2 text-left">
                    {pt.precoPct > 0 ? "+" : ""}
                    {pt.precoPct}%
                  </td>
                  <td className="p-2">
                    {Number.isFinite(pt.volumeEquilibrio)
                      ? `${pt.volumeEquilibrio > 0 ? "+" : ""}${(pt.volumeEquilibrio * 100).toFixed(1)}%`
                      : "impossível"}
                  </td>
                  <td className="p-2">{pt.elasticidadeLimite?.toFixed(2) ?? "—"}</td>
                  <td className="p-2 text-left text-muted-foreground">
                    {pt.precoPct < 0
                      ? Number.isFinite(pt.volumeEquilibrio)
                        ? `Só compensa se as vendas subirem mais de ${(pt.volumeEquilibrio * 100).toFixed(0)}%.`
                        : "O desconto consome toda a margem."
                      : `Compensa enquanto a perda de vendas for menor que ${Math.abs(pt.volumeEquilibrio * 100).toFixed(0)}%.`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        {/* Metas */}
        <TabsContent value="metas" className="pt-3">
          <GoalSeekPanel state={state} params={params} onApplyParams={onApplyParams} />
        </TabsContent>

        {/* Estresse */}
        <TabsContent value="estresse" className="pt-3">
          <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" /> Choques aplicados sobre o cenário atual. Caixa
            mínimo de segurança: {fmtBRL(state.cashflow?.caixaMinimo ?? 0)}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-border/60 text-right">
                  <th className="p-2 text-left font-medium">Choque</th>
                  <th className="p-2 font-medium">Pior caixa</th>
                  <th className="p-2 font-medium">Mês</th>
                  <th className="p-2 font-medium">Crédito necessário</th>
                  <th className="p-2 font-medium">Efeito no lucro</th>
                </tr>
              </thead>
              <tbody>
                {stress.map((s) => (
                  <tr key={s.id} className="border-b border-border/20 text-right tabular-nums">
                    <td className="p-2 text-left">
                      <div className="font-medium">{s.nome}</div>
                      <div className="text-muted-foreground">{s.descricao}</div>
                    </td>
                    <td className={cn("p-2", s.caixaMinimo < 0 && "text-destructive")}>
                      {fmtBRL(s.caixaMinimo)}
                    </td>
                    <td className="p-2">{MESES[s.mesCaixaMinimo]}</td>
                    <td
                      className={cn(
                        "p-2",
                        s.creditoNecessario > 0 ? "font-medium text-amber-600" : "text-emerald-600",
                      )}
                    >
                      {s.creditoNecessario > 0 ? fmtBRL(s.creditoNecessario) : "não precisa"}
                    </td>
                    <td className={cn("p-2", s.deltaLucro < 0 && "text-destructive")}>
                      {signed(s.deltaLucro)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Valor econômico */}
        <TabsContent value="valor" className="pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-right">
                  <th className="p-2 text-left font-medium">Criação de valor</th>
                  <th className="p-2 font-medium">Base</th>
                  <th className="p-2 font-medium">Simulado</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <ValueRow
                  label="NOPAT (lucro operacional após IR)"
                  b={fmtBRL(value.base.nopat)}
                  s={fmtBRL(value.simulado.nopat)}
                />
                <ValueRow
                  label="Capital investido"
                  b={fmtBRL(value.base.capitalInvestido)}
                  s={fmtBRL(value.simulado.capitalInvestido)}
                />
                <ValueRow
                  label="ROIC"
                  b={`${value.base.roic.toFixed(1)}%`}
                  s={`${value.simulado.roic.toFixed(1)}%`}
                />
                <ValueRow
                  label="WACC (custo de capital)"
                  b={`${value.base.wacc.toFixed(1)}%`}
                  s={`${value.simulado.wacc.toFixed(1)}%`}
                />
                <ValueRow
                  label="Spread ROIC − WACC"
                  b={`${value.base.spread.toFixed(1)} p.p.`}
                  s={`${value.simulado.spread.toFixed(1)} p.p.`}
                  strong
                />
                <ValueRow
                  label="EVA (lucro econômico)"
                  b={fmtBRL(value.base.eva)}
                  s={fmtBRL(value.simulado.eva)}
                  strong
                />
              </tbody>
            </table>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-right">
                  <th className="p-2 text-left font-medium">Risco e alavancagem</th>
                  <th className="p-2 font-medium">Base</th>
                  <th className="p-2 font-medium">Simulado</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <ValueRow
                  label="Alavancagem operacional (GAO)"
                  b={`${value.base.gao.toFixed(2)}×`}
                  s={`${value.simulado.gao.toFixed(2)}×`}
                />
                <ValueRow
                  label="Alavancagem financeira (GAF)"
                  b={`${value.base.gaf.toFixed(2)}×`}
                  s={`${value.simulado.gaf.toFixed(2)}×`}
                />
                <ValueRow
                  label="Alavancagem total (GAT)"
                  b={`${value.base.gat.toFixed(2)}×`}
                  s={`${value.simulado.gat.toFixed(2)}×`}
                />
                <ValueRow
                  label="Margem de segurança"
                  b={`${value.base.margemSeguranca.toFixed(1)}%`}
                  s={`${value.simulado.margemSeguranca.toFixed(1)}%`}
                />
                <ValueRow
                  label="DSCR (cobertura da dívida)"
                  b={value.base.dscr === null ? "sem dívida" : `${value.base.dscr.toFixed(2)}×`}
                  s={
                    value.simulado.dscr === null
                      ? "sem dívida"
                      : `${value.simulado.dscr.toFixed(2)}×`
                  }
                />
                <ValueRow
                  label="Regime mais vantajoso"
                  b={REGIME[regime.atual] ?? regime.atual}
                  s={REGIME[regime.melhor] ?? regime.melhor}
                  strong={regime.melhor !== regime.atual}
                />
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            GAO = quanto o EBIT varia para cada 1% de variação nas vendas. Com GAT alto, pequenas
            quedas de receita viram grandes quedas de lucro. Na última linha, "Base" é o regime em
            uso e "Simulado" é o que daria mais lucro neste cenário.
          </p>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function ValueRow({
  label,
  b,
  s,
  strong,
}: {
  label: string;
  b: string;
  s: string;
  strong?: boolean;
}) {
  return (
    <tr className={cn("border-b border-border/20 text-right", strong && "font-semibold")}>
      <td className="p-2 text-left">{label}</td>
      <td className="p-2">{b}</td>
      <td className="p-2">{s}</td>
    </tr>
  );
}

/** Cascata base → contribuições → simulado (barras horizontais, sem animação). */
function Waterfall({
  inicio,
  passos,
  fim,
}: {
  inicio: { label: string; valor: number };
  passos: { label: string; valor: number }[];
  fim: { label: string; valor: number };
}) {
  if (!passos.length)
    return <p className="text-xs text-muted-foreground">Nenhuma alavanca ativa no simulador.</p>;
  let acc = inicio.valor;
  const rows = [
    { label: inicio.label, de: 0, ate: inicio.valor, tipo: "total" as const, valor: inicio.valor },
    ...passos.map((p) => {
      const de = acc;
      acc += p.valor;
      return {
        label: p.label,
        de,
        ate: acc,
        tipo: p.valor >= 0 ? ("up" as const) : ("down" as const),
        valor: p.valor,
      };
    }),
    { label: fim.label, de: 0, ate: fim.valor, tipo: "total" as const, valor: fim.valor },
  ];
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.de, r.ate)));
  const hi = Math.max(0, ...rows.map((r) => Math.max(r.de, r.ate)));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[160px_1fr_110px] items-center gap-2 text-xs">
          <span className={cn("truncate", r.tipo === "total" && "font-semibold")}>{r.label}</span>
          <div className="relative h-5 rounded bg-muted/40">
            <div
              className={cn(
                "absolute top-0.5 bottom-0.5 rounded-sm",
                r.tipo === "total" && "bg-primary/70",
                r.tipo === "up" && "bg-emerald-500/80",
                r.tipo === "down" && "bg-destructive/80",
              )}
              style={{
                left: `${pos(Math.min(r.de, r.ate))}%`,
                width: `${Math.max(0.5, Math.abs(pos(r.ate) - pos(r.de)))}%`,
              }}
            />
          </div>
          <span className={cn("text-right tabular-nums", r.tipo === "total" && "font-semibold")}>
            {r.tipo === "total" ? fmtBRLCompact(r.valor) : signed(r.valor)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Tornado({
  barras,
}: {
  barras: { key: string; label: string; passo: string; baixo: number; alto: number }[];
}) {
  const max = Math.max(1, ...barras.flatMap((b) => [Math.abs(b.baixo), Math.abs(b.alto)]));
  const w = (v: number) => `${(Math.abs(v) / max) * 50}%`;
  return (
    <div className="space-y-1">
      {barras.map((b) => (
        <div key={b.key} className="grid grid-cols-[180px_1fr_170px] items-center gap-2 text-xs">
          <span className="truncate">
            {b.label} <span className="text-muted-foreground">({b.passo})</span>
          </span>
          <div className="relative h-5 rounded bg-muted/40">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            {[b.baixo, b.alto].map((v, i) => (
              <div
                key={i}
                className={cn(
                  "absolute top-0.5 bottom-0.5",
                  v >= 0 ? "bg-emerald-500/80" : "bg-destructive/80",
                )}
                style={v >= 0 ? { left: "50%", width: w(v) } : { right: "50%", width: w(v) }}
              />
            ))}
          </div>
          <span className="text-right tabular-nums text-muted-foreground">
            {signed(b.baixo)} / {signed(b.alto)}
          </span>
        </div>
      ))}
    </div>
  );
}

function GoalSeekPanel({
  state,
  params,
  onApplyParams,
}: {
  state: AppState;
  params: SimulatorParams;
  onApplyParams: (p: SimulatorParams) => void;
}) {
  const [lever, setLever] = useState<keyof SimulatorParams>("priceDeltaPct");
  const [metric, setMetric] = useState<MetricKey>("ebitda");
  const [alvo, setAlvo] = useState<string>("");
  const [res, setRes] = useState<GoalSeekResult | null>(null);
  const spec = LEVERS.find((l) => l.key === lever)!;

  const run = () => {
    const v = Number(alvo.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v)) return;
    setRes(goalSeek(state, params, lever, metric, v));
  };

  return (
    <div className="space-y-3 text-xs">
      <p className="flex items-center gap-1 text-muted-foreground">
        <Target className="h-3.5 w-3.5" /> Responde perguntas como “que preço leva o EBITDA a R$ X?”
        ou “que prazo de recebimento evita caixa negativo?”, mantendo as demais alavancas do
        cenário.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          Qual
          <select
            className="h-8 rounded border border-border bg-background px-1.5"
            value={lever}
            onChange={(e) => setLever(e.target.value as keyof SimulatorParams)}
          >
            {LEVERS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          leva
          <select
            className="h-8 rounded border border-border bg-background px-1.5"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
          >
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
              <option key={k} value={k}>
                {METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          a (R$)
          <input
            className="h-8 w-40 rounded border border-border bg-background px-2"
            inputMode="decimal"
            placeholder="ex.: 500000"
            value={alvo}
            onChange={(e) => setAlvo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </label>
        <Button size="sm" className="h-8" onClick={run}>
          <TrendingUp className="mr-1 h-3.5 w-3.5" /> Calcular
        </Button>
      </div>
      {res && (
        <div
          className={cn(
            "rounded-md border p-3",
            res.ok
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5",
          )}
        >
          {res.ok ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {spec.label}:{" "}
                <strong>
                  {res.valor > 0 ? "+" : ""}
                  {res.valor.toFixed(1)}
                  {spec.unidade}
                </strong>{" "}
                leva {METRIC_LABELS[metric].toLowerCase()} a <strong>{fmtBRL(res.atingido)}</strong>
                .
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() =>
                  onApplyParams({ ...params, [lever]: Math.round(res.valor * 10) / 10 })
                }
              >
                Levar para o simulador
              </Button>
            </div>
          ) : (
            <span>
              {res.motivo} O mais próximo: {spec.label.toLowerCase()} em{" "}
              {res.melhorValor.toFixed(1)}
              {spec.unidade}, que leva a {fmtBRL(res.melhorResultado)}.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
