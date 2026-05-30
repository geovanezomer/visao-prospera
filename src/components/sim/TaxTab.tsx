import { Fragment } from "react";
import { AppState, SimplesAnexo, TaxRegime } from "@/lib/finance/types";
import { fmtBRL, fmtPct, sum } from "@/lib/finance/format";
import { compareRegimes, simplesAliquotaEfetiva, buildDRE } from "@/lib/finance/calculations";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HelpTip, PctInput, SectionTitle } from "./primitives";

export function TaxTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const rbAnual = sum(state.revenue.bruta);
  const set = (patch: Partial<typeof state.tax>) => update((s) => ({ ...s, tax: { ...s.tax, ...patch } }));
  const regimes = compareRegimes(state);
  const aliqEf = simplesAliquotaEfetiva(rbAnual, state.tax.simplesAnexo);

  // net profits per regime
  const llBy: Record<TaxRegime, number> = {
    simples: sum(buildDRE(state, "simples").dre.lucroLiquido),
    presumido: sum(buildDRE(state, "presumido").dre.lucroLiquido),
    real: sum(buildDRE(state, "real").dre.lucroLiquido),
  };
  const best = (Object.entries(llBy) as [TaxRegime, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  const Card = ({ title, regime, children }: { title: string; regime: TaxRegime; children: React.ReactNode }) => (
    <div className={`rounded-lg border bg-card/40 p-5 ${best === regime ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border/60"}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        {best === regime && <Badge className="bg-primary text-primary-foreground">✓ Mais Vantajoso</Badge>}
      </div>
      <div className="mt-4 space-y-3 text-sm">{children}</div>
    </div>
  );

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex items-center justify-between border-b border-border/30 pb-1 ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span className="text-xs">{label}</span>
      <span className="num text-sm">{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Simples Nacional" regime="simples">
          <div>
            <label className="text-xs text-muted-foreground">Anexo</label>
            <Select value={state.tax.simplesAnexo} onValueChange={(v) => set({ simplesAnexo: v as SimplesAnexo })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["I", "II", "III", "IV", "V"] as const).map((a) => (
                  <SelectItem key={a} value={a}>Anexo {a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Row label="RBT12" value={fmtBRL(rbAnual)} />
          <Row label="Alíquota Efetiva" value={fmtPct(aliqEf / 100)} />
          <Row label="DAS Anual" value={fmtBRL(regimes.simples.annual)} strong />
          <Row label="Carga efetiva s/ receita" value={fmtPct(regimes.simples.effective / 100)} />
          <div className="mt-3 rounded-md bg-accent/30 p-3 text-[11px] text-muted-foreground">
            Anexos: <b>I</b> comércio · <b>II</b> indústria · <b>III</b> serviços (Fator R ≥ 28%) · <b>IV</b> serviços específicos · <b>V</b> serviços intelectuais.
          </div>
        </Card>

        <Card title="Lucro Presumido" regime="presumido">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">Base IRPJ <HelpTip text="Indústria/Comércio: 8%. Serviços: 32%." /></label>
              <PctInput value={state.tax.presumidoBaseIRPJ} onChange={(n) => set({ presumidoBaseIRPJ: n })} />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">Base CSLL <HelpTip text="Indústria/Comércio: 12%. Serviços: 32%." /></label>
              <PctInput value={state.tax.presumidoBaseCSLL} onChange={(n) => set({ presumidoBaseCSLL: n })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                {state.businessType === "servicos" ? "ISS" : "ICMS (débito)"}
                <HelpTip text={state.businessType === "servicos" ? "Alíquota de ISS sobre o serviço prestado." : "Alíquota de débito de ICMS sobre a receita bruta. O crédito sobre o CPV é configurado ao lado."} />
              </label>
              <PctInput value={state.tax.issIcms} onChange={(n) => set({ issIcms: n })} />
            </div>
            {state.businessType !== "servicos" && (
              <div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  ICMS crédito (CPV)
                  <HelpTip text="Alíquota média de ICMS embutida nas compras (entradas). O sistema calcula ICMS efetivo = max(0, débito sobre receita − crédito sobre CPV). Tipicamente igual à alíquota de débito quando UF de origem = destino." example="Comércio com CPV 60% da receita e ICMS 12% em ambos os lados → carga efetiva ≈ 4,8% da receita." />
                </label>
                <PctInput value={state.tax.aliquotaICMSCredito ?? 0} onChange={(n) => set({ aliquotaICMSCredito: n })} />
              </div>
            )}
          </div>
          {Object.entries(regimes.presumido.detail).map(([k, v]) => <Row key={k} label={k} value={fmtBRL(v)} />)}
          <Row label="Total Anual" value={fmtBRL(regimes.presumido.annual)} strong />
          <Row label="Carga efetiva" value={fmtPct(regimes.presumido.effective / 100)} />
          <div className="mt-2 rounded-md bg-accent/30 p-2 text-[10.5px] text-muted-foreground">
            ⓘ Adicional de IRPJ (10% sobre lucro trimestral &gt; R$60k) é apurado e recolhido por trimestre; aqui é distribuído proporcionalmente entre os meses para fins gerenciais.
          </div>
        </Card>

        <Card title="Lucro Real" regime="real">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Créditos PIS / mês</label>
              <input type="number" value={state.tax.pisCreditos} onChange={(e) => set({ pisCreditos: parseFloat(e.target.value) || 0 })}
                className="num mt-1 w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Créditos COFINS / mês</label>
              <input type="number" value={state.tax.cofinsCreditos} onChange={(e) => set({ cofinsCreditos: parseFloat(e.target.value) || 0 })}
                className="num mt-1 w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm outline-none focus:border-primary" />
            </div>
          </div>
          {state.businessType !== "servicos" && (
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                ICMS crédito (CPV)
                <HelpTip text="Alíquota média de ICMS embutida nas compras. ICMS efetivo = max(0, débito − crédito)." />
              </label>
              <PctInput value={state.tax.aliquotaICMSCredito ?? 0} onChange={(n) => set({ aliquotaICMSCredito: n })} />
            </div>
          )}
          {Object.entries(regimes.real.detail).map(([k, v]) => <Row key={k} label={k} value={fmtBRL(v)} />)}
          <Row label="Total Anual" value={fmtBRL(regimes.real.annual)} strong />
          <Row label="Carga efetiva" value={fmtPct(regimes.real.effective / 100)} />
        </Card>
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle>Comparativo anual entre regimes</SectionTitle>
        </div>
        <div className="grid grid-cols-4 gap-px bg-border/40">
          <div className="bg-card p-4 text-xs uppercase tracking-wider text-muted-foreground">Indicador</div>
          {(["simples", "presumido", "real"] as TaxRegime[]).map((r) => (
            <div key={r} className={`bg-card p-4 text-xs uppercase tracking-wider ${best === r ? "text-primary" : "text-muted-foreground"}`}>
              {r === "simples" ? "Simples Nacional" : r === "presumido" ? "Lucro Presumido" : "Lucro Real"}
              {best === r && <span className="ml-2">✓</span>}
            </div>
          ))}
          {[
            { k: "Tributos totais (ano)", v: (r: TaxRegime) => fmtBRL(regimes[r].annual) },
            { k: "Alíquota efetiva", v: (r: TaxRegime) => fmtPct(regimes[r].effective / 100) },
            { k: "Lucro Líquido (ano)", v: (r: TaxRegime) => fmtBRL(llBy[r]) },
          ].map((row) => (
            <Fragment key={row.k}>
              <div className="bg-card p-3 text-xs text-muted-foreground">{row.k}</div>
              {(["simples", "presumido", "real"] as TaxRegime[]).map((r) => (
                <div key={r + row.k} className={`bg-card p-3 num text-sm ${best === r ? "text-pos font-semibold" : ""}`}>{row.v(r)}</div>
              ))}
            </Fragment>
          ))}
        </div>
        <div className="border-t border-border/60 p-4 text-xs text-muted-foreground">
          Use o regime ativo no app na aba <b>DRE</b>. Atualmente:{" "}
          <Select value={state.tax.regime} onValueChange={(v) => set({ regime: v as TaxRegime })}>
            <SelectTrigger className="ml-2 inline-flex h-7 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="simples">Simples Nacional</SelectItem>
              <SelectItem value="presumido">Lucro Presumido</SelectItem>
              <SelectItem value="real">Lucro Real</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
