/**
 * Calculadora comparativa CLT vs PJ (3 regimes: MEI / Simples / Presumido).
 * Cálculo reativo. Apenas abas Resumo e Detalhamento (sem Breakeven nem Fluxo Mensal).
 */
import { useMemo, useState } from "react";
import { Download, Info, RotateCcw, Scale } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compararCltVsPj, regimePJLabel, type RegimePJ } from "@/engines/calculadoras/cltVsPj";
import { ANO_VIGENTE } from "@/engines/calculadoras/tabelas";
import { useAppState } from "@/engines/finance/store";
import { getIrpjAdicionalPct, getIrpjAdicionalGatilhoTri } from "@/engines/finance/taxDefaults";
import { fmtBRL } from "@/engines/finance/format";

const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function CltVsPjCalc() {
  const { state } = useAppState();
  // Adicional IRPJ — vem das "Federais" (TaxConfig.ratesOverride). Permite que
  // decisões judiciais que zeram o adicional para um segmento se propaguem aqui.
  const irpjAdicionalPct = getIrpjAdicionalPct(state.tax) / 100;
  const irpjAdicionalGatilhoMensal = getIrpjAdicionalGatilhoTri(state.tax) / 3;

  const [salarioBrutoCLT, setSalarioBrutoCLT] = useState(3000);
  const [dependentesIR, setDependentesIR] = useState(0);
  const [plrAnual, setPlrAnual] = useState(0);
  const [beneficiosCLTMensal, setBeneficiosCLTMensal] = useState(0);

  const [faturamentoPJMensal, setFaturamentoPJMensal] = useState(5000);
  const [contabilidadeMensal, setContabilidadeMensal] = useState(0);
  const [planoSaudeMensal, setPlanoSaudeMensal] = useState(0);

  const r = useMemo(() => {
    try {
      return compararCltVsPj({
        salarioBrutoCLT,
        dependentesIR,
        plrAnual,
        beneficiosCLTMensal,
        faturamentoPJMensal,
        contabilidadeMensal,
        planoSaudeMensal,
        proLaborePct: 0.28,
        irpjAdicionalPct,
        irpjAdicionalGatilhoMensal,
      });
    } catch {
      return null;
    }
  }, [
    salarioBrutoCLT,
    dependentesIR,
    plrAnual,
    beneficiosCLTMensal,
    faturamentoPJMensal,
    contabilidadeMensal,
    planoSaudeMensal,
    irpjAdicionalPct,
    irpjAdicionalGatilhoMensal,
  ]);

  function limpar() {
    setSalarioBrutoCLT(0);
    setDependentesIR(0);
    setPlrAnual(0);
    setBeneficiosCLTMensal(0);
    setFaturamentoPJMensal(0);
    setContabilidadeMensal(0);
    setPlanoSaudeMensal(0);
  }

  async function exportar() {
    if (!r) return;
    const venceLabel = r.vencedor === "pj" ? `PJ (${regimePJLabel[r.melhorRegimePJ]})` : "CLT";
    await exportCalculadoraPDF({
      title: "CLT vs PJ",
      subtitle:
        "Comparativo de líquido anual entre carteira assinada e os três regimes mais comuns de PJ.",
      inputs: [
        { label: "Salário bruto CLT", value: fmtBRL(salarioBrutoCLT) },
        { label: "Dependentes IR", value: String(dependentesIR) },
        { label: "PLR anual", value: fmtBRL(plrAnual) },
        { label: "Benefícios CLT/mês", value: fmtBRL(beneficiosCLTMensal) },
        { label: "Faturamento PJ/mês", value: fmtBRL(faturamentoPJMensal) },
        { label: "Contabilidade/mês", value: fmtBRL(contabilidadeMensal) },
        { label: "Plano de saúde/mês", value: fmtBRL(planoSaudeMensal) },
      ],
      kpis: [
        { label: "Vencedor", value: venceLabel, sub: `+${fmtBRL(Math.abs(r.diferencaAnual))}/ano`, tone: "ok" },
        { label: "Líquido CLT/ano", value: fmtBRL(r.clt.totalAnualLiquido), sub: `${fmtBRL(r.clt.totalAnualLiquido / 12)}/mês`, tone: "neutral" },
        { label: "Líquido melhor PJ/ano", value: fmtBRL(r.pj[r.melhorRegimePJ].liquidoAnual), sub: `${fmtBRL(r.pj[r.melhorRegimePJ].liquidoMensal)}/mês`, tone: "neutral" },
      ],
      sections: [
        {
          kind: "table",
          title: "Comparativo por regime PJ",
          head: ["Regime", "Alíquota efetiva", "Líquido mensal", "Líquido anual"],
          body: (["mei", "simples", "presumido"] as const).map((reg) => [
            regimePJLabel[reg],
            fmtPct(r.pj[reg].aliquotaImpostos),
            fmtBRL(r.pj[reg].liquidoMensal),
            fmtBRL(r.pj[reg].liquidoAnual),
          ]),
        },
        {
          kind: "kv",
          title: "Direitos CLT (referência)",
          rows: [
            { label: "FGTS depositado/ano", value: fmtBRL(r.clt.fgtsAnual) },
            { label: "Multa potencial FGTS (40%)", value: fmtBRL(r.clt.multaFGTSPotencial) },
            { label: "13º salário líquido", value: fmtBRL(r.clt.decimoLiquido) },
            { label: "Férias + 1/3 líquidas", value: fmtBRL(r.clt.feriasLiquidas) },
          ],
        },
      ],
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Scale className="h-5 w-5 text-primary" /> CLT vs PJ
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare o líquido anual real entre carteira assinada e os três regimes mais comuns de
            Pessoa Jurídica.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={exportar} title="Exportar PDF" disabled={!r}>
            <Download className="mr-2 h-4 w-4" /> Exportar PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={limpar}>
            <RotateCcw className="mr-2 h-4 w-4" /> Limpar
          </Button>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge variant="outline" className="bg-primary/5 text-primary">
                CLT
              </Badge>{" "}
              Dados CLT
            </CardTitle>
            <CardDescription>
              Informe os dados do seu emprego com carteira assinada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Salário Bruto Mensal" hint="Valor antes de descontos (INSS, IRRF etc.)">
              <MoneyInput value={salarioBrutoCLT} onChange={setSalarioBrutoCLT} />
            </Field>
            <Field
              label="Número de Dependentes"
              hint="Cada dependente reduz a base do IRRF em R$ 189,59/mês."
            >
              <Input
                type="number"
                min={0}
                value={dependentesIR || ""}
                onChange={(e) => setDependentesIR(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="PLR Anual" hint="Participação nos Lucros e Resultados (opcional).">
              <MoneyInput value={plrAnual} onChange={setPlrAnual} />
            </Field>
            <Field label="Benefícios Mensais" hint="VA, VR, plano de saúde etc. (opcional)">
              <MoneyInput value={beneficiosCLTMensal} onChange={setBeneficiosCLTMensal} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              >
                PJ
              </Badge>{" "}
              Dados PJ
            </CardTitle>
            <CardDescription>Informe o faturamento e custos como Pessoa Jurídica.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Faturamento PJ Mensal"
              hint="Quanto você emitirá em notas por mês como PJ."
            >
              <MoneyInput value={faturamentoPJMensal} onChange={setFaturamentoPJMensal} />
            </Field>
            <p className="text-xs font-medium text-foreground">
              Custos fixos PJ (para comparação real)
            </p>
            <Field
              label="Contabilidade Mensal"
              hint="Contador/escritório contábil (tipicamente R$ 100–300)."
            >
              <MoneyInput value={contabilidadeMensal} onChange={setContabilidadeMensal} />
            </Field>
            <Field
              label="Plano de Saúde"
              hint="Como PJ você precisa contratar por conta (opcional)."
            >
              <MoneyInput value={planoSaudeMensal} onChange={setPlanoSaudeMensal} />
            </Field>
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground/80">
              <p className="mb-1 font-medium text-primary">Comparamos 3 regimes de uma vez:</p>
              <ul className="ml-3 list-disc space-y-0.5">
                <li>MEI — DAS fixo ~R$ 80 (teto R$ 6.750/mês)</li>
                <li>Simples Nacional — ~9,3% (serviços)</li>
                <li>Lucro Presumido — ~16,33% (serviços)</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resultado */}
      {r && r.clt.salarioBruto > 0 && r.pj.simples.faturamentoMensal > 0 && (
        <>
          {/* Hero comparativo */}
          <Card
            className={`border-2 ${r.vencedor === "pj" ? "border-emerald-500/40 bg-emerald-500/5" : "border-primary/40 bg-primary/5"}`}
          >
            <CardContent className="py-6 text-center">
              <p
                className={`text-xs font-bold uppercase tracking-wider ${r.vencedor === "pj" ? "text-emerald-700 dark:text-emerald-400" : "text-primary"}`}
              >
                {r.vencedor === "pj"
                  ? `PJ (${regimePJLabel[r.melhorRegimePJ]}) compensa mais`
                  : "CLT compensa mais"}
              </p>
              <p
                className={`mt-2 text-4xl font-bold tracking-tight sm:text-5xl ${r.vencedor === "pj" ? "text-emerald-700 dark:text-emerald-400" : "text-primary"}`}
              >
                {fmtBRL(Math.abs(r.diferencaAnual))}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                a mais por ano com {r.vencedor === "pj" ? regimePJLabel[r.melhorRegimePJ] : "CLT"}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtBRL(Math.abs(r.diferencaMensal))}/mês de diferença
              </p>
            </CardContent>
            <Separator />
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              <Cell label="Líquido CLT/mês" value={fmtBRL(r.clt.totalAnualLiquido / 12)} />
              <Cell
                label={`Líquido ${regimePJLabel[r.melhorRegimePJ]}/mês`}
                value={fmtBRL(r.pj[r.melhorRegimePJ].liquidoMensal)}
              />
              <Cell label="Total CLT/ano" value={fmtBRL(r.clt.totalAnualLiquido)} />
              <Cell
                label={`Total ${regimePJLabel[r.melhorRegimePJ]}/ano`}
                value={fmtBRL(r.pj[r.melhorRegimePJ].liquidoAnual)}
              />
            </div>
          </Card>

          {/* Comparação por regime */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              Comparação por regime tributário
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["mei", "simples", "presumido"] as RegimePJ[]).map((regime) => {
                const p = r.pj[regime];
                const isMelhor = regime === r.melhorRegimePJ;
                const diff = p.liquidoAnual - r.clt.totalAnualLiquido;
                return (
                  <Card
                    key={regime}
                    className={isMelhor ? "border-emerald-500/40 bg-emerald-500/5" : ""}
                  >
                    <CardContent className="space-y-2 py-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{regimePJLabel[regime]}</p>
                        {isMelhor && (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400"
                          >
                            Melhor opção
                          </Badge>
                        )}
                      </div>
                      <p className="text-xl font-bold text-foreground">
                        {fmtBRL(p.liquidoMensal)}
                        <span className="text-xs font-normal text-muted-foreground">/mês</span>
                      </p>
                      <div className="space-y-0.5 text-xs">
                        <Row
                          label="Impostos"
                          value={`−${fmtBRL(p.impostosMensal)} (${fmtPct(p.aliquotaImpostos)})`}
                          tone="destructive"
                        />
                        <Row
                          label="INSS pró-labore"
                          value={`−${fmtBRL(p.inssProLaboreMensal)}`}
                          tone="destructive"
                        />
                        {p.custosFixosMensal > 0 && (
                          <Row
                            label="Custos fixos"
                            value={`−${fmtBRL(p.custosFixosMensal)}`}
                            tone="destructive"
                          />
                        )}
                        {p.retencaoDividendosMensal > 0 && (
                          <Row
                            label="Retenção IR dividendos 10% (Lei 15.270/25)"
                            value={`−${fmtBRL(p.retencaoDividendosMensal)}`}
                            tone="destructive"
                          />
                        )}
                      </div>
                      <div
                        className={`mt-2 rounded-md p-2 text-center text-xs font-medium ${diff >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}
                      >
                        {diff >= 0 ? "+" : "−"}
                        {fmtBRL(Math.abs(diff))}/ano vs CLT
                      </div>
                      {p.alertaIRPFM && (
                        <p
                          className="text-[10px] text-amber-600 dark:text-amber-500"
                          title="Retenção na fonte sobre distribuições acima de R$ 50 mil/mês da mesma PJ à mesma PF; antecipação do IRPF Mínimo anual."
                        >
                          ⚠ Renda anual do sócio acima de R$ 600 mil — sujeita ao IRPF Mínimo
                          (até 10%). Simulação não calcula o IRPFM, que depende da renda global
                          da PF.
                        </p>
                      )}
                      {p.acimaDoTetoRegime && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-500">
                          ⚠ Faturamento acima do teto deste regime.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Tabs Resumo / Detalhamento */}
          <Tabs defaultValue="resumo">
            <TabsList>
              <TabsTrigger value="resumo">Resumo</TabsTrigger>
              <TabsTrigger value="detalhamento">Detalhamento</TabsTrigger>
            </TabsList>

            <TabsContent value="resumo" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Faturamento PJ para empatar com CLT</CardTitle>
                  <CardDescription>
                    Quanto você precisa faturar por mês em cada regime para igualar a renda CLT.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {(["mei", "simples", "presumido"] as RegimePJ[]).map((reg) => (
                      <div key={reg} className="flex items-center justify-between py-2.5">
                        <span className="text-sm text-foreground">{regimePJLabel[reg]}</span>
                        <span className="text-sm font-bold text-foreground">
                          {fmtBRL(r.faturamentoEmpate[reg])}
                          <span className="text-xs font-normal text-muted-foreground">/mês</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">O que a CLT te dá que PJ não tem</CardTitle>
                  <CardDescription>
                    Direitos trabalhistas que o PJ precisa se organizar para cobrir.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  <Row label="FGTS depositado/ano" value={fmtBRL(r.clt.fgtsAnual)} />
                  <Row
                    label="Multa 40% FGTS (demissão s/ justa causa)"
                    value={fmtBRL(r.clt.multaFGTSPotencial)}
                  />
                  <Row label="13º salário líquido" value={fmtBRL(r.clt.decimoLiquido)} />
                  <Row label="Férias + 1/3 líquidas" value={fmtBRL(r.clt.feriasLiquidas)} />
                  <Separator className="my-2" />
                  <Row
                    label="Total em direitos trabalhistas/ano"
                    value={fmtBRL(
                      r.clt.fgtsAnual +
                        r.clt.multaFGTSPotencial +
                        r.clt.decimoLiquido +
                        r.clt.feriasLiquidas,
                    )}
                    bold
                  />
                  <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                    <p>
                      <strong className="text-foreground">Seguro-desemprego:</strong> como CLT você
                      tem direito a até 5 meses de seguro. Como PJ, precisa manter reserva de
                      emergência de pelo menos 6 meses de despesas.
                    </p>
                    <p>
                      <strong className="text-foreground">Previdência:</strong> o INSS pró-labore do
                      PJ conta para aposentadoria, mas sobre base menor. Considere previdência
                      privada complementar.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="detalhamento" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Badge variant="outline" className="bg-primary/5 text-primary">
                        CLT
                      </Badge>{" "}
                      Detalhamento CLT
                    </CardTitle>
                    <CardDescription>
                      Salário bruto: {fmtBRL(r.clt.salarioBruto)}/mês
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    <Row label="Salário líquido anual (12×)" value={fmtBRL(r.clt.liquidoAnual)} />
                    <Row
                      label="INSS descontado/mês"
                      value={`−${fmtBRL(r.clt.inssMensal)}`}
                      tone="destructive"
                    />
                    <Row
                      label="IRRF descontado/mês"
                      value={r.clt.irrfMensal > 0 ? `−${fmtBRL(r.clt.irrfMensal)}` : "Isento"}
                      tone={r.clt.irrfMensal > 0 ? "destructive" : "muted"}
                    />
                    <Separator className="my-1" />
                    <Row label="13º salário líquido" value={fmtBRL(r.clt.decimoLiquido)} />
                    <Row label="Férias líquidas (+ 1/3)" value={fmtBRL(r.clt.feriasLiquidas)} />
                    {r.clt.plrLiquido > 0 && (
                      <Row label="PLR líquida" value={fmtBRL(r.clt.plrLiquido)} />
                    )}
                    {r.clt.beneficiosAnuais > 0 && (
                      <Row label="Benefícios anuais" value={fmtBRL(r.clt.beneficiosAnuais)} />
                    )}
                    <Separator className="my-1" />
                    <Row label="Total anual CLT" value={fmtBRL(r.clt.totalAnualLiquido)} bold />
                    <div className="mt-3 space-y-0.5 rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
                      <p>FGTS depositado (não contabilizado): {fmtBRL(r.clt.fgtsAnual)}/ano</p>
                      <p>Líquido mensal: {fmtBRL(r.clt.totalAnualLiquido / 12)}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      >
                        PJ
                      </Badge>
                      Detalhamento PJ ({regimePJLabel[r.melhorRegimePJ]})
                    </CardTitle>
                    <CardDescription>
                      {fmtPct(r.pj[r.melhorRegimePJ].aliquotaImpostos)} de impostos
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    <Row
                      label="Faturamento bruto anual"
                      value={fmtBRL(r.pj[r.melhorRegimePJ].faturamentoMensal * 12)}
                    />
                    <Row
                      label="Impostos anuais"
                      value={`−${fmtBRL(r.pj[r.melhorRegimePJ].impostosMensal * 12)}`}
                      tone="destructive"
                    />
                    <Row
                      label="INSS pró-labore (anual)"
                      value={`−${fmtBRL(r.pj[r.melhorRegimePJ].inssProLaboreMensal * 12)}`}
                      tone="destructive"
                    />
                    {r.pj[r.melhorRegimePJ].irrfProLaboreMensal > 0 && (
                      <Row
                        label="IRRF pró-labore (anual)"
                        value={`−${fmtBRL(r.pj[r.melhorRegimePJ].irrfProLaboreMensal * 12)}`}
                        tone="destructive"
                      />
                    )}
                    {r.pj[r.melhorRegimePJ].custosFixosMensal > 0 && (
                      <Row
                        label="Custos fixos (anual)"
                        value={`−${fmtBRL(r.pj[r.melhorRegimePJ].custosFixosMensal * 12)}`}
                        tone="destructive"
                      />
                    )}
                    <Separator className="my-1" />
                    <Row
                      label="Renda líquida anual"
                      value={fmtBRL(r.pj[r.melhorRegimePJ].liquidoAnual)}
                      bold
                    />
                    <div className="mt-3 space-y-0.5 rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
                      <p>Pró-labore base: {fmtBRL(r.pj[r.melhorRegimePJ].proLaboreMensal)}/mês</p>
                      <p>Líquido mensal: {fmtBRL(r.pj[r.melhorRegimePJ].liquidoMensal)}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <p className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Metodologia:</strong> CLT: 12 salários líquidos
                + 13º + férias com 1/3 + PLR. PJ: faturamento − impostos − INSS pró-labore − custos
                fixos. Pró-labore de 28% do faturamento (mínimo 1 salário mínimo). FGTS não
                contabilizado no total CLT (inacessível sem demissão). Alíquotas efetivas
                aproximadas para serviços. Consulte seu contador para valores exatos.
              </p>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Entenda */}
      <Collapsible>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between p-4 text-left text-sm font-medium hover:bg-muted/40">
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" /> Entenda a calculadora
              </span>
              <span className="text-xs text-muted-foreground">expandir</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3 border-t pt-4 text-sm text-muted-foreground">
              <p>
                A comparação CLT vs PJ vai muito além do salário bruto: envolve benefícios que o
                empregador CLT custeia (FGTS, 13º, férias, plano de saúde) e encargos que o
                trabalhador PJ precisa cobrir por conta própria (INSS pró-labore, IRPJ, CSLL,
                PIS/COFINS, ISS, honorário contábil). O objetivo é encontrar o
                <strong> ponto de equilíbrio</strong> — o faturamento mínimo como PJ para igualar o
                custo-benefício do CLT.
              </p>
              <p>
                Como benchmark de mercado, o faturamento PJ deve ser pelo menos{" "}
                <strong>35–40% maior</strong> que o salário bruto CLT equivalente para compensar a
                perda de direitos trabalhistas e a vacância (períodos sem contrato).
              </p>
              <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                Total CLT (para empregador) = Salário Bruto × 1,68 (INSS patronal + FGTS +
                provisões)
                <br />
                Faturamento PJ mínimo = Líquido CLT alvo ÷ (1 − alíquota PJ − reserva)
              </div>
              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Vacância é o fator mais esquecido:</strong> contratos PJ podem ser
                    interrompidos. Reserve 10–15% do faturamento para cobrir meses sem receita.
                  </li>
                  <li>
                    <strong>Plano de saúde:</strong> um plano empresarial CLT pode custar R$
                    500–800/mês para o empregador. Como PJ, geralmente 40–60% mais caro para
                    cobertura similar.
                  </li>
                  <li>
                    <strong>FGTS tem valor real de opção:</strong> em demissão sem justa causa,
                    equivale a ~10,4% do salário ao ano de rendimento garantido.
                  </li>
                  <li>
                    <strong>Use o ponto de equilíbrio, não a regra de bolso:</strong> “ganhe 40% a
                    mais como PJ” é média; o número real depende do regime, benefícios e dependentes
                    no IR.
                  </li>
                </ul>
              </div>
              <p className="pt-2 text-xs">
                Bases: LC 123/2006 (Simples/MEI), Lei 9.249/95 (Lucro Presumido), Lei 8.212/91 (INSS
                pró-labore), tabelas IRRF/INSS {ANO_VIGENTE}. IRRF conforme Lei nº 15.270/2025 (redutor até R$ 7.350). Estimativa — sempre confirme com seu contador.
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

// ============================================================================
// Subcomponentes
// ============================================================================

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MoneyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
        R$
      </span>
      <Input
        type="number"
        min={0}
        step={100}
        className="pl-10"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-3 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "foreground",
  bold,
}: {
  label: string;
  value: string;
  tone?: "foreground" | "destructive" | "muted";
  bold?: boolean;
}) {
  const cls =
    tone === "destructive"
      ? "text-destructive"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div className={`flex items-center justify-between ${bold ? "font-bold" : ""}`}>
      <span className={bold ? "text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}
