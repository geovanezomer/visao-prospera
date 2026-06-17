import { Fragment, useEffect, useMemo, useRef } from "react";
import { useFinance, usePatchTax } from "@/engines/finance/AppStateContext";
import { toast } from "sonner";
import {
  AppState,
  BusinessType,
  SimplesAnexo,
  TaxEra,
  TaxRegime,
  TAX_ERA_SHORT,
} from "@/engines/finance/types";
import { fmtBRL, fmtPct, sum } from "@/engines/finance/format";
import {
  compareErasForRegime,
  compareRegimes,
  getReformaRates,
  simplesAliquotaEfetiva,
  resolveSimplesAnexo,
  folhaAnual,
  buildDRE,
} from "@/engines/finance";
import {
  getPresumidoBases,
  SIMPLES_LIMITE,
  SIMPLES_SUBLIMITE_ESTADUAL,
} from "@/engines/finance/taxDefaults";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HelpTip, PctInput, SectionTitle } from "./primitives";

// =================================================================
// Componentes movidos para o topo do módulo (B9) — evitam recriação
// a cada render e preservam identidade React dos filhos.
// =================================================================
const RegimeCard = ({
  title,
  isBest,
  annual,
  effective,
  badge,
  children,
}: {
  title: string;
  isBest: boolean;
  annual: number;
  effective: number;
  badge?: string;
  children: React.ReactNode;
}) => (
  <div
    className={`relative rounded-lg border bg-card/40 p-5 ${
      isBest ? "border-success shadow-[0_0_0_1px_var(--success)]" : "border-border/60"
    }`}
  >
    {isBest && (
      <div className="absolute -top-2.5 left-4 z-10">
        <span className="inline-flex items-center rounded-full bg-success px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
          ✓ Mais vantajoso
        </span>
      </div>
    )}
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <div
        className={`text-3xl font-bold tracking-tight ${isBest ? "text-pos" : "text-foreground"}`}
      >
        {fmtBRL(annual)}
      </div>
      <div className="text-xs text-muted-foreground">{fmtPct(effective / 100)} carga efetiva</div>
    </div>
    {badge && (
      <div className="mt-3">
        <Badge
          variant="outline"
          className="border-border/60 bg-accent/20 text-[11px] font-normal text-foreground"
        >
          {badge}
        </Badge>
      </div>
    )}
    <div className="mt-4 space-y-3 text-sm">{children}</div>
  </div>
);

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div
    className={`flex items-center justify-between border-b border-border/30 pb-1 ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}
  >
    <span className="text-xs">{label}</span>
    <span className="num text-sm">{value}</span>
  </div>
);

// Mapeamento Anexo → atividade esperada para validação (B5).
const ANEXO_BUSINESS_OK: Record<SimplesAnexo, BusinessType[]> = {
  I: ["comercio"],
  II: ["industria"],
  III: ["servicos"],
  IV: ["servicos"],
  V: ["servicos"],
};

export function TaxTab() {
  const { state, update } = useFinance();
  const rbAnual = useMemo(() => sum(state.revenue.bruta), [state.revenue.bruta]);
  const set = useCallback(
    (patch: Partial<typeof state.tax>) => update((s) => ({ ...s, tax: { ...s.tax, ...patch } })),
    [update],
  );

  // ----- Engine: memoizada (B1) — recomputa só quando state muda -----
  // SSOT-4: compareRegimes já devolve llBy, best e desenquadradoSimples.
  const regimes = useMemo(() => compareRegimes(state), [state]);
  const llBy = regimes.llBy;
  const projAtiva = useMemo(() => compareErasForRegime(state, state.tax.regime), [state]);

  // B10: alíquota efetiva exibida usa o anexo *resolvido* (Fator R V→III).
  const anexoEfetivo = useMemo(() => resolveSimplesAnexo(state), [state]);
  const aliqEf = useMemo(
    () => simplesAliquotaEfetiva(rbAnual, anexoEfetivo, state.tax),
    [rbAnual, anexoEfetivo, state.tax],
  );

  const simplesLimite = state.tax.ratesOverride?.simplesLimite ?? SIMPLES_LIMITE;
  const desenquadradoSimples = regimes.desenquadradoSimples;
  const best: TaxRegime = regimes.best;

  // B2/B7: auto-migrar regime quando desenquadrado, com guarda contra
  // oscilação (só dispara UMA vez por transição "ficou desenquadrado")
  // e avisa o usuário via toast.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!desenquadradoSimples) {
      migratedRef.current = false;
      return;
    }
    if (state.tax.regime === "simples" && !migratedRef.current) {
      migratedRef.current = true;
      const target = best;
      set({ regime: target });
      const label = target === "presumido" ? "Lucro Presumido" : "Lucro Real";
      toast.warning(`Regime migrado automaticamente para ${label}`, {
        description: `RBT12 = ${fmtBRL(rbAnual)} ultrapassa o teto do Simples (${fmtBRL(simplesLimite)}).`,
      });
    }
  }, [desenquadradoSimples, state.tax.regime, best, set, rbAnual, simplesLimite]);

  // Alertas de sublimite e enquadramento (memoizado — B1/B5)
  const simplesWarnings = useMemo(() => {
    const w: string[] = [];
    if (rbAnual > simplesLimite) {
      // Desenquadramento já é comunicado pelo card "desligado" — sem alerta extra.
    } else if (rbAnual > SIMPLES_SUBLIMITE_ESTADUAL) {
      w.push(
        `RBT12 = ${fmtBRL(rbAnual)} ultrapassa o sublimite estadual de R$ 3.600.000 — ICMS/ISS passam a ser recolhidos fora do Simples (regime normal estadual), embora os tributos federais continuem no DAS.`,
      );
    } else if (rbAnual > simplesLimite * 0.9) {
      w.push(
        `RBT12 = ${fmtBRL(rbAnual)} está a menos de 10% do teto (${fmtBRL(simplesLimite)}). Cuidado com o desenquadramento automático.`,
      );
    }
    // B5: validação completa de anexo × businessType.
    const okBusiness = ANEXO_BUSINESS_OK[state.tax.simplesAnexo];
    if (okBusiness && !okBusiness.includes(state.businessType)) {
      const labels: Record<SimplesAnexo, string> = {
        I: "Anexo I (comércio)",
        II: "Anexo II (indústria)",
        III: "Anexo III (serviços, Fator R ≥ 28%)",
        IV: "Anexo IV (serviços específicos)",
        V: "Anexo V (serviços intelectuais)",
      };
      w.push(
        `${labels[state.tax.simplesAnexo]} é incompatível com a atividade "${state.businessType}". Reveja o anexo (Comércio = I, Indústria = II, Serviços = III/IV/V).`,
      );
    }
    if (state.tax.simplesAnexo === "V" && state.tax.fatorRAuto) {
      // B6: usa helper barato `folhaAnual` em vez de `buildDRE(...).folhaCltAnual`.
      const folha = folhaAnual(state);
      if (rbAnual > 0 && folha / rbAnual >= 0.28) {
        w.push(
          `Fator R = ${((folha / rbAnual) * 100).toFixed(1)}% (≥ 28%) — Anexo V será automaticamente migrado para Anexo III (alíquotas menores).`,
        );
      }
    }
    return w;
  }, [rbAnual, simplesLimite, state]);

  const era: TaxEra = state.tax.era ?? "atual";
  const reforma = useMemo(() => getReformaRates(era, state.tax), [era, state.tax]);

  const setOverride = useCallback(
    (patch: Partial<NonNullable<typeof state.tax.ratesOverride>>) =>
      set({ ratesOverride: { ...(state.tax.ratesOverride ?? {}), ...patch } }),
    [set, state.tax.ratesOverride],
  );

  return (
    <div className="space-y-6">
      {simplesWarnings.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-warning">⚠ Avisos do Simples Nacional</div>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {simplesWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Cabeçalho — Timeline clicável da Reforma Tributária (EC 132/2023) */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle>Cronograma da Reforma Tributária</SectionTitle>
            <p className="mt-1 text-[11px] text-muted-foreground max-w-xl">
              EC 132/2023 + LC 214/2025. Clique em uma fase para simular toda a tela naquele momento
              do cronograma.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Regime ativo (DRE)
              </span>
              <Select
                value={state.tax.regime}
                onValueChange={(v) => set({ regime: v as TaxRegime })}
              >
                <SelectTrigger className="h-8 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* B7: opção Simples desabilitada quando desenquadrado */}
                  <SelectItem value="simples" disabled={desenquadradoSimples}>
                    Simples Nacional{desenquadradoSimples ? " (desenquadrado)" : ""}
                  </SelectItem>
                  <SelectItem value="presumido">Lucro Presumido</SelectItem>
                  <SelectItem value="real">Lucro Real</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Timeline visual clicável */}
        <div className="mt-5">
          {(() => {
            const phases: { era: TaxEra; label: string; periodo: string; desc: string }[] = [
              {
                era: "atual",
                label: "Sistema Atual",
                periodo: "até 2026",
                desc: "PIS/COFINS + ICMS/ISS vigentes",
              },
              {
                era: "transicao",
                label: "Transição",
                periodo: "2027 – 2032",
                desc: "CBS pleno · IBS faseado · ICMS/ISS em redução",
              },
              {
                era: "pleno",
                label: "Regime Pleno",
                periodo: "2033 +",
                desc: "CBS + IBS (sem PIS/COFINS/ICMS/ISS)",
              },
            ];
            const activeIdx = phases.findIndex((p) => p.era === era);
            return (
              <>
                <div className="relative">
                  <div className="absolute left-0 right-0 top-4 h-1 rounded-full bg-border/60" />
                  <div
                    className="absolute left-0 top-4 h-1 rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${(activeIdx / (phases.length - 1)) * 100}%` }}
                  />
                  <div className="relative grid grid-cols-3 gap-3">
                    {phases.map((p, i) => {
                      const isActive = i === activeIdx;
                      const isPast = i < activeIdx;
                      return (
                        <button
                          key={p.era}
                          type="button"
                          onClick={() => set({ era: p.era })}
                          className="group flex flex-col items-center text-center focus:outline-none"
                        >
                          <div
                            className={`relative z-10 grid h-9 w-9 place-items-center rounded-full border-2 text-xs font-bold transition-all ${
                              isActive
                                ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_var(--primary)]/20 scale-110"
                                : isPast
                                  ? "border-primary bg-primary/30 text-primary"
                                  : "border-border bg-card text-muted-foreground group-hover:border-primary/60"
                            }`}
                          >
                            {i + 1}
                          </div>
                          <div
                            className={`mt-2 text-xs font-semibold ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {p.label}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{p.periodo}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
                  <span className="font-semibold text-primary">{phases[activeIdx].label}</span>
                  <span className="text-muted-foreground"> · {phases[activeIdx].periodo}</span>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {phases[activeIdx].desc}
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* Alíquotas editáveis — Transição e Regime Pleno */}
        {(() => {
          const cbsPleno = state.tax.cbsAliquota ?? 8.8;
          const ibsPleno = state.tax.ibsAliquotaRef ?? 17.7;
          const ibsMult = state.tax.ratesOverride?.reformaTransicaoIbsMult ?? 0.5;
          const icmsIssMult = state.tax.ratesOverride?.reformaTransicaoIcmsIssMult ?? 0.5;
          const ibsTrans = ibsPleno * ibsMult;
          const icmsIssResidual = icmsIssMult * 100;
          return (
            <div className="mt-5 grid gap-4 border-t border-border/40 pt-4 md:grid-cols-2">
              <div className="rounded-md border border-border/50 bg-accent/20 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transição · 2027–2032
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      CBS (%)
                      <HelpTip text="CBS já entra plena em 2027 (extingue PIS/COFINS). Use o mesmo valor do Regime Pleno." />
                    </label>
                    <PctInput value={cbsPleno} onChange={(n) => set({ cbsAliquota: n })} />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      IBS (%)
                      <HelpTip text="IBS na transição (ponto médio do faseamento 20/40/60/80% — default ≈ 50% da alíquota plena)." />
                    </label>
                    <PctInput
                      value={ibsTrans}
                      onChange={(n) =>
                        setOverride({ reformaTransicaoIbsMult: ibsPleno > 0 ? n / ibsPleno : 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      ICMS/ISS res. (%)
                      <HelpTip text="Fração residual de ICMS/ISS que ainda incide durante a transição (default 50%)." />
                    </label>
                    <PctInput
                      value={icmsIssResidual}
                      onChange={(n) => setOverride({ reformaTransicaoIcmsIssMult: n / 100 })}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/50 bg-accent/20 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Regime Pleno · 2033+
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      CBS (%)
                      <HelpTip text="Contribuição sobre Bens e Serviços (federal). Referência MF/Senado: 8,8%." />
                    </label>
                    <PctInput value={cbsPleno} onChange={(n) => set({ cbsAliquota: n })} />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      IBS (%)
                      <HelpTip text="Imposto sobre Bens e Serviços (estadual + municipal). Referência: 17,7%." />
                    </label>
                    <PctInput value={ibsPleno} onChange={(n) => set({ ibsAliquotaRef: n })} />
                  </div>
                </div>
                <div className="mt-2 text-[10.5px] text-muted-foreground">
                  Soma de referência ≈ 26,5%. Ajuste para cenários conservadores (≈28%).
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* B3/B4: Bloco compartilhado de ICMS (afeta Presumido E Real).
           Antes estava duplicado dentro de cada card, sugerindo parâmetros independentes. */}
      {state.businessType !== "servicos" && (
        <div className="rounded-lg border border-border/60 bg-card/40 p-5">
          <SectionTitle hint="Alíquotas de ICMS aplicadas tanto em Lucro Presumido quanto em Lucro Real. ICMS efetivo = max(0, débito − crédito).">
            ICMS · Débito e Crédito
          </SectionTitle>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                ICMS débito (%)
                <HelpTip text="Alíquota de débito sobre a receita bruta. Mesmo valor é usado em Presumido e Real." />
              </label>
              <PctInput value={state.tax.issIcms} onChange={(n) => set({ issIcms: n })} />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                ICMS crédito (CPV) (%)
                <HelpTip text="Alíquota média de ICMS embutida nas compras (entradas). Aproveitada como crédito em Presumido e Real." />
              </label>
              <PctInput
                value={state.tax.aliquotaICMSCredito ?? 0}
                onChange={(n) => set({ aliquotaICMSCredito: n })}
              />
            </div>
          </div>
          <div className="mt-2 text-[10.5px] text-muted-foreground">
            ⓘ Estas alíquotas são compartilhadas pelos dois regimes — alterá-las aqui afeta ambos os
            cálculos abaixo.
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {desenquadradoSimples ? (
          <div className="relative rounded-lg border border-border/40 bg-card/20 p-5 opacity-60">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-muted-foreground line-through">
                  Simples Nacional
                </h3>
                <Badge
                  variant="outline"
                  className="border-warning/50 bg-warning/10 text-[10px] text-warning"
                >
                  Desenquadrado
                </Badge>
              </div>
              <div className="text-3xl font-bold tracking-tight text-muted-foreground/50">—</div>
              <div className="text-xs text-muted-foreground">indisponível</div>
            </div>
            <div className="mt-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-[11px] text-muted-foreground">
              RBT12 ({fmtBRL(rbAnual)}) ultrapassa o teto de {fmtBRL(simplesLimite)}. Ajuste o teto
              em <b>Parâmetros → Simples Nacional</b> se a legislação mudar.
            </div>
          </div>
        ) : (
          <RegimeCard
            title="Simples Nacional"
            isBest={best === "simples"}
            annual={regimes.simples.annual}
            effective={regimes.simples.effective}
            badge={`Anexo ${anexoEfetivo}${anexoEfetivo === "III" && state.tax.simplesAnexo === "V" ? " (migrado de V via Fator R)" : ""}`}
          >
            <div>
              <label className="text-xs text-muted-foreground">Anexo</label>
              <Select
                value={state.tax.simplesAnexo}
                onValueChange={(v) => set({ simplesAnexo: v as SimplesAnexo })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["I", "II", "III", "IV", "V"] as const).map((a) => (
                    <SelectItem key={a} value={a}>
                      Anexo {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Row label="RBT12" value={fmtBRL(rbAnual)} />
            <Row label="Alíquota Efetiva" value={fmtPct(aliqEf / 100)} />
            <Row label="DAS (unificado)" value={fmtBRL(regimes.simples.annual)} strong />

            <div className="mt-3 rounded-md bg-accent/30 p-3 text-[11px] text-muted-foreground">
              Anexos: <b>I</b> comércio · <b>II</b> indústria · <b>III</b> serviços (Fator R ≥ 28%)
              · <b>IV</b> serviços específicos · <b>V</b> serviços intelectuais.
            </div>
          </RegimeCard>
        )}

        <RegimeCard
          title="Lucro Presumido"
          isBest={best === "presumido"}
          annual={regimes.presumido.annual}
          effective={regimes.presumido.effective}
          badge={(() => {
            const bases = getPresumidoBases(state.tax, state.businessType);
            const bI = state.tax.presumidoBaseIRPJ || bases.irpj;
            const bC = state.tax.presumidoBaseCSLL || bases.csll;
            return `Base IRPJ ${bI}% · CSLL ${bC}%`;
          })()}
        >
          {Object.entries(regimes.presumido.detail).map(([k, v]) => (
            <Row key={k} label={k} value={fmtBRL(v)} />
          ))}
          <div className="mt-2 rounded-md bg-accent/30 p-2 text-[10.5px] text-muted-foreground">
            ⓘ Base IRPJ, Base CSLL{state.businessType === "servicos" ? " e ISS" : ""} são editáveis
            em <b>Parâmetros</b> (cabeçalho). Adicional de IRPJ (10% sobre lucro trimestral &gt;
            R$60k) é distribuído proporcionalmente entre os meses.
          </div>
        </RegimeCard>

        <RegimeCard
          title="Lucro Real"
          isBest={best === "real"}
          annual={regimes.real.annual}
          effective={regimes.real.effective}
          badge="PIS/COFINS não-cumulativo"
        >
          {Object.entries(regimes.real.detail).map(([k, v]) => (
            <Row key={k} label={k} value={fmtBRL(v)} />
          ))}
          <div className="mt-2 rounded-md bg-accent/30 p-2 text-[10.5px] text-muted-foreground">
            ⓘ PIS/COFINS não-cumulativos abatem créditos automaticamente sobre insumos. Após 2027,
            com CBS/IBS, a não-cumulatividade é plena sobre toda despesa operacional vinculada à
            atividade.
          </div>
        </RegimeCard>
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle>Comparativo anual entre regimes</SectionTitle>
        </div>

        {/* Barras proporcionais — Lucro Líquido por regime */}
        <div className="border-b border-border/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Lucro líquido anual por regime
            </div>
            <div className="text-[11px] text-muted-foreground">
              Quanto maior a barra, mais sobra para a empresa
            </div>
          </div>
          {(() => {
            const regs: TaxRegime[] = (["simples", "presumido", "real"] as TaxRegime[]).filter(
              (r) => !(desenquadradoSimples && r === "simples"),
            );
            const labels: Record<TaxRegime, string> = {
              simples: "Simples Nacional",
              presumido: "Lucro Presumido",
              real: "Lucro Real",
            };
            const values = regs.map((r) => llBy[r]);
            const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
            const bestVal = llBy[best];
            return (
              <div className="space-y-3">
                {regs.map((r) => {
                  const v = llBy[r];
                  const widthPct = (Math.abs(v) / maxAbs) * 100;
                  const isBest = r === best;
                  const isCurrent = r === state.tax.regime;
                  const delta = v - bestVal;
                  const deltaPct = bestVal !== 0 ? (delta / Math.abs(bestVal)) * 100 : 0;
                  return (
                    <div key={r}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-semibold ${isBest ? "text-pos" : "text-foreground"}`}
                          >
                            {labels[r]}
                          </span>
                          {isBest && (
                            <Badge className="h-4 bg-pos/20 text-pos border border-pos/40 px-1.5 text-[9px]">
                              MELHOR
                            </Badge>
                          )}
                          {isCurrent && (
                            <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                              Ativo
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="num text-sm font-semibold tabular-nums">
                            {fmtBRL(v)}
                          </span>
                          {!isBest && (
                            <span className="num text-[11px] text-neg tabular-nums">
                              {delta >= 0 ? "+" : ""}
                              {fmtBRL(delta)} ({deltaPct.toFixed(1)}%)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-border/40">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            v < 0 ? "bg-neg" : isBest ? "bg-pos" : "bg-primary/60"
                          }`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>
                          Tributos: <span className="num">{fmtBRL(regimes[r].annual)}</span>
                        </span>
                        <span>
                          Carga: <span className="num">{fmtPct(regimes[r].effective / 100)}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {(() => {
          const cols: TaxRegime[] = (["simples", "presumido", "real"] as TaxRegime[]).filter(
            (r) => !(desenquadradoSimples && r === "simples"),
          );
          const labelOf = (r: TaxRegime) =>
            r === "simples"
              ? "Simples Nacional"
              : r === "presumido"
                ? "Lucro Presumido"
                : "Lucro Real";
          const gridCls = cols.length === 3 ? "grid-cols-4" : "grid-cols-3";
          return (
            <div className={`grid ${gridCls} gap-px bg-border/40`}>
              <div className="bg-card p-4 text-xs uppercase tracking-wider text-muted-foreground">
                Indicador
              </div>
              {cols.map((r) => (
                <div
                  key={r}
                  className={`bg-card p-4 text-xs uppercase tracking-wider ${best === r ? "text-primary" : "text-muted-foreground"}`}
                >
                  {labelOf(r)}
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
                  {cols.map((r) => (
                    <div
                      key={r + row.k}
                      className={`bg-card p-3 num text-sm ${best === r ? "text-pos font-semibold" : ""}`}
                    >
                      {row.v(r)}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Comparativo Atual vs. Reforma — tabela + gráfico */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle>
            Atual vs. Reforma —{" "}
            {state.tax.regime === "simples"
              ? "Simples"
              : state.tax.regime === "presumido"
                ? "Presumido"
                : "Real"}
          </SectionTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Carga tributária projetada para o regime ativo nas três fases da Reforma (EC 132/2023),
            mantendo receita, custos e demais parâmetros constantes. A era selecionada no topo está
            destacada.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-px bg-border/40 text-center">
          <div className="bg-card p-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            Indicador
          </div>
          {projAtiva.map((p) => (
            <div
              key={"h" + p.era}
              className={`bg-card p-3 text-[11px] uppercase tracking-wider ${p.era === era ? "text-primary font-semibold" : "text-muted-foreground"}`}
            >
              {TAX_ERA_SHORT[p.era]}
            </div>
          ))}
          <div className="bg-card p-3 text-left text-xs text-muted-foreground">Carga efetiva</div>
          {projAtiva.map((p) => (
            <div
              key={"v" + p.era}
              className={`bg-card p-3 num text-sm ${p.era === era ? "text-primary font-semibold" : ""}`}
            >
              {p.effective.toFixed(2)}%
            </div>
          ))}
          <div className="bg-card p-3 text-left text-xs text-muted-foreground">Tributos (ano)</div>
          {projAtiva.map((p) => (
            <div
              key={"a" + p.era}
              className={`bg-card p-3 num text-sm ${p.era === era ? "text-primary font-semibold" : "text-muted-foreground"}`}
            >
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
                {p.era === "atual"
                  ? "—"
                  : `${delta >= 0 ? "+" : ""}${fmtBRL(delta)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}
              </div>
            );
          })}
        </div>

        <div className="border-t border-border/60 p-4 text-[11px] text-muted-foreground">
          "Transição" usa o ponto médio de 2027–2032 (CBS pleno, IBS a 50% da plena, ICMS/ISS a 50%,
          PIS/COFINS extintos). Ajuste as alíquotas CBS/IBS acima para simular cenários otimista
          (≈26,5%) ou conservador (≈28%).
        </div>
      </div>
    </div>
  );
}
