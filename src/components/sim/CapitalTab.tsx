import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { AppState, CapexAtivacao } from "@/lib/finance/types";
import { fmtBRL } from "@/lib/finance/format";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { buildSpreadForecast } from "@/lib/finance/spreadForecast";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Lightbulb, X, TrendingUp, TrendingDown, Wallet, Landmark, Coins, Settings2, LineChart } from "lucide-react";
import { MoneyInput, NumInput, PctInput, SectionTitle, StatCard, HelpTip } from "./primitives";

const INTRO_KEY = "gzf_capital_intro_dismissed_v1";

export function CapitalTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const c = state.capital;
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);

  const set = (patch: Partial<typeof c>) => update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  const wacc = ind.wacc;
  const terceiros = 100 - c.proprio;

  // Validações
  const warnings: string[] = [];
  if (c.dividaOnerosa > c.ativoTotal && c.ativoTotal > 0) {
    warnings.push(`Dívida onerosa (${fmtBRL(c.dividaOnerosa)}) maior que o Ativo Total (${fmtBRL(c.ativoTotal)}) — situação de insolvência técnica. WACC e ROIC perdem significado neste cenário.`);
  }
  if (c.patrimonioLiquido < 0) {
    warnings.push(`Patrimônio Líquido negativo (${fmtBRL(c.patrimonioLiquido)}) — passivo a descoberto. Reveja o balanço antes de interpretar ROE/ROIC.`);
  }
  if (c.patrimonioLiquido > 0 && c.dividaOnerosa / c.patrimonioLiquido > 5) {
    warnings.push(`Endividamento muito elevado: D/PL = ${(c.dividaOnerosa / c.patrimonioLiquido).toFixed(1)}× (saudável ≤ 2×). Risco financeiro relevante.`);
  }
  if (c.ativoCirculante > 0 && c.ativoTotal > 0 && c.ativoCirculante > c.ativoTotal) {
    warnings.push(`Ativo Circulante (${fmtBRL(c.ativoCirculante)}) maior que Ativo Total — confira os valores.`);
  }

  return (
    <div className="space-y-6">
      <IntroCard />

      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-warning">⚠ Inconsistências patrimoniais detectadas</div>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Ciclo Financeiro"
          value={`${ind.cicloFinanceiro} dias`}
          hint={{ description: "Dias entre pagar fornecedores e receber dos clientes. Quanto MAIOR, mais capital de giro a empresa precisa imobilizar.", formula: "PMR + PME − PMP" }}
          sub={ind.cicloFinanceiro > 60 ? "Ciclo longo — pressiona o caixa" : ind.cicloFinanceiro > 30 ? "Ciclo moderado" : "Ciclo curto — bom para o caixa"}
        />
        <StatCard
          label="Necessidade de Capital de Giro"
          value={fmtBRL(ind.ncg)}
          tone="warn"
          hint={{ description: "Dinheiro que a operação consome permanentemente para girar. Quando Contas a Receber/Fornecedores estão zerados, é estimada via PMR/PMP sobre receita bruta e CPV — pode divergir 30-40% do real se você tem mix de à vista/a prazo. Preencha os saldos médios para precisão.", formula: "CR + Estoques − Fornecedores" }}
          sub="O quanto o ciclo 'come' de caixa todo dia"
        />
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Capital de Giro Disponível
            <HelpTip text="Recursos próprios que a empresa tem disponíveis para financiar o ciclo operacional (capital permanente menos ativo permanente)." formula="(PL + Exigível a LP) − Ativo Permanente" />
          </div>
          <MoneyInput value={c.capitalGiroDisponivel} onChange={(n) => set({ capitalGiroDisponivel: n })} className="mt-2 text-lg" />
          <div className="mt-1 text-[10px] text-muted-foreground">Quanto a empresa tem livre para girar</div>
        </div>
        <StatCard
          label="Gap de Capital de Giro"
          value={fmtBRL(ind.gapCapitalGiro)}
          tone={ind.gapCapitalGiro > 0 ? "neg" : "pos"}
          sub={
            ind.gapCapitalGiro > 0
              ? "Falta caixa: negocie prazos, antecipe recebíveis ou capte giro"
              : "Folga: sobra para investir ou amortizar dívidas"
          }
          hint={{ description: "Diferença entre o que a operação precisa (NCG) e o que a empresa tem (CGD). Positivo = precisa de empréstimo de giro; Negativo = sobra caixa.", formula: "NCG − CGD" }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          <CapitalStructureCard
            proprio={c.proprio}
            terceiros={terceiros}
            ke={c.ke}
            kd={c.kd}
            patrimonioLiquido={c.patrimonioLiquido}
            dividaOnerosa={c.dividaOnerosa}
            onChange={set}
          />
          <WaccRoicMeter wacc={wacc} roic={ind.roic} />
          <SpreadForecastCard state={state} />
        </div>

        <BalanceSheetCard capital={c} onChange={set} />
      </div>

      <CapexAtivacaoSection
        items={c.capexAtivacao ?? []}
        onChange={(next) => set({ capexAtivacao: next })}
      />
    </div>
  );
}

// =================================================================
// Intro card (dismissible)
// =================================================================
function IntroCard() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(INTRO_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  if (dismissed) {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => {
            setDismissed(false);
            try { localStorage.removeItem(INTRO_KEY); } catch { /* */ }
          }}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary"
        >
          <Lightbulb className="h-3 w-3" />
          O que é esta aba?
        </button>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg border border-primary/30 bg-primary/5 p-5">
      <button
        onClick={() => {
          setDismissed(true);
          try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* */ }
        }}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        aria-label="Ocultar"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="mb-2 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-primary">Capital é o "combustível" da empresa</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Aqui você responde 3 perguntas que definem a saúde financeira do negócio:
      </p>
      <ol className="mt-2 grid gap-2 text-xs text-foreground sm:grid-cols-3">
        <li className="rounded-md border border-border/40 bg-background/40 p-3">
          <span className="font-semibold text-primary">1. De onde vem o dinheiro?</span>
          <div className="mt-1 text-[11px] text-muted-foreground">Sócios ou bancos — e em que proporção.</div>
        </li>
        <li className="rounded-md border border-border/40 bg-background/40 p-3">
          <span className="font-semibold text-primary">2. Quanto custa esse dinheiro?</span>
          <div className="mt-1 text-[11px] text-muted-foreground">Retorno que sócios esperam + juros dos bancos.</div>
        </li>
        <li className="rounded-md border border-border/40 bg-background/40 p-3">
          <span className="font-semibold text-primary">3. Quanto a empresa precisa para girar?</span>
          <div className="mt-1 text-[11px] text-muted-foreground">Capital de giro para sustentar o dia a dia.</div>
        </li>
      </ol>
      <p className="mt-3 text-[11px] text-muted-foreground">
        No final, o termômetro <strong className="text-foreground">WACC × ROIC</strong> diz se o negócio está <span className="text-pos font-semibold">criando</span> ou <span className="text-neg font-semibold">destruindo</span> valor.
      </p>
    </div>
  );
}

// =================================================================
// Capital structure card
// =================================================================
function CapitalStructureCard({
  proprio,
  terceiros,
  ke,
  kd,
  patrimonioLiquido,
  dividaOnerosa,
  onChange,
}: {
  proprio: number;
  terceiros: number;
  ke: number;
  kd: number;
  patrimonioLiquido: number;
  dividaOnerosa: number;
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  // Valores absolutos: usa PL e Dívida Onerosa reais se informados; senão mostra apenas %
  const totalFinanc = (patrimonioLiquido > 0 ? patrimonioLiquido : 0) + (dividaOnerosa > 0 ? dividaOnerosa : 0);
  const hasAbs = totalFinanc > 0;
  const valSocios = hasAbs ? patrimonioLiquido : 0;
  const valBancos = hasAbs ? dividaOnerosa : 0;

  // Diagnóstico de alavancagem
  const dpl = patrimonioLiquido > 0 ? dividaOnerosa / patrimonioLiquido : 0;
  let alavMsg = "";
  let alavTone: "pos" | "warn" | "neg" | "muted" = "muted";
  if (hasAbs) {
    if (dpl > 2) { alavMsg = `Endividamento alto: D/PL = ${dpl.toFixed(1)}× (saudável ≤ 2×)`; alavTone = "neg"; }
    else if (dpl >= 0.5) { alavMsg = `Alavancagem equilibrada: D/PL = ${dpl.toFixed(1)}×`; alavTone = "pos"; }
    else if (dpl > 0) { alavMsg = `Pouco alavancada: D/PL = ${dpl.toFixed(1)}× — espaço para usar mais dívida`; alavTone = "warn"; }
    else { alavMsg = "Sem dívida onerosa: empresa 100% financiada pelos sócios"; alavTone = "pos"; }
  }
  const toneCls = alavTone === "neg" ? "text-neg" : alavTone === "warn" ? "text-warning" : alavTone === "pos" ? "text-pos" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
      <div>
        <SectionTitle hint="Proporção entre capital dos sócios e dívida com terceiros. Define a 'mistura' do combustível da empresa.">
          De onde vem o dinheiro da empresa
        </SectionTitle>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Estrutura de Capital</div>
      </div>

      {/* Barra visual */}
      <div>
        <div className="relative flex h-12 w-full overflow-hidden rounded-md border border-border/40">
          <div
            className="flex items-center justify-start bg-pos/80 px-3 text-[11px] font-semibold text-background transition-all"
            style={{ width: `${proprio}%` }}
          >
            {proprio >= 12 && (
              <span className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5" />
                Sócios {proprio.toFixed(0)}%
              </span>
            )}
          </div>
          <div
            className="flex items-center justify-end bg-warning/80 px-3 text-[11px] font-semibold text-background transition-all"
            style={{ width: `${terceiros}%` }}
          >
            {terceiros >= 12 && (
              <span className="flex items-center gap-1.5">
                Bancos {terceiros.toFixed(0)}%
                <Landmark className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </div>
        <Slider value={[proprio]} min={0} max={100} step={1} onValueChange={([v]) => onChange({ proprio: v })} className="mt-3" />
        {hasAbs && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Sua empresa é financiada por <span className="font-semibold text-pos">{fmtBRL(valSocios)}</span> dos sócios e <span className="font-semibold text-warning">{fmtBRL(valBancos)}</span> de bancos.
          </p>
        )}
        {alavMsg && (
          <p className={`mt-1 text-[11px] font-medium ${toneCls}`}>{alavMsg}</p>
        )}
      </div>

      {/* Ke e Kd com presets */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Ke — Quanto os sócios querem ganhar (a.a.)
            <HelpTip
              text="Retorno mínimo exigido pelos sócios para aceitar o risco do negócio. Quem investe em empresa precisa ganhar mais do que na renda fixa."
              formula="CAPM: Rf + β × (Rm − Rf)"
              example="Selic 10% + Prêmio de risco 8% = 18%"
            />
          </label>
          <PctInput value={ke} onChange={(n) => onChange({ ke: n })} />
          <PresetRow
            label="Sugestões:"
            presets={[
              { label: "Estável 12%", value: 12 },
              { label: "Crescimento 18%", value: 18 },
              { label: "Alto risco 25%", value: 25 },
            ]}
            onPick={(v) => onChange({ ke: v })}
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Kd — Juros dos bancos (a.a.)
            <HelpTip
              text="Taxa média anual paga em empréstimos e financiamentos, ANTES do benefício fiscal (juros são dedutíveis do IR)."
              formula="Custo efetivo = Kd × (1 − Alíquota IR)"
            />
          </label>
          <PctInput value={kd} onChange={(n) => onChange({ kd: n })} />
          <PresetRow
            label="Selic ≈ 11% · spread PJ +6 a +12%:"
            presets={[
              { label: "Capital giro 18%", value: 18 },
              { label: "BNDES 14%", value: 14 },
              { label: "Cartão/cheque 25%", value: 25 },
            ]}
            onPick={(v) => onChange({ kd: v })}
          />
        </div>
      </div>
    </div>
  );
}

function PresetRow({
  label,
  presets,
  onPick,
}: {
  label: string;
  presets: { label: string; value: number }[];
  onPick: (n: number) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p.value)}
          className="rounded-full border border-border/40 bg-background/40 px-2 py-0.5 text-foreground transition hover:border-primary/60 hover:text-primary"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// =================================================================
// WACC × ROIC meter
// =================================================================
function WaccRoicMeter({ wacc, roic }: { wacc: number; roic: number }) {
  const creating = roic >= wacc;
  const delta = roic - wacc;
  const max = Math.max(wacc, roic, 1) * 1.3;
  const waccPct = Math.min(100, (wacc / max) * 100);
  const roicPct = Math.min(100, (Math.max(0, roic) / max) * 100);
  const ringColor = creating ? "var(--success)" : "var(--destructive)";

  return (
    <div
      className="rounded-lg border bg-card/40 p-5"
      style={{ borderColor: `color-mix(in oklab, ${ringColor} 35%, var(--border))` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Termômetro de Valor
            <HelpTip
              text="Compara o que o capital CUSTA (WACC) com o que ele RENDE (ROIC). Se rende mais do que custa, a empresa cria valor."
              formula="ROIC vs. WACC · Spread = ROIC − WACC"
            />
          </div>
          <h3 className="mt-1 text-lg font-semibold flex items-center gap-2">
            {creating ? (
              <><TrendingUp className="h-5 w-5 text-pos" /> <span className="text-pos">Criando valor</span></>
            ) : (
              <><TrendingDown className="h-5 w-5 text-neg" /> <span className="text-neg">Destruindo valor</span></>
            )}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {creating
              ? <>Cada R$ investido rende <strong className="text-pos">+{delta.toFixed(2)} p.p.</strong> acima do custo do capital. Mantenha o ritmo e reinvista nas alavancas que sustentam esse spread.</>
              : <>Cada R$ investido rende <strong className="text-neg">{delta.toFixed(2)} p.p.</strong> abaixo do custo do capital. Para corrigir: melhore margem, gire mais o capital ou reduza o custo da dívida.</>
            }
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spread</div>
          <div className={`mono text-3xl font-bold ${creating ? "text-pos" : "text-neg"}`}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">p.p.</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <MeterBar
          label="WACC"
          subLabel="custo do capital"
          value={wacc}
          pct={waccPct}
          color="var(--warning)"
        />
        <MeterBar
          label="ROIC"
          subLabel="retorno entregue"
          value={roic}
          pct={roicPct}
          color={creating ? "var(--success)" : "var(--destructive)"}
        />
      </div>
    </div>
  );
}

function MeterBar({ label, subLabel, value, pct, color }: { label: string; subLabel: string; value: number; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span>
          <span className="font-semibold">{label}</span>
          <span className="ml-1.5 text-[10px] text-muted-foreground">{subLabel}</span>
        </span>
        <span className="mono font-semibold" style={{ color }}>{value.toFixed(2)}%</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-border/30">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

// =================================================================
// Spread forecast (ROIC − WACC) — projeção 5 anos
// =================================================================
function SpreadForecastCard({ state }: { state: AppState }) {
  const result = useMemo(() => buildSpreadForecast(state, 5), [state]);
  const { years, waccConstant, degenerate, breakEvenYear } = result;

  const allPositive = years.every((y) => y.spread >= 0);
  const allNegative = years.every((y) => y.spread < 0);
  const trendUp = years[years.length - 1].spread > years[0].spread + 0.5;
  const trendDown = years[years.length - 1].spread < years[0].spread - 0.5;

  let headline = "";
  let headlineTone: "pos" | "neg" | "muted" = "muted";
  if (degenerate) {
    headline = allPositive
      ? "Spread estável — continua criando valor nos próximos 5 anos"
      : allNegative
      ? "Spread estável — continua destruindo valor nos próximos 5 anos"
      : "Spread estável ao longo do horizonte";
    headlineTone = allPositive ? "pos" : allNegative ? "neg" : "muted";
  } else if (breakEvenYear) {
    const cruzouParaPos = years[breakEvenYear - 1].spread >= 0;
    headline = cruzouParaPos
      ? `Volta a criar valor no ano Y${breakEvenYear}`
      : `Passa a destruir valor a partir de Y${breakEvenYear}`;
    headlineTone = cruzouParaPos ? "pos" : "neg";
  } else if (trendUp) {
    headline = allPositive ? "Spread melhorando — valor cresce" : "Spread melhorando, mas ainda negativo";
    headlineTone = allPositive ? "pos" : "neg";
  } else if (trendDown) {
    headline = allPositive ? "Spread caindo — atenção" : "Spread piorando — destruição de valor acelera";
    headlineTone = "neg";
  } else {
    headline = allPositive ? "Mantém criação de valor" : "Mantém destruição de valor";
    headlineTone = allPositive ? "pos" : "neg";
  }

  const toneCls =
    headlineTone === "pos" ? "text-pos" : headlineTone === "neg" ? "text-neg" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <LineChart className="h-3.5 w-3.5" />
            Spread projetado · ROIC − WACC
            <HelpTip
              text="Projeção do spread anual nos próximos 5 anos, usando o crescimento de receita do simulador. WACC mantido constante (mesma estrutura de capital). Capital Investido cresce com capex acumulado."
              formula="Spread = ROIC_ano − WACC"
            />
          </div>
          <h3 className={`mt-1 text-sm font-semibold ${toneCls}`}>{headline}</h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Y5</div>
          <div className={`mono text-base font-semibold ${years[4].spread >= 0 ? "text-pos" : "text-neg"}`}>
            {years[4].spread >= 0 ? "+" : ""}
            {years[4].spread.toFixed(1)} p.p.
          </div>
        </div>
      </div>

      <div className="mt-3 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={years} margin={{ top: 16, right: 8, bottom: 0, left: -16 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}`} width={36} />
            <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
            <RTooltip
              cursor={{ fill: "color-mix(in oklab, var(--muted) 30%, transparent)" }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
              formatter={(v: number, _name: string, item: { payload?: typeof years[number] }) => {
                const p = item?.payload;
                if (!p) return [`${v.toFixed(2)} p.p.`, "Spread"];
                return [
                  `${v >= 0 ? "+" : ""}${v.toFixed(2)} p.p.  (ROIC ${p.roic.toFixed(1)}% · WACC ${p.wacc.toFixed(1)}%)`,
                  "Spread",
                ];
              }}
            />
            <Bar dataKey="spread" radius={[4, 4, 0, 0]}>
              {years.map((y) => (
                <Cell key={y.ano} fill={y.spread >= 0 ? "var(--success)" : "var(--destructive)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="mono">WACC fixo: {waccConstant.toFixed(1)}%</span>
        <span>Mesma estrutura de capital · capex base replicado</span>
      </div>
    </div>
  );
}



// =================================================================
// Balance sheet card — grouped
// =================================================================
function BalanceSheetCard({
  capital,
  onChange,
}: {
  capital: AppState["capital"];
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-4">
      <div>
        <SectionTitle hint="Saldos do balanço usados para calcular liquidez, ROE, ROA e alavancagem. Tire da última DRE/Balancete da empresa.">
          Fotografia do balanço hoje
        </SectionTitle>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Posição Patrimonial</div>
      </div>

      <BalanceGroup
        icon={<Coins className="h-3.5 w-3.5" />}
        color="var(--success)"
        title="O que a empresa TEM (Ativos)"
        subtitle="Bens e direitos: caixa, estoques, contas a receber"
      >
        <Field label="Ativo Total" value={capital.ativoTotal} onChange={(n) => onChange({ ativoTotal: n })} hint="Soma de tudo que a empresa possui: caixa, estoques, máquinas, imóveis, contas a receber etc." />
        <Field label="Disponibilidades (caixa)" value={capital.disponibilidades} onChange={(n) => onChange({ disponibilidades: n })} hint="Dinheiro em conta corrente, aplicações de liquidez imediata." />
        <Field label="Estoques" value={capital.estoques} onChange={(n) => onChange({ estoques: n })} hint="Mercadorias, matéria-prima ou produtos acabados em estoque." />
        <Field label="Ativo Circulante" value={capital.ativoCirculante} onChange={(n) => onChange({ ativoCirculante: n })} hint="Bens conversíveis em caixa em até 12 meses. Deixe 0 para o sistema estimar automaticamente." placeholder="0 = auto" />
        <Field label="Contas a Receber" value={capital.contasReceber} onChange={(n) => onChange({ contasReceber: n })} hint="Saldo médio que clientes ainda devem. Deixe 0 para estimar via PMR." placeholder="0 = auto via PMR" />
      </BalanceGroup>

      <BalanceGroup
        icon={<Landmark className="h-3.5 w-3.5" />}
        color="var(--destructive)"
        title="O que a empresa DEVE (Passivos)"
        subtitle="Obrigações com bancos, fornecedores e tributos"
      >
        <Field label="Dívida Onerosa (empréstimos)" value={capital.dividaOnerosa} onChange={(n) => onChange({ dividaOnerosa: n })} hint="Empréstimos e financiamentos com bancos que cobram juros. NÃO inclui fornecedores ou impostos parcelados sem juros." />
        <Field label="Passivo Circulante" value={capital.passivoCirculante} onChange={(n) => onChange({ passivoCirculante: n })} hint="Obrigações a pagar em até 12 meses (fornecedores, salários, impostos, parcela de empréstimos). Deixe 0 para estimar." placeholder="0 = auto" />
        <Field label="Fornecedores a Pagar" value={capital.fornecedores} onChange={(n) => onChange({ fornecedores: n })} hint="Saldo médio que a empresa deve a fornecedores. Deixe 0 para estimar via PMP." placeholder="0 = auto via PMP" />
      </BalanceGroup>

      <BalanceGroup
        icon={<Wallet className="h-3.5 w-3.5" />}
        color="var(--primary)"
        title="O que sobra para os sócios (Patrimônio)"
        subtitle="Ativo − Passivo = riqueza líquida dos donos"
      >
        <Field label="Patrimônio Líquido" value={capital.patrimonioLiquido} onChange={(n) => onChange({ patrimonioLiquido: n })} hint="Capital social + reservas + lucros acumulados. É o que sobraria para os sócios se a empresa quitasse todas as dívidas hoje." />
      </BalanceGroup>

      <BalanceGroup
        icon={<Settings2 className="h-3.5 w-3.5" />}
        color="var(--muted-foreground)"
        title="Outros lançamentos mensais"
        subtitle="Entram na DRE todo mês"
      >
        <Field label="Depreciação mensal" value={capital.depreciacaoMensal} onChange={(n) => onChange({ depreciacaoMensal: n })} hint="Perda contábil de valor de máquinas, equipamentos e imóveis no mês. Não sai do caixa, mas reduz o lucro tributável." />
        <Field label="Juros recebidos / mês" value={capital.jurosRecebidosMensal} onChange={(n) => onChange({ jurosRecebidosMensal: n })} hint="Rendimentos médios de aplicações financeiras no mês." />
      </BalanceGroup>
    </div>
  );
}

function BalanceGroup({
  icon,
  color,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border bg-background/30 p-3"
      style={{ borderColor: `color-mix(in oklab, ${color} 30%, var(--border))` }}
    >
      <div className="mb-2 flex items-start gap-2">
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in oklab, ${color} 20%, transparent)`, color }}
        >
          {icon}
        </span>
        <div>
          <div className="text-xs font-semibold" style={{ color }}>{title}</div>
          <div className="text-[10px] text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        <HelpTip text={hint} />
      </label>
      <MoneyInput value={value} onChange={onChange} />
      {placeholder && <div className="mt-0.5 text-[9.5px] text-muted-foreground/70">{placeholder}</div>}
    </div>
  );
}

// =================================================================
// CapEx ativação (mesmo comportamento, com exemplo amigável)
// =================================================================
function CapexAtivacaoSection({
  items,
  onChange,
}: {
  items: CapexAtivacao[];
  onChange: (next: CapexAtivacao[]) => void;
}) {
  const add = () => {
    const id = `cx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onChange([...items, { id, label: "Novo ativo", mes: 1, valor: 0, vidaUtilMeses: 60 }]);
  };
  const addExample = () => {
    const id = `cx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onChange([...items, { id, label: "Notebook (exemplo)", mes: 1, valor: 5000, vidaUtilMeses: 36 }]);
  };
  const upd = (id: string, patch: Partial<CapexAtivacao>) =>
    onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rm = (id: string) => onChange(items.filter((x) => x.id !== id));

  const depMensalAdicional = items.reduce(
    (acc, x) => acc + (x.vidaUtilMeses > 0 ? x.valor / x.vidaUtilMeses : 0),
    0,
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          <SectionTitle hint="Cada item gera depreciação adicional linear (valor ÷ vida útil) a partir do mês de ativação até o fim do ano. Atualiza EBIT, IR (no Real) e ROIC automaticamente.">
            Investimentos em equipamentos e ativos
          </SectionTitle>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Capex · Ativação de Imobilizado no ano</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Depreciação adicional/mês:{" "}
            <span className="num text-foreground">{fmtBRL(depMensalAdicional)}</span>
          </span>
          <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar ativação
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs">
          <div className="text-muted-foreground">
            Nenhuma ativação cadastrada. Use para máquinas, software, reformas, móveis e qualquer ativo que entre em operação no meio do ano.
          </div>
          <Button size="sm" variant="ghost" onClick={addExample} className="h-7 text-xs text-primary hover:text-primary">
            <Lightbulb className="mr-1 h-3.5 w-3.5" />
            Adicionar exemplo: Notebook R$ 5.000 / 36 meses
          </Button>
        </div>
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Descrição</th>
                <th className="w-24 px-2 py-2 text-center">Mês ativ.</th>
                <th className="w-40 px-2 py-2 text-right">Valor capitalizado</th>
                <th className="w-32 px-2 py-2 text-right">Vida útil (meses)</th>
                <th className="w-32 px-2 py-2 text-right">Dep./mês</th>
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => {
                const dep = x.vidaUtilMeses > 0 ? x.valor / x.vidaUtilMeses : 0;
                return (
                  <tr key={x.id} className="border-t border-border/40 align-middle">
                    <td className="px-3 py-2">
                      <input
                        value={x.label}
                        onChange={(e) => upd(x.id, { label: e.target.value })}
                        className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <NumInput
                        integer
                        min={1}
                        max={12}
                        value={x.mes}
                        onChange={(n) => upd(x.id, { mes: Math.max(1, Math.min(12, n || 1)) })}
                        className="w-16"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <MoneyInput value={x.valor} onChange={(n) => upd(x.id, { valor: n })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumInput
                        integer
                        min={1}
                        value={x.vidaUtilMeses}
                        onChange={(n) => upd(x.id, { vidaUtilMeses: Math.max(1, n || 1) })}
                      />
                    </td>
                    <td className="num px-2 py-2 text-right text-neg">{fmtBRL(dep)}</td>
                    <td className="px-1 py-2 text-center">
                      <button
                        onClick={() => rm(x.id)}
                        title="Remover"
                        className="text-muted-foreground transition hover:text-neg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
