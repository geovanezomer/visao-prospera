import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";

const INTRO_KEY = "gzf_capital_intro_dismissed_v1";

// Card de introdução dispensável da aba Capital — persiste o estado em localStorage.
export function IntroCard() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(INTRO_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  if (dismissed) {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => {
            setDismissed(false);
            try {
              localStorage.removeItem(INTRO_KEY);
            } catch {
              /* */
            }
          }}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary"
        >
          <Lightbulb className="h-3 w-3" />O que é esta aba?
        </button>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg border border-primary/30 bg-primary/5 p-5">
      <button
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(INTRO_KEY, "1");
          } catch {
            /* */
          }
        }}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        aria-label="Ocultar"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="mb-2 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-primary">Capital é o "combustível" da empresa</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Aqui você responde 3 perguntas que definem a saúde financeira do negócio:
      </p>
      <ol className="mt-2 grid gap-2 text-xs text-foreground sm:grid-cols-3">
        <li className="rounded-md border border-border/40 bg-background/40 p-3">
          <span className="font-semibold text-primary">1. De onde vem o dinheiro?</span>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Sócios ou bancos — e em que proporção.
          </div>
        </li>
        <li className="rounded-md border border-border/40 bg-background/40 p-3">
          <span className="font-semibold text-primary">2. Quanto custa esse dinheiro?</span>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Retorno que sócios esperam + juros dos bancos.
          </div>
        </li>
        <li className="rounded-md border border-border/40 bg-background/40 p-3">
          <span className="font-semibold text-primary">
            3. Quanto a empresa precisa para girar?
          </span>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Capital de giro para sustentar o dia a dia.
          </div>
        </li>
      </ol>
      <p className="mt-3 text-[11px] text-muted-foreground">
        No final, o termômetro <strong className="text-foreground">WACC × ROIC</strong> diz se o
        negócio está <span className="text-pos font-semibold">criando</span> ou{" "}
        <span className="text-neg font-semibold">destruindo</span> valor.
      </p>
    </div>
  );
}
