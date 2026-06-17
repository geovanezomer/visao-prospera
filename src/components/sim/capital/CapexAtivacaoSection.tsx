import { CapexAtivacao } from "@/engines/finance/types";
import { fmtBRL } from "@/engines/finance/format";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Lightbulb } from "lucide-react";
import { MoneyInput, NumInput, SectionTitle } from "../primitives";

// Capex ativações — gera depreciação linear adicional a partir do mês de ativação.
export function CapexAtivacaoSection({
  items,
  onChange,
}: {
  items: CapexAtivacao[];
  onChange: (next: CapexAtivacao[]) => void;
}) {
  const add = () => {
    const id = `cx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onChange([...items, { id, label: "Novo ativo", mes: 1, valor: 0, vidaUtilMeses: 60 }]);
  };
  const addExample = () => {
    const id = `cx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onChange([...items, { id, label: "Notebook (exemplo)", mes: 1, valor: 5000, vidaUtilMeses: 36 }]);
  };
  const upd = (id: string, patch: Partial<CapexAtivacao>) =>
    onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rm = (id: string) => onChange(items.filter((x) => x.id !== id));

  const depMensalAdicional = items.reduce(
    (acc, x) => acc + (x.vidaUtilMeses > 0 ? x.valor / x.vidaUtilMeses : 0),
    0,
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          <SectionTitle hint="Cada item gera depreciação adicional linear (valor ÷ vida útil) a partir do mês de ativação até o fim do ano. Atualiza EBIT, IR (no Real) e ROIC automaticamente.">
            Investimentos em equipamentos e ativos
          </SectionTitle>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Capex · Ativação de Imobilizado no ano</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Depreciação adicional/mês:{" "}
            <span className="num text-foreground">{fmtBRL(depMensalAdicional)}</span>
          </span>
          <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar ativação
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs">
          <div className="text-muted-foreground">
            Nenhuma ativação cadastrada. Use para máquinas, software, reformas, móveis e qualquer ativo que entre em operação no meio do ano.
          </div>
          <Button size="sm" variant="ghost" onClick={addExample} className="h-7 text-xs text-primary hover:text-primary">
            <Lightbulb className="mr-1 h-3.5 w-3.5" />
            Adicionar exemplo: Notebook R$ 5.000 / 36 meses
          </Button>
        </div>
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Descrição</th>
                <th className="w-24 px-2 py-2 text-center">Mês ativ.</th>
                <th className="w-40 px-2 py-2 text-right">Valor capitalizado</th>
                <th className="w-32 px-2 py-2 text-right">Vida útil (meses)</th>
                <th className="w-32 px-2 py-2 text-right">Dep./mês</th>
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => {
                const dep = x.vidaUtilMeses > 0 ? x.valor / x.vidaUtilMeses : 0;
                return (
                  <tr key={x.id} className="border-t border-border/40 align-middle">
                    <td className="px-3 py-2">
                      <input
                        value={x.label}
                        onChange={(e) => upd(x.id, { label: e.target.value })}
                        className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <NumInput
                        integer
                        min={1}
                        max={12}
                        value={x.mes}
                        onChange={(n) => upd(x.id, { mes: Math.max(1, Math.min(12, n || 1)) })}
                        className="w-16"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <MoneyInput value={x.valor} onChange={(n) => upd(x.id, { valor: n })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumInput
                        integer
                        min={1}
                        value={x.vidaUtilMeses}
                        onChange={(n) => upd(x.id, { vidaUtilMeses: Math.max(1, n || 1) })}
                      />
                    </td>
                    <td className="num px-2 py-2 text-right text-neg">{fmtBRL(dep)}</td>
                    <td className="px-1 py-2 text-center">
                      <button
                        onClick={() => rm(x.id)}
                        title="Remover"
                        className="text-muted-foreground transition hover:text-neg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
