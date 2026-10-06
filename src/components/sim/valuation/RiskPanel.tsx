import { AppState } from "@/engines/finance/types";
import { buildValuation } from "@/engines/finance/valuation";
import { fmtBRLCompact, fmtNum } from "@/engines/finance/format";
import { ShieldAlert, TrendingDown, CheckCircle2 } from "lucide-react";
import { SectionTitle } from "@/components/sim/shared/primitives";
import { RangeCard, Reco } from "@/components/sim/valuation/parts";

// Painel de risco estratégico — haircut, faixa de valuation e recomendações.
export function RiskPanel({
  valuation,
  state: _state,
}: {
  valuation: ReturnType<typeof buildValuation>;
  state: AppState;
}) {
  const s = valuation.strategicResult;
  const haircut = valuation.haircutApplied;
  const ev = valuation.enterpriseValue;
  const levelTone =
    s.level === "robusto"
      ? "border-pos/40 bg-pos/5 text-pos"
      : s.level === "adequado"
        ? "border-primary/40 bg-primary/5 text-primary"
        : s.level === "frágil"
          ? "border-[var(--warning)]/40 bg-[var(--warning)]/5 text-[var(--warning)]"
          : s.level === "crítico"
            ? "border-neg/40 bg-neg/5 text-neg"
            : "border-border/60 bg-card/40 text-muted-foreground";

  return (
    <>
      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--warning)]" />
            <SectionTitle hint="Vem da aba Governança. Quanto mais alto o índice, menor o haircut aplicado ao valuation.">
              Risco Estratégico (Governança)
            </SectionTitle>
          </div>
          <span
            className={`rounded-md border px-3 py-1 text-xs font-semibold capitalize ${levelTone}`}
          >
            {s.level}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Índice de Risco Estratégico</span>
            <span className="mono font-semibold text-foreground">{fmtNum(s.index, 0)} / 100</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full bg-gradient-to-r from-neg via-[var(--warning)] to-pos"
              style={{ width: `${Math.max(2, s.index)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{s.headline}</p>
        </div>

        {s.subscores.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-border/40 pt-4">
            {s.subscores.map((sub) => (
              <div key={sub.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{sub.label}</span>
                  <span
                    className={`mono font-semibold ${
                      !sub.filled
                        ? "text-muted-foreground"
                        : sub.score >= 70
                          ? "text-pos"
                          : sub.score >= 50
                            ? "text-[var(--warning)]"
                            : "text-neg"
                    }`}
                  >
                    {sub.filled ? sub.score.toFixed(0) : "—"}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className={`h-full ${
                      !sub.filled
                        ? "bg-muted-foreground/30"
                        : sub.score >= 70
                          ? "bg-pos"
                          : sub.score >= 50
                            ? "bg-[var(--warning)]"
                            : "bg-neg"
                    }`}
                    style={{ width: `${sub.filled ? sub.score : 0}%` }}
                  />
                </div>
                {sub.highlights.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                    {sub.highlights.map((h, i) => (
                      <li key={i}>· {h}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {haircut > 0 && (
        <section className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-5">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-[var(--warning)]" />
            <SectionTitle>Haircut Estratégico Aplicado</SectionTitle>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-foreground">Redução de valor por risco estratégico</span>
            <span className="mono text-2xl font-bold text-[var(--warning)]">
              −{fmtNum(haircut * 100, 1)}%
            </span>
          </div>
          <div className="mt-3 grid gap-3 border-t border-[var(--warning)]/30 pt-3 md:grid-cols-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                EV sem haircut
              </div>
              <div className="mono mt-1 text-lg font-semibold text-foreground">
                {fmtBRLCompact(ev.base / (1 - haircut))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                EV com haircut
              </div>
              <div className="mono mt-1 text-lg font-semibold text-[var(--warning)]">
                {fmtBRLCompact(ev.base)}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle hint="Range de Enterprise Value combinando incerteza de premissas e haircut estratégico.">
          Faixa de Valuation
        </SectionTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <RangeCard
            tone="neg"
            label="Pessimista"
            desc={
              valuation.dcfDetails
                ? "Incerteza paramétrica: −25% sobre EV base"
                : "Incerteza paramétrica: −10% sobre EV base"
            }
            value={ev.low}
            base={ev.base}
          />
          <RangeCard
            tone="primary"
            label="Base (provável)"
            desc="Premissas atuais (WACC, g, múltiplos)"
            value={ev.base}
            base={ev.base}
          />
          <RangeCard
            tone="pos"
            label="Otimista"
            desc={
              valuation.dcfDetails
                ? "Incerteza paramétrica: +35% sobre EV base"
                : "Incerteza paramétrica: +15% sobre EV base"
            }
            value={ev.high}
            base={ev.base}
          />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <div className="text-foreground">
            <span className="font-semibold">Faixa de confiança:</span>{" "}
            <span className="mono">
              {fmtBRLCompact(ev.low)} → {fmtBRLCompact(ev.high)}
            </span>{" "}
            <span className="text-muted-foreground">· base provável </span>
            <span className="mono">{fmtBRLCompact(ev.base)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle>Recomendações para Aumentar o Valor</SectionTitle>
        <ul className="mt-3 space-y-2 text-sm">
          {s.index < 50 && (
            <Reco
              icon="🎯"
              title="Diversifique a base de clientes"
              text="Reduzir concentração eleva o múltiplo aceitável pelo comprador."
            />
          )}
          {(s.level === "crítico" || s.level === "frágil") && (
            <Reco
              icon="🏛️"
              title="Profissionalize a governança"
              text="Plano de sucessão, processos documentados e equipe sênior reduzem o bus factor."
            />
          )}
          {haircut > 0.2 && (
            <Reco
              icon="💰"
              title="Cada melhoria estratégica vira valor"
              text={`No nível atual de haircut (${fmtNum(haircut * 100, 0)}%), reduzir 10pp no risco libera ~${fmtBRLCompact(ev.base * (haircut / 4))} de valor.`}
            />
          )}
          <Reco
            icon="🧪"
            title="Simule cenários operacionais"
            text="Use a aba Simulador para testar como mudanças de preço, custo ou volume impactam o EV."
          />
          <Reco
            icon="📐"
            title="Triangule múltiplos vs DCF"
            text="Métodos próximos = valuation defensável. Métodos divergentes = revisar premissas antes de negociar."
          />
        </ul>
      </section>
    </>
  );
}
