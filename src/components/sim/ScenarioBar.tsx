import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Save, GitCompare, Trash2 } from "lucide-react";
import { AppState, Scenario } from "@/lib/finance/types";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { fmtBRL, fmtPct, sum } from "@/lib/finance/format";

export function ScenarioBar({
  state,
  scenarios,
  save,
  remove,
  load,
}: {
  state: AppState;
  scenarios: Scenario[];
  save: (name: string, s: AppState) => void;
  remove: (id: string) => void;
  load: (s: AppState) => void;
}) {
  const [name, setName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [cmpOpen, setCmpOpen] = useState(false);

  const metric = (s: AppState) => {
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    return {
      receita: sum(dre.receitaBruta),
      lucro: sum(dre.lucroLiquido),
      margem: ind.margemLiquida,
      ebitda: sum(dre.ebitda),
      wacc: ind.wacc,
      roic: ind.roic,
    };
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex gap-2">
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogTrigger asChild>
          <Button className="shadow-lg shadow-primary/30"><Save className="mr-2 h-4 w-4" /> Salvar Cenário</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Salvar cenário atual</DialogTitle></DialogHeader>
          <input
            placeholder="Ex.: Cenário base, Otimista, +20% receita..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button disabled={!name.trim()} onClick={() => { save(name.trim(), state); setName(""); setSaveOpen(false); }}>Salvar</Button>
          </div>
          {scenarios.length >= 5 && <p className="text-xs text-[var(--warning)]">Limite de 5 cenários — o mais antigo será descartado.</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={cmpOpen} onOpenChange={setCmpOpen}>
        <DialogTrigger asChild>
          <Button variant="outline"><GitCompare className="mr-2 h-4 w-4" /> Cenários ({scenarios.length})</Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Comparar cenários</DialogTitle></DialogHeader>
          {scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cenário salvo ainda.</p>
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-muted-foreground">
                    <th className="p-2">Cenário</th>
                    <th className="p-2 text-right">Receita</th>
                    <th className="p-2 text-right">EBITDA</th>
                    <th className="p-2 text-right">Lucro Líq.</th>
                    <th className="p-2 text-right">Margem</th>
                    <th className="p-2 text-right">ROIC</th>
                    <th className="p-2 text-right">WACC</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border/40 bg-primary/5">
                    <td className="p-2 font-semibold">Atual</td>
                    {(() => {
                      const m = metric(state);
                      return (<>
                        <td className="num p-2 text-right">{fmtBRL(m.receita)}</td>
                        <td className="num p-2 text-right">{fmtBRL(m.ebitda)}</td>
                        <td className="num p-2 text-right">{fmtBRL(m.lucro)}</td>
                        <td className="num p-2 text-right">{fmtPct(m.margem / 100)}</td>
                        <td className="num p-2 text-right">{fmtPct(m.roic / 100)}</td>
                        <td className="num p-2 text-right">{fmtPct(m.wacc / 100)}</td>
                        <td></td>
                      </>);
                    })()}
                  </tr>
                  {scenarios.map((sc) => {
                    const m = metric(sc.state);
                    return (
                      <tr key={sc.id} className="border-t border-border/40">
                        <td className="p-2">{sc.name}</td>
                        <td className="num p-2 text-right">{fmtBRL(m.receita)}</td>
                        <td className="num p-2 text-right">{fmtBRL(m.ebitda)}</td>
                        <td className="num p-2 text-right">{fmtBRL(m.lucro)}</td>
                        <td className="num p-2 text-right">{fmtPct(m.margem / 100)}</td>
                        <td className="num p-2 text-right">{fmtPct(m.roic / 100)}</td>
                        <td className="num p-2 text-right">{fmtPct(m.wacc / 100)}</td>
                        <td className="p-2">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => { load(sc.state); setCmpOpen(false); }}>Carregar</Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(sc.id)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
