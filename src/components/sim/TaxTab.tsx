import { Fragment } from "react";
import { AppState, SimplesAnexo, TaxEra, TaxRegime, TAX_ERAS, TAX_ERA_LABEL, TAX_ERA_SHORT } from "@/lib/finance/types";
import { fmtBRL, fmtPct, sum } from "@/lib/finance/format";
import { compareErasForRegime, compareRegimes, getReformaRates, simplesAliquotaEfetiva, buildDRE } from "@/lib/finance/calculations";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HelpTip, NumInput, PctInput, SectionTitle } from "./primitives";

export function TaxTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const rbAnual = sum(state.revenue.bruta);
  const set = (patch: Partial<typeof state.tax>) => update((s) => ({ ...s, tax: { ...s.tax, ...patch } }));
  const regimes = compareRegimes(state);
  const aliqEf = simplesAliquotaEfetiva(rbAnual, state.tax.simplesAnexo, state.tax);

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

  // Alertas de sublimite e enquadramento (Auditoria — Fase 2)
  const simplesWarnings: string[] = [];
  if (rbAnual > 4_800_000) {
    simplesWarnings.push(
      `RBT12 = ${fmtBRL(rbAnual)} ultrapassa R$ 4.800.000 — a empresa está DESENQUADRADA do Simples Nacional. Migre obrigatoriamente para Lucro Presumido ou Real.`,
    );
  } else if (rbAnual > 3_600_000) {
    simplesWarnings.push(
      `RBT12 = ${fmtBRL(rbAnual)} ultrapassa o sublimite estadual de R$ 3.600.000 — ICMS/ISS passam a ser recolhidos fora do Simples (regime normal estadual), embora os tributos federais continuem no DAS.`,
    );
  } else if (rbAnual > 4_320_000) {
    simplesWarnings.push(
      `RBT12 = ${fmtBRL(rbAnual)} está a menos de 10% do teto (R$ 4.8M). Cuidado com o desenquadramento automático.`,
    );
  }
  if (state.tax.simplesAnexo === "III" && state.businessType !== "servicos") {
    simplesWarnings.push(
      `Anexo III é para serviços com Fator R ≥ 28%. Atividade atual é "${state.businessType}" — reveja o anexo (Comércio = I, Indústria = II).`,
    );
  }
  if (state.tax.simplesAnexo === "V" && state.tax.fatorRAuto) {
    const folha = (buildDRE(state, state.tax.regime).dre.folhaCltAnual || 0);
    if (rbAnual > 0 && folha / rbAnual >= 0.28) {
      simplesWarnings.push(
        `Fator R = ${((folha / rbAnual) * 100).toFixed(1)}% (≥ 28%) — Anexo V será automaticamente migrado para Anexo III (alíquotas menores).`,
      );
    }
  }

  const era: TaxEra = state.tax.era ?? "atual";
  const reforma = getReformaRates(era, state.tax);
  const emReforma = era !== "atual";
  const projAtiva = compareErasForRegime(state, state.tax.regime);

  return (
    <div className="space-y-6">
      {simplesWarnings.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-warning">⚠ Avisos do Simples Nacional</div>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {simplesWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Seletor de Era Tributária — Reforma CBS/IBS (EC 132/2023 + LC 214/2025) */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SectionTitle>Sistema Tributário</SectionTitle>
            {emReforma && <Badge className="bg-primary/20 text-primary border border-primary/30">Reforma ativa</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Era</label>
            <Select value={era} onValueChange={(v) => set({ era: v as TaxEra })}>
              <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAX_ERAS.map((e) => (
                  <SelectItem key={e} value={e}>{TAX_ERA_LABEL[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {emReforma && (
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="rounded-md bg-accent/30 p-2 text-xs">
              <div className="text-muted-foreground">CBS (federal)</div>
              <div className="num text-sm font-semibold">{reforma.cbsPct.toFixed(2)}%</div>
            </div>
            <div className="rounded-md bg-accent/30 p-2 text-xs">
              <div className="text-muted-foreground">IBS (estadual+municipal)</div>
              <div className="num text-sm font-semibold">{reforma.ibsPct.toFixed(2)}%</div>
            </div>
            <div className="rounded-md bg-accent/30 p-2 text-xs">
              <div className="text-muted-foreground">PIS/COFINS residual</div>
              <div className="num text-sm font-semibold">{(reforma.pisCofinsMult * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded-md bg-accent/30 p-2 text-xs">
              <div className="text-muted-foreground">ICMS/ISS residual</div>
              <div className="num text-sm font-semibold">{(reforma.icmsIssMult * 100).toFixed(0)}%</div>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-border/40 pt-3">
          <div>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              CBS plena (%)
              <HelpTip text="Alíquota de referência da Contribuição sobre Bens e Serviços (federal), substituta de PIS+COFINS. Referência MF/Senado: 8,8%." />
            </label>
            <PctInput value={state.tax.cbsAliquota ?? 8.8} onChange={(n) => set({ cbsAliquota: n })} />
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              IBS plena (%)
              <HelpTip text="Alíquota de referência do Imposto sobre Bens e Serviços (estadual+municipal), substituto de ICMS+ISS. Referência: 17,7%." />
            </label>
            <PctInput value={state.tax.ibsAliquotaRef ?? 17.7} onChange={(n) => set({ ibsAliquotaRef: n })} />
          </div>
          <div className="ml-auto text-[11px] text-muted-foreground max-w-md">
            Cronograma EC 132/2023: 2027 — CBS pleno + PIS/COFINS extintos; 2027–2032 transição (IBS faseado, ICMS/ISS em redução, ponto médio usado aqui); 2033 — regime pleno (CBS+IBS, sem PIS/COFINS/ICMS/ISS). Simples mantém o DAS em todas as eras.
          </div>
        </div>
      </div>


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
              <NumInput value={state.tax.pisCreditos} onChange={(n) => set({ pisCreditos: n })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Créditos COFINS / mês</label>
              <NumInput value={state.tax.cofinsCreditos} onChange={(n) => set({ cofinsCreditos: n })} className="mt-1" />
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

      {/* Comparativo Atual vs. Reforma — tabela + gráfico */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle>
            Atual vs. Reforma — {state.tax.regime === "simples" ? "Simples" : state.tax.regime === "presumido" ? "Presumido" : "Real"}
          </SectionTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Carga tributária projetada para o regime ativo nas três fases da Reforma (EC 132/2023), mantendo receita, custos e demais parâmetros constantes. A era selecionada no topo está destacada.
          </p>
        </div>

        {/* Tabela compacta 3 colunas */}
        <div className="grid grid-cols-4 gap-px bg-border/40 text-center">
          <div className="bg-card p-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground">Indicador</div>
          {projAtiva.map((p) => (
            <div key={"h" + p.era} className={`bg-card p-3 text-[11px] uppercase tracking-wider ${p.era === era ? "text-primary font-semibold" : "text-muted-foreground"}`}>
              {TAX_ERA_SHORT[p.era]}
            </div>
          ))}
          <div className="bg-card p-3 text-left text-xs text-muted-foreground">Carga efetiva</div>
          {projAtiva.map((p) => (
            <div key={"v" + p.era} className={`bg-card p-3 num text-sm ${p.era === era ? "text-primary font-semibold" : ""}`}>
              {p.effective.toFixed(2)}%
            </div>
          ))}
          <div className="bg-card p-3 text-left text-xs text-muted-foreground">Tributos (ano)</div>
          {projAtiva.map((p) => (
            <div key={"a" + p.era} className={`bg-card p-3 num text-sm ${p.era === era ? "text-primary font-semibold" : "text-muted-foreground"}`}>
              {fmtBRL(p.annual)}
            </div>
          ))}
          <div className="bg-card p-3 text-left text-xs text-muted-foreground">Δ vs. atual</div>
          {projAtiva.map((p) => {
            const base = projAtiva[0].annual;
            const delta = p.annual - base;
            const pct = base > 0 ? (delta / base) * 100 : 0;
            const tone = delta > 0 ? "text-neg" : delta < 0 ? "text-pos" : "text-muted-foreground";
            return (
              <div key={"d" + p.era} className={`bg-card p-3 num text-sm ${tone}`}>
                {p.era === "atual" ? "—" : `${delta >= 0 ? "+" : ""}${fmtBRL(delta)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}
              </div>
            );
          })}
        </div>

        <div className="border-t border-border/60 p-4 text-[11px] text-muted-foreground">
          "Transição" usa o ponto médio de 2027–2032 (CBS pleno, IBS a 50% da plena, ICMS/ISS a 50%, PIS/COFINS extintos). Ajuste as alíquotas CBS/IBS acima para simular cenários otimista (≈26,5%) ou conservador (≈28%).
        </div>
      </div>
    </div>
  );
}
