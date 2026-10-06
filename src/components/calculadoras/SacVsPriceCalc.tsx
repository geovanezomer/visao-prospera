/**
 * Calculadora SAC vs PRICE — simulador de financiamento.
 * Engine: src/lib/calculadoras/sacPrice.ts
 */
import { useMemo, useState } from "react";
import { Building2, Download, Info, RotateCcw } from "lucide-react";
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
import { simularSacPrice, type ResultadoSistema } from "@/engines/calculadoras/sacPrice";
import { fmtBRL } from "@/engines/finance/format";

const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const PRAZOS_RAPIDOS = [
  { label: "10 anos", meses: 120 },
  { label: "20 anos", meses: 240 },
  { label: "30 anos", meses: 360 },
  { label: "35 anos", meses: 420 },
];

const PAGE_SIZE = 12;

export function SacVsPriceCalc() {
  const [valor, setValor] = useState<number>(25000);
  const [taxaAnual, setTaxaAnual] = useState<number>(10);
  const [meses, setMeses] = useState<number>(360);
  const [tabela, setTabela] = useState<"sac" | "price">("sac");
  const [paginaSac, setPaginaSac] = useState(0);
  const [paginaPrice, setPaginaPrice] = useState(0);

  const sim = useMemo(() => {
    if (valor <= 0 || meses <= 0) return null;
    return simularSacPrice(valor, taxaAnual, meses);
  }, [valor, taxaAnual, meses]);

  function limpar() {
    setValor(0);
    setTaxaAnual(0);
    setMeses(0);
    setPaginaSac(0);
    setPaginaPrice(0);
  }

  async function exportar() {
    if (!sim) return;
    const fmtPct = (n: number) =>
      `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
    await exportCalculadoraPDF({
      title: "Simulador SAC vs PRICE",
      subtitle:
        "Comparação entre os dois sistemas de amortização mais usados em financiamentos no Brasil.",
      inputs: [
        { label: "Valor financiado", value: fmtBRL(valor) },
        {
          label: "Taxa de juros anual",
          value: `${taxaAnual}% a.a. (${fmtPct(sim.taxaMensal)} a.m.)`,
        },
        { label: "Prazo", value: `${meses} meses` },
        { label: "Sistema preferido", value: tabela.toUpperCase() },
      ],
      kpis: [
        {
          label: "Economia de juros (SAC vs PRICE)",
          value: fmtBRL(sim.economiaJurosSac),
          sub: "SAC paga menos juros no total",
          tone: "ok",
        },
        {
          label: "Total pago — SAC",
          value: fmtBRL(sim.sac.totalPago),
          sub: `Juros: ${fmtBRL(sim.sac.totalJuros)}`,
          tone: "neutral",
        },
        {
          label: "Total pago — PRICE",
          value: fmtBRL(sim.price.totalPago),
          sub: `Juros: ${fmtBRL(sim.price.totalJuros)}`,
          tone: "neutral",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Resumo dos sistemas",
          head: ["Indicador", "SAC", "PRICE"],
          body: [
            ["1ª parcela", fmtBRL(sim.sac.primeiraParcela), fmtBRL(sim.price.primeiraParcela)],
            ["Última parcela", fmtBRL(sim.sac.ultimaParcela), fmtBRL(sim.price.ultimaParcela)],
            ["Total de juros", fmtBRL(sim.sac.totalJuros), fmtBRL(sim.price.totalJuros)],
            ["Total pago", fmtBRL(sim.sac.totalPago), fmtBRL(sim.price.totalPago)],
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
            <Building2 className="h-5 w-5 text-primary" /> Simulador SAC vs PRICE
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare os dois sistemas de amortização mais usados no Brasil.
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
              <Step n={1} /> Valor do Financiamento
            </CardTitle>
            <CardDescription>Quanto deseja financiar</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Valor financiado">
              <MoneyInput value={valor} onChange={setValor} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={2} /> Taxa e Prazo
            </CardTitle>
            <CardDescription>Juros anuais e prazo em meses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Taxa de juros (% a.a.)">
              <SuffixInput value={taxaAnual} suffix="% a.a." step={0.1} onChange={setTaxaAnual} />
            </Field>
            <Field label="Prazo (meses)">
              <SuffixInput
                value={meses}
                suffix="meses"
                step={12}
                onChange={(v) => setMeses(Math.round(v))}
              />
            </Field>
            <div className="flex flex-wrap gap-2 pt-1">
              {PRAZOS_RAPIDOS.map((p) => (
                <button
                  key={p.meses}
                  onClick={() => setMeses(p.meses)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    meses === p.meses
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-primary/30 text-primary hover:bg-primary/10"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {sim && (
        <>
          {/* Card destaque comparativo */}
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardContent className="space-y-5 py-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Financiamento de <strong className="text-foreground">{fmtBRL(valor)}</strong> em{" "}
                  <strong className="text-foreground">{meses} meses</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Taxa: {taxaAnual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% a.a. (
                  {fmtPct(sim.taxaMensal)} a.m.)
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="text-center">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    SAC
                  </p>
                  <p className="mt-1 text-3xl font-bold text-emerald-700 dark:text-emerald-400 sm:text-4xl">
                    {fmtBRL(sim.sac.totalPago)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    juros: {fmtBRL(sim.sac.totalJuros)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">PRICE</p>
                  <p className="mt-1 text-3xl font-bold text-primary sm:text-4xl">
                    {fmtBRL(sim.price.totalPago)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    juros: {fmtBRL(sim.price.totalJuros)}
                  </p>
                </div>
              </div>

              {/* Barras de juros */}
              <div className="space-y-3">
                <BarraJuros
                  label="SAC - juros"
                  valor={sim.sac.totalJuros}
                  total={sim.sac.totalPago}
                  color="bg-emerald-500"
                />
                <BarraJuros
                  label="PRICE - juros"
                  valor={sim.price.totalJuros}
                  total={sim.price.totalPago}
                  color="bg-primary"
                />
              </div>
            </CardContent>
          </Card>

          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            No sistema <strong className="text-foreground">SAC</strong>, você economiza{" "}
            <strong className="text-emerald-700 dark:text-emerald-400">
              {fmtBRL(sim.economiaJurosSac)}
            </strong>{" "}
            em juros comparado ao PRICE. Porém, as primeiras parcelas do SAC são mais altas (
            {fmtBRL(sim.sac.primeiraParcela)} vs {fmtBRL(sim.price.primeiraParcela)}).
          </p>

          {/* Resumo por sistema */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ResumoSistema titulo="Sistema SAC" cor="emerald" sistema={sim.sac} />
            <ResumoSistema titulo="Sistema PRICE" cor="primary" sistema={sim.price} />
          </div>

          {/* Economia destaque */}
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm text-foreground">Economia de juros no SAC vs PRICE</p>
              <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
                {fmtBRL(sim.economiaJurosSac)}
              </Badge>
            </CardContent>
          </Card>

          {/* Toggle tabela */}
          <div className="flex justify-center gap-2">
            <button
              onClick={() => setTabela("sac")}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                tabela === "sac"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              Tabela SAC
            </button>
            <button
              onClick={() => setTabela("price")}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                tabela === "price"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              Tabela PRICE
            </button>
          </div>

          {tabela === "sac" ? (
            <TabelaAmortizacao
              titulo="Tabela de amortização — SAC"
              sistema={sim.sac}
              pagina={paginaSac}
              setPagina={setPaginaSac}
            />
          ) : (
            <TabelaAmortizacao
              titulo="Tabela de amortização — PRICE"
              sistema={sim.price}
              pagina={paginaPrice}
              setPagina={setPaginaPrice}
            />
          )}
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
                Como funciona o simulador de financiamento (SAC vs PRICE)?
              </p>
              <p>
                No Brasil, os dois sistemas de amortização mais usados em financiamentos
                imobiliários e de veículos são o<strong> SAC</strong> (Sistema de Amortização
                Constante) e a <strong>Tabela PRICE</strong> (Sistema Francês de Amortização). A
                diferença fundamental está na composição das parcelas ao longo do tempo.
              </p>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  <strong>SAC:</strong> a amortização (parte que reduz o saldo devedor) é constante
                  em todas as parcelas. Como os juros incidem sobre o saldo devedor (que diminui a
                  cada mês), as parcelas começam maiores e vão diminuindo. É o mais usado em
                  financiamentos imobiliários no Brasil.
                </li>
                <li>
                  <strong>PRICE:</strong> a parcela total é fixa durante todo o contrato. No início,
                  a maior parte da parcela são juros; com o tempo, a proporção se inverte. É o
                  sistema padrão para financiamento de veículos e empréstimos pessoais.
                </li>
              </ul>

              <p className="pt-2 font-medium text-foreground">Fórmula</p>
              <p className="font-medium text-foreground">SAC:</p>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Amortização<sub>mensal</sub> = Valor financiado ÷ Número de parcelas
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Juros do mês = Saldo devedor × Taxa mensal
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Parcela = Amortização + Juros
              </div>
              <p className="font-medium text-foreground">PRICE:</p>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Parcela fixa = Valor financiado × [i × (1+i)<sup>n</sup>] ÷ [(1+i)<sup>n</sup> − 1]
              </div>
              <p className="text-xs">
                Onde <code>i</code> = taxa mensal e <code>n</code> = número de parcelas.
              </p>

              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>SAC é quase sempre mais barato:</strong> por amortizar mais rápido, o
                    SAC reduz o saldo devedor mais cedo e gera menos juros no total. Prefira SAC
                    sempre que a primeira parcela (mais alta) couber no orçamento.
                  </li>
                  <li>
                    <strong>Comprometimento máximo de 30% da renda:</strong> bancos aprovam até 30%
                    da renda bruta familiar para a parcela. Mas considere usar no máximo 25% da
                    renda líquida — imprevistos acontecem e você precisa de folga no orçamento.
                  </li>
                  <li>
                    <strong>Amortize com o FGTS a cada 2 anos:</strong> trabalhadores CLT podem usar
                    o FGTS para amortizar o saldo devedor do financiamento imobiliário a cada 2
                    anos. Reduzir o saldo devedor antecipadamente é a forma mais eficiente de
                    economizar juros.
                  </li>
                  <li>
                    <strong>Compare o CET, não apenas a taxa:</strong> o Custo Efetivo Total (CET)
                    inclui seguros obrigatórios, taxas de administração e avaliação. Dois bancos com
                    a mesma taxa nominal podem ter CETs muito diferentes.
                  </li>
                </ul>
              </div>
              <p className="pt-2 text-xs">
                Bases: Resolução CMN 4.676/2018 (SFH/SFI), normas Banco Central sobre CET (Resolução
                CMN 3.517/2007).
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
        step={1000}
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

function BarraJuros({
  label,
  valor,
  total,
  color,
}: {
  label: string;
  valor: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% do total
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ResumoSistema({
  titulo,
  cor,
  sistema,
}: {
  titulo: string;
  cor: "emerald" | "primary";
  sistema: ResultadoSistema;
}) {
  const colorClass = cor === "emerald" ? "text-emerald-700 dark:text-emerald-400" : "text-primary";
  return (
    <Card>
      <CardHeader>
        <CardTitle className={`text-base ${colorClass}`}>{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Primeira parcela</span>
          <span className="font-medium text-foreground">{fmtBRL(sistema.primeiraParcela)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Última parcela</span>
          <span className="font-medium text-foreground">{fmtBRL(sistema.ultimaParcela)}</span>
        </div>
        <div className="border-t pt-2" />
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total pago</span>
          <span className="font-semibold text-foreground">{fmtBRL(sistema.totalPago)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total em juros</span>
          <span className="font-semibold text-destructive">{fmtBRL(sistema.totalJuros)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TabelaAmortizacao({
  titulo,
  sistema,
  pagina,
  setPagina,
}: {
  titulo: string;
  sistema: ResultadoSistema;
  pagina: number;
  setPagina: (n: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(sistema.parcelas.length / PAGE_SIZE));
  const inicio = pagina * PAGE_SIZE;
  const linhas = sistema.parcelas.slice(inicio, inicio + PAGE_SIZE);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Mês</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Prestação
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Amortização
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">Juros</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Saldo devedor
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.mes}>
                <TableCell className="text-sm text-primary">{l.mes}</TableCell>
                <TableCell className="text-right text-sm font-medium">
                  {fmtBRL(l.parcela)}
                </TableCell>
                <TableCell className="text-right text-sm text-emerald-600 dark:text-emerald-500">
                  {fmtBRL(l.amortizacao)}
                </TableCell>
                <TableCell className="text-right text-sm text-primary">{fmtBRL(l.juros)}</TableCell>
                <TableCell className="text-right text-sm">{fmtBRL(l.saldoDevedor)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <button
            onClick={() => setPagina(Math.max(0, pagina - 1))}
            disabled={pagina === 0}
            className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            {pagina + 1} / {totalPaginas}
          </span>
          <button
            onClick={() => setPagina(Math.min(totalPaginas - 1, pagina + 1))}
            disabled={pagina >= totalPaginas - 1}
            className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
