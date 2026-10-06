import { SectionTitle } from "@/components/sim/shared/primitives";
import { fmtNum } from "@/engines/finance/format";

// Matriz de sensibilidade WACC × g terminal — normalizada para base = 100.
export function SensitivityMatrix({
  wacc,
  g,
  fcfBase,
}: {
  wacc: number;
  g: number;
  fcfBase: number;
}) {
  const waccs = [-2, -1, 0, 1, 2].map((d) => Math.max(1, wacc + d));
  const gs = [1.5, 2.0, 2.5, 3.0, 3.5];
  const baseVal = wacc > g && fcfBase !== 0 ? fcfBase / (wacc / 100 - g / 100) : 1;

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <SectionTitle hint="Mostra como o Enterprise Value relativo (base = 100) varia conforme WACC e crescimento terminal mudam.">
        Matriz de Sensibilidade · WACC × g terminal
      </SectionTitle>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="bg-muted/50 px-2 py-1.5 text-left font-semibold text-muted-foreground">
                WACC ↓ \ g →
              </th>
              {gs.map((gg) => (
                <th
                  key={gg}
                  className="bg-muted/50 px-2 py-1.5 text-center font-semibold text-muted-foreground"
                >
                  {fmtNum(gg, 1)}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="mono">
            {waccs.map((w) => (
              <tr key={w} className="border-t border-border/30">
                <td className="bg-muted/30 px-2 py-1.5 font-semibold text-foreground">
                  {fmtNum(w, 1)}%
                </td>
                {gs.map((gg) => {
                  const v = w / 100 > gg / 100 ? fcfBase / (w / 100 - gg / 100) : 0;
                  const rel = baseVal !== 0 ? v / baseVal : 0;
                  const tone =
                    rel === 0
                      ? "bg-neg/20 text-neg"
                      : rel < 0.8
                        ? "bg-neg/10 text-neg"
                        : rel < 1.0
                          ? "bg-[var(--warning)]/10 text-[var(--warning)]"
                          : rel < 1.2
                            ? "bg-pos/10 text-pos"
                            : "bg-primary/15 text-primary";
                  return (
                    <td key={gg} className={`px-2 py-1.5 text-center font-medium ${tone}`}>
                      {v === 0 ? "—" : (rel * 100).toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Valores normalizados: base WACC × g atuais = 100. Verde = valorização · vermelho =
        desvalorização · "—" quando g ≥ WACC (não converge).
      </p>
    </section>
  );
}
