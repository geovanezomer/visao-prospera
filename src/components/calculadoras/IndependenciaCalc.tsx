/**
 * Calculadora de Independência Financeira (FIRE).
 *
 * Número FIRE = Gasto Anual ÷ Taxa de Retirada Segura
 *   - Regra dos 4% (Trinity Study, 1998) → Gasto Mensal × 12 × 25
 *   - Regra dos 3,5%                     → Gasto Mensal × 12 ÷ 0,035 ≈ × 343
 *
 * Tempo até FIRE (com aporte mensal e patrimônio inicial):
 *   simulação ano-a-ano até o patrimônio atingir o Número FIRE.
 *   patrimônio_próximo = patrimônio × (1+r) + aporte_anual × (1+r/2)
 *   (aproximação simples de aportes distribuídos no ano)
 */
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Flag, Info, RotateCcw } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtBRL, fmtBRLCompact, fmtPct, fmtNum } from "@/engines/finance/format";

const fmtBRLShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${fmtNum(n / 1_000_000, 1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return Math.round(n).toString();
};

const RETORNOS = [
  { label: "Conservador", pct: 6 },
  { label: "Moderado", pct: 10 },
  { label: "Arrojado", pct: 14 },
];
const RETIRADAS = [
  { label: "Segura", pct: 3 },
  { label: "Regra 4%", pct: 4 },
  { label: "Moderada", pct: 5 },
];

const PAGE_SIZE = 10;

type LinhaAno = {
  ano: number;
  idade: number;
  aporteAno: number;
  rendimentoAno: number;
  totalInvestido: number;
  patrimonio: number;
};

export function IndependenciaCalc() {
  const [idadeAtual, setIdadeAtual] = useState<number>(30);
  const [idadeAlvo, setIdadeAlvo] = useState<number>(50);
  const [gastosMensais, setGastosMensais] = useState<number>(5000);
  const [patrimonio, setPatrimonio] = useState<number>(100000);
  const [aporteMensal, setAporteMensal] = useState<number>(1000);
  const [retornoAnual, setRetornoAnual] = useState<number>(10);
  const [taxaRetirada, setTaxaRetirada] = useState<number>(4);
  // Inflação anual esperada (IPCA): a simulação roda em termos REAIS,
  // ou seja, todos os valores ficam em poder de compra de hoje.
  const [inflacaoAnual, setInflacaoAnual] = useState<number>(4);
  const [pagina, setPagina] = useState(0);

  const sim = useMemo(() => {
    const gastoAnual = gastosMensais * 12;
    const numeroFire = taxaRetirada > 0 ? gastoAnual / (taxaRetirada / 100) : 0;
    // Retorno REAL = (1 + nominal) / (1 + inflação) − 1 (Equação de Fisher).
    // Mantém o cálculo do número FIRE em reais de hoje e neutraliza a inflação.
    const rNominal = retornoAnual / 100;
    const iInfl = inflacaoAnual / 100;
    const r = (1 + rNominal) / (1 + iInfl) - 1;
    const aporteAno = aporteMensal * 12;

    // Simulação ano a ano até atingir FIRE (cap de 80 anos para evitar loop)
    const linhas: LinhaAno[] = [];
    let p = patrimonio;
    let totalInvestido = patrimonio;
    // Se o patrimônio inicial já cobre o número FIRE, a meta foi atingida no ano 0.
    let anosParaFire: number | null = numeroFire > 0 && patrimonio >= numeroFire ? 0 : null;
    const maxAnos = 80;
    for (let ano = 1; ano <= maxAnos; ano++) {
      const rendimentoAno = p * r + aporteAno * (r / 2); // aporte distribuído
      p = p * (1 + r) + aporteAno * (1 + r / 2);
      totalInvestido += aporteAno;
      linhas.push({
        ano,
        idade: idadeAtual + ano,
        aporteAno,
        rendimentoAno,
        totalInvestido,
        patrimonio: p,
      });
      if (anosParaFire === null && p >= numeroFire && numeroFire > 0) {
        anosParaFire = ano;
        // continuar simulação até pelo menos idade-alvo
      }
      if (
        ano >= Math.max(idadeAlvo - idadeAtual, anosParaFire ?? 0) &&
        (anosParaFire !== null || ano >= maxAnos)
      ) {
        break;
      }
    }

    // Recorta linhas até o último ano relevante (atingiu FIRE ou idade-alvo)
    const anosLimite = Math.max(anosParaFire ?? linhas.length, idadeAlvo - idadeAtual);
    const linhasMostradas = linhas.slice(0, Math.max(1, anosLimite));

    // Estima fração de ano se atingiu FIRE entre anos
    let anosFracionarios: number | null = null;
    if (anosParaFire !== null) {
      const idx = anosParaFire - 1;
      const antes = idx > 0 ? linhas[idx - 1].patrimonio : patrimonio;
      const depois = linhas[idx].patrimonio;
      const delta = depois - antes;
      const fracao = delta > 0 ? Math.max(0, Math.min(1, (numeroFire - antes) / delta)) : 0;
      anosFracionarios = idx + fracao;
    }

    // Patrimônio na idade-alvo (interpolação até esse ano)
    const anosAteAlvo = Math.max(0, idadeAlvo - idadeAtual);
    const patAlvo =
      anosAteAlvo === 0
        ? patrimonio
        : (linhas[Math.min(anosAteAlvo, linhas.length) - 1]?.patrimonio ?? patrimonio);
    const totInvAlvo =
      anosAteAlvo === 0
        ? patrimonio
        : (linhas[Math.min(anosAteAlvo, linhas.length) - 1]?.totalInvestido ?? patrimonio);
    const totRendAlvo = patAlvo - totInvAlvo;
    const rendaMensalAlvo = (patAlvo * (taxaRetirada / 100)) / 12;
    const pctFire = numeroFire > 0 ? patAlvo / numeroFire : 0;
    const progressoAtual = numeroFire > 0 ? patrimonio / numeroFire : 0;
    const idadeFire = anosFracionarios !== null ? idadeAtual + anosFracionarios : null;
    const atingeNoTempo = idadeFire !== null && idadeFire <= idadeAlvo;

    return {
      gastoAnual,
      numeroFire,
      anosParaFire,
      anosFracionarios,
      idadeFire,
      atingeNoTempo,
      linhas: linhasMostradas,
      patAlvo,
      totInvAlvo,
      totRendAlvo,
      rendaMensalAlvo,
      pctFire,
      progressoAtual,
    };
  }, [
    idadeAtual,
    idadeAlvo,
    gastosMensais,
    patrimonio,
    aporteMensal,
    retornoAnual,
    taxaRetirada,
    inflacaoAnual,
  ]);

  function limpar() {
    setIdadeAtual(0);
    setIdadeAlvo(0);
    setGastosMensais(0);
    setPatrimonio(0);
    setAporteMensal(0);
    setRetornoAnual(0);
    setTaxaRetirada(0);
    setInflacaoAnual(0);
    setPagina(0);
  }

  async function exportar() {
    const idadeFireStr =
      sim.idadeFire !== null ? `${fmtNum(sim.idadeFire, 1)} anos` : "Não atinge em 80 anos";
    const linhasAnuais = sim.linhas.filter((_, i) => i % 5 === 0 || i === sim.linhas.length - 1);
    await exportCalculadoraPDF({
      title: "Independência Financeira (FIRE)",
      subtitle: "Simulação em termos reais — descontada a inflação (equação de Fisher).",
      inputs: [
        { label: "Idade atual / alvo", value: `${idadeAtual} → ${idadeAlvo} anos` },
        { label: "Gastos mensais", value: fmtBRLCompact(gastosMensais) },
        { label: "Patrimônio inicial", value: fmtBRLCompact(patrimonio) },
        { label: "Aporte mensal", value: fmtBRLCompact(aporteMensal) },
        { label: "Retorno anual nominal", value: `${retornoAnual}%` },
        { label: "Inflação anual (IPCA)", value: `${inflacaoAnual}%` },
        { label: "Taxa de retirada", value: `${taxaRetirada}%` },
      ],
      kpis: [
        {
          label: "Número FIRE",
          value: fmtBRLCompact(sim.numeroFire),
          sub: "Patrimônio necessário",
          tone: "neutral",
        },
        {
          label: "Idade FIRE",
          value: idadeFireStr,
          sub: sim.atingeNoTempo ? "Atinge no tempo" : "Após a idade-alvo",
          tone: sim.atingeNoTempo ? "ok" : "warn",
        },
        {
          label: "Renda na idade-alvo",
          value: `${fmtBRLCompact(sim.rendaMensalAlvo)}/mês`,
          sub: `${fmtNum(sim.pctFire * 100, 0)}% do FIRE`,
          tone: sim.pctFire >= 1 ? "ok" : "warn",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Evolução do patrimônio (amostra de 5 em 5 anos)",
          head: ["Ano", "Idade", "Aporte ano", "Total investido", "Patrimônio"],
          body: linhasAnuais.map((l) => [
            l.ano,
            l.idade,
            fmtBRLCompact(l.aporteAno),
            fmtBRLCompact(l.totalInvestido),
            fmtBRLCompact(l.patrimonio),
          ]),
        },
      ],
    });
  }

  const chartData = sim.linhas.map((l) => ({
    idade: l.idade,
    Investido: Math.round(l.totalInvestido),
    Rendimentos: Math.round(Math.max(0, l.patrimonio - l.totalInvestido)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Flag className="h-5 w-5 text-primary" /> Independência Financeira (FIRE)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Descubra quanto patrimônio você precisa para viver de renda e quando vai chegar lá.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={exportar} title="Exportar PDF">
            <Download className="mr-2 h-4 w-4" /> Exportar PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={limpar}>
            <RotateCcw className="mr-2 h-4 w-4" /> Limpar
          </Button>
        </div>
      </div>

      {/* Inputs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Step n={1} /> Perfil pessoal
          </CardTitle>
          <CardDescription>Sua idade atual e idade-alvo para aposentadoria</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Idade atual">
            <SuffixInput value={idadeAtual} suffix="anos" onChange={setIdadeAtual} step={1} />
          </Field>
          <Field label="Idade-alvo para aposentadoria">
            <SuffixInput value={idadeAlvo} suffix="anos" onChange={setIdadeAlvo} step={1} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Step n={2} /> Gastos e patrimônio
          </CardTitle>
          <CardDescription>
            Despesas mensais, quanto já tem investido e aporte mensal
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field
            label="Gastos mensais"
            hint="Quanto gasta por mês (ou pretende gastar na aposentadoria)"
          >
            <MoneyInput value={gastosMensais} onChange={setGastosMensais} />
          </Field>
          <Field label="Patrimônio investido" hint="Opcional — pode começar do zero">
            <MoneyInput value={patrimonio} onChange={setPatrimonio} />
          </Field>
          <Field label="Aporte mensal">
            <MoneyInput value={aporteMensal} onChange={setAporteMensal} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Step n={3} /> Taxas
          </CardTitle>
          <CardDescription>
            Retorno anual esperado e taxa de retirada (regra dos 4%)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">Retorno anual esperado</Label>
            <div className="flex flex-wrap gap-2">
              {RETORNOS.map((r) => (
                <PresetButton
                  key={r.pct}
                  label={`${r.label} ${r.pct}%`}
                  active={retornoAnual === r.pct}
                  onClick={() => setRetornoAnual(r.pct)}
                />
              ))}
            </div>
            <SuffixInput
              value={retornoAnual}
              suffix="% a.a."
              onChange={setRetornoAnual}
              step={0.5}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Taxa de retirada anual</Label>
            <div className="flex flex-wrap gap-2">
              {RETIRADAS.map((r) => (
                <PresetButton
                  key={r.pct}
                  label={`${r.label} ${r.pct}%`}
                  active={taxaRetirada === r.pct}
                  onClick={() => setTaxaRetirada(r.pct)}
                />
              ))}
            </div>
            <SuffixInput value={taxaRetirada} suffix="%" onChange={setTaxaRetirada} step={0.5} />
            <p className="text-[11px] text-muted-foreground">
              A regra dos 4% sugere retirar 4% do patrimônio por ano
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label className="text-xs">Inflação anual esperada (IPCA)</Label>
            <SuffixInput
              value={inflacaoAnual}
              suffix="% a.a."
              onChange={setInflacaoAnual}
              step={0.5}
            />
            <p className="text-[11px] text-muted-foreground">
              A simulação roda em <strong>termos reais</strong> (poder de compra de hoje). Retorno
              real = (1+nominal)/(1+inflação)−1.
            </p>
          </div>
        </CardContent>
      </Card>

      {sim.numeroFire > 0 && (
        <>
          {/* Card destaque FIRE */}
          <Card
            className={
              sim.atingeNoTempo
                ? "border-2 border-emerald-500/40 bg-emerald-500/5"
                : "border-2 border-amber-500/40 bg-amber-500/5"
            }
          >
            <CardContent className="space-y-3 py-6 text-center">
              <Badge
                className={
                  sim.atingeNoTempo
                    ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                }
              >
                {sim.atingeNoTempo ? "Meta atingida no prazo" : "Meta não atingida a tempo"}
              </Badge>
              <p className="text-sm text-muted-foreground">Número FIRE (patrimônio necessário)</p>
              <p
                className={`text-4xl font-bold tracking-tight sm:text-5xl ${
                  sim.atingeNoTempo
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {fmtBRL(sim.numeroFire)}
              </p>
              {sim.idadeFire !== null ? (
                <p className="text-sm text-muted-foreground">
                  Você chega lá em{" "}
                  <strong className="text-foreground">
                    {Math.floor(sim.anosFracionarios!)} ano
                    {Math.floor(sim.anosFracionarios!) === 1 ? "" : "s"} e{" "}
                    {Math.round((sim.anosFracionarios! - Math.floor(sim.anosFracionarios!)) * 12)}{" "}
                    meses
                  </strong>{" "}
                  (aos {Math.round(sim.idadeFire)} anos)
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Com os parâmetros atuais, o patrimônio não atinge o Número FIRE em 80 anos.
                </p>
              )}

              {/* Progresso */}
              <div className="px-2 pt-2 sm:px-8">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progresso atual</span>
                  <span>{fmtPct(sim.progressoAtual)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={sim.atingeNoTempo ? "h-full bg-emerald-500" : "h-full bg-amber-500"}
                    style={{ width: `${Math.min(100, sim.progressoAtual * 100)}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            {sim.idadeFire !== null && sim.atingeNoTempo ? (
              <>Parabéns! Com esses parâmetros você atinge o FIRE antes da idade-alvo.</>
            ) : sim.idadeFire !== null ? (
              <>
                Você atingirá o FIRE aos{" "}
                <strong className="text-foreground">{Math.round(sim.idadeFire)}</strong> anos, mas
                sua meta era se aposentar antes. Aumente os aportes ou reduza os gastos para
                antecipar a independência.
              </>
            ) : (
              <>
                O patrimônio projetado não cobre o Número FIRE. Reavalie aportes, retorno esperado
                ou gastos.
              </>
            )}
          </p>

          {/* KPI grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Patrimônio projetado"
              value={fmtBRL(sim.patAlvo)}
              valueClass="text-primary"
              foot={`Na idade-alvo (${fmtPct(sim.pctFire)} do FIRE)`}
            />
            <KpiCard
              label="Renda mensal projetada"
              value={fmtBRL(sim.rendaMensalAlvo)}
              valueClass="text-primary"
              foot="Pela taxa de retirada na idade-alvo"
            />
            <KpiCard
              label="Total investido"
              value={fmtBRL(sim.totInvAlvo)}
              valueClass="text-emerald-700 dark:text-emerald-400"
              foot={
                <Badge variant="outline" className="text-[10px]">
                  Aportes acumulados
                </Badge>
              }
            />
            <KpiCard
              label="Total em rendimentos"
              value={fmtBRL(sim.totRendAlvo)}
              valueClass="text-primary"
              foot={
                <Badge variant="outline" className="text-[10px]">
                  Juros compostos
                </Badge>
              }
            />
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução do patrimônio por idade</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gFireInv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.7} />
                        <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="gFireRend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.7} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="idade"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "Idade",
                        position: "insideBottomRight",
                        offset: -2,
                        fontSize: 11,
                      }}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtBRLShort(v)} />
                    <Tooltip
                      formatter={(value: number) => fmtBRL(value)}
                      labelFormatter={(label) => `${label} anos`}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine
                      y={sim.numeroFire}
                      stroke="rgb(245 158 11)"
                      strokeDasharray="5 4"
                      label={{
                        value: "FIRE",
                        position: "right",
                        fill: "rgb(245 158 11)",
                        fontSize: 11,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Investido"
                      stackId="1"
                      stroke="rgb(16 185 129)"
                      fill="url(#gFireInv)"
                    />
                    <Area
                      type="monotone"
                      dataKey="Rendimentos"
                      stackId="1"
                      stroke="hsl(var(--primary))"
                      fill="url(#gFireRend)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Tabela anual */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução anual do patrimônio</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Ano</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Idade</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Aportes no ano
                    </TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Rendimento no ano
                    </TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Total investido
                    </TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Patrimônio
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sim.linhas.slice(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE).map((l) => (
                    <TableRow key={l.ano}>
                      <TableCell className="text-sm text-primary">{l.ano}</TableCell>
                      <TableCell className="text-sm">{l.idade} anos</TableCell>
                      <TableCell className="text-right text-sm">{fmtBRL(l.aporteAno)}</TableCell>
                      <TableCell className="text-right text-sm text-primary">
                        {fmtBRL(l.rendimentoAno)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {fmtBRL(l.totalInvestido)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {fmtBRL(l.patrimonio)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {sim.linhas.length > PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <button
                    onClick={() => setPagina(Math.max(0, pagina - 1))}
                    disabled={pagina === 0}
                    className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    {pagina + 1} / {Math.ceil(sim.linhas.length / PAGE_SIZE)}
                  </span>
                  <button
                    onClick={() =>
                      setPagina(Math.min(Math.ceil(sim.linhas.length / PAGE_SIZE) - 1, pagina + 1))
                    }
                    disabled={pagina >= Math.ceil(sim.linhas.length / PAGE_SIZE) - 1}
                    className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
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
              <p className="font-medium text-foreground">
                Como funciona a calculadora de independência financeira (FIRE)?
              </p>
              <p>
                O movimento <strong>FIRE</strong> (Financial Independence, Retire Early) se baseia
                em uma premissa simples: acumular patrimônio suficiente para viver dos rendimentos,
                sem depender de salário. O cálculo central é o <strong>Número FIRE</strong> — o
                patrimônio mínimo necessário para que a renda passiva cubra seus gastos mensais
                indefinidamente.
              </p>
              <p>
                A base teórica é o <strong>Trinity Study</strong> (1998), que analisou 75 anos de
                dados do mercado americano e concluiu que uma taxa de retirada de 4% ao ano preserva
                o patrimônio por pelo menos 30 anos com 95% de probabilidade. No Brasil, onde juros
                reais são historicamente maiores, a taxa segura pode variar entre 3,5% e 5% ao ano.
              </p>

              <p className="pt-2 font-medium text-foreground">Fórmula</p>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Número FIRE = Gasto Anual ÷ Taxa de Retirada Segura
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Número FIRE (regra dos 4%) = Gasto Mensal × 12 × 25
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Número FIRE (regra dos 3,5%) = Gasto Mensal × 12 ÷ 0,035 ≈ Gasto Mensal × 343
              </div>
              <p>Para estimar o tempo até FIRE:</p>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Anos = ln[(Número FIRE × r + Aporte anual) ÷ Aporte anual] ÷ ln(1 + r)
              </div>
              <p className="text-xs">
                Onde <code>r</code> = taxa real de retorno anual dos investimentos.
              </p>

              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Reduzir gastos tem efeito duplo:</strong> gastar R$ 1.000 a menos por
                    mês reduz o Número FIRE em R$ 300.000 E aumenta sua capacidade de aporte. É o
                    atalho mais poderoso para FIRE.
                  </li>
                  <li>
                    <strong>No Brasil, considere 3,5% como taxa segura:</strong> os 4% originais são
                    baseados no mercado americano. Com a volatilidade brasileira e inflação mais
                    alta, usar 3,5% dá margem de segurança adicional.
                  </li>
                  <li>
                    <strong>FIRE não significa parar de trabalhar:</strong> a maioria dos adeptos
                    busca liberdade para escolher trabalhos por prazer, não por necessidade. Renda
                    extra pós-FIRE (mesmo que pequena) reduz drasticamente o risco do patrimônio
                    acabar.
                  </li>
                  <li>
                    <strong>Diversifique entre classes de ativos:</strong> Tesouro IPCA+ para
                    proteção inflacionária, FIIs para renda passiva mensal, e ações para crescimento
                    de longo prazo. Uma carteira 100% em renda fixa pós-fixada pode não acompanhar a
                    inflação real no longo prazo.
                  </li>
                </ul>
              </div>
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

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
      {n}
    </span>
  );
}

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

function SuffixInput({
  value,
  suffix,
  step = 1,
  onChange,
}: {
  value: number;
  suffix: string;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="relative">
      <Input
        type="number"
        min={0}
        step={step}
        className="pr-20"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function KpiCard({
  label,
  value,
  valueClass,
  foot,
}: {
  label: string;
  value: string;
  valueClass?: string;
  foot?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold sm:text-2xl ${valueClass ?? "text-foreground"}`}>
          {value}
        </p>
        {foot && <div className="text-xs text-muted-foreground">{foot}</div>}
      </CardContent>
    </Card>
  );
}
