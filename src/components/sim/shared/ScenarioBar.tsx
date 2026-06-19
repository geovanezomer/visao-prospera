// ============================================================================
// ScenarioBar — Botões flutuantes "Salvar ANO" e "ANO".
//
// Salvar ANO  → arquiva o AppState corrente como snapshot histórico do ano
//               escolhido (select 2010–2040). Nome do snapshot = "Ano YYYY".
// ANO         → lista os snapshots históricos já salvos; permite carregar
//               (substitui o AppState atual) ou excluir.
//
// Usa exclusivamente a store de scenarios (engines/scenarios/store), mesmo
// canal das pills de período no cabeçalho dos cards.
// ============================================================================
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Save, CalendarDays, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/engines/finance/AppStateContext";
import {
  useScenarios,
  archiveYearAsHistorical,
  deleteScenario,
} from "@/engines/scenarios/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { fmtBRL, fmtPct, sum } from "@/engines/finance/format";
import { buildDRE } from "@/engines/finance/dre";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { calcIndicators } from "@/engines/finance/indicators";

// Lista de anos disponíveis no select (inclusivo).
const YEARS: number[] = Array.from({ length: 2040 - 2010 + 1 }, (_, i) => 2010 + i);

export function ScenarioBar() {
  const { state, update } = useFinance();
  const company = state.companyName || "default";
  const all = useScenarios(company);

  const historicals = useMemo(
    () =>
      all
        .filter((s) => s.kind === "historical" && s.state && s.fiscalYear)
        .sort((a, b) => (b.fiscalYear ?? 0) - (a.fiscalYear ?? 0)),
    [all],
  );

  // Recalcula indicadores anuais consistentes a partir do AppState arquivado.
  const metrics = useMemo(() => {
    const m = new Map<
      string,
      {
        faturamento: number;
        ebitda: number;
        roe: number;
        margemLiquida: number;
        lucroLiquido: number;
      }
    >();
    for (const h of historicals) {
      if (!h.state) continue;
      const regime = resolveEffectiveRegime(h.state);
      const { dre } = buildDRE(h.state, regime);
      const ind = calcIndicators(h.state, dre);
      m.set(h.id, {
        faturamento: sum(dre.receitaBruta),
        ebitda: sum(dre.ebitda),
        roe: ind.roe,
        margemLiquida: ind.margemLiquida,
        lucroLiquido: sum(dre.lucroLiquido),
      });
    }
    return m;
  }, [historicals]);


  const defaultYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(
    YEARS.includes(defaultYear) ? defaultYear : 2025,
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const handleSave = () => {
    archiveYearAsHistorical(company, year, state);
    toast.success(`Ano ${year} arquivado`);
    setSaveOpen(false);
  };

  const handleLoad = (id: string) => {
    const rec = historicals.find((h) => h.id === id);
    if (!rec?.state) return;
    update(() => rec.state!);
    toast.success(`Visualizando ${rec.name}`);
    setListOpen(false);
  };

  const alreadyExists = historicals.some((h) => h.fiscalYear === year);

  return (
    <div className="fixed bottom-6 right-6 z-40 flex gap-2">
      {/* Salvar ANO */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogTrigger asChild>
          <Button className="shadow-lg shadow-primary/30">
            <Save className="mr-2 h-4 w-4" /> Salvar ANO
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Arquivar ano fechado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Salva o AppState corrente como snapshot histórico. Esse ano poderá ser
              comparado lado a lado nos cards de DRE e Fluxo de Caixa.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Ano</label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o ano" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {alreadyExists && (
                <p className="text-[11px] text-[var(--warning)]">
                  Já existe um snapshot para {year} — será sobrescrito.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Salvar Ano {year}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lista de anos */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <CalendarDays className="mr-2 h-4 w-4" /> ANO ({historicals.length})
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Anos arquivados</DialogTitle>
          </DialogHeader>
          {historicals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum ano arquivado ainda. Use <strong>Salvar ANO</strong> para
              arquivar o exercício atual.
            </p>
          ) : (
            <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-muted-foreground">
                    <th className="p-2">Ano</th>
                    <th className="p-2 text-right">Faturamento</th>
                    <th className="p-2 text-right">EBITDA</th>
                    <th className="p-2 text-right">ROE</th>
                    <th className="p-2 text-right">Margem Líq.</th>
                    <th className="p-2 text-right">Lucro Líq.</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {historicals.map((h) => {
                    const m = metrics.get(h.id);
                    return (
                    <tr key={h.id} className="border-t border-border/40">
                      <td className="p-2 font-semibold">{h.name}</td>
                      <td className="num p-2 text-right">
                        {m ? fmtBRL(m.faturamento) : "—"}
                      </td>
                      <td className="num p-2 text-right">
                        {m ? fmtBRL(m.ebitda) : "—"}
                      </td>
                      <td className="num p-2 text-right">
                        {m ? fmtPct(m.roe) : "—"}
                      </td>
                      <td className="num p-2 text-right">
                        {m ? fmtPct(m.margemLiquida) : "—"}
                      </td>
                      <td className="num p-2 text-right">
                        {m ? fmtBRL(m.lucroLiquido) : "—"}
                      </td>
                      <td className="p-2">

                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleLoad(h.id)}
                            title="Carregar este ano no AppState"
                          >
                            <Download className="mr-1 h-3.5 w-3.5" /> Carregar
                          </Button>
                          <ConfirmDialog
                            title={`Excluir "${h.name}"?`}
                            description="O snapshot será removido das pills e da comparação."
                            confirmLabel="Excluir"
                            destructive
                            onConfirm={() => {
                              deleteScenario(company, h.id);
                              toast.success(`${h.name} removido`);
                            }}
                            trigger={
                              <Button size="sm" variant="ghost" title="Excluir ano">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            }
                          />
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
