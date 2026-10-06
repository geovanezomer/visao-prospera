import { useState } from "react";
import {
  traceValuation,
  runValuationSelfTests,
  ValuationTestCase,
} from "@/engines/finance/valuation";
import { fmtBRLCompact, fmtNum } from "@/engines/finance/format";
import { Button } from "@/components/ui/button";
import { Calculator, FlaskConical } from "lucide-react";
import { SectionTitle } from "@/components/sim/shared/primitives";
import { KV } from "@/components/sim/valuation/parts";

// Painel de auditoria — memória de cálculo + self-tests opt-in.
export function AuditPanel({
  trace,
  onLogTrace,
}: {
  trace: ReturnType<typeof traceValuation>;
  onLogTrace: () => void;
}) {
  const [tests, setTests] = useState<{ results: ValuationTestCase[]; allPassed: boolean } | null>(
    null,
  );
  const runTests = () => setTests(runValuationSelfTests());

  return (
    <>
      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <SectionTitle hint="Cada linha mostra a fórmula aplicada, os inputs e o resultado. Use para auditar o valuation.">
              Memória de Cálculo
            </SectionTitle>
          </div>
          <Button size="sm" variant="outline" onClick={onLogTrace}>
            <Calculator className="mr-1.5 h-3.5 w-3.5" /> Logar no console
          </Button>
        </div>

        <div className="mt-4 grid gap-2 rounded-md border border-border/40 bg-background/30 p-3 text-xs md:grid-cols-3">
          <KV k="EBITDA (12m)" v={trace.inputs.ebitda} />
          <KV k="Receita Bruta (12m)" v={trace.inputs.receita} />
          <KV k="Lucro Líquido (12m)" v={trace.inputs.ll} />
          <KV k="Dívida onerosa" v={trace.inputs.dividaOnerosa} />
          <KV k="WACC (%a.a.)" v={trace.inputs.wacc} fmt="pct" />
          <KV
            k="Ke / Kd (%a.a.)"
            v={trace.inputs.ke}
            fmt="pct"
            extra={`${fmtNum(trace.inputs.kd, 2)}%`}
          />
          <KV k="m EV/EBITDA" v={trace.inputs.multEbitda} fmt="raw" />
          <KV k="m EV/Receita" v={trace.inputs.multReceita} fmt="raw" />
          <KV k="m P/L" v={trace.inputs.multPL} fmt="raw" />
          <KV k="Horizonte DCF" v={trace.inputs.horizonAnos} fmt="raw" extra="anos" />
          <KV k="g terminal" v={trace.inputs.g * 100} fmt="pct" />
          <KV k="Haircut" v={trace.inputs.haircut * 100} fmt="pct" />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 text-left font-medium">Etapa</th>
                <th className="py-2 text-left font-medium">Fórmula</th>
                <th className="py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="mono">
              {trace.steps.map((s, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-1.5 text-foreground">{s.label}</td>
                  <td className="py-1.5 text-muted-foreground">{s.formula}</td>
                  <td className="py-1.5 text-right font-semibold text-foreground">
                    {fmtBRLCompact(s.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <SectionTitle hint="Executa um conjunto de casos determinísticos (EV/EBITDA, EV/Receita, P/L, Gordon, DCF, haircut, equity). Resultados detalhados também aparecem no console do navegador (F12).">
              Validação de Fórmulas — Self-tests
            </SectionTitle>
          </div>
          <Button size="sm" onClick={runTests}>
            <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Rodar testes
          </Button>
        </div>

        {tests ? (
          <>
            <div
              className={`mt-4 rounded-md border p-3 text-xs ${tests.allPassed ? "border-pos/40 bg-pos/5 text-pos" : "border-neg/40 bg-neg/5 text-neg"}`}
            >
              {tests.allPassed
                ? `✅ Todos os ${tests.results.length} casos passaram dentro da tolerância de 0,5%.`
                : `❌ ${tests.results.filter((r) => !r.pass).length} de ${tests.results.length} casos falharam — abra o console (F12) para detalhes.`}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 text-left font-medium">Caso</th>
                    <th className="py-2 text-left font-medium">Fórmula</th>
                    <th className="py-2 text-right font-medium">Esperado</th>
                    <th className="py-2 text-right font-medium">Obtido</th>
                    <th className="py-2 text-right font-medium">Δ</th>
                    <th className="py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {tests.results.map((r, i) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-1.5 text-foreground">{r.name}</td>
                      <td className="py-1.5 text-muted-foreground">{r.formula}</td>
                      <td className="py-1.5 text-right">{r.expected.toLocaleString("pt-BR")}</td>
                      <td className="py-1.5 text-right">
                        {r.actual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {fmtNum(r.delta, 4)}
                      </td>
                      <td
                        className={`py-1.5 text-center font-semibold ${r.pass ? "text-pos" : "text-neg"}`}
                      >
                        {r.pass ? "OK" : "FAIL"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Clique em "Rodar testes" para validar todas as fórmulas (EV/EBITDA, EV/Receita, P/L,
            blended ponderado, Gordon, DCF mensal, ajustes de controle/liquidez, haircut e Equity
            Value). A memória de cálculo da empresa atual também é registrada no console em tempo
            real a cada mudança de parâmetro.
          </p>
        )}
      </section>
    </>
  );
}
