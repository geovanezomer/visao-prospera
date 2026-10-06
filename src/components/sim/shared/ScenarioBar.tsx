// ============================================================================
// Anos e previsões arquivados — dois diálogos abertos a partir de "Salvar /
// Compartilhar" (arquivar) e "Abrir / Restaurar" (lista). Antes eram botões
// flutuantes que cobriam valores da tela e competiam com o salvar da barra
// lateral.
//
// Arquivar → guarda o AppState corrente como snapshot do ano escolhido
//            (2010–2040), realizado ou previsão (budget).
// Lista    → anos e previsões já arquivados; carregar ou excluir.
//
// Usa exclusivamente a store de scenarios (engines/scenarios/store), mesmo
// canal das pills de período no cabeçalho dos cards.
// ============================================================================
import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { useFinance } from "@/engines/finance/AppStateContext";
import { archiveYearAsHistorical, switchToYear, deleteScenario } from "@/engines/scenarios/store";
import { ConfirmDialog } from "@/components/sim/shared/ConfirmDialog";
import { fmtBRL, fmtPct } from "@/engines/finance/format";
import { buildFinancialModel } from "@/engines/finance/financialModel";
import { useCompanySnapshots } from "@/hooks/useCompanySnapshots";

// Lista de anos disponíveis no select (inclusivo).
const YEARS: number[] = Array.from({ length: 2040 - 2010 + 1 }, (_, i) => 2010 + i);
type MetricasAno = {
  faturamento: number;
  ebitda: number;
  roe: number;
  margemLiquida: number;
  lucroLiquido: number;
};

const HISTORICAL_SNAPSHOT_OPTS = { kind: "historical" as const, sortByYear: true };

export function AnosArquivadosDialogs({
  aberto,
  onFechar,
}: {
  /** Qual diálogo está aberto. */
  aberto: "arquivar" | "lista" | null;
  onFechar: () => void;
}) {
  const { state, update } = useFinance();
  const company = state.companyName || "default";
  const allHistoricals = useCompanySnapshots(HISTORICAL_SNAPSHOT_OPTS);

  const historicals = useMemo(
    () => [...allHistoricals].sort((a, b) => (b.fiscalYear ?? 0) - (a.fiscalYear ?? 0)),
    [allHistoricals],
  );

  // Recalcula indicadores anuais consistentes a partir do AppState arquivado.
  // Cache por id+updatedAt: o autosave relê os arquivos (objetos novos) a cada
  // pausa na digitação; só o ano que mudou é recalculado.
  const cacheMetricas = useRef(new Map<string, MetricasAno>());
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
    const cache = cacheMetricas.current;
    const vivos = new Set<string>();
    for (const h of historicals) {
      if (!h.state) continue;
      const chave = `${h.id}:${h.updatedAt}`;
      vivos.add(chave);
      let met = cache.get(chave);
      if (!met) {
        const { ind } = buildFinancialModel(h.state);
        met = {
          faturamento: ind.receitaBrutaAnual,
          ebitda: ind.ebitdaAnual,
          roe: ind.roe ?? 0,
          margemLiquida: ind.margemLiquida,
          lucroLiquido: ind.lucroLiquidoAnual,
        };
        cache.set(chave, met);
      }
      m.set(h.id, met);
    }
    for (const k of cache.keys()) if (!vivos.has(k)) cache.delete(k);
    return m;
  }, [historicals]);

  const defaultYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(YEARS.includes(defaultYear) ? defaultYear : 2025);
  const [subKind, setSubKind] = useState<"realizado" | "previsao">("realizado");
  const [previsaoName, setPrevisaoName] = useState<string>("");
  const saveOpen = aberto === "arquivar";
  const listOpen = aberto === "lista";
  const setSaveOpen = (v: boolean) => !v && onFechar();
  const setListOpen = (v: boolean) => !v && onFechar();

  const handleSave = () => {
    const name = subKind === "previsao" ? previsaoName.trim() || `Previsão ${year}` : undefined;
    archiveYearAsHistorical(company, year, state, undefined, { subKind, name });
    // Estampa o ano no AppState ativo — a partir daqui, trocar de pill faz
    // auto-arquivamento correto sob este `fiscalYear`.
    update((s) => ({ ...s, fiscalYear: year }));
    toast.success(
      subKind === "previsao"
        ? `Previsão ${year} arquivada${name ? ` (${name})` : ""}`
        : `Ano ${year} arquivado`,
    );
    setSaveOpen(false);
    setPrevisaoName("");
  };

  const handleLoad = (id: string) => {
    const rec = historicals.find((h) => h.id === id);
    if (!rec?.state) return;
    // Auto-arquiva o ano corrente antes de trocar — nada se perde.
    const next = switchToYear(company, rec, state);
    update(() => next);
    toast.success(`Carregado: ${rec.name} (ano atual arquivado)`);
    setListOpen(false);
  };

  const alreadyExists = historicals.some(
    (h) =>
      h.fiscalYear === year &&
      (h.subKind ?? "realizado") === subKind &&
      (subKind === "realizado" || h.name === (previsaoName.trim() || `Previsão ${year}`)),
  );

  return (
    <>
      {/* Arquivar ano / previsão */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Arquivar ano / previsão</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Use <strong>Ano realizado</strong> para arquivar um exercício fechado/em andamento, ou{" "}
              <strong>Previsão</strong> para guardar um orçamento (budget) e comparar Previsto ×
              Realizado.
            </p>

            {/* Toggle Realizado / Previsão */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Tipo</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSubKind("realizado")}
                  className={
                    "rounded-md border px-3 py-2 text-xs font-medium transition-colors " +
                    (subKind === "realizado"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background hover:bg-accent")
                  }
                >
                  Ano realizado
                </button>
                <button
                  type="button"
                  onClick={() => setSubKind("previsao")}
                  className={
                    "rounded-md border px-3 py-2 text-xs font-medium transition-colors " +
                    (subKind === "previsao"
                      ? "border-[var(--warning)] bg-[var(--warning)]/10 text-[var(--warning)]"
                      : "border-input bg-background hover:bg-accent")
                  }
                >
                  Previsão (budget)
                </button>
              </div>
            </div>

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
            </div>

            {subKind === "previsao" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Nome da previsão <span className="text-muted-foreground">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={previsaoName}
                  maxLength={60}
                  placeholder={`Previsão ${year}`}
                  onChange={(e) => setPrevisaoName(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  Dica: nomeie cenários distintos (ex: "Conservador", "Otimista").
                </p>
              </div>
            )}

            {alreadyExists && (
              <p className="text-[11px] text-[var(--warning)]">
                Já existe um snapshot equivalente para {year} — será sobrescrito.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>
              {subKind === "previsao" ? `Salvar Previsão ${year}` : `Salvar Ano ${year}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lista de anos */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-5xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>Anos e previsões arquivados</DialogTitle>
          </DialogHeader>
          {historicals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada arquivado ainda. Em <strong>Salvar / Compartilhar</strong>, use{" "}
              <strong>Arquivar ano</strong> para guardar o exercício atual ou uma previsão (budget).
            </p>
          ) : (
            <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-muted-foreground">
                    <th className="p-2">Cenário</th>
                    <th className="p-2">Tipo</th>
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
                    const isPrev = (h.subKind ?? "realizado") === "previsao";
                    return (
                      <tr key={h.id} className="border-t border-border/40">
                        <td className="p-2 font-semibold">{h.name}</td>
                        <td className="p-2">
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                              (isPrev
                                ? "bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/40"
                                : "bg-primary/15 text-primary border border-primary/40")
                            }
                          >
                            {isPrev ? "Previsão" : "Realizado"}
                          </span>
                        </td>
                        <td className="num p-2 text-right">{m ? fmtBRL(m.faturamento) : "—"}</td>
                        <td className="num p-2 text-right">{m ? fmtBRL(m.ebitda) : "—"}</td>
                        <td className="num p-2 text-right">{m ? fmtPct(m.roe / 100) : "—"}</td>
                        <td className="num p-2 text-right">
                          {m ? fmtPct(m.margemLiquida / 100) : "—"}
                        </td>
                        <td className="num p-2 text-right">{m ? fmtBRL(m.lucroLiquido) : "—"}</td>
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
    </>
  );
}
