/**
 * Calculadora de Horas Extras CLT.
 *
 * Fórmulas (CLT, art. 7º XVI da CF/88, art. 73 CLT):
 *   Hora normal      = Salário Bruto ÷ (Jornada semanal × 5)        (jornada mensal padrão 220h p/ 44h)
 *   Hora extra 50%   = Hora normal × 1,50
 *   Hora extra noturna (22h–5h) = Hora normal × 1,20 × 1,50 = × 1,80
 *   Hora extra 100% (feriado/domingo) = Hora normal × 2,00
 */
import { useMemo, useState } from "react";
import { Clock, Download, Info, RotateCcw } from "lucide-react";
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

const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

// Jornada semanal → horas mensais (semana × 5 dias úteis ÷ 7 × 30 → aproximação CLT padrão)
const JORNADAS: { value: string; label: string; horasMes: number }[] = [
  { value: "44", label: "44 horas (CLT padrão)", horasMes: 220 },
  { value: "40", label: "40 horas", horasMes: 200 },
  { value: "36", label: "36 horas", horasMes: 180 },
  { value: "30", label: "30 horas", horasMes: 150 },
];

export function HorasExtrasCalc() {
  const [salarioBruto, setSalarioBruto] = useState<number>(4500);
  const [jornada, setJornada] = useState<string>("44");
  const [qtd50, setQtd50] = useState<number>(0);
  const [qtdNoturna, setQtdNoturna] = useState<number>(0);
  const [qtd100, setQtd100] = useState<number>(0);

  const r = useMemo(() => {
    const horasMes = JORNADAS.find((j) => j.value === jornada)?.horasMes ?? 220;
    const horaNormal = salarioBruto > 0 ? salarioBruto / horasMes : 0;
    const valor50 = horaNormal * 1.5;
    const valorNoturna = horaNormal * 1.8;
    const valor100 = horaNormal * 2.0;
    const total50 = valor50 * qtd50;
    const totalNoturna = valorNoturna * qtdNoturna;
    const total100 = valor100 * qtd100;
    const totalExtrasSemDSR = total50 + totalNoturna + total100;
    // Reflexo de DSR sobre horas extras habituais (Lei 605/49, Súmula 172 TST).
    // Aproximação com mês médio: 5 dom./feriados ÷ 22 dias úteis ≈ 22,73% sobre HE.
    // Esta é a fórmula consolidada usada em folha quando não há calendário específico.
    const DSR_FATOR = 5 / 22;
    const totalDSR = totalExtrasSemDSR * DSR_FATOR;
    const totalExtras = totalExtrasSemDSR + totalDSR;
    const salarioTotal = salarioBruto + totalExtras;
    const pctAcrescimo = salarioBruto > 0 ? totalExtras / salarioBruto : 0;
    return {
      horasMes,
      horaNormal,
      valor50,
      valorNoturna,
      valor100,
      total50,
      totalNoturna,
      total100,
      totalExtrasSemDSR,
      totalDSR,
      totalExtras,
      salarioTotal,
      pctAcrescimo,
    };
  }, [salarioBruto, jornada, qtd50, qtdNoturna, qtd100]);

  function limpar() {
    setSalarioBruto(0);
    setQtd50(0);
    setQtdNoturna(0);
    setQtd100(0);
  }

  async function exportar() {
    await exportCalculadoraPDF({
      title: "Horas Extras",
      subtitle:
        "Cálculo de horas extras com adicional + reflexo de DSR (CLT art. 59 e Lei 605/49).",
      inputs: [
        { label: "Salário bruto", value: fmtBRL(salarioBruto) },
        { label: "Jornada semanal", value: `${jornada}h (${r.horasMes}h/mês)` },
        { label: "Horas extras 50%", value: String(qtd50) },
        { label: "Horas extras noturnas (80%)", value: String(qtdNoturna) },
        { label: "Horas extras 100%", value: String(qtd100) },
      ],
      kpis: [
        {
          label: "Total a receber",
          value: fmtBRL(r.totalExtras),
          sub: `+${(r.pctAcrescimo * 100).toFixed(1)}% sobre o salário`,
          tone: "ok",
        },
        {
          label: "Hora normal",
          value: fmtBRL(r.horaNormal),
          sub: "Base de cálculo",
          tone: "neutral",
        },
        {
          label: "Reflexo de DSR",
          value: fmtBRL(r.totalDSR),
          sub: "Súmula 172 TST",
          tone: "neutral",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Composição",
          head: ["Tipo", "Qtd", "Valor unitário", "Total"],
          body: [
            ["HE 50%", qtd50, fmtBRL(r.valor50), fmtBRL(r.total50)],
            ["HE Noturna 80%", qtdNoturna, fmtBRL(r.valorNoturna), fmtBRL(r.totalNoturna)],
            ["HE 100%", qtd100, fmtBRL(r.valor100), fmtBRL(r.total100)],
            ["Reflexo DSR", "—", "—", fmtBRL(r.totalDSR)],
            ["Total geral", "—", "—", fmtBRL(r.totalExtras)],
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
            <Clock className="h-5 w-5 text-primary" /> Calculadora de Horas Extras
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe seu salário e as quantidades de horas extras trabalhadas para calcular o valor a
            receber.
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

      {/* Salário + jornada */}
      <Card>
        <CardContent className="grid gap-4 py-6 md:grid-cols-2">
          <Field label="Salário Bruto Mensal">
            <MoneyInput value={salarioBruto} onChange={setSalarioBruto} />
          </Field>
          <Field label="Jornada de Trabalho Semanal">
            <Select value={jornada} onValueChange={setJornada}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JORNADAS.map((j) => (
                  <SelectItem key={j.value} value={j.value}>
                    {j.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Quantidade de horas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quantidade de Horas Extras</CardTitle>
          <CardDescription>
            Informe quantas horas de cada tipo você trabalhou no mês.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Horas extras 50%" hint="Adicional de 50%.">
            <HourInput value={qtd50} onChange={setQtd50} />
          </Field>
          <Field label="Horas extras noturnas" hint="50% + 20% noturno (80% total).">
            <HourInput value={qtdNoturna} onChange={setQtdNoturna} />
          </Field>
          <Field label="Horas extras 100%" hint="Feriado ou domingo.">
            <HourInput value={qtd100} onChange={setQtd100} />
          </Field>
        </CardContent>
      </Card>

      {/* Resultado */}
      {salarioBruto > 0 && (r.totalExtras > 0 || true) && (
        <>
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardContent className="py-6 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-primary">
                Total de Horas Extras
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-primary sm:text-5xl">
                {fmtBRL(r.totalExtras)}
              </p>
              {r.totalExtras > 0 && (
                <Badge className="mt-2 bg-primary/15 text-primary hover:bg-primary/20">
                  +{fmtPct(r.pctAcrescimo)} sobre o salário base
                </Badge>
              )}
              <div className="mt-4 flex justify-between border-t pt-3 text-xs text-muted-foreground">
                <span>Salário base: {fmtBRL(salarioBruto)}</span>
                <span>
                  Salário total:{" "}
                  <strong className="text-foreground">{fmtBRL(r.salarioTotal)}</strong>
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Cards detalhados */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailCard
              title="Valor da Hora Normal"
              value={fmtBRL(r.horaNormal)}
              valueClass="text-foreground"
              footer={
                <p className="text-xs text-muted-foreground">
                  Base para cálculo de todas as horas extras
                </p>
              }
            />
            <DetailCard
              title="Horas Extras 50%"
              value={fmtBRL(r.total50)}
              valueClass="text-emerald-600 dark:text-emerald-500"
              footer={
                <div className="space-y-1 text-xs">
                  <Row
                    label="Quantidade"
                    value={<span className="font-medium text-foreground">{qtd50}h</span>}
                  />
                  <Row
                    label="Adicional"
                    value={
                      <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">
                        50%
                      </Badge>
                    }
                  />
                </div>
              }
            />
            <DetailCard
              title="Horas Extras Noturnas"
              value={fmtBRL(r.totalNoturna)}
              valueClass="text-orange-600 dark:text-orange-500"
              footer={
                <div className="space-y-1 text-xs">
                  <Row
                    label="Quantidade"
                    value={<span className="font-medium text-foreground">{qtdNoturna}h</span>}
                  />
                  <Row
                    label="Adicional"
                    value={
                      <Badge variant="outline" className="border-orange-500/30 text-orange-600">
                        50% + 20% noturno
                      </Badge>
                    }
                  />
                </div>
              }
            />
            <DetailCard
              title="Horas Extras 100%"
              value={fmtBRL(r.total100)}
              valueClass="text-destructive"
              footer={
                <div className="space-y-1 text-xs">
                  <Row
                    label="Quantidade"
                    value={<span className="font-medium text-foreground">{qtd100}h</span>}
                  />
                  <Row
                    label="Adicional"
                    value={
                      <Badge variant="outline" className="border-destructive/30 text-destructive">
                        100% (feriado/domingo)
                      </Badge>
                    }
                  />
                </div>
              }
            />
            <DetailCard
              title="Salário Total do Mês"
              value={fmtBRL(r.salarioTotal)}
              valueClass="text-emerald-700 dark:text-emerald-400"
              footer={
                <div className="space-y-1 text-xs">
                  <Row
                    label="Salário base"
                    value={<span className="text-foreground">{fmtBRL(salarioBruto)}</span>}
                  />
                  <Row
                    label="HE (sem DSR)"
                    value={<span className="text-primary">+ {fmtBRL(r.totalExtrasSemDSR)}</span>}
                  />
                  <Row
                    label="DSR sobre HE"
                    value={<span className="text-primary">+ {fmtBRL(r.totalDSR)}</span>}
                  />
                </div>
              }
            />
          </div>

          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Nota:</strong> O salário total inclui o reflexo de
            DSR (Descanso Semanal Remunerado) sobre as horas extras habituais, na proporção média de
            5 dom./feriados ÷ 22 dias úteis ≈ 22,73% (Lei 605/49, Súmula 172 TST). Valores brutos,
            antes de INSS e IRRF. A hora noturna considera o adicional noturno de 20% acrescido ao
            adicional de hora extra de 50%, totalizando 80% sobre a hora normal.
          </p>
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
                Como funciona o cálculo de horas extras CLT?
              </p>
              <p>
                A CLT estabelece diferentes adicionais para horas extras conforme o horário e o dia
                em que são realizadas. Horas trabalhadas além da jornada padrão (geralmente 8h
                diárias ou 44h semanais) devem ser remuneradas com adicional de <strong>50%</strong>{" "}
                sobre o valor da hora normal. Horas em período noturno (22h às 5h) têm acréscimo de{" "}
                <strong>20%</strong> sobre a hora diurna (hora noturna = hora diurna × 1,20), e o
                adicional de hora extra noturna é de 50% sobre esse valor já majorado.
              </p>
              <p>
                Em feriados e domingos sem escala, o adicional chega a <strong>100%</strong> — o
                trabalhador recebe o dobro do valor da hora normal. Muitas convenções coletivas
                estabelecem percentuais ainda maiores. Acordos de banco de horas podem substituir o
                pagamento em dinheiro, mas precisam de convenção coletiva e limite de 6 meses para
                compensação.
              </p>

              <p className="pt-2 font-medium text-foreground">Fórmula</p>
              <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                Hora normal = Salário Bruto ÷ (Dias trabalhados × Horas/dia)
              </div>
              <p>Para jornada mensal padrão:</p>
              <div className="space-y-2">
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  Hora normal = Salário Bruto ÷ 220h
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  Hora extra (50%) = Hora normal × 1,50
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  Hora extra noturna (50% + 20%) = Hora normal × 1,20 × 1,50 = Hora normal × 1,80
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-center font-mono text-xs">
                  Hora extra feriado/domingo (100%) = Hora normal × 2,00
                </div>
              </div>

              <p className="pt-2 font-medium text-foreground">Adicionais de horas extras CLT</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Tipo de hora extra</TableHead>
                    <TableHead className="text-xs">Adicional</TableHead>
                    <TableHead className="text-xs">Fator multiplicador</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs">Diurna (além das 8h)</TableCell>
                    <TableCell className="text-xs">50%</TableCell>
                    <TableCell className="text-xs">1,50×</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs">Noturna (22h–5h)</TableCell>
                    <TableCell className="text-xs">50% + 20% noturno</TableCell>
                    <TableCell className="text-xs">1,80×</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs">Feriados / Domingos sem escala</TableCell>
                    <TableCell className="text-xs">100%</TableCell>
                    <TableCell className="text-xs">2,00×</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs">Sábado (acordo coletivo comum)</TableCell>
                    <TableCell className="text-xs">50–100%</TableCell>
                    <TableCell className="text-xs">1,50–2,00×</TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Horas extras têm reflexos:</strong> integram a base de cálculo do 13º,
                    férias, aviso prévio e FGTS quando habituais. Se você faz horas extras todo mês,
                    o RH deve incluí-las na média para esses cálculos.
                  </li>
                  <li>
                    <strong>Banco de horas exige acordo formal:</strong> empresa não pode impor
                    banco de horas verbalmente. Exija o instrumento coletivo por escrito, com prazo
                    de compensação e regras claras sobre o que acontece se você não compensar antes
                    de sair.
                  </li>
                  <li>
                    <strong>Confira a hora noturna reduzida:</strong> a CLT considera a hora noturna
                    como 52 minutos e 30 segundos (não 60 minutos), o que amplia o número de horas
                    noturnas computadas. Muitos sistemas de ponto calculam errado.
                  </li>
                  <li>
                    <strong>Habitualidade gera direito adquirido:</strong> fazer horas extras por
                    mais de 1 ano cria expectativa legítima. A supressão abrupta pode gerar direito
                    a indenização pela perda — consulte um advogado trabalhista se isso ocorrer.
                  </li>
                </ul>
              </div>
              <p className="pt-2 text-xs">
                Bases: CF/88 art. 7º XVI, CLT arts. 59, 73 e 73 §1º, Lei 605/49, Súmula 264 TST.
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

function HourInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <Input
        type="number"
        min={0}
        step={1}
        className="pr-8"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
        h
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DetailCard({
  title,
  value,
  valueClass,
  footer,
}: {
  title: string;
  value: string;
  valueClass?: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold ${valueClass ?? "text-foreground"}`}>{value}</p>
        {footer && <div className="border-t pt-2">{footer}</div>}
      </CardContent>
    </Card>
  );
}
