// =====================================================================
// KanitzCard — Termômetro de Insolvência (Kanitz, 1978).
// Card visual reaproveitado em IndicatorsTab e DashboardTab.
// Lê SOMENTE valores derivados (state + ind) — sem cálculo próprio.
// =====================================================================
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { calcKanitz, kanitzCalcMemo } from "@/engines/finance/kanitz";
import { assessCrisisStage, type CrisisTone } from "@/engines/finance/crisisStage";
import { HelpTip } from "@/components/sim/shared/primitives";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ShieldAlert, Skull, TrendingDown } from "lucide-react";
import { fmtNum } from "@/engines/finance/format";

// Escala visual: [-7, +7]. Faixas: <-3 vermelho, -3..0 âmbar, >0 verde.
const MIN = -7;
const MAX = 7;
const RANGE = MAX - MIN;

function pctFromFi(fi: number): number {
  if (!Number.isFinite(fi)) return 50;
  const clamped = Math.max(MIN, Math.min(MAX, fi));
  return ((clamped - MIN) / RANGE) * 100;
}

export function KanitzCard({
  compact = false,
  state: stateProp,
}: {
  compact?: boolean;
  /** Estado opcional (cenário simulado). Sem prop, lê do contexto (base). */
  state?: ReturnType<typeof useFinanceState>;
}) {
  const ctxState = useFinanceState();
  const state = stateProp ?? ctxState;
  const { ind } = useFinanceModel(state);
  const k = calcKanitz(state, ind);
  const crisis = assessCrisisStage(state, ind);

  const toneColor =
    k.tone === "pos"
      ? "var(--success)"
      : k.tone === "warn"
        ? "#F5B85B"
        : k.tone === "neg"
          ? "var(--destructive)"
          : "var(--muted-foreground)";

  const pos = pctFromFi(k.fi);
  // Limites das faixas em % da escala (MIN..MAX).
  const insolEnd = ((-3 - MIN) / RANGE) * 100; // 0 → -3
  const penumEnd = ((0 - MIN) / RANGE) * 100; // -3 → 0

  return (
    <div className="rounded-lg border border-primary/30 bg-card/60 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <span>Termômetro de Insolvência — Kanitz</span>
            <HelpTip
              text="Fator de Insolvência (FI) de Kanitz. Combina rentabilidade, liquidez e endividamento em um único índice calibrado para o mercado brasileiro. FI ≥ 0 = solvente; entre −3 e 0 = penumbra (atenção); abaixo de −3 = risco real de insolvência."
              formula="FI = 0,05·X1 + 1,65·X2 + 3,55·X3 − 1,06·X4 − 0,33·X5"
              calc={kanitzCalcMemo(k)}
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            X1 ROE · X2 Liq. Geral · X3 Liq. Seca · X4 Liq. Corrente · X5 Terceiros/PL
          </div>
        </div>
        <div className="text-right">
          <div className="mono text-3xl font-bold" style={{ color: toneColor }}>
            {k.baseInsuficiente ? "—" : k.fi.toFixed(2)}
          </div>
          <div
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: toneColor }}
          >
            {k.label}
          </div>
        </div>
      </div>

      {/* Régua do termômetro */}
      <div className="mt-5">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 bg-[var(--destructive)]/70"
            style={{ width: `${insolEnd}%` }}
          />
          <div
            className="absolute inset-y-0 bg-[#F5B85B]/70"
            style={{ left: `${insolEnd}%`, width: `${penumEnd - insolEnd}%` }}
          />
          <div
            className="absolute inset-y-0 bg-[var(--success)]/70"
            style={{ left: `${penumEnd}%`, right: 0 }}
          />
          {!k.baseInsuficiente && (
            <div
              className="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-foreground shadow"
              style={{ left: `${pos}%` }}
              role="img"
              aria-label={`Indicador na posição FI = ${k.fi.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`}
            />
          )}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>−7</span>
          <span>−3</span>
          <span>0</span>
          <span>+7</span>
        </div>
      </div>

      {!compact && !k.baseInsuficiente && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-5">
          <KanitzCell label="X1 · LL/PL" v={k.x1} c={k.c1} fmt="frac" />
          <KanitzCell label="X2 · Liq. Geral" v={k.x2} c={k.c2} fmt="x" />
          <KanitzCell label="X3 · Liq. Seca" v={k.x3} c={k.c3} fmt="x" />
          <KanitzCell label="X4 · Liq. Corr." v={k.x4} c={k.c4} fmt="x" />
          <KanitzCell label="X5 · Terc./PL" v={k.x5} c={k.c5} fmt="x" />
        </div>
      )}

      <p
        className={cn(
          "mt-3 text-[11px] leading-relaxed text-muted-foreground",
          compact && "hidden",
        )}
      >
        Modelo discriminante de Stephen Kanitz (FEA-USP, 1978), calibrado em empresas brasileiras.
        Excelente alerta precoce de descontinuidade — deve ser lido junto com DSCR, geração de caixa
        e covenants.
      </p>

      {/* ── Termômetro de Crise — estágio operacional + rota recomendada ── */}
      {/* Sem base para o índice, o estágio ao lado contradiria o "—" acima. */}
      {!k.baseInsuficiente && <CrisisStagePanel crisis={crisis} compact={compact} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Painel de Estágio de Crise (Lei 11.101/2005 — Lei 14.112/2020)
// ─────────────────────────────────────────────────────────────────────
function CrisisStagePanel({
  crisis,
  compact,
}: {
  crisis: ReturnType<typeof assessCrisisStage>;
  compact: boolean;
}) {
  const palette = toneToPalette(crisis.tone);
  const Icon = stageIcon(crisis.stage);

  return (
    <div
      className="mt-4 rounded-lg border p-4"
      style={{ borderColor: palette.border, background: palette.bg }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" style={{ color: palette.fg }} aria-hidden />
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: palette.fg }}
            >
              Estágio {crisis.stage} de 4 · Termômetro de Crise
            </div>
            <div className="mt-0.5 text-sm font-semibold" style={{ color: palette.fg }}>
              {crisis.label}
            </div>
          </div>
        </div>
        <HelpTip
          text={
            "Classificação operacional do estágio de crise — complementar ao Kanitz. " +
            "Combina margens, FCO, liquidez, alavancagem e PL para indicar a ROTA recomendada: " +
            "ajuste gerencial → renegociação extrajudicial → recuperação extrajudicial → RJ. " +
            "Base: Lei 11.101/2005, atualizada pela Lei 14.112/2020."
          }
        />
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-foreground/90">{crisis.description}</p>

      {/* Régua dos 4 estágios */}
      <div className="mt-3 grid grid-cols-5 gap-1">
        {(["0", "1", "2", "3", "4"] as const).map((s) => {
          const n = Number(s) as 0 | 1 | 2 | 3 | 4;
          const active = n === crisis.stage;
          const passed = n < crisis.stage;
          return (
            <div
              key={s}
              className="h-1.5 rounded-full"
              style={{
                background: active
                  ? palette.fg
                  : passed
                    ? "var(--muted-foreground)"
                    : "var(--muted)",
                opacity: active ? 1 : passed ? 0.55 : 0.35,
              }}
              title={`Estágio ${s}`}
            />
          );
        })}
      </div>

      {!compact && (
        <>
          <div className="mt-3 rounded-md bg-background/60 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recomendação
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-foreground">
              {crisis.recommendation}
            </div>
            <div className="mt-1.5 text-[10px] italic text-muted-foreground">
              {crisis.legalBasis}
            </div>
          </div>

          {crisis.triggers.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Gatilhos detectados
              </div>
              <ul className="mt-1 space-y-0.5">
                {crisis.triggers.map((t, i) => (
                  <li key={i} className="text-[11px] text-foreground/85">
                    • {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function toneToPalette(tone: CrisisTone) {
  switch (tone) {
    case "pos":
      return {
        fg: "var(--success)",
        border: "color-mix(in srgb, var(--success) 35%, transparent)",
        bg: "color-mix(in srgb, var(--success) 8%, transparent)",
      };
    case "warn":
      return {
        fg: "#F5B85B",
        border: "color-mix(in srgb, #F5B85B 40%, transparent)",
        bg: "color-mix(in srgb, #F5B85B 10%, transparent)",
      };
    case "neg":
      return {
        fg: "var(--destructive)",
        border: "color-mix(in srgb, var(--destructive) 40%, transparent)",
        bg: "color-mix(in srgb, var(--destructive) 8%, transparent)",
      };
    case "crit":
      return {
        fg: "var(--destructive)",
        border: "var(--destructive)",
        bg: "color-mix(in srgb, var(--destructive) 16%, transparent)",
      };
    default:
      return { fg: "var(--muted-foreground)", border: "var(--border)", bg: "transparent" };
  }
}

function stageIcon(stage: 0 | 1 | 2 | 3 | 4) {
  if (stage === 0) return CheckCircle2;
  if (stage === 1) return TrendingDown;
  if (stage === 2) return AlertTriangle;
  if (stage === 3) return ShieldAlert;
  return Skull;
}

function KanitzCell({
  label,
  v,
  c,
  fmt,
}: {
  label: string;
  v: number;
  c: number;
  fmt: "frac" | "x";
}) {
  const f = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className="mono font-semibold text-foreground">
        {fmt === "frac" ? `${fmtNum(v * 100, 1)}%` : `${f(v)}×`}
      </span>
      <span className="mono text-[10px] text-muted-foreground">contrib.: {f(c)}</span>
    </div>
  );
}
