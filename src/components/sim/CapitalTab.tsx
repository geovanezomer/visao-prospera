import { useEffect, useMemo, useState } from "react";
import { AppState, CapexAtivacao } from "@/lib/finance/types";
import { fmtBRL, fmtNum, sum } from "@/lib/finance/format";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Lightbulb, X, TrendingUp, TrendingDown, Wallet, Landmark, Coins, Settings2, ArrowRight, Banknote, Package, Users, AlertTriangle, CheckCircle2, Camera, ChevronDown, ChevronUp } from "lucide-react";
import { MoneyInput, NumInput, PctInput, SectionTitle, StatCard, HelpTip } from "./primitives";

const INTRO_KEY = "gzf_capital_intro_dismissed_v1";

export function CapitalTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const c = state.capital;
  // Memoiza engine pesada — recomputa só quando o estado financeiro muda.
  const { dre } = useMemo(() => buildDRE(state, state.tax.regime), [state]);
  const ind = useMemo(() => calcIndicators(state, dre), [state, dre]);


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
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Capital de Giro Disponível
            <HelpTip text="Recursos próprios que a empresa tem disponíveis para financiar o ciclo operacional (capital permanente menos ativo permanente)." formula="(PL + Exigível a LP) − Ativo Permanente" />
          </div>
          <MoneyInput value={c.capitalGiroDisponivel} onChange={(n) => set({ capitalGiroDisponivel: n })} className="mt-2 text-lg" />
          <div className="mt-1 text-[10px] text-muted-foreground">Qual é a disponibilidade de dinheiro imediata da empresa para giro, somando caixa e bancos</div>
        </div>
        <div className="md:col-span-3">
          <NCGExplanationCard ncg={ind.ncg} pmr={state.revenue.pmr} pmp={state.revenue.pmp} receitaDia={sum(dre.receitaBruta)/360} cpvDia={sum(dre.cpv)/360} />
        </div>
      </div>


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
        <BalanceSheetCard capital={c} onChange={set} />
        <CapexAtivacaoSection
          items={c.capexAtivacao ?? []}
          onChange={(next) => set({ capexAtivacao: next })}
        />
        <WaccRoicMeter wacc={wacc} roic={ind.roic} />
      </div>
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
// Balance sheet card — redesenhado para pequenos empresários
// Layout: 3 blocos empilhados (Ativos · Dívidas+PL · Resumo) +
// um bloco extra para lançamentos mensais (depreciação / juros recebidos).
// =================================================================
function BalanceSheetCard({
  capital,
  onChange,
}: {
  capital: AppState["capital"];
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  // ---------- Cálculos auxiliares ----------
  // ---------- Cálculos auxiliares ----------
  // Ativos Circulantes (curto prazo)
  const ativoCircCalc = (capital.disponibilidades || 0) + (capital.estoques || 0) + (capital.contasReceber || 0);
  
  // Total de Dívidas (Passivos)
  // Somamos Dívida Onerosa (bancos) + Fornecedores + Outros passivos circulantes se houver
  const totalPassivos = (capital.dividaOnerosa || 0) + (capital.fornecedores || 0) + (capital.passivoCirculante || 0);
  
  // Patrimônio líquido calculado pela equação fundamental: PL = Ativos − Passivos
  const plCalculado = (capital.ativoTotal || 0) - totalPassivos;
  const plInformado = capital.patrimonioLiquido || 0;
  
  const diff = Math.abs(plInformado - plCalculado);
  // Consideramos inconsistência se a diferença for maior que 2% do ativo ou R$ 100
  const hasInconsistencia = capital.ativoTotal > 0 && diff > Math.max(100, capital.ativoTotal * 0.02);

  // KPIs do resumo
  const capitalCirculante = ativoCircCalc - (capital.fornecedores || capital.passivoCirculante || 0);
  const dpl = plInformado > 0 ? (capital.dividaOnerosa || 0) / plInformado : 0;
  const solvencia = totalPassivos > 0 ? (capital.ativoTotal || 0) / totalPassivos : 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Camera className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <SectionTitle hint="Saldos atuais do balanço — preencha com os últimos números do seu contador. Geram liquidez, ROE, ROA e alavancagem.">
            Fotografia do balanço hoje
          </SectionTitle>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Em 3 passos rápidos você descreve a posição patrimonial da empresa.
          </div>
        </div>
      </div>

      {/* ============================================================
          PASSO 1 — ATIVOS (o que a empresa tem)
         ============================================================ */}
      <StepCard
        step={1}
        color="var(--success)"
        title="Dinheiro e bens da empresa"
        subtitle="Tudo que pode virar caixa em algum momento"
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
          <SimpleField
            icon={<Coins className="h-4 w-4" />}
            label="Total de ativos da empresa"
            hint="Soma de TUDO que a empresa possui: caixa, estoques, máquinas, imóveis, veículos, contas a receber etc."
            value={capital.ativoTotal}
            onChange={(n) => onChange({ ativoTotal: n })}
            emphasis
          />
        </div>

        {/* Mini-resumo do ativo circulante */}
        <div className="mt-3 grid grid-cols-4 overflow-hidden rounded-md border border-border/40 text-center text-[10px]">
          <MiniStat label="Caixa/bancos" value={fmtBRL(capital.disponibilidades)} />
          <MiniStat label="Estoque" value={fmtBRL(capital.estoques)} />
          <MiniStat label="A receber" value={fmtBRL(capital.contasReceber)} />
          <MiniStat label="Ativo circulante" value={fmtBRL(ativoCircCalc)} highlight />
        </div>
      </StepCard>

      {/* ============================================================
          PASSO 2 — DÍVIDAS + PATRIMÔNIO LÍQUIDO
         ============================================================ */}
      <StepCard
        step={2}
        color="var(--destructive)"
        title="O que a empresa deve"
        subtitle="Dívidas, contas e obrigações"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SimpleField
            icon={<Landmark className="h-4 w-4" />}
            label="Empréstimos e financiamentos"
            hint="Dívida com bancos que cobram juros. NÃO inclua fornecedores ou impostos parcelados sem juros."
            value={capital.dividaOnerosa}
            onChange={(n) => onChange({ dividaOnerosa: n })}
          />
          <SimpleField
            icon={<Users className="h-4 w-4" />}
            label="Fornecedores a pagar"
            hint="Saldo médio que a empresa deve a fornecedores. Deixe 0 para calcular pelo prazo médio (PMP)."
            value={capital.fornecedores}
            onChange={(n) => onChange({ fornecedores: n })}
            placeholder="0 = calculado pelo prazo médio"
          />
        </div>

        {/* Sub-bloco: Patrimônio Líquido */}
        <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <div className="text-xs font-semibold text-primary">O que sobra para os sócios</div>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Patrimônio líquido = ativos − dívidas
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SimpleField
              icon={<Wallet className="h-4 w-4" />}
              label="Patrimônio líquido dos sócios"
              hint="Capital social + reservas + lucros acumulados. O que sobraria para os sócios se a empresa quitasse todas as dívidas hoje."
              value={capital.patrimonioLiquido}
              onChange={(n) => onChange({ patrimonioLiquido: n })}
              emphasis
            />

            {/* Equação visual: Ativo − Dívidas = PL calculado */}
            <div className="flex items-center justify-around rounded-md border border-border/40 bg-background/40 p-3 text-center">
              <div>
                <div className="num text-sm font-semibold">{fmtBRL(capital.ativoTotal)}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Ativos</div>
              </div>
              <span className="text-muted-foreground">−</span>
              <div>
                <div className="num text-sm font-semibold text-neg">{fmtBRL(totalPassivos)}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Dívidas</div>
              </div>
              <span className="text-muted-foreground">=</span>
              <div>
                <div className={`num text-sm font-semibold ${hasInconsistencia ? "text-warning" : "text-pos"}`}>
                  {fmtBRL(plCalculado)}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">PL calculado</div>
              </div>
            </div>
          </div>

          {hasInconsistencia && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  O PL informado (<strong>{fmtBRL(plInformado)}</strong>) não bate com a diferença entre 
                  Ativos e Dívidas (<strong>{fmtBRL(plCalculado)}</strong>). 
                  Diferença: <strong>{fmtBRL(diff)}</strong>.
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
        </div>
      </StepCard>

      {/* ============================================================
          PASSO 3 — RESUMO + KPIs
         ============================================================ */}
      <StepCard
        step={3}
        color="var(--primary)"
        title="Resumo do balanço"
        subtitle="Confira antes de continuar"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryList
            title="ATIVOS"
            color="var(--success)"
            rows={[
              ["Caixa e bancos", capital.disponibilidades],
              ["Estoque", capital.estoques],
              ["Clientes a receber", capital.contasReceber],
              ["Total de ativos", capital.ativoTotal, true],
            ]}
          />
          <SummaryList
            title="PASSIVOS"
            color="var(--destructive)"
            rows={[
              ["Empréstimos e financiamentos", capital.dividaOnerosa],
              ["Fornecedores a pagar", capital.fornecedores],
              ["Patrimônio líquido", capital.patrimonioLiquido, true],
            ]}
          />
        </div>

        {hasInconsistencia ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Há inconsistência no balanço (Ativos ≠ Dívidas + PL).
            </div>
            <button 
              onClick={() => onChange({ patrimonioLiquido: plCalculado })}
              className="text-[10px] font-bold underline decoration-warning/30 underline-offset-2 hover:text-warning/80"
            >
              Corrigir agora
            </button>
          </div>
        ) : capital.ativoTotal > 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-pos/40 bg-pos/10 p-2 text-[11px] text-pos">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Balanço consistente — Ativo = Passivo + PL.
          </div>
        ) : null}

        {/* KPIs derivados */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <KpiTile
            label="Capital circulante"
            value={fmtBRL(capitalCirculante)}
            tone={capitalCirculante >= 0 ? "pos" : "neg"}
            hint="Ativo circulante − Passivo circulante. Folga para honrar compromissos de curto prazo."
          />
          <KpiTile
            label="Alavancagem D/PL"
            value={`${dpl.toFixed(2)}×`}
            tone={dpl <= 2 ? "pos" : dpl <= 3 ? "warn" : "neg"}
            hint="Dívida onerosa ÷ Patrimônio líquido. Saudável ≤ 2×."
          />
          <KpiTile
            label="Solvência geral"
            value={`${solvencia.toFixed(2)}×`}
            tone={solvencia >= 1.5 ? "pos" : solvencia >= 1 ? "warn" : "neg"}
            hint="Ativo total ÷ Passivo total. Quanto a empresa tem para cada R$ 1 de dívida."
          />
        </div>
      </StepCard>

      {/* ============================================================
          Lançamentos mensais (mantidos para a DRE)
         ============================================================ */}
      <div className="rounded-md border border-border/40 bg-background/30 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="text-xs font-semibold text-muted-foreground">Outros lançamentos mensais</div>
          <span className="text-[10px] text-muted-foreground/70">Entram na DRE todo mês</span>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Depreciação mensal" value={capital.depreciacaoMensal} onChange={(n) => onChange({ depreciacaoMensal: n })} hint="Perda contábil de valor de máquinas, equipamentos e imóveis no mês. Não sai do caixa, mas reduz o lucro tributável." />
        </div>
      </div>
    </div>
  );
}

// ---------- Subcomponentes do balanço amigável ----------

function StepCard({
  step,
  color,
  title,
  subtitle,
  children,
}: {
  step: number;
  color: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border bg-background/40 p-4"
      style={{ borderColor: `color-mix(in oklab, ${color} 30%, var(--border))` }}
    >
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-background"
          style={{ background: color }}
        >
          {step}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color }}>{title}</div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function SimpleField({
  icon,
  label,
  hint,
  value,
  onChange,
  placeholder,
  emphasis,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 ${emphasis ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background/40"}`}>
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="text-muted-foreground/80">{icon}</span>
        <span className="font-medium text-foreground/90">{label}</span>
        <HelpTip text={hint} />
      </label>
      <MoneyInput value={value} onChange={onChange} className={`mt-1.5 ${emphasis ? "text-base font-semibold" : ""}`} />
      {placeholder && <div className="mt-1 text-[9.5px] text-muted-foreground/70">{placeholder}</div>}
    </div>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-2 ${highlight ? "bg-primary/10" : "bg-background/40"} border-r border-border/30 last:border-r-0`}>
      <div className="num text-[11px] font-semibold">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function SummaryList({
  title,
  color,
  rows,
}: {
  title: string;
  color: string;
  rows: [string, number, boolean?][];
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{title}</div>
      <div className="space-y-1">
        {rows.map(([label, value, bold], i) => (
          <div
            key={i}
            className={`flex items-center justify-between text-xs ${bold ? "border-t border-border/40 pt-1.5 font-semibold" : ""}`}
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="num">{fmtBRL(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "pos" | "warn" | "neg";
  hint: string;
}) {
  const colorCls = tone === "pos" ? "text-pos border-pos/30 bg-pos/5"
                 : tone === "warn" ? "text-warning border-warning/30 bg-warning/5"
                 : "text-neg border-neg/30 bg-neg/5";
  return (
    <div className={`rounded-md border p-2 ${colorCls}`}>
      <div className="num text-sm font-bold">{value}</div>
      <div className="flex items-center justify-center gap-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
        {label}
        <HelpTip text={hint} />
      </div>
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



function NCGExplanationCard({ ncg, pmr, pmp, receitaDia, cpvDia }: { ncg: number; pmr: number; pmp: number; receitaDia: number; cpvDia: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-5">
      <SectionTitle hint="Explicação CFO sobre a composição do Capital de Giro.">
        Por dentro do seu Capital de Giro
      </SectionTitle>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sua operação mantém hoje <strong className="text-foreground">{fmtBRL(ncg)}</strong> imobilizados. 
            Isso significa que, antes de ver a cor do lucro, você precisa "adiantar" esse valor para o negócio não parar.
          </p>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between rounded bg-muted/20 p-2 text-xs">
              <span className="text-muted-foreground">Ciclo de Recebimento</span>
              <span className="font-semibold">{pmr} dias</span>
            </div>
            <div className="flex items-center justify-between rounded bg-muted/20 p-2 text-xs">
              <span className="text-muted-foreground">Ciclo de Pagamento</span>
              <span className="font-semibold">{pmp} dias</span>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex flex-col justify-center">
          <div className="text-[10px] uppercase tracking-wider text-primary font-bold mb-1">Impacto CFO</div>
          <div className="text-lg font-bold leading-tight">
            Seu desencaixe operacional é de {pmr - pmp} dias.
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
            Cada dia a mais que o cliente demora a pagar (PMR) te custa <strong className="text-foreground">{fmtBRL(receitaDia)}</strong>. 
            Cada dia que você consegue a mais com fornecedores (PMP) te economiza <strong className="text-foreground">{fmtBRL(cpvDia)}</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
