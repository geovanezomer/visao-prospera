// =====================================================================
// DiagnosticoExecutivoCard — card narrativo gerado pela IA.
//
// Renderiza APENAS se IA estiver configurada (`enabled`).
// Estrutura controlada pelo componente; a IA só preenche os textos.
// Números reais (valor, %) vêm do briefing — NUNCA do texto da IA.
// =====================================================================

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { Briefing } from "@/engines/finance/briefing";
import type { IndicadorKey } from "@/data/thresholds";
import { useDiagnosticoIA } from "@/hooks/useDiagnosticoIA";
import { readTelemetry, clearTelemetry } from "@/engines/ai/diagnosticoTelemetry";
import { compileAiMove, getAiMove } from "@/engines/finance/levers/aiMoves";

// Labels humanos dos indicadores — usados nos chips.
const INDICADOR_LABEL: Record<IndicadorKey, string> = {
  margemBruta: "Margem Bruta",
  margemEbitda: "Margem EBITDA",
  margemLiquida: "Margem Líquida",
  margemContribuicao: "Margem Contribuição",
  roe: "ROE",
  roic: "ROIC",
  roicVsWacc: "ROIC vs WACC",
  liquidezCorrente: "Liquidez Corrente",
  liquidezSeca: "Liquidez Seca",
  dividaLiqEbitda: "Dívida Líq./EBITDA",
  coberturaJuros: "Cobertura de Juros",
  dscr: "DSCR",
  endividamentoGeral: "Endividamento Geral",
  cicloFinanceiro: "Ciclo Financeiro",
  margemSeguranca: "Margem de Segurança",
  conversaoEbitdaCaixa: "Conversão EBITDA→Caixa",
  custoPessoalSobreReceita: "Custo Pessoal/Receita",
  qualidadeLucro: "Qualidade do Lucro",
};

const PRAZO_LABEL: Record<"imediato" | "30d" | "90d", string> = {
  imediato: "Imediato",
  "30d": "30 dias",
  "90d": "90 dias",
};

const PRAZO_COLOR: Record<"imediato" | "30d" | "90d", string> = {
  imediato: "border-[var(--destructive)]/40 bg-[var(--destructive)]/10 text-[var(--destructive)]",
  "30d": "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]",
  "90d": "border-border bg-muted/40 text-muted-foreground",
};

interface Props {
  briefing: Briefing | null;
}

export function DiagnosticoExecutivoCard({ briefing }: Props) {
  const { enabled, data, loading, error, cached, regenerate } = useDiagnosticoIA(briefing);
  const [showLog, setShowLog] = useState(false);
  // Releitura on-demand do log a cada render com o painel aberto (leitura
  // local e barata; acompanha novas gerações sem dependências artificiais).
  const log = showLog ? readTelemetry() : [];

  // Mapa de classificações p/ enriquecer os chips dos indicadores referenciados.
  const classMap = useMemo(() => {
    const m: Partial<Record<IndicadorKey, "critico" | "atencao" | "ok" | "excelente">> = {};
    briefing?.classificacoes.forEach((c) => {
      m[c.indicador] = c.nivel;
    });
    return m;
  }, [briefing]);

  // Regra: IA não configurada → OCULTA o card. Não mostra placeholder.
  if (!enabled) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Diagnóstico Executivo</h3>
          <Badge variant="outline" className="text-[10px] uppercase">
            IA
          </Badge>
          {cached && data && (
            <Badge
              variant="outline"
              className="gap-1 border-[var(--success)]/40 bg-[var(--success)]/10 text-[10px] text-[var(--success)]"
              title="Resultado carregado do cache local (até 7 dias)."
            >
              <Database className="h-3 w-3" />
              cache
            </Badge>
          )}
          {data?.usedPremium && (
            <Badge
              variant="outline"
              className="gap-1 border-primary/40 bg-primary/10 text-[10px] text-primary"
              title={`Gerado com modelo premium: ${data.provider}/${data.modelo}`}
            >
              Premium
            </Badge>
          )}
          {data?.usedFallback && (
            <Badge
              variant="outline"
              className="gap-1 border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[10px] text-[var(--warning)]"
              title="Premium configurado com dados incompletos — usando modelo base."
            >
              fallback base
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={regenerate}
          disabled={loading || !briefing}
          className="h-7 gap-1.5 text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Gerando..." : "Regerar"}
        </Button>
      </header>

      {/* Loading: skeleton */}
      {loading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {/* Erro: mensagem + retry */}
      {error && !loading && (
        <div className="flex items-start gap-3 rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--destructive)]" />
          <div className="flex-1">
            <div className="font-semibold text-foreground">Falha ao gerar diagnóstico</div>
            <div className="mt-1 text-muted-foreground">{error}</div>
          </div>
        </div>
      )}

      {/* Conteúdo */}
      {data && !loading && (
        <div className="space-y-5">
          {/* Veredito */}
          <p className="text-base font-medium leading-snug text-foreground">{data.data.veredito}</p>

          {/* Contexto */}
          {data.data.contexto && (
            <p className="text-sm leading-relaxed text-muted-foreground">{data.data.contexto}</p>
          )}

          {/* Pontos críticos */}
          {data.data.pontosCriticos.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--destructive)]">
                <TriangleAlert className="h-3.5 w-3.5" />
                Pontos críticos
              </h4>
              <ul className="space-y-3">
                {data.data.pontosCriticos.map((p, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-3"
                  >
                    <div className="text-sm font-semibold text-foreground">{p.titulo}</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {p.explicacao}
                    </div>
                    {p.indicadoresReferenciados.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.indicadoresReferenciados
                          .filter((k) => INDICADOR_LABEL[k])
                          .map((k) => (
                            <Badge
                              key={k}
                              variant="outline"
                              className={`text-[10px] ${
                                classMap[k] === "critico"
                                  ? "border-[var(--destructive)]/50 text-[var(--destructive)]"
                                  : classMap[k] === "atencao"
                                    ? "border-[var(--warning)]/50 text-[var(--warning)]"
                                    : ""
                              }`}
                            >
                              {INDICADOR_LABEL[k]}
                            </Badge>
                          ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pontos fortes */}
          {data.data.pontosFortes.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-pos">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Pontos fortes
              </h4>
              <ul className="space-y-2">
                {data.data.pontosFortes.map((p, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 p-3"
                  >
                    <div className="text-sm font-semibold text-foreground">{p.titulo}</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {p.explicacao}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Próximos passos */}
          {data.data.proximosPassos.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Próximos passos
              </h4>
              <ol className="space-y-2">
                {data.data.proximosPassos.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 p-3"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-foreground">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm text-foreground">{p.acao}</div>
                      {p.impactoEsperado && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Impacto: {p.impactoEsperado}
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${PRAZO_COLOR[p.prazo]}`}>
                      {PRAZO_LABEL[p.prazo]}
                    </Badge>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Propostas propositivas — Fase 2: IA → Simulador (deep-link) */}
          {data.data.propostasSimulador && data.data.propostasSimulador.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Propostas para o Simulador
              </h4>
              <ul className="space-y-2">
                {data.data.propostasSimulador.map((p, i) => {
                  const move = getAiMove(p.moveId);
                  const compiled = compileAiMove(p.moveId, p.magnitude);
                  if (!move || !compiled) return null;
                  const magFmt =
                    move.unit === "BRL"
                      ? compiled.magnitude.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                          maximumFractionDigits: 0,
                        })
                      : move.unit === "pct"
                        ? `${compiled.magnitude > 0 ? "+" : ""}${compiled.magnitude}%`
                        : `${compiled.magnitude} dias`;
                  return (
                    <li
                      key={i}
                      className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {move.label}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-primary/40 bg-primary/10 font-mono text-[10px] text-primary"
                          >
                            {magFmt}
                          </Badge>
                        </div>
                        {p.justificativa && (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {p.justificativa}
                          </p>
                        )}
                        {p.impactoQualitativo && (
                          <p className="mt-1 text-[11px] italic text-muted-foreground">
                            Impacto esperado: {p.impactoQualitativo}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("gz-apply-simulator-params", {
                              detail: compiled.params,
                            }),
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded border border-primary/50 bg-primary/15 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary transition hover:bg-primary/25"
                      >
                        <SlidersHorizontal className="h-3 w-3" />
                        Abrir no Simulador
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[10px] italic text-muted-foreground">
                Propostas geradas pela IA com base no diagnóstico. Cada botão abre o Simulador com o
                slider pré-configurado — você pode então combinar com outras alavancas antes de
                aplicar ao plano-base.
              </p>
            </div>
          )}

          {/* Rodapé de auditoria CVM + telemetria local */}
          <footer className="space-y-2 border-t border-border/40 pt-3 text-[10px] text-muted-foreground">
            {/* Disclaimer CVM: IA assistiva, responsabilidade do consultor */}

            <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 p-2 text-[10px] leading-relaxed">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--warning)]" />
              <span>
                <strong className="text-foreground">Análise assistida por IA.</strong> Conteúdo
                interpretativo gerado por{" "}
                <span className="font-mono">
                  {data.provider}/{data.modelo}
                </span>{" "}
                a partir de números calculados pela engine. A revisão, validação e responsabilidade
                técnica são do consultor / analista.
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>
                Gerado por {data.provider} · {data.modelo} · prompt {data.promptVersion} ·{" "}
                {new Date(data.geradoEm).toLocaleString("pt-BR")}
              </span>
              <button
                type="button"
                onClick={() => setShowLog((v) => !v)}
                className="underline-offset-2 hover:underline"
              >
                {showLog ? "Ocultar log" : "Ver log"}
              </button>
            </div>

            {showLog && (
              <div className="rounded-md border border-border/40 bg-background/40 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Últimas gerações ({log.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      clearTelemetry();
                      setShowLog(false);
                    }}
                    className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Limpar
                  </button>
                </div>
                {log.length === 0 ? (
                  <div className="text-muted-foreground">Sem registros.</div>
                ) : (
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                    {log.slice(0, 20).map((e, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {new Date(e.ts).toLocaleTimeString("pt-BR")}
                        </span>
                        <span
                          className={
                            e.status === "ok"
                              ? "text-[var(--success)]"
                              : e.status === "cache"
                                ? "text-primary"
                                : "text-[var(--destructive)]"
                          }
                        >
                          {e.status}
                        </span>
                        <span>{e.model}</span>
                        <span className="text-muted-foreground">{e.durationMs}ms</span>
                        {e.errorMsg && (
                          <span className="truncate text-[var(--destructive)]" title={e.errorMsg}>
                            {e.errorMsg}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </footer>
        </div>
      )}
    </section>
  );
}
