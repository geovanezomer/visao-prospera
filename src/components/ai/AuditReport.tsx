// Renderiza relatórios do Modo Auditor com estilo distinto (card destacado),
// permitindo ao consultor reconhecer/apresentar ao cliente como entregável formal.
// Auditoria INTEGRADA: alertas detectados viram botões de drill-down que
// disparam novos prompts (chamando tools como get_fluxo_caixa, get_despesas,
// simular_alavanca) para investigação colaborativa, e exibimos um checklist
// com contagem de itens validados / em atenção / críticos.

import { lazy, Suspense, useMemo } from "react";
import remarkGfm from "remark-gfm";
import {
  ClipboardCheck,
  Copy,
  Download,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ReactMarkdown = lazy(() => import("react-markdown"));

export const AUDIT_OPEN = "<!--AUDIT-REPORT-->";
export const AUDIT_CLOSE = "<!--/AUDIT-REPORT-->";

/** Detecta se uma mensagem do assistente é um relatório do auditor. */
export function isAuditReport(content: string): boolean {
  return content.includes(AUDIT_OPEN);
}

/** Extrai apenas o miolo entre os marcadores (ou tudo, se streaming ainda em curso). */
function extractBody(content: string): string {
  const start = content.indexOf(AUDIT_OPEN);
  if (start < 0) return content;
  const after = content.slice(start + AUDIT_OPEN.length);
  const end = after.indexOf(AUDIT_CLOSE);
  return (end >= 0 ? after.slice(0, end) : after).trim();
}

type AlertLevel = "danger" | "warn" | "ok";
type Alert = { level: AlertLevel; text: string };

// Detecta linhas de alerta no markdown. Procura emojis/keywords comuns.
function parseAlerts(body: string): Alert[] {
  const lines = body.split(/\r?\n/);
  const out: Alert[] = [];
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*>\d.)\s]+/, "");
    if (!line) continue;
    const isDanger = /❌|🔴|DANGER|CRÍTIC|CRITIC|RISCO ALTO/i.test(line);
    const isWarn = /⚠️|🟡|WARN|ATENÇÃO|ALERTA/i.test(line);
    const isOk = /✅|🟢|OK\b|VALIDADO|SAUDÁVEL/i.test(line);
    if (isDanger) out.push({ level: "danger", text: line.slice(0, 220) });
    else if (isWarn) out.push({ level: "warn", text: line.slice(0, 220) });
    else if (isOk) out.push({ level: "ok", text: line.slice(0, 220) });
    if (out.length >= 12) break;
  }
  return out;
}

// Monta um prompt de drill-down que instrui a IA a usar 3 tools em paralelo.
function drillPrompt(alertText: string): string {
  return [
    `INVESTIGAR ESTE ALERTA DA AUDITORIA: "${alertText}"`,
    "",
    "Aprofunde chamando, em paralelo, as ferramentas mais relevantes (ex.: get_fluxo_caixa, get_despesas, get_indicadores, get_contratos_divida) e, se aplicável, simular_alavanca para testar 1-2 hipóteses de correção.",
    "Responda com: (1) causa-raiz com os números citando a tool de origem entre colchetes [tool:nome], (2) impacto quantificado, (3) 2-3 alavancas priorizadas com efeito estimado.",
  ].join("\n");
}

export function AuditReport({
  content,
  onCopy,
  onAction,
}: {
  content: string;
  onCopy: (s: string) => void;
  onAction?: (prompt: string) => void;
}) {
  const body = extractBody(content);
  const alerts = useMemo(() => parseAlerts(body), [body]);
  const counts = useMemo(
    () => ({
      ok: alerts.filter((a) => a.level === "ok").length,
      warn: alerts.filter((a) => a.level === "warn").length,
      danger: alerts.filter((a) => a.level === "danger").length,
    }),
    [alerts],
  );

  const download = () => {
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-auditor-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Relatório do Auditor
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => onCopy(body)}
          >
            <Copy className="h-3 w-3 mr-1" /> copiar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={download}>
            <Download className="h-3 w-3 mr-1" /> .md
          </Button>
        </div>
      </div>

      {/* Checklist da auditoria — contagem por status */}
      {counts.ok + counts.warn + counts.danger > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-background/40 px-3 py-2 text-[11px]">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">
            Checklist:
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> {counts.ok} validado{counts.ok === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-400">
            <AlertTriangle className="h-3 w-3" /> {counts.warn} em atenção
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-red-400">
            <XCircle className="h-3 w-3" /> {counts.danger} crítico{counts.danger === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div
        className="prose prose-sm prose-invert max-w-none px-4 py-3 text-sm break-words
                      prose-headings:text-foreground prose-h1:text-base prose-h2:text-sm prose-h2:mt-4 prose-h2:border-b prose-h2:border-border/40 prose-h2:pb-1
                      prose-h3:text-xs prose-h3:uppercase prose-h3:tracking-wide
                      prose-table:text-xs"
      >
        <Suspense fallback={<div className="text-xs text-muted-foreground">{body || "…"}</div>}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "_…_"}</ReactMarkdown>
        </Suspense>
      </div>

      {/* Auditoria interativa — botões de drill-down para cada alerta detectado */}
      {onAction && alerts.some((a) => a.level !== "ok") && (
        <div className="border-t border-primary/20 bg-background/40 px-3 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Investigação colaborativa — clique para aprofundar
          </div>
          <div className="flex flex-col gap-1.5">
            {alerts
              .filter((a) => a.level !== "ok")
              .map((a, i) => (
                <button
                  key={i}
                  onClick={() => onAction(drillPrompt(a.text))}
                  className={`group flex items-start gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent ${
                    a.level === "danger"
                      ? "border-red-500/40 hover:border-red-500/70"
                      : "border-amber-500/40 hover:border-amber-500/70"
                  }`}
                >
                  {a.level === "danger" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="flex-1 leading-snug text-foreground/90">{a.text}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-primary opacity-70 group-hover:opacity-100">
                    <Search className="h-3 w-3" /> investigar
                  </span>
                </button>
              ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            A IA executará as ferramentas relevantes em paralelo (fluxo de caixa, despesas,
            indicadores, contratos) e citará a origem de cada número.
          </p>
        </div>
      )}
    </div>
  );
}
