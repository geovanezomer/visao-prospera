/**
 * Calculadora de Rescisão Trabalhista CLT.
 * Cálculo reativo via useMemo conforme inputs.
 */
import { useMemo, useState } from "react";
import { Download, FileText, Info, RotateCcw } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  calcularRescisao,
  motivoDescricao,
  motivosLabel,
  type MotivoRescisao,
} from "@/engines/calculadoras/rescisao";
import { fmtBRL } from "@/engines/finance/format";
import { ANO_VIGENTE } from "@/engines/calculadoras/tabelas";


export function RescisaoCltCalc() {
  const [motivo, setMotivo] = useState<MotivoRescisao>("sem_justa_causa");
  const [salarioBruto, setSalarioBruto] = useState<number>(4000);
  const [diasTrabalhadosMes, setDiasTrabalhadosMes] = useState<number>(15);
  const [mesesFeriasProporcionais, setMesesFeriasProporcionais] = useState<number>(6);
  const [mesesDecimoProporcional, setMesesDecimoProporcional] = useState<number>(9);
  const [anosNaEmpresa, setAnosNaEmpresa] = useState<number>(2);
  const [saldoFGTS, setSaldoFGTS] = useState<number>(9600);
  const [possuiFeriasVencidas, setPossuiFeriasVencidas] = useState<boolean>(false);
  const [dependentesIR, setDependentesIR] = useState<number>(0);
  const [avisoPrevio, setAvisoPrevio] = useState<"indenizado" | "trabalhado" | "dispensado">(
    "indenizado",
  );
  // Campos exclusivos do contrato de experiência rompido antes do prazo (CLT arts. 479/480)
  const [diasRestantesExperiencia, setDiasRestantesExperiencia] = useState<number>(0);
  const [rupturaExperienciaPor, setRupturaExperienciaPor] = useState<"empregador" | "empregado">(
    "empregador",
  );

  const resultado = useMemo(() => {
    try {
      return calcularRescisao({
        motivo,
        salarioBruto,
        diasTrabalhadosMes,
        mesesFeriasProporcionais,
        mesesDecimoProporcional,
        anosNaEmpresa,
        saldoFGTS,
        possuiFeriasVencidas,
        dependentesIR,
        avisoPrevio,
        diasRestantesExperiencia,
        rupturaExperienciaPor,
      });
    } catch {
      return null;
    }
  }, [
    motivo,
    salarioBruto,
    diasTrabalhadosMes,
    mesesFeriasProporcionais,
    mesesDecimoProporcional,
    anosNaEmpresa,
    saldoFGTS,
    possuiFeriasVencidas,
    dependentesIR,
    avisoPrevio,
    diasRestantesExperiencia,
    rupturaExperienciaPor,
  ]);

  function limpar() {
    setMotivo("sem_justa_causa");
    setSalarioBruto(0);
    setDiasTrabalhadosMes(0);
    setMesesFeriasProporcionais(0);
    setMesesDecimoProporcional(0);
    setAnosNaEmpresa(0);
    setSaldoFGTS(0);
    setPossuiFeriasVencidas(false);
    setDependentesIR(0);
    setAvisoPrevio("indenizado");
    setDiasRestantesExperiencia(0);
    setRupturaExperienciaPor("empregador");
  }

  async function exportar() {
    if (!resultado) return;
    await exportCalculadoraPDF({
      title: "Rescisão Trabalhista CLT",
      subtitle:
        "Verbas rescisórias, incidência de INSS/IRRF e saque do FGTS por motivo de desligamento.",
      inputs: [
        { label: "Motivo da rescisão", value: motivo.replace(/_/g, " ") },
        { label: "Salário bruto", value: fmtBRL(salarioBruto) },
        { label: "Aviso prévio", value: avisoPrevio },
        { label: "Anos na empresa", value: String(anosNaEmpresa) },
        { label: "Dias trabalhados no mês", value: String(diasTrabalhadosMes) },
        { label: "Meses p/ férias proporcionais", value: String(mesesFeriasProporcionais) },
        { label: "Meses p/ 13º proporcional", value: String(mesesDecimoProporcional) },
        { label: "Saldo FGTS", value: fmtBRL(saldoFGTS) },
        { label: "Dependentes IR", value: String(dependentesIR) },
      ],
      kpis: [
        { label: "Total líquido", value: fmtBRL(resultado.totalLiquido), sub: "Após INSS e IRRF", tone: "ok" },
        { label: "Total bruto", value: fmtBRL(resultado.totalBruto), sub: "Soma de verbas", tone: "neutral" },
        { label: "Saque FGTS + Multa", value: fmtBRL(resultado.saqueFGTS + resultado.multaFGTS), sub: `Multa: ${fmtBRL(resultado.multaFGTS)}`, tone: "ok" },
      ],
      sections: [
        {
          kind: "table",
          title: "Verbas rescisórias",
          head: ["Verba", "Valor"],
          body: resultado.verbas.map((v) => [v.rotulo, fmtBRL(v.valor)]),
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
            <FileText className="h-5 w-5 text-primary" /> Rescisão Trabalhista CLT
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verbas rescisórias, incidência de INSS/IRRF e saque do FGTS por motivo de desligamento.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={exportar} title="Exportar PDF" disabled={!resultado}>
            <Download className="mr-2 h-4 w-4" /> Exportar PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={limpar}>
            <RotateCcw className="mr-2 h-4 w-4" /> Limpar
          </Button>
        </div>
      </div>

      {/* Tipo de rescisão */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Step n={1} /> Tipo de Rescisão
          </CardTitle>
          <CardDescription>Selecione o motivo do desligamento contratual.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Motivo da Rescisão</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoRescisao)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(motivosLabel) as MotivoRescisao[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {motivosLabel[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed text-foreground/80">
            <p className="mb-1 font-medium text-primary">Sobre este tipo de rescisão</p>
            <p>{motivoDescricao[motivo]}</p>
          </div>

          {motivo === "termino_experiencia" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Dias restantes do contrato"
                hint="0 = término no prazo. >0 = rescisão antecipada (CLT arts. 479/480)."
              >
                <Input
                  type="number"
                  min={0}
                  value={diasRestantesExperiencia || ""}
                  onChange={(e) => setDiasRestantesExperiencia(Number(e.target.value) || 0)}
                />
              </Field>
              <Field
                label="Quem rompeu antes do prazo?"
                hint="Empregador paga 50% (art. 479). Empregado desconta 50% (art. 480)."
              >
                <Select
                  value={rupturaExperienciaPor}
                  onValueChange={(v) => setRupturaExperienciaPor(v as typeof rupturaExperienciaPor)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empregador">Empregador</SelectItem>
                    <SelectItem value="empregado">Empregado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dados salariais + Tempo de trabalho */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={2} /> Dados Salariais
            </CardTitle>
            <CardDescription>Salário bruto mensal registrado em carteira.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Salário Bruto Mensal"
              hint="Valor bruto mensal antes de qualquer desconto."
            >
              <MoneyInput value={salarioBruto} onChange={setSalarioBruto} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Dependentes para IR"
                hint="Cada dependente reduz a base do IRRF em R$ 189,59."
              >
                <Input
                  type="number"
                  min={0}
                  value={dependentesIR || ""}
                  onChange={(e) => setDependentesIR(Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Aviso prévio" hint="Indenizado não sofre INSS/IRRF.">
                <Select
                  value={avisoPrevio}
                  onValueChange={(v) => setAvisoPrevio(v as typeof avisoPrevio)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="indenizado">Indenizado</SelectItem>
                    <SelectItem value="trabalhado">Trabalhado</SelectItem>
                    <SelectItem value="dispensado">Dispensado pelo empregado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={3} /> Tempo de Trabalho
            </CardTitle>
            <CardDescription>
              Períodos trabalhados para cálculo das verbas proporcionais.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Dias trabalhados no mês da rescisão" hint="0 a 31.">
              <Input
                type="number"
                min={0}
                max={31}
                value={diasTrabalhadosMes || ""}
                onChange={(e) => setDiasTrabalhadosMes(Number(e.target.value) || 0)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Meses p/ férias proporcionais" hint="0 a 12.">
                <MonthSelect
                  value={mesesFeriasProporcionais}
                  onChange={setMesesFeriasProporcionais}
                />
              </Field>
              <Field label="Meses p/ 13º proporcional" hint="0 a 12.">
                <MonthSelect
                  value={mesesDecimoProporcional}
                  onChange={setMesesDecimoProporcional}
                />
              </Field>
            </div>
            <Field
              label="Anos na empresa"
              hint="Usado no aviso proporcional: 30 + 3 dias por ano (máx 90)."
            >
              <Input
                type="number"
                min={0}
                step={0.5}
                value={anosNaEmpresa || ""}
                onChange={(e) => setAnosNaEmpresa(Number(e.target.value) || 0)}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* FGTS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Step n={4} /> FGTS e Férias Vencidas
          </CardTitle>
          <CardDescription>Saldo do FGTS e informação sobre férias vencidas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Saldo do FGTS" hint="Consulte no aplicativo FGTS ou extrato da Caixa.">
              <MoneyInput value={saldoFGTS} onChange={setSaldoFGTS} />
            </Field>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/30 p-3">
              <Checkbox
                checked={possuiFeriasVencidas}
                onCheckedChange={(c) => setPossuiFeriasVencidas(c === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">Possui férias vencidas</p>
                <p className="text-[11px] text-muted-foreground">
                  Marque se há períodos aquisitivos completados e não gozados.
                </p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Resultado */}
      {resultado && (
        <>
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
            <CardContent className="grid gap-4 py-6 sm:grid-cols-3">
              <ResultoCol rotulo="Total Bruto" valor={resultado.totalBruto} destaque />
              <ResultoCol
                rotulo="(–) INSS + IRRF"
                valor={resultado.inss + resultado.irrf}
                tone="destructive"
              />
              <ResultoCol
                rotulo="Total Líquido"
                valor={resultado.totalLiquido}
                tone="primary"
                destaque
              />
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <MiniCard
              rotulo="Saque do FGTS"
              valor={resultado.saqueFGTS}
              sub={resultado.saqueFGTS > 0 ? "Liberado para saque" : "Não há saque neste motivo"}
            />
            <MiniCard
              rotulo="Multa FGTS"
              valor={resultado.multaFGTS}
              sub={resultado.multaFGTS > 0 ? "Paga pelo empregador" : "Não há multa neste motivo"}
            />
            <MiniCard
              rotulo="Aviso Prévio"
              valor={resultado.diasAvisoPrevio}
              unidade="dias"
              sub="30 + 3/ano (Lei 12.506/11)"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Verbas Rescisórias — detalhamento</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Verba</TableHead>
                    <TableHead className="text-center">INSS</TableHead>
                    <TableHead className="text-center">IRRF</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultado.verbas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                        Nenhuma verba para este motivo com os dados informados.
                      </TableCell>
                    </TableRow>
                  )}
                  {resultado.verbas.map((v, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs">
                        {v.rotulo}
                        {v.base && (
                          <div className="text-[10px] text-muted-foreground">{v.base}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {v.incideINSS ? "Sim" : "—"}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {v.incideIRRF ? "Sim" : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        {fmtBRL(v.valor)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell colSpan={3} className="text-xs font-semibold">
                      Subtotal Bruto
                    </TableCell>
                    <TableCell className="text-right text-sm font-bold">
                      {fmtBRL(resultado.totalBruto)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={3} className="text-xs text-destructive">
                      (–) INSS
                    </TableCell>
                    <TableCell className="text-right text-xs text-destructive">
                      {fmtBRL(resultado.inss)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={3} className="text-xs text-destructive">
                      (–) IRRF
                    </TableCell>
                    <TableCell className="text-right text-xs text-destructive">
                      {fmtBRL(resultado.irrf)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="border-t bg-primary/5">
                    <TableCell colSpan={3} className="text-sm font-bold text-primary">
                      Total Líquido
                    </TableCell>
                    <TableCell className="text-right text-base font-bold text-primary">
                      {fmtBRL(resultado.totalLiquido)}
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
              <p>
                A rescisão CLT envolve verbas que variam conforme o motivo. As principais são: saldo
                de salário, aviso prévio (trabalhado ou indenizado), 13º proporcional, férias
                vencidas e proporcionais + 1/3, multa do FGTS (40% sem justa causa, 20% no acordo) e
                saque do FGTS.
              </p>
              <p>
                <strong>INSS e IRRF</strong> incidem sobre saldo de salário, aviso prévio{" "}
                <em>trabalhado</em> e 13º proporcional (este último calculado em separado). Não
                incidem sobre aviso prévio indenizado, férias indenizadas + 1/3 e multa do FGTS
                (consolidado pelo STJ — REsp 1.230.957 e STF — Tema 985).
              </p>
              <p>
                O <strong>TRCT</strong> (Termo de Rescisão) deve ser homologado no sindicato para
                contratos acima de 1 ano. O pagamento ocorre em até 10 dias após o término do
                contrato (CLT art. 477, §6º).
              </p>
              <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                Total = Saldo + Aviso + 13º prop. + Férias prop. + 1/3 + Férias vencidas + Multa
                FGTS − INSS − IRRF
              </div>
              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Aviso prévio proporcional:</strong> 30 dias + 3 dias por ano completo
                    trabalhado (Lei 12.506/11), até o teto de 90 dias.
                  </li>
                  <li>
                    <strong>Documentação:</strong> guarde contracheques, ponto e holerites — o ônus
                    da prova em ação trabalhista é do empregador.
                  </li>
                  <li>
                    <strong>Homologação sindical:</strong> obrigatória para contratos com mais de 1
                    ano. Não assine sem comparar com este cálculo.
                  </li>
                  <li>
                    <strong>Prazo para contestar:</strong> ação trabalhista pode ser ajuizada em até
                    2 anos após o desligamento, cobrindo os últimos 5 anos.
                  </li>
                </ul>
              </div>
              <p className="pt-2 text-xs">
                Bases: CLT arts. 477, 482, 484-A, 487; Lei 12.506/2011; Lei 8.036/90; tabelas
                INSS/IRRF {ANO_VIGENTE}. Estimativa — valide com contador antes de uso oficial.
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

function MonthSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 13 }, (_, i) => (
          <SelectItem key={i} value={String(i)}>
            {i} {i === 1 ? "mês" : "meses"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ResultoCol({
  rotulo,
  valor,
  tone = "foreground",
  destaque,
}: {
  rotulo: string;
  valor: number;
  tone?: "primary" | "destructive" | "foreground";
  destaque?: boolean;
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 font-bold ${toneCls} ${destaque ? "text-2xl sm:text-3xl" : "text-xl"}`}>
        {fmtBRL(valor)}
      </p>
    </div>
  );
}

function MiniCard({
  rotulo,
  valor,
  sub,
  unidade,
}: {
  rotulo: string;
  valor: number;
  sub?: string;
  unidade?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
        <p className="text-lg font-bold text-foreground">
          {unidade ? `${valor} ${unidade}` : fmtBRL(valor)}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
