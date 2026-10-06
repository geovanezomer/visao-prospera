// ============================================================================
// Receitas e despesas do modo Odoo em TABELAS DE LEITURA (no lugar dos
// formulários travados): valores compactos, primeira coluna fixa, categoria
// em português com a conta do Odoo (código e nome) em cada linha.
// ============================================================================
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Database } from "lucide-react";
import { fmtBRL, fmtBRLCompact } from "@/engines/finance/format";
import { PL_LINE_LABELS } from "@/engines/odoo/mapping";
import type { PlLine } from "@/engines/odoo/types";
import { useOdooCockpitContext } from "./cockpit";
import { usePeriodLabels } from "./usePeriodLabels";
import { cn } from "@/lib/utils";

const sum = (a: number[]) => a.reduce((x, y) => x + (y || 0), 0);

type Group = { titulo: string; linhas: PlLine[]; sinal: 1 | -1 };

const GRUPOS_RECEITA: Group[] = [
  { titulo: "Receita bruta", linhas: ["receita_bruta"], sinal: 1 },
  { titulo: "(−) Devoluções e abatimentos", linhas: ["deducoes"], sinal: -1 },
  { titulo: "(−) Tributos sobre vendas", linhas: ["impostos_vendas"], sinal: -1 },
  { titulo: "Receitas financeiras", linhas: ["receita_financeira"], sinal: 1 },
  { titulo: "Outras receitas não operacionais", linhas: ["outras_receitas"], sinal: 1 },
];

const GRUPOS_DESPESA: Group[] = [
  { titulo: "Custo dos produtos/serviços (CPV/CMV/CSP)", linhas: ["cpv"], sinal: -1 },
  {
    titulo: "Pessoal",
    linhas: ["pessoal_salarios", "pessoal_encargos", "pessoal_beneficios"],
    sinal: -1,
  },
  { titulo: "Despesas administrativas", linhas: ["despesa_administrativa"], sinal: -1 },
  { titulo: "Despesas comerciais", linhas: ["despesa_comercial"], sinal: -1 },
  { titulo: "Depreciação e amortização", linhas: ["depreciacao"], sinal: -1 },
  { titulo: "Despesas financeiras", linhas: ["despesa_financeira"], sinal: -1 },
  { titulo: "Outras despesas não operacionais", linhas: ["outras_despesas"], sinal: -1 },
  { titulo: "IRPJ e CSLL", linhas: ["ir_csll"], sinal: -1 },
];

export function OdooActualsView({ kind }: { kind: "receitas" | "despesas" }) {
  const cockpit = useOdooCockpitContext();
  const MESES = usePeriodLabels();
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const data = cockpit?.data;
  const grupos = kind === "receitas" ? GRUPOS_RECEITA : GRUPOS_DESPESA;

  const linhas = useMemo(() => {
    if (!data) return [];
    return grupos
      .map((g) => {
        const contas = data.actuals.plAccounts
          .filter((a) => g.linhas.includes(a.line))
          .sort((a, b) => sum(b.values) - sum(a.values));
        const total = Array.from({ length: 12 }, (_, i) =>
          sum(contas.map((c) => c.values[i] ?? 0)),
        );
        return { ...g, contas, total };
      })
      .filter((g) => g.contas.length > 0);
  }, [data, grupos]);

  if (!data) return null;

  const receitaLiquida = Array.from({ length: 12 }, (_, i) => {
    const p = data.actuals.pl;
    return (p.receita_bruta[i] ?? 0) - (p.deducoes[i] ?? 0) - (p.impostos_vendas[i] ?? 0);
  });
  const totalDespesas = Array.from({ length: 12 }, (_, i) =>
    sum(linhas.map((g) => g.total[i] ?? 0)),
  );

  const toggle = (k: string) => setAbertos((a) => ({ ...a, [k]: !a[k] }));
  const cell = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
  const first = "sticky left-0 z-10 bg-card px-3 py-1.5 text-left";

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4 text-primary" />
          {kind === "receitas" ? "Receitas realizadas" : "Custos e despesas realizados"} —{" "}
          {cockpit?.entity?.label}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          Lançamentos do Odoo, {MESES[0]} a {MESES[11]} · somente leitura · clique num grupo para
          ver as contas
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr className="border-b border-border/60 text-muted-foreground">
              <th className={cn(first, "font-medium")}>Conta</th>
              {MESES.map((m) => (
                <th key={m} className={cn(cell, "font-medium")}>
                  {m}
                </th>
              ))}
              <th className={cn(cell, "font-semibold text-foreground")}>12 meses</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((g) => {
              const aberto = abertos[g.titulo] ?? false;
              return (
                <Fragment key={g.titulo}>
                  <tr
                    className="cursor-pointer border-b border-border/30 font-semibold hover:bg-muted/40"
                    onClick={() => toggle(g.titulo)}
                  >
                    <td className={first}>
                      <span className="flex items-center gap-1">
                        {aberto ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {g.titulo}
                        <span className="font-normal text-muted-foreground">
                          ({g.contas.length})
                        </span>
                      </span>
                    </td>
                    {g.total.map((v, i) => (
                      <td key={i} className={cn(cell, g.sinal < 0 && v > 0 && "text-foreground")}>
                        {v ? fmtBRLCompact(v) : "—"}
                      </td>
                    ))}
                    <td className={cn(cell, "font-semibold")}>{fmtBRL(sum(g.total))}</td>
                  </tr>
                  {aberto &&
                    g.contas.map((c) => (
                      <tr key={c.code} className="border-b border-border/20 text-muted-foreground">
                        <td className={cn(first, "pl-8")} title={`${c.code} — ${c.name}`}>
                          <div className="max-w-[260px] truncate text-foreground/90">
                            {PL_LINE_LABELS[c.line]}: {c.name.replace(/^\(-\)\s*/, "")}
                          </div>
                          <div className="font-mono text-[10px]">{c.code}</div>
                        </td>
                        {c.values.map((v, i) => (
                          <td key={i} className={cell}>
                            {v ? fmtBRLCompact(v) : "—"}
                          </td>
                        ))}
                        <td className={cell}>{fmtBRL(sum(c.values))}</td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
            <tr className="border-t-2 border-border/60 font-semibold">
              <td className={first}>
                {kind === "receitas" ? "Receita líquida" : "Total de custos e despesas"}
              </td>
              {(kind === "receitas" ? receitaLiquida : totalDespesas).map((v, i) => (
                <td key={i} className={cell}>
                  {fmtBRLCompact(v)}
                </td>
              ))}
              <td className={cell}>
                {fmtBRL(sum(kind === "receitas" ? receitaLiquida : totalDespesas))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
