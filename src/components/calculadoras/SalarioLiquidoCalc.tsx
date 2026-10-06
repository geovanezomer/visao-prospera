/**
 * Calculadora de Salário Líquido CLT.
 * Aplica INSS progressivo + IRRF progressivo (com deduções por dependente,
 * pensão alimentícia e outros descontos) sobre o salário bruto.
 *
 * Bases: Lei 8.212/91, Lei 9.250/95 (IRRF), tabelas INSS/IRRF versionadas em engines/calculadoras/tabelas.ts.
 */
import { useMemo, useState } from "react";
import { Download, Info, RotateCcw, Wallet } from "lucide-react";
import { exportCalculadoraPDF } from "@/lib/pdfCalculadora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { calcularINSS, calcularIRRF } from "@/engines/calculadoras/rescisao";
import { getTabelas, ANO_VIGENTE } from "@/engines/calculadoras/tabelas";
import { fmtBRL, fmtPct } from "@/engines/finance/format";

const DEP_DEDUCAO = 189.59;
// Salário-família e faixas INSS vêm de getTabelas() (SSOT anual — Portaria MPS/MF).
const TABELA = getTabelas();
const SALARIO_FAMILIA_TETO = TABELA.salarioFamiliaLimite;
const SALARIO_FAMILIA_VALOR = TABELA.salarioFamiliaCota;

export function SalarioLiquidoCalc() {
  const [salarioBruto, setSalarioBruto] = useState<number>(5000);
  const [dependentes, setDependentes] = useState<number>(0);
  const [filhosSalarioFamilia, setFilhosSalarioFamilia] = useState<number>(0);
  const [pensao, setPensao] = useState<number>(0);
  const [outrosDescontos, setOutrosDescontos] = useState<number>(0);

  const r = useMemo(() => {
    const inss = calcularINSS(salarioBruto);
    // Base IRRF (tradicional) = bruto − INSS − (dependentes × 189,59) − pensão alimentícia.
    // A pensão é passada como parâmetro para NÃO contaminar o cálculo simplificado
    // (Lei 14.848/24) nem o redutor da Lei 15.270/25, que usam o rendimento bruto.
    const baseIRBruta = Math.max(0, salarioBruto - inss - dependentes * DEP_DEDUCAO - pensao);
    const irrf = calcularIRRF(salarioBruto, inss, dependentes, pensao);
    const salarioFamilia =
      salarioBruto <= SALARIO_FAMILIA_TETO ? filhosSalarioFamilia * SALARIO_FAMILIA_VALOR : 0;
    const liquido =
      Math.round((salarioBruto - inss - irrf - pensao - outrosDescontos + salarioFamilia) * 100) /
      100;
    const totalDescontos = Math.round((inss + irrf + pensao + outrosDescontos) * 100) / 100;
    const pctLiquido = salarioBruto > 0 ? liquido / salarioBruto : 0;
    const inssAliquota = salarioBruto > 0 ? inss / salarioBruto : 0;
    const irrfAliquota = baseIRBruta > 0 ? irrf / baseIRBruta : 0;
    return {
      inss,
      irrf,
      baseIRBruta,
      salarioFamilia,
      liquido,
      totalDescontos,
      pctLiquido,
      inssAliquota,
      irrfAliquota,
    };
  }, [salarioBruto, dependentes, filhosSalarioFamilia, pensao, outrosDescontos]);

  function limpar() {
    setSalarioBruto(0);
    setDependentes(0);
    setFilhosSalarioFamilia(0);
    setPensao(0);
    setOutrosDescontos(0);
  }

  async function exportar() {
    await exportCalculadoraPDF({
      title: "Salário Líquido CLT",
      subtitle:
        "Cálculo do líquido após INSS, IRRF e demais descontos (Lei 8.212/91 e Lei 9.250/95).",
      inputs: [
        { label: "Salário bruto", value: fmtBRL(salarioBruto) },
        { label: "Dependentes IRRF", value: String(dependentes) },
        { label: "Filhos (salário-família)", value: String(filhosSalarioFamilia) },
        { label: "Pensão alimentícia", value: fmtBRL(pensao) },
        { label: "Outros descontos", value: fmtBRL(outrosDescontos) },
      ],
      kpis: [
        {
          label: "Salário líquido",
          value: fmtBRL(r.liquido),
          sub: `${fmtPct(r.pctLiquido)} do bruto`,
          tone: "ok",
        },
        {
          label: "INSS",
          value: fmtBRL(r.inss),
          sub: `Alíquota efetiva ${fmtPct(r.inssAliquota)}`,
          tone: "warn",
        },
        {
          label: "IRRF",
          value: r.irrf > 0 ? fmtBRL(r.irrf) : "Isento",
          sub: `Alíquota ${fmtPct(r.irrfAliquota)}`,
          tone: r.irrf > 0 ? "warn" : "ok",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Resumo detalhado",
          head: ["Descrição", "Valor"],
          body: [
            ["Salário bruto", fmtBRL(salarioBruto)],
            ["(−) INSS", fmtBRL(r.inss)],
            ["(−) IRRF", r.irrf > 0 ? fmtBRL(r.irrf) : "Isento"],
            ...(pensao > 0 ? [["(−) Pensão alimentícia", fmtBRL(pensao)]] : []),
            ...(outrosDescontos > 0 ? [["(−) Outros descontos", fmtBRL(outrosDescontos)]] : []),
            ["Total de descontos", fmtBRL(r.totalDescontos)],
            ...(r.salarioFamilia > 0 ? [["(+) Salário-família", fmtBRL(r.salarioFamilia)]] : []),
            ["Salário líquido", fmtBRL(r.liquido)],
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
            <Wallet className="h-5 w-5 text-primary" /> Salário Líquido CLT
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Calcule quanto cai na sua conta após INSS, IRRF e demais descontos da folha.
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

      {/* Inputs em 3 colunas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={1} /> Remuneração
            </CardTitle>
            <CardDescription>Salário bruto mensal antes de descontos.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Salário Bruto">
              <MoneyInput value={salarioBruto} onChange={setSalarioBruto} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={2} /> Dependentes
            </CardTitle>
            <CardDescription>Informações para dedução de IRRF e salário-família.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field
              label="Total de Dependentes"
              hint="Cada dependente reduz a base do IR em R$ 189,59/mês."
            >
              <Input
                type="number"
                min={0}
                value={dependentes || ""}
                onChange={(e) => setDependentes(Number(e.target.value) || 0)}
              />
            </Field>
            <Field
              label="Filhos menores de 14 anos"
              hint={`Usado para salário-família (renda ≤ ${fmtBRL(SALARIO_FAMILIA_TETO)}).`}
            >
              <Input
                type="number"
                min={0}
                value={filhosSalarioFamilia || ""}
                onChange={(e) => setFilhosSalarioFamilia(Number(e.target.value) || 0)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Step n={3} /> Outros Descontos
            </CardTitle>
            <CardDescription>Pensão alimentícia e demais descontos em folha.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Pensão Alimentícia" hint="Deduzida antes do cálculo do IRRF.">
              <MoneyInput value={pensao} onChange={setPensao} />
            </Field>
            <Field label="Outros Descontos" hint="VT, plano de saúde, contribuição sindical etc.">
              <MoneyInput value={outrosDescontos} onChange={setOutrosDescontos} />
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* Resultado */}
      {salarioBruto > 0 && (
        <>
          <Card className="border-2 border-emerald-500/40 bg-emerald-500/5">
            <CardContent className="py-6 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Seu Salário Líquido
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400 sm:text-5xl">
                {fmtBRL(r.liquido)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{fmtPct(r.pctLiquido)} do bruto</p>

              {/* Barra visual */}
              <div className="mt-4 px-2 sm:px-8">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Bruto: {fmtBRL(salarioBruto)}</span>
                  <span>Líquido: {fmtBRL(r.liquido)}</span>
                </div>
                <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-muted">
                  <div className="bg-emerald-500" style={{ width: `${r.pctLiquido * 100}%` }} />
                  <div
                    className="bg-destructive/60"
                    style={{ width: `${(1 - r.pctLiquido) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Você recebe
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-destructive/60" /> Descontos (
                    {fmtPct(1 - r.pctLiquido)})
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* INSS + IRRF cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs font-medium text-muted-foreground">INSS</p>
                <p className="text-2xl font-bold text-destructive">− {fmtBRL(r.inss)}</p>
                <div className="space-y-0.5 text-xs">
                  <Row label="Base de cálculo" value={fmtBRL(salarioBruto)} />
                  <Row
                    label="Alíquota efetiva"
                    value={
                      <Badge variant="outline" className="border-destructive/30 text-destructive">
                        {fmtPct(r.inssAliquota)}
                      </Badge>
                    }
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs font-medium text-muted-foreground">IRRF</p>
                <p
                  className={`text-2xl font-bold ${r.irrf > 0 ? "text-destructive" : "text-emerald-600"}`}
                >
                  {r.irrf > 0 ? `− ${fmtBRL(r.irrf)}` : "Isento"}
                </p>
                <div className="space-y-0.5 text-xs">
                  <Row label="Base de cálculo" value={fmtBRL(r.baseIRBruta)} />
                  <Row
                    label="Alíquota"
                    value={
                      <Badge
                        variant="outline"
                        className={
                          r.irrf > 0
                            ? "border-destructive/30 text-destructive"
                            : "border-emerald-500/30 text-emerald-600"
                        }
                      >
                        {fmtPct(r.irrfAliquota)}
                      </Badge>
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Resumo detalhado */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo Detalhado</CardTitle>
              <CardDescription>Composição completa do seu contra-cheque.</CardDescription>
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
                    <TableCell className="text-sm font-medium">Salário Bruto</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {fmtBRL(salarioBruto)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/30">
                    <TableCell
                      colSpan={2}
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      Descontos
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">
                      INSS{" "}
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {fmtPct(r.inssAliquota)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-destructive">
                      − {fmtBRL(r.inss)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm">
                      IRRF{" "}
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {fmtPct(r.irrfAliquota)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.irrf > 0 ? (
                        <span className="text-destructive">− {fmtBRL(r.irrf)}</span>
                      ) : (
                        <span className="text-emerald-600">Isento</span>
                      )}
                    </TableCell>
                  </TableRow>
                  {pensao > 0 && (
                    <TableRow>
                      <TableCell className="text-sm">Pensão Alimentícia</TableCell>
                      <TableCell className="text-right text-sm text-destructive">
                        − {fmtBRL(pensao)}
                      </TableCell>
                    </TableRow>
                  )}
                  {outrosDescontos > 0 && (
                    <TableRow>
                      <TableCell className="text-sm">Outros Descontos</TableCell>
                      <TableCell className="text-right text-sm text-destructive">
                        − {fmtBRL(outrosDescontos)}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className="bg-muted/30">
                    <TableCell className="text-sm font-semibold">Total de Descontos</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-destructive">
                      − {fmtBRL(r.totalDescontos)}
                    </TableCell>
                  </TableRow>
                  {r.salarioFamilia > 0 && (
                    <TableRow>
                      <TableCell className="text-sm">
                        (+) Salário-Família ({filhosSalarioFamilia} ×{" "}
                        {fmtBRL(SALARIO_FAMILIA_VALOR)})
                      </TableCell>
                      <TableCell className="text-right text-sm text-emerald-600">
                        + {fmtBRL(r.salarioFamilia)}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className="border-t-2">
                    <TableCell className="text-base font-bold">Salário Líquido</TableCell>
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
              <p>
                O <strong>salário líquido</strong> é o valor que o trabalhador CLT efetivamente
                recebe após todos os descontos obrigatórios. A legislação prevê dois descontos
                principais: a contribuição ao <strong>INSS</strong>
                (Previdência Social) e o <strong>IRRF</strong> (Imposto de Renda Retido na Fonte).
                Ambos seguem tabelas progressivas — alíquotas maiores incidem apenas sobre a parcela
                do salário que ultrapassa cada faixa.
              </p>
              <p>
                O cálculo segue uma ordem específica: primeiro desconta-se o INSS, pois a base do
                IRRF já considera o INSS como dedução. Em seguida aplica-se a tabela do IR sobre a
                base resultante. Cada dependente reduz a base do IR em <strong>R$ 189,59</strong>.
                Beneficiários do Salário-Família (renda bruta até {fmtBRL(SALARIO_FAMILIA_TETO)})
                recebem acréscimo de {fmtBRL(SALARIO_FAMILIA_VALOR)} por filho menor de 14 anos.
              </p>
              <div className="rounded-md bg-muted/40 p-3 font-mono text-xs">
                Base IRRF = Salário Bruto − INSS − (Dependentes × R$ 189,59) − Pensão
                <br />
                Salário Líquido = Salário Bruto − INSS − IRRF − Pensão − Outros + Salário-Família
              </div>

              <p className="pt-2 font-medium text-foreground">Tabela INSS {ANO_VIGENTE}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Faixa salarial</TableHead>
                    <TableHead className="text-xs">Alíquota</TableHead>
                    <TableHead className="text-xs">Desconto máx na faixa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TABELA.inssFaixas.map((f, idx) => {
                    const prev = idx === 0 ? 0 : TABELA.inssFaixas[idx - 1].ate;
                    const larguraFaixa = f.ate - prev;
                    const descontoMax = larguraFaixa * f.aliquota;
                    const faixaLabel =
                      idx === 0
                        ? `Até ${fmtBRL(f.ate)}`
                        : `${fmtBRL(prev + 0.01)} a ${fmtBRL(f.ate)}`;
                    return (
                      <TableRow key={f.ate}>
                        <TableCell className="text-xs">{faixaLabel}</TableCell>
                        <TableCell className="text-xs">{fmtPct(f.aliquota)}</TableCell>
                        <TableCell className="text-xs">{fmtBRL(descontoMax)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="space-y-1 pt-2">
                <p className="font-medium text-foreground">Dicas</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong>Declare dependentes no IR:</strong> cada dependente reduz a base em R$
                    189,59/mês — economia real de até R$ 52,14/mês na maior alíquota (27,5%).
                  </li>
                  <li>
                    <strong>Contribuição voluntária ao PGBL:</strong> aportes em PGBL deduzem até
                    12% da renda bruta anual na declaração completa.
                  </li>
                  <li>
                    <strong>Cheque o Salário-Família:</strong> se seu bruto for até{" "}
                    {fmtBRL(SALARIO_FAMILIA_TETO)}, você tem direito a{" "}
                    {fmtBRL(SALARIO_FAMILIA_VALOR)} por filho menor de 14 anos — basta apresentar
                    certidão de nascimento ao RH.
                  </li>
                  <li>
                    <strong>Desconto marginal:</strong> entre {fmtBRL(TABELA.inssFaixas[2].ate)} e{" "}
                    {fmtBRL(TABELA.inssTeto)} o INSS adicional é 14% — para cada R$ 1.000 a mais no
                    bruto, R$ 140 vão para o INSS antes do IR.
                  </li>
                </ul>
              </div>
              <p className="pt-2 text-xs">
                Bases: Lei 8.212/91 (custeio previdenciário), Lei 9.250/95 (IRRF), tabelas INSS/IRRF
                vigentes {ANO_VIGENTE}. IRRF conforme Lei nº 15.270/2025 (redutor até R$ 7.350).
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
