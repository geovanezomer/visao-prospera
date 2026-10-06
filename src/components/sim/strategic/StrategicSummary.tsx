/**
 * Painel de resultado estratégico — extraído do antigo StrategicTab para ser
 * reutilizado na aba "Resultados". Renderiza índice, haircut, matriz 2x2,
 * highlights por dimensão e quadrantes.
 */
import { AppState } from "@/engines/finance/types";
import { computeStrategic, quadrant, type SubScore } from "@/engines/finance/strategic";
import { computeHealth } from "@/engines/finance/health";
import { SectionTitle, StatCard } from "@/components/sim/shared/primitives";
import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle, TriangleAlert } from "lucide-react";
import { fmtNum } from "@/engines/finance/format";

export function StrategicSummary({ state }: { state: AppState }) {
  const strategic = computeStrategic(state);
  const health = computeHealth(state);
  const quad = quadrant(health.financial, strategic);

  if (!strategic.hasAnyAnswer) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <HelpCircle className="h-4 w-4" /> Análise estratégica não preenchida
        </div>
        <p className="mt-1">
          Preencha a aba <strong>Governança</strong> para enriquecer este diagnóstico com
          concentração de clientes, dependência de pessoas-chave, posição competitiva e exposição
          regulatória. Sem isso, o health score reflete apenas o lado financeiro.
        </p>
      </div>
    );
  }

  const levelTone =
    strategic.level === "robusto"
      ? "pos"
      : strategic.level === "adequado"
        ? "default"
        : strategic.level === "frágil"
          ? "warn"
          : "neg";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
        <StatCard
          label="Índice estratégico"
          value={`${strategic.index}/100`}
          tone={levelTone as "pos" | "default" | "warn" | "neg"}
          sub={`Nível: ${strategic.level}`}
        />
        <StatCard
          label="Haircut aplicado"
          value={`${fmtNum(strategic.haircut * 100, 0)}%`}
          tone={strategic.haircut === 0 ? "pos" : strategic.haircut > 0.2 ? "neg" : "warn"}
          sub="reduz o health financeiro"
        />
        <div className="col-span-2 md:col-span-1">
          <StatCard
            label="Health ajustado"
            value={`${fmtNum(health.total, 0)}/100`}
            sub={`Financeiro puro: ${fmtNum(health.financial, 0)}`}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
        <div className="text-foreground">{strategic.headline}</div>
      </div>

      <Matrix financial={health.financial} strategic={strategic.index} quad={quad} />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {strategic.subscores
          .filter((s) => s.filled)
          .map((s) => (
            <SubscoreCard key={s.key} sub={s} />
          ))}
        <ResilienciaCard strategic={strategic} health={health} />
        {strategic.subscores.filter((s) => !s.filled).length > 0 && (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
            <div className="mb-2 flex items-center gap-1.5 font-medium">
              <HelpCircle className="h-4 w-4" /> Dimensões não respondidas
            </div>
            <ul className="space-y-1">
              {strategic.subscores
                .filter((s) => !s.filled)
                .map((s) => (
                  <li key={s.key} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" /> {s.label}
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-[11px] italic">
              Não penalizam o score — apenas reduzem a precisão do diagnóstico.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ResilienciaCard({
  strategic,
  health,
}: {
  strategic: ReturnType<typeof computeStrategic>;
  health: ReturnType<typeof computeHealth>;
}) {
  // Score sintético: média ponderada entre health financeiro e índice estratégico,
  // penalizada pelo haircut. Reflete a "resiliência combinada" da empresa.
  const score = Math.round(
    Math.max(
      0,
      Math.min(100, health.financial * 0.5 + strategic.index * 0.5 - strategic.haircut * 100 * 0.3),
    ),
  );
  const tone =
    score >= 70
      ? { bar: "bg-pos", icon: <CheckCircle2 className="h-4 w-4 text-pos" /> }
      : score >= 45
        ? {
            bar: "bg-[var(--warning)]",
            icon: <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />,
          }
        : { bar: "bg-neg", icon: <AlertTriangle className="h-4 w-4 text-neg" /> };
  const highlights: string[] = [];
  if (strategic.haircut > 0.2)
    highlights.push(
      `Haircut estratégico ${fmtNum(strategic.haircut * 100, 0)}% sobre o financeiro`,
    );
  if (health.financial < 50)
    highlights.push("Financeiro fraco — pouca margem para absorver choques");
  if (strategic.index < 50)
    highlights.push("Estratégia frágil — eventos externos podem comprometer resultado");
  if (highlights.length === 0)
    highlights.push("Combinação saudável entre solidez financeira e estratégica");
  highlights.push(
    `Financeiro ${fmtNum(health.financial, 0)} · Estratégico ${strategic.index} · ajustado ${score}`,
  );
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {tone.icon} Resiliência Combinada
        </div>
        <div className="mono text-sm font-semibold">{fmtNum(score, 0)}</div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
        <div className={`h-full ${tone.bar}`} style={{ width: `${score}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
        {highlights.map((h, i) => (
          <li key={i} className="flex gap-1.5">
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubscoreCard({ sub }: { sub: SubScore }) {
  const tone =
    sub.status === "ok"
      ? { bar: "bg-pos", icon: <CheckCircle2 className="h-4 w-4 text-pos" /> }
      : sub.status === "warn"
        ? {
            bar: "bg-[var(--warning)]",
            icon: <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />,
          }
        : { bar: "bg-neg", icon: <AlertTriangle className="h-4 w-4 text-neg" /> };
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {tone.icon} {sub.label}
        </div>
        <div className="mono text-sm font-semibold">{fmtNum(sub.score, 0)}</div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
        <div className={`h-full ${tone.bar}`} style={{ width: `${sub.score}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
        {sub.highlights.map((h, i) => (
          <li key={i} className="flex gap-1.5">
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Matrix({
  financial,
  strategic,
  quad,
}: {
  financial: number;
  strategic: number;
  quad: ReturnType<typeof quadrant>;
}) {
  const x = strategic;
  const y = financial;
  const quadStyle = (key: "robusta" | "fragil_rica" | "vulneravel" | "critica") =>
    quad.q === key ? "border-primary bg-primary/10" : "border-border/40 bg-muted/10";
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Matriz Financeiro × Estratégico</SectionTitle>
        <div className="text-xs">
          <span className="text-muted-foreground">Quadrante: </span>
          <span className="font-semibold text-primary">{quad.label}</span>
        </div>
      </div>
      <div className="relative">
        <div className="grid grid-cols-2 gap-2">
          {/*
           * Layout do quadrante (eixo X = estratégico; eixo Y = financeiro).
           * O ponto usa `left: x%` e `top: (100 − y)%` — portanto:
           *   top-left   → estratégico BAIXO + financeiro ALTO → Frágil-rica
           *   top-right  → estratégico ALTO  + financeiro ALTO → Robusta
           *   bottom-left→ estratégico BAIXO + financeiro BAIXO→ Crítica
           *   bottom-right → estratégico ALTO + financeiro BAIXO → Vulnerável
           * (Antes: top-left estava rotulada "Vulnerável" e bottom-right
           * "Frágil-rica", divergindo do ponto e da função `quadrant()`.)
           */}
          <div
            className={`flex h-28 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("fragil_rica")}`}
          >
            <div>
              <div className="font-semibold">Frágil-rica</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Fin. forte / Estrat. frágil
              </div>
            </div>
          </div>
          <div
            className={`flex h-28 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("robusta")}`}
          >
            <div>
              <div className="font-semibold">Robusta</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Fin. forte / Estrat. sólido
              </div>
            </div>
          </div>
          <div
            className={`flex h-28 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("critica")}`}
          >
            <div>
              <div className="font-semibold">Crítica</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Fin. fraco / Estrat. frágil
              </div>
            </div>
          </div>
          <div
            className={`flex h-28 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("vulneravel")}`}
          >
            <div>
              <div className="font-semibold">Vulnerável</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Fin. fraco / Estrat. sólido
              </div>
            </div>
          </div>
        </div>
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-lg ring-2 ring-primary/40"
          style={{ left: `${x}%`, top: `${100 - y}%` }}
          title={`Fin: ${fmtNum(y, 0)} · Estrat: ${fmtNum(x, 0)}`}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{quad.description}</p>
      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>← Estratégico frágil</span>
        <span>Estratégico sólido →</span>
      </div>
    </div>
  );
}
