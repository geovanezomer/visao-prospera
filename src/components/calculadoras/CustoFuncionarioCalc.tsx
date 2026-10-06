/**
 * Calculadora de Custo Real de Funcionário CLT.
 * Lê o regime tributário do estado global e permite override manual.
 * Cálculo 100% reativo via useMemo — sem botão "Calcular".
 */
import { useMemo, useState } from "react";
import { Calculator, Download, Info, RotateCcw, Sparkles } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppState } from "@/engines/finance/store";
import {
  calcularCustoFuncionario,
  labelRegime,
  type GrauRAT,
  type RegimeEmpresa,
} from "@/engines/calculadoras/custoFuncionario";
import { fmtBRL } from "@/engines/finance/format";

const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const DEFAULT_VT = 0;
const DEFAULT_SALARIO = 4800;

export function CustoFuncionarioCalc() {
  const { state } = useAppState();
  const regimeDoPlano = state.tax.regime as RegimeEmpresa;

  // ----- Inputs -----
  const [salarioBruto, setSalarioBruto] = useState<number>(DEFAULT_SALARIO);
  const [regime, setRegime] = useState<RegimeEmpresa>(regimeDoPlano);
  const [grauRAT, setGrauRAT] = useState<GrauRAT>(1);
  const [aliquotaTerceiros, setAliquotaTerceiros] = useState<number>(5.8);
  const [simplesAnexoIV, setSimplesAnexoIV] = useState(false);

  const [vtAtivo, setVtAtivo] = useState(false);
  const [vtCusto, setVtCusto] = useState<number>(DEFAULT_VT);
  const [vr, setVr] = useState<number>(0);
  const [planoSaude, setPlanoSaude] = useState<number>(0);
  const [outros, setOutros] = useState<number>(0);

  const regimeSobrescrito = regime !== regimeDoPlano;

  // ----- Cálculo reativo -----
  const resultado = useMemo(() => {
    try {
      return calcularCustoFuncionario({
        salarioBruto,
        regime,
        simplesAnexoIV,
        grauRAT,
        aliquotaTerceiros: aliquotaTerceiros / 100,
        beneficios: {
          vt: { ativo: vtAtivo, custoMensal: vtCusto },
          vr,
          planoSaude,
          outros,
        },
      });
    } catch {
      return null;
    }
  }, [
    salarioBruto,
    regime,
    simplesAnexoIV,
    grauRAT,
    aliquotaTerceiros,
    vtAtivo,
    vtCusto,
    vr,
    planoSaude,
    outros,
  ]);

  function limpar() {
    setSalarioBruto(DEFAULT_SALARIO);
    setRegime(regimeDoPlano);
    setGrauRAT(1);
    setAliquotaTerceiros(5.8);
    setSimplesAnexoIV(false);
    setVtAtivo(false);
    setVtCusto(0);
    setVr(0);
    setPlanoSaude(0);
    setOutros(0);
  }

  async function exportar() {
    if (!resultado) return;
    await exportCalculadoraPDF({
      title: "Custo Real do Funcionário CLT",
      subtitle: "Custo de contratação considerando salário, encargos, provisões e benefícios.",
      inputs: [
        { label: "Salário bruto", value: fmtBRL(salarioBruto) },
        { label: "Regime", value: regime.toUpperCase() },
        { label: "Grau RAT", value: String(grauRAT) },
        { label: "Alíquota Terceiros", value: `${aliquotaTerceiros.toFixed(2)}%` },
        { label: "VT (custo empresa)", value: vtAtivo ? fmtBRL(vtCusto) : "—" },
        {
          label: "VR / Plano Saúde / Outros",
          value: `${fmtBRL(vr)} / ${fmtBRL(planoSaude)} / ${fmtBRL(outros)}`,
        },
      ],
      kpis: [
        {
          label: "Custo mensal total",
          value: fmtBRL(resultado.custoMensalTotal),
          sub: `${resultado.fatorMultiplicador.toFixed(2).replace(".", ",")}× o salário bruto`,
          tone: "warn",
        },
        {
          label: "Custo anual total",
          value: fmtBRL(resultado.custoAnualTotal),
          sub: "12 meses + provisões",
          tone: "warn",
        },
        {
          label: "Encargos + Provisões",
          value: fmtBRL(resultado.encargos.total + resultado.provisoes.total),
          sub: fmtPct(
            (resultado.encargos.total + resultado.provisoes.total) /
              Math.max(1, resultado.salarioBruto),
          ),
          tone: "neutral",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Encargos mensais",
          head: ["Item", "Valor"],
          body: resultado.encargos.itens.map((it) => [it.rotulo, fmtBRL(it.valor)]),
        },
        {
          kind: "table",
          title: "Provisões mensais",
          head: ["Item", "Valor"],
          body: resultado.provisoes.itens.map((it) => [it.rotulo, fmtBRL(it.valor)]),
        },
      ],
    });
  }

  return (
    <div className="space-y-6">
      {/* Header da calculadora */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Calculator className="h-5 w-5 text-primary" /> Custo Real de Funcionário CLT
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Calcule o custo efetivo de contratação considerando encargos, provisões e benefícios.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={exportar}
            title="Exportar PDF"
            disabled={!resultado}
          >
            <Download className="mr-2 h-4 w-4" /> Exportar PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={limpar}>
            <RotateCcw className="mr-2 h-4 w-4" /> Limpar
          </Button>
        </div>
      </div>

      {/* Inputs em 2 colunas */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Remuneração */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                1
              </span>
              Remuneração
            </CardTitle>
            <CardDescription>Salário bruto e regime tributário da empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="salario">Salário Bruto</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  R$
                </span>
                <Input
                  id="salario"
                  type="number"
                  min={0}
                  step={100}
                  className="pl-10"
                  value={salarioBruto || ""}
                  onChange={(e) => setSalarioBruto(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Regime da Empresa</Label>
                {regimeSobrescrito ? (
                  <button
                    onClick={() => setRegime(regimeDoPlano)}
                    className="text-xs text-primary hover:underline"
                  >
                    Voltar ao do plano
                  </button>
                ) : (
                  <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                    <Sparkles className="h-3 w-3" /> do seu plano
                  </Badge>
                )}
              </div>
              <Select value={regime} onValueChange={(v) => setRegime(v as RegimeEmpresa)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simples">Simples Nacional</SelectItem>
                  <SelectItem value="presumido">Lucro Presumido</SelectItem>
                  <SelectItem value="real">Lucro Real</SelectItem>
                </SelectContent>
              </Select>
              {regime === "simples" && (
                <p className="text-xs text-muted-foreground">
                  No Simples Nacional o INSS patronal e os Terceiros estão inclusos no DAS (exceto
                  Anexo IV).
                </p>
              )}
            </div>

            {regime === "simples" && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={simplesAnexoIV}
                  onCheckedChange={(c) => setSimplesAnexoIV(c === true)}
                  className="mt-0.5"
                />
                <span>
                  Empresa enquadrada no <strong>Anexo IV</strong> (INSS patronal devido à parte)
                </span>
              </label>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rat" className="text-xs">
                  Grau de Risco (RAT)
                </Label>
                <Select
                  value={String(grauRAT)}
                  onValueChange={(v) => setGrauRAT(Number(v) as GrauRAT)}
                >
                  <SelectTrigger id="rat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Leve (1%)</SelectItem>
                    <SelectItem value="2">Médio (2%)</SelectItem>
                    <SelectItem value="3">Grave (3%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="terceiros" className="text-xs">
                  Terceiros (% — varia por CNAE)
                </Label>
                <Input
                  id="terceiros"
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={aliquotaTerceiros}
                  onChange={(e) => setAliquotaTerceiros(Number(e.target.value) || 0)}
                  disabled={regime === "simples" && !simplesAnexoIV}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Benefícios */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                2
              </span>
              Benefícios
            </CardTitle>
            <CardDescription>Benefícios mensais pagos pela empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <Checkbox checked={vtAtivo} onCheckedChange={(c) => setVtAtivo(c === true)} />
                <span className="text-sm font-medium">Vale-Transporte</span>
              </label>
              {vtAtivo && (
                <div className="space-y-1 pl-6">
                  <Label htmlFor="vt" className="text-xs text-muted-foreground">
                    Custo mensal do VT
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="vt"
                      type="number"
                      min={0}
                      step={10}
                      className="pl-10"
                      value={vtCusto || ""}
                      onChange={(e) => setVtCusto(Number(e.target.value) || 0)}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Funcionário paga até 6% do salário; empresa cobre o excedente (Lei 7.418/85).
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="vr" className="text-xs">
                Vale-Refeição / Alimentação
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  R$
                </span>
                <Input
                  id="vr"
                  type="number"
                  min={0}
                  step={10}
                  className="pl-10"
                  value={vr || ""}
                  onChange={(e) => setVr(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="saude" className="text-xs">
                Plano de Saúde
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  R$
                </span>
                <Input
                  id="saude"
                  type="number"
                  min={0}
                  step={10}
                  className="pl-10"
                  value={planoSaude || ""}
                  onChange={(e) => setPlanoSaude(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="outros" className="text-xs">
                Outros Benefícios
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  R$
                </span>
                <Input
                  id="outros"
                  type="number"
                  min={0}
                  step={10}
                  className="pl-10"
                  value={outros || ""}
                  onChange={(e) => setOutros(Number(e.target.value) || 0)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resultado destaque */}
      {resultado && resultado.salarioBruto > 0 && (
        <>
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
            <CardContent className="py-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Custo Mensal Total
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                {fmtBRL(resultado.custoMensalTotal)}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-primary">
                  {resultado.fatorMultiplicador.toFixed(2).replace(".", ",")}× o salário bruto
                </span>
                <span>•</span>
                <Badge variant="outline">{labelRegime(resultado.regime)}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Salário bruto: {fmtBRL(resultado.salarioBruto)}
              </p>
            </CardContent>
          </Card>

          {/* Cards-resumo */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ResumoCard
              rotulo="Encargos Patronais"
              valor={resultado.encargos.total}
              pct={resultado.encargos.total / resultado.salarioBruto}
              tone="destructive"
              sub="Sobre o salário"
            />
            <ResumoCard
              rotulo="Provisões Mensais"
              valor={resultado.provisoes.total}
              pct={resultado.provisoes.total / resultado.salarioBruto}
              tone="warning"
              sub="13º, férias e FGTS"
            />
            <ResumoCard
              rotulo="Benefícios"
              valor={resultado.beneficios.total}
              tone="primary"
              sub="VT, VR, saúde e outros"
            />
            <ResumoCard
              rotulo="Custo Anual"
              valor={resultado.custoAnualTotal}
              tone="foreground"
              sub="× 12 meses"
            />
          </div>

          {/* Detalhamento — cards separados */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Encargos Patronais — detalhamento</CardTitle>
            </CardHeader>
            <CardContent>
              <DetalheTable linhas={resultado.encargos.itens} total={resultado.encargos.total} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Provisões Mensais — detalhamento</CardTitle>
            </CardHeader>
            <CardContent>
              <DetalheTable linhas={resultado.provisoes.itens} total={resultado.provisoes.total} />
            </CardContent>
          </Card>

          {resultado.beneficios.itens.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Benefícios — detalhamento</CardTitle>
              </CardHeader>
              <CardContent>
                <DetalheTable
                  linhas={resultado.beneficios.itens}
                  total={resultado.beneficios.total}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Resumo do Custo Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-sm">
                <LinhaResumo rotulo="Salário Bruto" valor={resultado.salarioBruto} />
                <LinhaResumo
                  rotulo="(+) Encargos Patronais"
                  valor={resultado.encargos.total}
                  tone="destructive"
                />
                <LinhaResumo
                  rotulo="(+) Provisões Mensais"
                  valor={resultado.provisoes.total}
                  tone="warning"
                />
                {resultado.beneficios.total > 0 && (
                  <LinhaResumo
                    rotulo="(+) Benefícios"
                    valor={resultado.beneficios.total}
                    tone="primary"
                  />
                )}
                <Separator className="my-2" />
                <LinhaResumo
                  rotulo="Custo Mensal Total"
                  valor={resultado.custoMensalTotal}
                  bold
                  tone="primary"
                />
                <LinhaResumo
                  rotulo="Custo Anual Total (× 12)"
                  valor={resultado.custoAnualTotal}
                  bold
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Entenda a calculadora */}
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
                Contratar via CLT custa muito mais que o salário combinado. O empregador arca com
                encargos previdenciários (INSS patronal 20% + RAT 1–3% + Terceiros ~5,8%), FGTS 8% e
                provisões de 13º (8,33%) e férias + 1/3 (11,11%). No Regime Geral o custo real fica
                entre <strong>1,6× e 1,8× o salário bruto</strong>— sem contar benefícios.
              </p>
              <p>
                Para empresas no <strong>Simples Nacional</strong>, INSS patronal e Terceiros estão
                embutidos no DAS (exceto Anexo IV), mas FGTS, RAT e provisões continuam integrais. O
                custo efetivo costuma ficar próximo de <strong>1,4×–1,5× o salário bruto</strong>,
                variando com a atividade e o anexo.
              </p>
              <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                custoMensal = salário × (1 + INSS + RAT + Terceiros + FGTS + Provisões) + benefícios
              </div>
              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Negocie salário líquido, pague bruto:</strong> apresente o bruto ao
                    candidato para evitar surpresas.
                  </li>
                  <li>
                    <strong>RAT varia por risco:</strong> escritório 1%, indústria leve 2%,
                    construção/mineração 3%. Confirme o CNAE.
                  </li>
                  <li>
                    <strong>Benefícios têm impacto tributário:</strong> VR/VA são dedutíveis no
                    IRPJ/CSLL (Lucro Real). VT tem isenção previdenciária.
                  </li>
                  <li>
                    <strong>Cuidado com PJ:</strong> reduz encargos mas gera risco de pejotização e
                    passivo trabalhista.
                  </li>
                </ul>
              </div>
              <p className="pt-2 text-xs">
                Bases legais: Lei 8.212/91 (custeio previdenciário), Lei 8.036/90 (FGTS), Decreto
                6.957/09 (FAP/RAT), Lei 7.418/85 (VT), LC 123/2006 (Simples Nacional).
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

type Tone = "primary" | "destructive" | "warning" | "foreground";

const toneClass: Record<Tone, string> = {
  primary: "text-primary",
  destructive: "text-destructive",
  warning: "text-amber-600 dark:text-amber-500",
  foreground: "text-foreground",
};

function ResumoCard({
  rotulo,
  valor,
  pct,
  sub,
  tone = "foreground",
}: {
  rotulo: string;
  valor: number;
  pct?: number;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
        <p className={`text-xl font-bold ${toneClass[tone]}`}>{fmtBRL(valor)}</p>
        {pct !== undefined && pct > 0 ? (
          <p className="text-[11px] text-muted-foreground">{fmtPct(pct)} do salário</p>
        ) : sub ? (
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetalheTable({
  linhas,
  total,
}: {
  linhas: { rotulo: string; base: number; aliquota: number | null; valor: number }[];
  total: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Base</TableHead>
          <TableHead className="text-right">Alíquota</TableHead>
          <TableHead className="text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map((l) => (
          <TableRow key={l.rotulo}>
            <TableCell className="text-xs">{l.rotulo}</TableCell>
            <TableCell className="text-right text-xs text-muted-foreground">
              {fmtBRL(l.base)}
            </TableCell>
            <TableCell className="text-right text-xs text-muted-foreground">
              {l.aliquota === null ? "—" : fmtPct(l.aliquota)}
            </TableCell>
            <TableCell className="text-right text-xs font-medium">{fmtBRL(l.valor)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="border-t-2">
          <TableCell colSpan={3} className="text-xs font-semibold">
            Total
          </TableCell>
          <TableCell className="text-right text-sm font-bold">{fmtBRL(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function LinhaResumo({
  rotulo,
  valor,
  bold,
  tone = "foreground",
}: {
  rotulo: string;
  valor: number;
  bold?: boolean;
  tone?: Tone;
}) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-bold" : ""}`}>
      <span className={bold ? "text-foreground" : "text-muted-foreground"}>{rotulo}</span>
      <span className={toneClass[tone]}>{fmtBRL(valor)}</span>
    </div>
  );
}
