/**
 * Calculadora de 13º Salário (Gratificação Natalina).
 *
 * Padrão visual alinhado às demais calculadoras (header com ícone,
 * card de entrada com etapas, card de resultado destacado + mini-cards
 * de parcelas + composição/barra + bloco "Entenda a calculadora").
 */
import { useMemo, useState } from "react";
import { BookOpen, Download, Gift, Info, RotateCcw } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { calcularDecimoTerceiro } from "@/engines/calculadoras/decimoTerceiro";
import { ANO_VIGENTE } from "@/engines/calculadoras/tabelas";
import { fmtBRL, fmtPct } from "@/engines/finance/format";

export function DecimoTerceiroCalc() {
  const [salarioBruto, setSalarioBruto] = useState<number>(3800);
  const [meses, setMeses] = useState<number>(10);
  const [dependentes, setDependentes] = useState<number>(1);

  const r = useMemo(() => {
    try {
      return calcularDecimoTerceiro({
        salarioBruto,
        mesesTrabalhados: meses,
        dependentesIR: dependentes,
      });
    } catch {
      return null;
    }
  }, [salarioBruto, meses, dependentes]);

  function limpar() {
    setSalarioBruto(0);
    setMeses(12);
    setDependentes(0);
  }

  async function exportar() {
    if (!r) return;
    await exportCalculadoraPDF({
      title: "13º Salário",
      subtitle: "Cálculo do 13º proporcional com INSS e IRRF separados (Lei 4.090/62).",
      inputs: [
        { label: "Salário bruto mensal", value: fmtBRL(salarioBruto) },
        { label: "Meses trabalhados", value: `${meses} ${meses === 1 ? "mês" : "meses"}` },
        { label: "Dependentes IRRF", value: String(dependentes) },
      ],
      kpis: [
        {
          label: "13º líquido",
          value: fmtBRL(r.liquido),
          sub: fmtPct(r.bruto > 0 ? r.liquido / r.bruto : 0),
          tone: "ok",
        },
        {
          label: "13º bruto",
          value: fmtBRL(r.bruto),
          sub: "Proporcional aos meses",
          tone: "neutral",
        },
        { label: "Descontos", value: fmtBRL(r.inss + r.irrf), sub: "INSS + IRRF", tone: "warn" },
      ],
    });
  }

  // % por componente, para a barra de composição.
  const pctLiquido = r && r.bruto > 0 ? r.liquido / r.bruto : 0;
  const pctInss = r && r.bruto > 0 ? r.inss / r.bruto : 0;
  const pctIrrf = r && r.bruto > 0 ? r.irrf / r.bruto : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Gift className="h-5 w-5 text-primary" /> Calculadora de 13º Salário
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Calcule o valor líquido do seu décimo terceiro salário, com as duas parcelas e todos os
            descontos detalhados.
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Step n={1} /> Dados do Trabalhador
          </CardTitle>
          <CardDescription>
            Informe seu salário bruto e os meses trabalhados no ano para calcular o 13º salário.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Salário Bruto Mensal"
            hint="Salário bruto registrado na carteira de trabalho."
          >
            <MoneyInput value={salarioBruto} onChange={setSalarioBruto} />
          </Field>

          <Field
            label="Meses Trabalhados no Ano"
            hint="Quantidade de meses trabalhados de janeiro a dezembro. Acima de 15 dias no mês conta como mês inteiro."
          >
            <Select value={String(meses)} onValueChange={(v) => setMeses(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} {m === 1 ? "mês" : "meses"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Número de Dependentes (IRRF)"
            hint="Dependentes para dedução do Imposto de Renda na fonte."
          >
            <Input
              type="number"
              min={0}
              value={dependentes || ""}
              onChange={(e) => setDependentes(Number(e.target.value) || 0)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={() => undefined} className="pointer-events-none">
              Calcular 13º Salário
            </Button>
            <Button variant="outline" onClick={limpar}>
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resultado */}
      {r && salarioBruto > 0 && meses > 0 && (
        <>
          <Card className="border-2 border-emerald-500/40 bg-emerald-500/5">
            <CardContent className="py-6 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Seu 13º Salário Líquido
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400 sm:text-5xl">
                {fmtBRL(r.liquido)}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Badge variant="outline">
                  {meses} {meses === 1 ? "mês trabalhado" : "meses trabalhados"}
                </Badge>
                <Badge variant="outline">Bruto: {fmtBRL(r.bruto)}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Mini-cards das parcelas */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">1ª Parcela</p>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                    Até 30/Nov
                  </Badge>
                </div>
                <p className="text-2xl font-bold text-foreground">{fmtBRL(r.primeiraParcela)}</p>
                <p className="text-[11px] text-muted-foreground">
                  50% do valor bruto, sem descontos de INSS ou IRRF. Pode ser solicitada junto com
                  as férias.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">2ª Parcela</p>
                  <Badge className="bg-primary text-primary-foreground">Até 20/Dez</Badge>
                </div>
                <p className="text-2xl font-bold text-foreground">{fmtBRL(r.segundaParcela)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Valor restante após descontos de INSS e IRRF aplicados integralmente nesta
                  parcela.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Composição com barra */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Composição do 13º Salário</CardTitle>
              <CardDescription>Distribuição entre valor líquido e descontos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <div className="bg-emerald-500" style={{ width: `${pctLiquido * 100}%` }} />
                <div className="bg-amber-500" style={{ width: `${pctInss * 100}%` }} />
                <div className="bg-destructive/70" style={{ width: `${pctIrrf * 100}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Líquido{" "}
                  {fmtPct(pctLiquido)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> INSS {fmtPct(pctInss)}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-destructive/70" /> IRRF {fmtPct(pctIrrf)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Detalhamento */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalhamento do Cálculo</CardTitle>
              <CardDescription>Passo a passo do cálculo do seu 13º salário</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm font-medium">13º Salário Bruto</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {fmtBRL(r.bruto)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">
                      (−) INSS
                      <div className="text-[11px] text-muted-foreground">
                        Alíquota efetiva: {fmtPct(r.inssAliquota)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm text-destructive">
                      − {fmtBRL(r.inss)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">
                      (−) IRRF
                      <div className="text-[11px] text-muted-foreground">
                        Base: {fmtBRL(r.baseIRRF)} | Alíquota: {fmtPct(r.irrfAliquota)}
                        {dependentes > 0 && (
                          <>
                            <br />
                            Dedução dependentes: {fmtBRL(dependentes * 189.59)}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.irrf > 0 ? (
                        <span className="text-destructive">− {fmtBRL(r.irrf)}</span>
                      ) : (
                        <span className="text-emerald-600">− {fmtBRL(0)}</span>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow className="border-t-2">
                    <TableCell className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                      = 13º Salário Líquido
                    </TableCell>
                    <TableCell className="text-right text-base font-bold text-emerald-700 dark:text-emerald-400">
                      {fmtBRL(r.liquido)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Aviso de contexto */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-1 py-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Info className="h-4 w-4" /> Informação importante
              </p>
              <p className="text-xs text-muted-foreground">
                O 13º salário é calculado com base nos meses efetivamente trabalhados no ano. Os
                valores de INSS e IRRF são descontados integralmente na 2ª parcela. Tabelas de
                referência: INSS e IRRF {ANO_VIGENTE}.
              </p>
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
                <BookOpen className="h-4 w-4 text-primary" /> ENTENDA A CALCULADORA
              </span>
              <span className="text-xs text-muted-foreground">expandir</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3 border-t pt-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Como funciona o cálculo do 13º salário?</p>
              <p>
                O 13º salário (gratificação natalina) é um direito garantido pela Lei 4.090/1964 e
                corresponde a 1/12 do salário bruto por mês trabalhado no ano. Meses com mais de 15
                dias trabalhados contam como mês cheio. O pagamento é feito em duas parcelas: a
                primeira (50% do salário bruto, sem descontos de IR) até 30 de novembro, e a segunda
                (restante menos INSS e IRRF) até 20 de dezembro.
              </p>
              <p>
                O desconto de INSS na segunda parcela é calculado sobre o valor total do 13º (não
                sobre a metade). O IRRF também incide sobre o valor integral do 13º, mas de forma
                separada do salário mensal — existe uma alíquota específica para a gratificação
                natalina na tabela anual do IR, o que frequentemente gera restituição no ajuste
                anual para quem não tem outras rendas.
              </p>

              <p className="pt-2 font-medium text-foreground">Fórmula</p>
              <div className="space-y-2">
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  13º bruto = (Salário Bruto ÷ 12) × Meses trabalhados
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  1ª parcela = 13º bruto ÷ 2
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  INSS₁₃º = Tabela progressiva sobre 13º bruto total
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  2ª parcela líquida = (13º bruto ÷ 2) − INSS − IRRF
                </div>
              </div>

              <p className="pt-2 font-medium text-foreground">Exemplo prático</p>
              <p>
                <strong>Salário bruto: R$ 5.000,00</strong> | Admissão: 1º de janeiro | Cálculo em
                dezembro
              </p>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  13º bruto: R$ 5.000,00 × (12/12) = <strong>R$ 5.000,00</strong>
                </li>
                <li>
                  1ª parcela (nov): R$ 5.000,00 ÷ 2 = <strong>R$ 2.500,00</strong> (sem desconto)
                </li>
                <li>INSS sobre R$ 5.000: R$ 509,59 (tabela progressiva)</li>
                <li>Base IRRF: R$ 5.000 − R$ 509,59 = R$ 4.490,41</li>
                <li>IRRF: R$ 347,58</li>
                <li>
                  2ª parcela = R$ 2.500,00 − R$ 509,59 − R$ 347,58 = <strong>R$ 1.642,83</strong>
                </li>
                <li>
                  <strong>Total líquido recebido: R$ 4.142,83</strong>
                </li>
              </ul>

              <p className="pt-2 font-medium text-foreground">Dicas</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  <strong>Admitido acima do dia 15:</strong> o mês de admissão não conta. Admitido
                  no dia 16 de março? Conta apenas de abril em diante — 9 avos, não 10.
                </li>
                <li>
                  <strong>Antecipe a 1ª parcela nas férias:</strong> o empregado pode solicitar o
                  adiantamento da 1ª parcela junto com as férias (janeiro a novembro). Assim, recebe
                  um volume maior para o período de descanso.
                </li>
                <li>
                  <strong>Invista a 1ª parcela:</strong> recebendo em novembro sem desconto de IR,
                  aplique em Tesouro Selic ou CDB DI. Mesmo por 20 dias (até o Natal), a juros de
                  14,9% a.a. rende ~R$ 20 para cada R$ 2.500 investidos.
                </li>
                <li>
                  <strong>Confira o holerite de dezembro:</strong> verifique se o empregador
                  calculou o INSS progressivo corretamente sobre o total do 13º. Erro de alíquota
                  única (14% flat) é comum e prejudica o trabalhador.
                </li>
              </ul>

              <p className="pt-2 text-xs">
                Bases: Lei 4.090/1962, Lei 4.749/1965, CF art. 7º VIII, IN RFB 1.500/2014, tabelas
                INSS/IRRF {ANO_VIGENTE}. IRRF conforme Lei nº 15.270/2025 (redutor até R$ 7.350).
                Estimativa — valide com contador antes de uso oficial.
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
