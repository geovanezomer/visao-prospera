import { useState } from "react";
import { AppState } from "@/engines/finance/types";
import { Banknote, Users, Package, ChevronDown, ChevronUp } from "lucide-react";
import { SimpleField } from "./parts";

// Refinamento avançado — expõe campos que a engine usa mas estavam
// "escondidos": caixa ocioso, passivos não-onerosos, estoque inicial/final.
// Colapsável para não poluir a tela.
export function AdvancedRefinementCard({
  capital,
  onChange,
}: {
  capital: AppState["capital"];
  onChange: (patch: Partial<AppState["capital"]>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold">Refinamento avançado</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Ajustes finos que melhoram ROIC, PME e liquidez — opcionais.
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="grid gap-3 border-t border-border/40 p-4 sm:grid-cols-2">
          <SimpleField
            icon={<Banknote className="h-4 w-4" />}
            label="Caixa ocioso (não-operacional)"
            hint="Parcela do caixa que NÃO sustenta a operação (ex.: reserva estratégica, sobra). É subtraída do Capital Investido no ROIC para não distorcer o retorno."
            value={capital.caixaOcioso ?? 0}
            onChange={(n) => onChange({ caixaOcioso: n })}
          />
          <SimpleField
            icon={<Users className="h-4 w-4" />}
            label="Passivos não-onerosos"
            hint="Fornecedores + salários + impostos a pagar (sem juros). Subtraídos do Capital Investido no ROIC. Se 0, usa o campo Fornecedores."
            value={capital.passivosNaoOnerosos ?? 0}
            onChange={(n) => onChange({ passivosNaoOnerosos: n })}
            placeholder="0 = usa Fornecedores"
          />
          <SimpleField
            icon={<Package className="h-4 w-4" />}
            label="Estoque inicial do período"
            hint="Saldo de estoque em 01/jan. Usado para PME = (inicial + final) ÷ 2 quando ambos preenchidos."
            value={capital.estoqueInicial ?? 0}
            onChange={(n) => onChange({ estoqueInicial: n })}
            placeholder="0 = usa só estoque atual"
          />
          <SimpleField
            icon={<Package className="h-4 w-4" />}
            label="Estoque final do período"
            hint="Saldo de estoque em 31/dez. Usado para PME médio. Se 0, usa o campo Estoque do balanço."
            value={capital.estoqueFinal ?? 0}
            onChange={(n) => onChange({ estoqueFinal: n })}
            placeholder="0 = usa Estoque"
          />
        </div>
      )}
    </div>
  );
}
