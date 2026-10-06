// ============================================================================
// Conciliação Odoo × app da entidade aberta: soma das contas por linha da DRE
// e grupo do balanço contra o que o app usa, balancete, eliminações, contas
// sem uso com saldo e o que a tela mostra. Baixa em CSV (resumo ou contas).
// ============================================================================
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Download, Scale, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtBRL } from "@/engines/finance/format";
import { reconcile, reconciliationCsv } from "@/engines/odoo/reconcile";
import { useOdooCockpitContext } from "./cockpit";
import { cn } from "@/lib/utils";

const TOL = 0.05;

function download(name: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Check({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-3 py-2">
      <span className="flex items-center gap-2 text-xs">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-amber-500" />
        )}
        {label}
      </span>
      <span className="num text-xs">{value}</span>
    </div>
  );
}

export function ConciliacaoCard({
  exibido,
}: {
  /** Valores que a tela mostra, para conferir com o razão. */
  exibido: { receitaBruta: number; lucroLiquido: number };
}) {
  const cockpit = useOdooCockpitContext();
  const [aberto, setAberto] = useState(false);
  const r = useMemo(() => {
    if (!cockpit?.snapshot || !cockpit.entity || !cockpit.data || !cockpit.entityReady) return null;
    try {
      return reconcile(cockpit.snapshot, cockpit.entity, cockpit.data);
    } catch {
      return null;
    }
  }, [cockpit?.snapshot, cockpit?.entity, cockpit?.data, cockpit?.entityReady]);
  if (!r) return null;

  const receitaOdoo = r.lines.find((l) => l.key === "receita_bruta")?.somaContas ?? 0;
  const telaOk =
    Math.abs(exibido.receitaBruta - receitaOdoo) <= 1 &&
    Math.abs(exibido.lucroLiquido - r.lucroLiquido) <= 1;
  const tudoOk = r.ok && telaOk;
  const slug = r.entidade
    .normalize("NFD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const periodo = `${r.months[0]}_${r.months[r.months.length - 1]}`;

  return (
    <section className="rounded-lg border border-border/60 bg-card" aria-label="Conciliação">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4 text-primary" />
          Conciliação com o Odoo
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              tudoOk ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500",
            )}
          >
            {tudoOk ? "sem diferenças" : "verificar"}
          </span>
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(`conciliacao-${slug}-${periodo}-resumo.csv`, reconciliationCsv(r, "resumo"))
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Resumo (CSV)
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(`conciliacao-${slug}-${periodo}-contas.csv`, reconciliationCsv(r, "contas"))
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Conta a conta (CSV)
          </Button>
        </div>
      </header>
      <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <Check
          ok={Math.abs(r.balanceteDiferenca) <= TOL}
          label="Balancete (débitos = créditos)"
          value={fmtBRL(r.balanceteDiferenca)}
        />
        <Check
          ok={r.maiorDiferenca <= TOL}
          label="Linhas do app = soma das contas"
          value={`maior diferença ${fmtBRL(r.maiorDiferenca)}`}
        />
        <Check
          ok={telaOk}
          label="Receita e lucro na tela = razão"
          value={`${fmtBRL(r.lucroLiquido)} de lucro`}
        />
        <Check
          ok={Math.abs(r.eliminacaoNoResultado) <= TOL}
          label="Eliminações não alteram o lucro"
          value={fmtBRL(r.eliminacaoNoResultado)}
        />
        <Check
          ok={r.naoClassificadas.contas === 0}
          label="Contas sem uso com saldo"
          value={
            r.naoClassificadas.contas
              ? `${r.naoClassificadas.contas} · ${fmtBRL(r.naoClassificadas.saldo)}`
              : "nenhuma"
          }
        />
        <Check ok label="Contas conferidas" value={String(r.accounts.length)} />
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-1 border-t border-border/60 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        {aberto ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Linha a linha ({r.lines.length})
      </button>
      {aberto && (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="px-4 py-1.5 text-left font-medium">Linha</th>
                <th className="px-2 py-1.5 text-right font-medium">Contas</th>
                <th className="px-2 py-1.5 text-right font-medium">Soma das contas</th>
                <th className="px-2 py-1.5 text-right font-medium">No app</th>
                <th className="px-4 py-1.5 text-right font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={`${l.grupo}-${l.key}`} className="border-b border-border/20">
                  <td className="px-4 py-1.5">
                    <span className="text-muted-foreground">{l.grupo} · </span>
                    {l.label}
                  </td>
                  <td className="num px-2 py-1.5 text-right">{l.contas}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtBRL(l.somaContas)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtBRL(l.valorApp)}</td>
                  <td
                    className={cn(
                      "num px-4 py-1.5 text-right",
                      Math.abs(l.diferenca) > TOL && "font-semibold text-amber-500",
                    )}
                  >
                    {fmtBRL(l.diferenca)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
