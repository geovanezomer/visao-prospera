/**
 * PermutasCard — operações comerciais simples sem juros, contrato ou amortização.
 *
 * Tipos suportados: serviço por serviço, material por serviço, cheques próprios
 * (dinheiro), compensação com recebíveis e quaisquer outras movimentações de
 * caixa não operacionais que não envolvam dívida.
 *
 * Integração contábil:
 *  - Fluxo de Caixa: linha própria "Permutas (não operacionais)" — entra na
 *    variação de caixa, FORA dos blocos OP/INV/FIN.
 *  - DRE: SEM impacto (movimento patrimonial, não é receita nem despesa).
 *  - Balanço: efeito-líquido já refletido em Caixa.
 */
import { useState } from "react";
import { usePeriodLabels } from "@/components/odoo/usePeriodLabels";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput, SectionTitle } from "@/components/sim/shared/primitives";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useFinance, usePatchCashflow } from "@/engines/finance/AppStateContext";
import { fmtBRL, sum, zeros12 } from "@/engines/finance/format";
import type { PermutaLinha } from "@/engines/finance/types";
import { fixedBase, hasSazonalidade } from "@/components/sim/cashflow/tableHelpers";
import { toast } from "sonner";

const TOOLTIP_TEXT =
  "Permutas simples — operações que NÃO geram juros, contratos ou amortizações. " +
  "Use para registrar trocas comerciais típicas de PMEs: serviço por serviço, " +
  "material por serviço, pagamento/recebimento via cheque próprio (dinheiro), " +
  "compensação com recebíveis e qualquer outra movimentação pontual sem natureza " +
  "de financiamento. Crédito = entrada de caixa; Débito = saída. Estas operações " +
  "afetam apenas o Fluxo de Caixa (linha não operacional) e NÃO impactam a DRE.";

export function PermutasCard() {
  const MESES = usePeriodLabels();
  const { state } = useFinance();
  const patchCashflow = usePatchCashflow();
  const permutas = state.cashflow.permutas ?? [];

  // Toggle local Fixo/Mensal por linha.
  const [fixedMap, setFixedMap] = useState<Record<string, boolean>>({});
  const isFixed = (id: string) => fixedMap[id] ?? true;
  const setFixed = (id: string, v: boolean) => setFixedMap((m) => ({ ...m, [id]: v }));

  const updateLinha = (id: string, patch: Partial<PermutaLinha>) =>
    patchCashflow((cur) => ({
      permutas: (cur.permutas ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));

  const setMonth = (id: string, monthIdx: number, value: number) =>
    patchCashflow((cur) => ({
      permutas: (cur.permutas ?? []).map((p) =>
        p.id === id
          ? {
              ...p,
              values: p.values.map((v, i) =>
                i === monthIdx ? value : v,
              ) as PermutaLinha["values"],
            }
          : p,
      ),
    }));

  const setAllMonths = (id: string, value: number) =>
    patchCashflow((cur) => ({
      permutas: (cur.permutas ?? []).map((p) =>
        p.id === id ? { ...p, values: MESES.map(() => value) as PermutaLinha["values"] } : p,
      ),
    }));

  const addLinha = () => {
    const id = `perm_${Date.now().toString(36)}`;
    patchCashflow((cur) => ({
      permutas: [
        ...(cur.permutas ?? []),
        {
          id,
          label: "Nova permuta",
          tipo: "credito",
          values: zeros12() as PermutaLinha["values"],
        },
      ],
    }));
  };

  const removeLinha = (id: string) =>
    patchCashflow((cur) => ({
      permutas: (cur.permutas ?? []).filter((p) => p.id !== id),
    }));

  return (
    <div className="rounded-lg border border-border/60 border-l-4 border-l-[color:var(--primary)] bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={TOOLTIP_TEXT}>
          Movimentações de caixa não operacionais — Permutas Simples (12 meses)
        </SectionTitle>
        <Button size="sm" variant="outline" onClick={addLinha}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
        </Button>
      </div>

      <div className="scrollbar-thin w-full overflow-x-auto overflow-y-hidden p-2">
        <table className="w-full min-w-[900px] text-[clamp(0.75rem,1vw+0.5rem,0.875rem)]">
          <thead>
            <tr className="bg-card text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 z-20 w-64 bg-card px-3 py-2 shadow-[1px_0_0_0_var(--border)]">
                Descrição
              </th>
              <th className="w-24 px-2 py-2 text-center">Tipo</th>
              <th className="w-24 px-2 py-2 text-center">Modo</th>
              {MESES.map((m) => (
                <th key={m} className="px-1 py-2 text-right">
                  {m}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Anual</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {permutas.map((row) => {
              const fixed = isFixed(row.id);
              const anual = sum(row.values);
              const tonePos = row.tipo === "credito";
              const dotColor = tonePos ? "var(--success)" : "var(--destructive)";
              const toneClass =
                anual === 0 ? "text-muted-foreground" : tonePos ? "text-pos" : "text-neg";
              const anualDisplay =
                anual === 0 ? "—" : tonePos ? fmtBRL(anual) : `(${fmtBRL(anual)})`;
              return (
                <tr key={row.id} className="border-t border-border/40 bg-card align-middle">
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 shadow-[1px_0_0_0_var(--border)]">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: dotColor }}
                      />
                      {row.isDefault ? (
                        <span className="text-xs font-semibold">{row.label}</span>
                      ) : (
                        <input
                          className="w-full border-0 bg-transparent text-xs font-semibold outline-none focus:ring-1 focus:ring-primary/40 rounded px-1"
                          value={row.label}
                          onChange={(e) => updateLinha(row.id, { label: e.target.value })}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {row.isDefault ? (
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {row.tipo === "credito" ? "Crédito" : "Débito"}
                      </span>
                    ) : (
                      <select
                        className="rounded border border-border bg-background px-1 py-0.5 text-[10px] uppercase"
                        value={row.tipo}
                        onChange={(e) =>
                          updateLinha(row.id, { tipo: e.target.value as PermutaLinha["tipo"] })
                        }
                      >
                        <option value="credito">Crédito</option>
                        <option value="debito">Débito</option>
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>Fixo</span>
                      <Switch
                        aria-label={`Valores mês a mês — ${row.label}`}
                        checked={!fixed}
                        onCheckedChange={(v) => {
                          if (!v && hasSazonalidade(row.values)) {
                            toast.warning(`Sazonalidade de "${row.label}" será nivelada`, {
                              description:
                                "Alternar para 'Fixo' substitui os 12 meses pelo primeiro valor não-zero.",
                            });
                          }
                          setFixed(row.id, !v);
                        }}
                      />
                      <span>Mensal</span>
                    </div>
                  </td>
                  {fixed ? (
                    <td className="px-1 py-1" colSpan={12}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase text-muted-foreground">
                          Valor aplicado em todos os meses:
                        </span>
                        <div className="w-36">
                          <MoneyInput
                            aria-label={`Valor aplicado em todos os meses — ${row.label}`}
                            value={fixedBase(row.values)}
                            onChange={(n) => setAllMonths(row.id, n)}
                          />
                        </div>
                      </div>
                    </td>
                  ) : (
                    row.values.map((v, i) => (
                      <td key={i} className="px-1 py-1">
                        <MoneyInput
                          aria-label={`${row.label} — ${MESES[i]}`}
                          value={v}
                          onChange={(n) => setMonth(row.id, i, n)}
                        />
                      </td>
                    ))
                  )}
                  <td className={`num px-3 py-2 text-right font-semibold ${toneClass}`}>
                    {anualDisplay}
                  </td>
                  <td className="px-1 py-1 text-center">
                    {!row.isDefault && (
                      <button
                        type="button"
                        onClick={() => removeLinha(row.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remover linha"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
