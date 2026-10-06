/**
 * Calculadora de Juros Compostos com aportes mensais.
 *
 * Fórmula:
 *   M = VP × (1 + i)^n + PMT × [(1 + i)^n − 1] ÷ i
 * Onde:
 *   VP  = valor presente (capital inicial)
 *   PMT = aporte mensal
 *   i   = taxa mensal (decimal)
 *   n   = número de meses
 *
 * Conversão taxa anual → mensal: i_mensal = (1 + i_anual)^(1/12) − 1.
 */
import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Info, RotateCcw, TrendingUp } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtBRL } from "@/engines/finance/format";

const fmtBRLShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return Math.round(n).toString();
};
const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const PAGE_SIZE = 12;

type Linha = {
  mes: number;
  jurosMes: number;
  jurosTotais: number;
  totalInvestido: number;
  totalAcumulado: number;
};

export function JurosCompostosCalc() {
  const [valorInicial, setValorInicial] = useState<number>(100000);
  const [aporteMensal, setAporteMensal] = useState<number>(1000);
  const [taxa, setTaxa] = useState<number>(8);
  const [taxaTipo, setTaxaTipo] = useState<"anual" | "mensal">("anual");
  const [periodo, setPeriodo] = useState<number>(1);
  const [periodoTipo, setPeriodoTipo] = useState<"anos" | "meses">("anos");
  const [pagina, setPagina] = useState(0);

  const sim = useMemo(() => {
    const meses = periodoTipo === "anos" ? Math.round(periodo * 12) : Math.round(periodo);
    if (meses <= 0) return null;
    const i = taxaTipo === "anual" ? Math.pow(1 + taxa / 100, 1 / 12) - 1 : taxa / 100;
    let saldo = valorInicial;
    let jurosAcum = 0;
    const linhas: Linha[] = [];
    for (let m = 1; m <= meses; m++) {
      const jurosMes = saldo * i;
      saldo = saldo + jurosMes + aporteMensal;
      jurosAcum += jurosMes;
      const totalInvestido = valorInicial + aporteMensal * m;
      linhas.push({
        mes: m,
        jurosMes,
        jurosTotais: jurosAcum,
        totalInvestido,
        totalAcumulado: saldo,
      });
    }
    const last = linhas[linhas.length - 1];
    const totalInvestido = last.totalInvestido;
    const totalJuros = last.jurosTotais;
    const totalFinal = last.totalAcumulado;
    const pctInvestido = totalFinal > 0 ? totalInvestido / totalFinal : 0;
    const pctJuros = totalFinal > 0 ? totalJuros / totalFinal : 0;
    const multiplicador = totalInvestido > 0 ? totalFinal / totalInvestido : 0;
    return {
      i,
      meses,
      linhas,
      totalInvestido,
      totalJuros,
      totalFinal,
      pctInvestido,
      pctJuros,
      multiplicador,
    };
  }, [valorInicial, aporteMensal, taxa, taxaTipo, periodo, periodoTipo]);

  function limpar() {
    setValorInicial(0);
    setAporteMensal(0);
    setTaxa(0);
    setPeriodo(0);
    setPagina(0);
  }

  async function exportar() {
    if (!sim) return;
    const taxaLabel = `${taxa}% ${taxaTipo}`;
    const periodoLabel = periodoTipo === "anos" ? `${periodo} ano(s)` : `${periodo} mês(es)`;
    // Amostra anual para a tabela.
    const linhasAnuais = sim.linhas.filter((l) => l.mes % 12 === 0 || l.mes === sim.linhas.length);
    await exportCalculadoraPDF({
      title: "Juros Compostos",
      subtitle: "Simulação de evolução de patrimônio com aportes mensais.",
      inputs: [
        { label: "Capital inicial", value: fmtBRL(valorInicial) },
        { label: "Aporte mensal", value: fmtBRL(aporteMensal) },
        { label: "Taxa de juros", value: taxaLabel },
        { label: "Período", value: periodoLabel },
      ],
      kpis: [
        {
          label: "Valor final",
          value: fmtBRL(sim.totalFinal),
          sub: `${sim.multiplicador.toFixed(1)}× o investido`,
          tone: "ok",
        },
        {
          label: "Total investido",
          value: fmtBRL(sim.totalInvestido),
          sub: fmtPct(sim.pctInvestido),
          tone: "neutral",
        },
        {
          label: "Total em juros",
          value: fmtBRL(sim.totalJuros),
          sub: fmtPct(sim.pctJuros),
          tone: "ok",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Evolução anual",
          head: ["Mês", "Juros no mês", "Juros totais", "Total investido", "Total acumulado"],
          body: linhasAnuais.map((l) => [
            l.mes,
            fmtBRL(l.jurosMes),
            fmtBRL(l.jurosTotais),
            fmtBRL(l.totalInvestido),
            fmtBRL(l.totalAcumulado),
          ]),
        },
      ],
    });
  }

  const periodoLabel =
    periodoTipo === "anos"
      ? `${periodo} ano${periodo === 1 ? "" : "s"}`
      : `${periodo} mes${periodo === 1 ? "" : "es"}`;

  // Para gráfico, amostrar até ~60 pontos para legibilidade
  const chartData = useMemo(() => {
    if (!sim) return [];
    const step = Math.max(1, Math.ceil(sim.linhas.length / 60));
    return sim.linhas
      .filter((_, idx) => idx === 0 || (idx + 1) % step === 0 || idx === sim.linhas.length - 1)
      .map((l) => ({
        mes: l.mes,
        Investido: Math.round(l.totalInvestido),
        Juros: Math.round(l.jurosTotais),
      }));
  }, [sim]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <TrendingUp className="h-5 w-5 text-primary" /> Juros Compostos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Simule a evolução do seu patrimônio com aportes mensais e juros compostos.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={exportar} title="Exportar PDF" disabled={!sim}>
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
              <Step n={1} /> Valores
            </CardTitle>
            <CardDescription>Capital inicial e aportes mensais</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Valor inicial">
              <MoneyInput value={valorInicial} onChange={setValorInicial} />
            </Field>
            <Field label="Aporte mensal">
              <MoneyInput value={aporteMensal} onChange={setAporteMensal} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={2} /> Taxa e Período
            </CardTitle>
            <CardDescription>Juros e tempo de investimento</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Taxa de juros">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    className="pr-8"
                    value={taxa || ""}
                    onChange={(e) => setTaxa(Number(e.target.value) || 0)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    %
                  </span>
                </div>
                <Select
                  value={taxaTipo}
                  onValueChange={(v) => setTaxaTipo(v as "anual" | "mensal")}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anual">anual</SelectItem>
                    <SelectItem value="mensal">mensal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field label="Período">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={periodo || ""}
                  onChange={(e) => setPeriodo(Number(e.target.value) || 0)}
                />
                <Select
                  value={periodoTipo}
                  onValueChange={(v) => setPeriodoTipo(v as "anos" | "meses")}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anos">ano(s)</SelectItem>
                    <SelectItem value="meses">mês(es)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Field>
          </CardContent>
        </Card>
      </div>

      {sim && (
        <>
          {/* Card destaque */}
          <Card className="border-2 border-emerald-500/40 bg-emerald-500/5">
            <CardContent className="space-y-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">Valor total final</p>
              <p className="text-4xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400 sm:text-5xl">
                {fmtBRL(sim.totalFinal)}
              </p>
              <p className="text-sm text-muted-foreground">em {periodoLabel}</p>

              <div className="px-2 sm:px-8">
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  <div className="bg-emerald-500" style={{ width: `${sim.pctInvestido * 100}%` }} />
                  <div className="bg-primary" style={{ width: `${sim.pctJuros * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-xs">
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Investido {fmtPct(sim.pctInvestido)}
                  </span>
                  <span className="text-primary">Juros {fmtPct(sim.pctJuros)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            Com mais tempo, os juros compostos ganham força. Considere aumentar o prazo para ver o
            efeito exponencial.
          </p>

          {/* Cards laterais */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs font-medium text-muted-foreground">Total investido</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {fmtBRL(sim.totalInvestido)}
                </p>
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                >
                  {fmtPct(sim.pctInvestido)} do total
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs font-medium text-muted-foreground">Total em juros</p>
                <p className="text-2xl font-bold text-primary">{fmtBRL(sim.totalJuros)}</p>
                <Badge variant="outline" className="border-primary/30 text-primary">
                  {fmtPct(sim.pctJuros)} do total
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-4">
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="none"
                      stroke="rgb(16 185 129)"
                      strokeWidth="3"
                      strokeDasharray={`${sim.pctInvestido * 100} ${100 - sim.pctInvestido * 100}`}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <p className="text-xs text-muted-foreground">
                  {sim.multiplicador.toFixed(1)}x o investido
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução do patrimônio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="gJur" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="mes"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "Mês",
                        position: "insideBottomRight",
                        offset: -2,
                        fontSize: 11,
                      }}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtBRLShort(v)} />
                    <Tooltip
                      formatter={(value: number) => fmtBRL(value)}
                      labelFormatter={(label) => `Mês ${label}`}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="Investido"
                      stackId="1"
                      stroke="rgb(16 185 129)"
                      fill="url(#gInv)"
                    />
                    <Area
                      type="monotone"
                      dataKey="Juros"
                      stackId="1"
                      stroke="hsl(var(--primary))"
                      fill="url(#gJur)"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Tabela mensal */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tabela mensal</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Mês</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Juros no mês
                    </TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Juros totais
                    </TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Total investido
                    </TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider">
                      Total acumulado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sim.linhas.slice(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE).map((l) => (
                    <TableRow key={l.mes}>
                      <TableCell className="text-sm text-primary">{l.mes}</TableCell>
                      <TableCell className="text-right text-sm text-primary">
                        {fmtBRL(l.jurosMes)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-primary">
                        {fmtBRL(l.jurosTotais)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {fmtBRL(l.totalInvestido)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {fmtBRL(l.totalAcumulado)}
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
                Como funcionam os juros compostos com aportes mensais?
              </p>
              <p>
                Os juros compostos são o princípio fundamental da riqueza acumulada: o rendimento de
                cada período é somado ao capital e também passa a render nos períodos seguintes.
                Diferentemente dos juros simples, onde a base de cálculo é sempre o capital inicial,
                nos juros compostos o montante cresce de forma exponencial — o que Albert Einstein
                teria chamado de "a oitava maravilha do mundo".
              </p>
              <p>
                Com aportes mensais regulares, o efeito se amplifica: cada aporte também começa a
                render compostos a partir do momento em que é feito. A fórmula combina o crescimento
                do capital inicial (VP) com a soma geométrica dos aportes mensais (PMT). O fator
                tempo é o mais importante — aportar R$ 500/mês por 30 anos gera um patrimônio muito
                maior do que R$ 1.500/mês por 10 anos, mesmo com o mesmo total investido.
              </p>

              <p className="pt-2 font-medium text-foreground">Fórmula</p>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                M = VP × (1 + i)<sup>n</sup> + PMT × [(1 + i)<sup>n</sup> − 1] ÷ i
              </div>
              <p className="font-medium text-foreground">Onde:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>VP = valor presente (capital inicial)</li>
                <li>PMT = aporte mensal</li>
                <li>i = taxa de juros mensal</li>
                <li>n = número de meses</li>
              </ul>
              <p>
                Taxa mensal equivalente: <code>i_mensal = (1 + i_anual)^(1/12) − 1</code>
              </p>

              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Comece cedo, mesmo com pouco:</strong> R$ 200/mês começando aos 25 anos
                    gera mais patrimônio do que R$ 500/mês a partir dos 35, mesmo que o segundo
                    invista mais dinheiro no total.
                  </li>
                  <li>
                    <strong>Reinvista sempre os rendimentos:</strong> se você recebe rendimentos e
                    gasta, está quebrando o efeito dos juros compostos. Reinvestir automaticamente
                    (como em ETFs ou CDBs de longo prazo) é a forma mais eficiente.
                  </li>
                  <li>
                    <strong>Inflação corrói o real:</strong> a taxa de 14,9% a.a. (CDI) parece alta,
                    mas com IPCA em ~5%, o ganho real é ~9,4%. Use a taxa real para cálculos de
                    longo prazo: <code>i_real = (1 + i_nominal) ÷ (1 + inflação) − 1</code>.
                  </li>
                  <li>
                    <strong>Aumente o aporte com a renda:</strong> ao receber um aumento de R$
                    500/mês, direcione R$ 200–300 para investimentos antes de elevar seu padrão de
                    vida. Pequenas mudanças no aporte têm impacto enorme em 20–30 anos.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
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
