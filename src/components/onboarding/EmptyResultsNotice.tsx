// Aviso nas telas de resultado enquanto a empresa não tem faturamento lançado:
// sem receita, margens, indicadores e alertas não dizem nada sobre a empresa.
import { Compass, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyResultsNotice({ onIrPara }: { onIrPara: (aba: string) => void }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center"
      aria-label="Sem dados lançados"
    >
      <Info className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Ainda não há faturamento lançado.</p>
        <p className="text-muted-foreground">
          Resultados, indicadores e alertas passam a valer quando você informar as receitas e as
          despesas da empresa. Até lá, os números abaixo ficam zerados.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onIrPara("receitas")}>
          Lançar receitas
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.dispatchEvent(new Event("gz-open-guide"))}
        >
          <Compass className="mr-1 h-3.5 w-3.5" /> Guia
        </Button>
      </div>
    </section>
  );
}
