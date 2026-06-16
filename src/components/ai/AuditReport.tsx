// Renderiza relatórios do Modo Auditor com estilo distinto (card destacado),
// permitindo ao consultor reconhecer/apresentar ao cliente como entregável formal.

import { lazy, Suspense } from "react";
import remarkGfm from "remark-gfm";
import { ClipboardCheck, Copy, Download } from "lucide-react";
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

export function AuditReport({ content, onCopy }: { content: string; onCopy: (s: string) => void }) {
  const body = extractBody(content);

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
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">Relatório do Auditor</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onCopy(body)}>
            <Copy className="h-3 w-3 mr-1" /> copiar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={download}>
            <Download className="h-3 w-3 mr-1" /> .md
          </Button>
        </div>
      </div>
      <div className="prose prose-sm prose-invert max-w-none px-4 py-3 text-sm break-words
                      prose-headings:text-foreground prose-h1:text-base prose-h2:text-sm prose-h2:mt-4 prose-h2:border-b prose-h2:border-border/40 prose-h2:pb-1
                      prose-h3:text-xs prose-h3:uppercase prose-h3:tracking-wide
                      prose-table:text-xs">
        <Suspense fallback={<div className="text-xs text-muted-foreground">{body || "…"}</div>}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "_…_"}</ReactMarkdown>
        </Suspense>
      </div>
    </div>
  );
}
