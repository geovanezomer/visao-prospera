import { useEffect, useState } from "react";

export type PeriodView = "mensal" | "trimestral" | "anual";

/**
 * Hook compartilhado para tabelas com agregação por período (DRE, DFC, …).
 * Em telas pequenas reduz a granularidade automaticamente:
 *  - `<sm` (640px): força "anual" (apenas 1 coluna + Total/% Rec)
 *  - `<lg` (1024px): rebaixa "mensal" para "trimestral"
 * Em telas >= lg, mantém a escolha do usuário.
 *
 * @param initial valor inicial em desktop (default: "trimestral")
 */
export function usePeriodView(initial: PeriodView = "trimestral") {
  const [period, setPeriod] = useState<PeriodView>(initial);
  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth;
      if (w < 640 && period !== "anual") setPeriod("anual");
      else if (w >= 640 && w < 1024 && period === "mensal") setPeriod("trimestral");
    };
    window.addEventListener("resize", handler);
    handler();
    return () => window.removeEventListener("resize", handler);
  }, [period]);
  return [period, setPeriod] as const;
}
