// Adições e exclusões do Lalur/Lacs (Lucro Real), valor anual por linha.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumInput } from "@/components/sim/shared/primitives";
import { genId } from "@/engines/finance/format";
import type { LalurAjuste } from "@/engines/finance/types";

const SUGESTOES: Array<Pick<LalurAjuste, "descricao" | "tipo">> = [
  { descricao: "Multas punitivas e brindes (indedutíveis)", tipo: "adicao" },
  { descricao: "Provisões não dedutíveis", tipo: "adicao" },
  { descricao: "Resultado positivo de equivalência patrimonial", tipo: "exclusao" },
  { descricao: "Dividendos recebidos", tipo: "exclusao" },
];

export function LalurAjustesEditor({
  value,
  onChange,
}: {
  value: LalurAjuste[];
  onChange: (v: LalurAjuste[]) => void;
}) {
  const set = (id: string, patch: Partial<LalurAjuste>) =>
    onChange(value.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const add = (s?: (typeof SUGESTOES)[number]) =>
    onChange([
      ...value,
      {
        id: genId("lalur"),
        descricao: s?.descricao ?? "",
        tipo: s?.tipo ?? "adicao",
        valorAnual: 0,
        base: "ambos",
      },
    ]);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="text-sm font-medium">Ajustes do Lalur/Lacs (valores anuais)</div>
      <p className="text-[12px] text-muted-foreground">
        Adições aumentam e exclusões reduzem o lucro tributável antes da compensação de prejuízo
        (RIR/2018, arts. 260-261). Escolha se o ajuste vale para IRPJ, CSLL ou ambos.
      </p>
      {value.map((a) => (
        <div key={a.id} className="grid grid-cols-12 items-center gap-2">
          <Input
            className="col-span-12 h-8 text-xs sm:col-span-5"
            placeholder="Descrição"
            value={a.descricao}
            aria-label="Descrição do ajuste"
            onChange={(e) => set(a.id, { descricao: e.target.value })}
          />
          <select
            className="col-span-4 h-8 rounded-md border bg-background px-2 text-xs sm:col-span-2"
            value={a.tipo}
            aria-label="Tipo do ajuste"
            onChange={(e) => set(a.id, { tipo: e.target.value as LalurAjuste["tipo"] })}
          >
            <option value="adicao">Adição</option>
            <option value="exclusao">Exclusão</option>
          </select>
          <select
            className="col-span-4 h-8 rounded-md border bg-background px-2 text-xs sm:col-span-2"
            value={a.base ?? "ambos"}
            aria-label="Base do ajuste"
            onChange={(e) => set(a.id, { base: e.target.value as LalurAjuste["base"] })}
          >
            <option value="ambos">IRPJ e CSLL</option>
            <option value="irpj">Só IRPJ</option>
            <option value="csll">Só CSLL</option>
          </select>
          <div className="col-span-3 sm:col-span-2">
            <NumInput
              value={a.valorAnual}
              onChange={(v) => set(a.id, { valorAnual: Math.max(0, v) })}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="col-span-1 h-8 w-8 p-0"
            aria-label="Remover ajuste"
            onClick={() => onChange(value.filter((x) => x.id !== a.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => add()}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Ajuste
        </Button>
        {SUGESTOES.filter((s) => !value.some((v) => v.descricao === s.descricao)).map((s) => (
          <Button
            key={s.descricao}
            variant="ghost"
            size="sm"
            className="text-[11px]"
            onClick={() => add(s)}
          >
            + {s.descricao}
          </Button>
        ))}
      </div>
    </div>
  );
}
