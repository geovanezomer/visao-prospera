/**
 * Calculadora de Férias CLT.
 *
 * Padrão visual alinhado às demais calculadoras (cards numerados, MoneyInput,
 * card de resultado destacado + mini-cards + tabela detalhada + entenda).
 */
import { useMemo, useState } from "react";
import { Download, Info, Palmtree, RotateCcw } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { calcularFerias } from "@/engines/calculadoras/ferias";
import { ANO_VIGENTE } from "@/engines/calculadoras/tabelas";
import { fmtBRL } from "@/engines/finance/format";

export function FeriasCltCalc() {
  const [salarioBruto, setSalarioBruto] = useState<number>(3800);
  const [dependentes, setDependentes] = useState<number>(1);
  const [abono, setAbono] = useState<boolean>(true);

  const r = useMemo(() => {
    try {
      return calcularFerias({
        salarioBruto,
        dependentesIR: dependentes,
        abonoPecuniario: abono,
      });
    } catch {
      return null;
    }
  }, [salarioBruto, dependentes, abono]);

  function limpar() {
    setSalarioBruto(0);
    setDependentes(0);
    setAbono(false);
  }

  async function exportar() {
    if (!r) return;
    await exportCalculadoraPDF({
      title: "Férias CLT",
      subtitle: "Valor líquido das férias com INSS, IRRF e abono pecuniário (CLT art. 143).",
      inputs: [
        { label: "Salário bruto", value: fmtBRL(salarioBruto) },
        { label: "Dependentes IRRF", value: String(dependentes) },
        { label: "Abono pecuniário", value: abono ? "Sim (1/3 vendido)" : "Não" },
      ],
      kpis: [
        {
          label: "Líquido a receber",
          value: fmtBRL(r.liquido),
          sub: `${r.diasGozados} dias gozados`,
          tone: "ok",
        },
        {
          label: "Bruto total",
          value: fmtBRL(r.brutoTotal),
          sub: "Férias + 1/3 + abono",
          tone: "neutral",
        },
        { label: "Descontos", value: fmtBRL(r.inss + r.irrf), sub: "INSS + IRRF", tone: "warn" },
      ],
      sections: [
        {
          kind: "table",
          title: "Composição",
          head: ["Item", "Valor"],
          body: [
            [`Férias (${r.diasGozados} dias)`, fmtBRL(r.feriasBase)],
            ["1/3 constitucional", fmtBRL(r.tercoFerias)],
            ...(abono
              ? [
                  [`Abono pecuniário (${r.diasAbono} dias)`, fmtBRL(r.abonoValor)],
                  ["1/3 sobre abono", fmtBRL(r.tercoAbono)],
                ]
              : []),
            ["(−) INSS", fmtBRL(r.inss)],
            ["(−) IRRF", fmtBRL(r.irrf)],
            ["Líquido", fmtBRL(r.liquido)],
          ],
        },
      ],
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Palmtree className="h-5 w-5 text-primary" /> Férias CLT
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Calcule o valor líquido das férias com INSS, IRRF e abono pecuniário.
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
            <Step n={1} /> Calcular Férias
          </CardTitle>
          <CardDescription>
            Informe os dados para calcular o valor líquido das suas férias com INSS e IRRF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Salário Bruto Mensal" hint="Remuneração base usada no cálculo das férias.">
            <MoneyInput value={salarioBruto} onChange={setSalarioBruto} />
          </Field>

          <Field
            label="Número de Dependentes"
            hint="Cada dependente deduz R$ 189,59 da base de cálculo do IRRF."
          >
            <div className="relative">
              <Input
                type="number"
                min={0}
                value={dependentes || ""}
                onChange={(e) => setDependentes(Number(e.target.value) || 0)}
                className="pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                dep.
              </span>
            </div>
          </Field>

          <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/30 p-3">
            <Checkbox
              checked={abono}
              onCheckedChange={(c) => setAbono(c === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Solicitar abono pecuniário (vender 10 dias de férias)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Você recebe férias de 20 dias e converte 10 dias em dinheiro. O abono é isento de
                INSS e IRRF.
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Resultado */}
      {r && salarioBruto > 0 && (
        <>
          <Card className="border-2 border-emerald-500/40 bg-emerald-500/5">
            <CardContent className="py-6 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Férias Líquidas a Receber
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400 sm:text-5xl">
                {fmtBRL(r.liquido)}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Badge variant="outline">{r.diasGozados} dias de férias</Badge>
                <Badge variant="outline">
                  {dependentes} {dependentes === 1 ? "dependente" : "dependentes"}
                </Badge>
                {abono && <Badge variant="outline">Com abono pecuniário</Badge>}
              </div>
            </CardContent>
          </Card>

          {/* Mini-cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Férias ({r.diasGozados} dias)
                </p>
                <p className="text-lg font-bold text-foreground">{fmtBRL(r.feriasBase)}</p>
                <div className="space-y-0.5 pt-1 text-[11px]">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>1/3 constitucional</span>
                    <span className="text-emerald-600">+ {fmtBRL(r.tercoFerias)}</span>
                  </div>
                  <div className="flex items-center justify-between font-medium text-foreground">
                    <span>Bruto total</span>
                    <span>{fmtBRL(r.brutoTotal)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-xs font-medium text-muted-foreground">INSS</p>
                <p className="text-lg font-bold text-destructive">− {fmtBRL(r.inss)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Incide sobre férias + 1/3 constitucional. O abono pecuniário é isento de INSS.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-1 py-4">
                <p className="text-xs font-medium text-muted-foreground">IRRF</p>
                <p
                  className={`text-lg font-bold ${r.irrf > 0 ? "text-destructive" : "text-emerald-600"}`}
                >
                  {r.irrf > 0 ? `− ${fmtBRL(r.irrf)}` : "Isento"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Base de cálculo após INSS e dedução de {dependentes} dependente(s).
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Composição detalhada */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Composição das Férias</CardTitle>
              <CardDescription>
                Detalhamento de todos os valores que compõem o pagamento.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm">Férias ({r.diasGozados} dias)</TableCell>
                    <TableCell className="text-right text-sm">{fmtBRL(r.feriasBase)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">+ 1/3 constitucional</TableCell>
                    <TableCell className="text-right text-sm text-emerald-600">
                      + {fmtBRL(r.tercoFerias)}
                    </TableCell>
                  </TableRow>
                  {abono && (
                    <>
                      <TableRow>
                        <TableCell className="text-sm">
                          + Abono pecuniário ({r.diasAbono} dias){" "}
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            isento INSS/IR
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-emerald-600">
                          + {fmtBRL(r.abonoValor)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm">
                          + 1/3 sobre abono{" "}
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            isento INSS/IR
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-emerald-600">
                          + {fmtBRL(r.tercoAbono)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                  <TableRow className="border-t-2 bg-muted/30">
                    <TableCell className="text-sm font-bold">= Bruto total</TableCell>
                    <TableCell className="text-right text-sm font-bold">
                      {fmtBRL(r.brutoTotal)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">− INSS</TableCell>
                    <TableCell className="text-right text-sm text-destructive">
                      − {fmtBRL(r.inss)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">− IRRF</TableCell>
                    <TableCell className="text-right text-sm">
                      {r.irrf > 0 ? (
                        <span className="text-destructive">− {fmtBRL(r.irrf)}</span>
                      ) : (
                        <span className="text-emerald-600">Isento</span>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow className="border-t-2">
                    <TableCell className="text-base font-bold">= Líquido a receber</TableCell>
                    <TableCell className="text-right text-base font-bold text-emerald-700 dark:text-emerald-400">
                      {fmtBRL(r.liquido)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
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
              <p className="font-medium text-foreground">Como funciona o cálculo das férias CLT?</p>
              <p>
                As férias remuneradas são garantidas pelo artigo 129 da CLT após cada período
                aquisitivo de 12 meses. O trabalhador recebe o salário do período mais o adicional
                constitucional de 1/3, totalizando 4/3 do salário. Esse acréscimo visa compensar os
                gastos extras no período de descanso. O pagamento deve ser feito até 2 dias antes do
                início do gozo.
              </p>
              <p>
                Sobre o total bruto (salário + 1/3) incidem INSS e IRRF, da mesma forma que no
                salário mensal. O abono pecuniário (venda de 10 dias) e seu respectivo 1/3 são{" "}
                <strong>isentos</strong> de INSS e IRRF (Lei 7.713/88; IN RFB 1.500/2014).
              </p>

              <p className="pt-2 font-medium text-foreground">Fórmulas</p>
              <div className="space-y-2">
                <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                  Férias brutas = Salário Bruto × (dias gozados ÷ 30)
                </div>
                <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                  Adicional 1/3 = Férias brutas ÷ 3
                </div>
                <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                  Total bruto = Férias + 1/3 (+ Abono + 1/3 do abono, se houver)
                </div>
                <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                  Líquido = Total bruto − INSS(base tributável) − IRRF(base)
                </div>
              </div>

              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Abono pecuniário:</strong> o trabalhador pode converter até 1/3 das
                    férias (10 dias) em dinheiro. O valor é isento e pago junto com as férias.
                  </li>
                  <li>
                    <strong>Goze as férias antes de 24 meses:</strong> se o empregador não conceder
                    no período concessivo, deverá pagá-las em dobro (CLT art. 137).
                  </li>
                  <li>
                    <strong>Planeje o mês de gozo:</strong> receber férias e salário no mesmo mês
                    pode elevar a renda mensal declarada e, em alguns casos, aumentar o IRRF.
                  </li>
                  <li>
                    <strong>Comissões integram a base:</strong> comissões habituais compõem a média
                    do salário das férias.
                  </li>
                </ul>
              </div>

              <p className="pt-2 text-xs">
                Bases: CLT arts. 129–153; CF art. 7º, XVII; Lei 7.713/88; tabelas INSS/IRRF{" "}
                {ANO_VIGENTE}. IRRF conforme Lei nº 15.270/2025 (redutor até R$ 7.350). Estimativa —
                valide com contador antes de uso oficial.
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
