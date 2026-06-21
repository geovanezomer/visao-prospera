// Aba Balanço — página dedicada ao Balanço Patrimonial detalhado.
//
// Fase 1 (atual): estrutura criada. Renderiza um resumo dos totais
// derivados de `state.capital.balanco` (já pré-populado pela migração
// v1→v2) + aviso de "UI em construção".
//
// Fase 2 (próxima): substituir este placeholder pela UI completa com
// 3 modos (Simples/Padrão/Completo), layout duas colunas Ativo |
// Passivo+PL, comparativo N vs N-1, validação de fechamento, auto-puxar
// resultadoExercicio do DRE e impostos do módulo tributário.
import { useFinance } from "@/engines/finance/AppStateContext";
import { calcBalancoTotals } from "@/engines/finance/balanco";
import { fmtBRL } from "@/engines/finance/format";
import { Scale, Info } from "lucide-react";

export function BalancoTab() {
  const { state } = useFinance();
  const totals = calcBalancoTotals(state.capital.balanco);
  const fechado = Math.abs(totals.diferenca) < Math.max(100, totals.ativoTotal * 0.001);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <Scale className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Balanço Patrimonial</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Posição patrimonial detalhada (Ativo · Passivo · Patrimônio
              Líquido) — preenchida após o DRE para herdar o Resultado do
              Exercício automaticamente.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-2 text-[12px]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <div className="font-medium text-amber-200">
              UI detalhada em construção (Fase 2)
            </div>
            <div className="mt-1 text-muted-foreground">
              Os 3 modos de profundidade (Simples · Padrão · Completo), o
              comparativo N vs N-1 e o auto-preenchimento a partir do DRE
              entram na próxima etapa. A coleta simples continua disponível
              na aba <strong>Capital</strong>.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ativo
          </div>
          <Row label="Ativo Circulante" value={totals.ativoCirculante} />
          <Row label="Realizável a LP" value={totals.realizavelLP} />
          <Row label="Investimentos" value={totals.investimentos} />
          <Row label="Imobilizado (líq.)" value={totals.imobilizadoLiquido} />
          <Row label="Intangível (líq.)" value={totals.intangivelLiquido} />
          <Row label="Ativo Não Circulante" value={totals.ativoNaoCirculante} muted />
          <div className="mt-2 border-t border-border/60 pt-2">
            <Row label="TOTAL DO ATIVO" value={totals.ativoTotal} bold />
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Passivo + Patrimônio Líquido
          </div>
          <Row label="Passivo Circulante" value={totals.passivoCirculante} />
          <Row label="Passivo Não Circulante" value={totals.passivoNaoCirculante} />
          <Row label="Patrimônio Líquido" value={totals.patrimonioLiquido} />
          <div className="mt-2 border-t border-border/60 pt-2">
            <Row
              label="TOTAL DO PASSIVO + PL"
              value={totals.passivoTotal + totals.patrimonioLiquido}
              bold
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <Mini label="Dívida onerosa" value={totals.dividaOnerosa} />
            <Mini label="Passivos não-onerosos" value={totals.passivosNaoOnerosos} />
          </div>
        </div>
      </div>

      <div
        className={`rounded-lg border p-3 text-[12px] ${
          fechado
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
            : "border-red-500/30 bg-red-500/5 text-red-200"
        }`}
      >
        {fechado ? (
          <>✓ Balanço fechado — Ativo = Passivo + PL</>
        ) : (
          <>
            ⚠ Diferença de {fmtBRL(totals.diferenca)} entre Ativo e Passivo+PL.
            Ajuste as rubricas na próxima fase.
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 text-[13px] ${
        bold ? "font-semibold" : muted ? "text-muted-foreground" : ""
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{fmtBRL(value)}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{fmtBRL(value)}</div>
    </div>
  );
}
