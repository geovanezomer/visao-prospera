// Cenários salvos do simulador (por empresa): salvar o atual, abrir e apagar.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_SIM, type SimulatorParams } from "@/engines/finance/simulator";
import { deleteScenario, listScenarios, saveScenario } from "@/lib/scenarios.functions";

export function ScenariosMenu({
  namespace,
  params,
  onLoad,
}: {
  namespace: string;
  params: SimulatorParams;
  onLoad: (p: SimulatorParams) => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [aberto, setAberto] = useState(false);
  const key = ["sim-scenarios", namespace];
  const lista = useQuery({
    queryKey: key,
    queryFn: () => listScenarios({ data: { namespace } }),
    staleTime: 60_000,
  });
  const salvar = useMutation({
    mutationFn: () =>
      saveScenario({
        data: {
          namespace,
          name: nome.trim(),
          params: params as unknown as Record<string, number | string | boolean | null>,
        },
      }),
    onSuccess: () => {
      setNome("");
      toast.success("Simulação salva.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => deleteScenario({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8">
          <Bookmark className="mr-1 h-3.5 w-3.5" /> Simulações salvas
          {lista.data?.length ? ` (${lista.data.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim()) salvar.mutate();
          }}
        >
          <Input
            className="h-8 text-xs"
            placeholder="Nome da simulação atual"
            aria-label="Nome da simulação"
            value={nome}
            maxLength={60}
            onChange={(e) => setNome(e.target.value)}
          />
          <Button
            size="sm"
            className="h-8"
            type="submit"
            disabled={!nome.trim() || salvar.isPending}
          >
            {salvar.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span className="sr-only">Salvar simulação</span>
          </Button>
        </form>
        {lista.isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : !lista.data?.length ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma simulação salva para esta empresa. Ajuste as alavancas e dê um nome.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {lista.data.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex-1 truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  title={new Date(c.createdAt).toLocaleString("pt-BR")}
                  onClick={() => {
                    onLoad({
                      ...DEFAULT_SIM,
                      ...(JSON.parse(c.paramsJson) as Partial<SimulatorParams>),
                    });
                    toast.success(`Simulação "${c.name}" aplicada.`);
                    setAberto(false);
                  }}
                >
                  {c.name}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  aria-label={`Apagar simulação ${c.name}`}
                  onClick={() => apagar.mutate(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
