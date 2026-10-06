// =====================================================================
// VerificationFooter — rodapé "Resposta Auditável" na mensagem do assistente.
// Mostra selo compacto; expande para listar cifras não verificadas.
// Não bloqueia nem altera a resposta.
// =====================================================================

import { useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { VerificationResult } from "@/engines/ai/verification";

interface Props {
  verification: VerificationResult;
}

export function VerificationFooter({ verification }: Props) {
  const [open, setOpen] = useState(false);
  const total = verification.verified.length + verification.unverified.length;

  // Sem números citados → sem selo (vacuamente verdadeiro).
  if (total === 0) return null;

  const full = verification.unverified.length === 0;
  const cls = full
    ? "text-[var(--success)] border-[var(--success)]/30 bg-[var(--success)]/5"
    : "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/5";

  return (
    <div className={`mt-2 rounded-md border px-2 py-1.5 text-[11px] ${cls}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        {full ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1">
          {full ? "✓ " : ""}
          {verification.verified.length} de {total} números verificados nas fontes
          {!full && ` · ${verification.unverified.length} sem procedência`}
        </span>
        {!full &&
          (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
      </button>
      {open && !full && (
        <ul className="mt-1.5 space-y-1 border-t border-current/20 pt-1.5">
          {verification.unverified.map((n, i) => (
            <li key={i} className="leading-snug">
              <span className="font-mono font-semibold">{n.raw}</span> — não encontrado nos dados
              das ferramentas desta conversa. Confirme antes de apresentar.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
