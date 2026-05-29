import { useMemo, useState } from "react";
import { AppState } from "@/lib/finance/types";
import { applyWizard, WIZARD_DEFAULTS, WizardAnswers, wizardSchema, buildRevenueCurve } from "@/lib/finance/guided/wizardToState";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { fmtBRL } from "@/lib/finance/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Briefcase, Store, Factory, ArrowLeft, ArrowRight, Sparkles, Check, AlertCircle, Users, Wallet, Receipt, Calendar, Building, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";

const STEP_COUNT = 7;

export function GuidedWizard({
  open,
  onOpenChange,
  baseState,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  baseState: AppState;
  onApply: (newState: AppState) => void;
}) {
  const [step, setStep] = useState(1);
  const [a, setA] = useState<WizardAnswers>({
    ...WIZARD_DEFAULTS,
    businessType: baseState.businessType,
    companyName: baseState.companyName,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (patch: Partial<WizardAnswers>) => setA((s) => ({ ...s, ...patch }));

  const validateCurrent = (): boolean => {
    // valida só o que importa para este passo, mas usa o schema completo no fim
    try {
      wizardSchema.parse(a);
      setErrors({});
      return true;
    } catch (e) {
      if (e instanceof z.ZodError) {
        const map: Record<string, string> = {};
        e.errors.forEach((err) => {
          map[err.path.join(".")] = err.message;
        });
        setErrors(map);
      }
      return false;
    }
  };

  const next = () => setStep((s) => Math.min(STEP_COUNT + 1, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const handleFinish = () => {
    if (!validateCurrent()) return;
    const newState = applyWizard(a, baseState);
    onApply(newState);
    onOpenChange(false);
    setStep(1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Modo Guiado — Setup em {STEP_COUNT} passos
          </DialogTitle>
        </DialogHeader>

        <ProgressBar step={Math.min(step, STEP_COUNT)} total={STEP_COUNT} />

        <div className="min-h-[340px] py-2">
          {step === 1 && <Step1 a={a} update={update} />}
          {step === 2 && <Step2 a={a} update={update} err={errors} />}
          {step === 3 && <Step3 a={a} update={update} />}
          {step === 4 && <Step4 a={a} update={update} err={errors} />}
          {step === 5 && <Step5 a={a} update={update} err={errors} />}
          {step === 6 && <Step6 a={a} update={update} />}
          {step === 7 && <Step7 a={a} update={update} err={errors} />}
          {step === STEP_COUNT + 1 && <Summary a={a} baseState={baseState} />}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={prev}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
            )}
            {step <= STEP_COUNT ? (
              <Button onClick={next}>
                Próximo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleFinish}>
                <Check className="mr-2 h-4 w-4" /> Aplicar ao plano
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Passo {step} de {total}</span>
        <span>{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ============ Steps ============

function StepHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] text-neg">
      <AlertCircle className="h-3 w-3" /> {msg}
    </p>
  );
}

type StepProps = { a: WizardAnswers; update: (p: Partial<WizardAnswers>) => void; err?: Record<string, string> };

function Step1({ a, update }: StepProps) {
  const opts: { id: WizardAnswers["businessType"]; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: "servicos", label: "Serviços", desc: "Consultoria, agência, técnica", icon: <Briefcase className="h-5 w-5" /> },
    { id: "comercio", label: "Comércio", desc: "Loja, revenda, e-commerce", icon: <Store className="h-5 w-5" /> },
    { id: "industria", label: "Indústria", desc: "Fabricação, transformação", icon: <Factory className="h-5 w-5" /> },
  ];
  return (
    <div>
      <StepHeader icon={<Building className="h-5 w-5" />} title="Que tipo de negócio é o seu?" subtitle="Define o tipo de custo de vendas (CSP/CMV/CPV) e os benchmarks que vamos usar." />
      <div className="grid gap-3 sm:grid-cols-3">
        {opts.map((o) => (
          <button
            key={o.id}
            onClick={() => update({ businessType: o.id })}
            className={cn(
              "rounded-lg border p-4 text-left transition",
              a.businessType === o.id ? "border-primary bg-primary/10" : "border-border/60 bg-card/40 hover:border-primary/60",
            )}
          >
            <div className="text-primary">{o.icon}</div>
            <div className="mt-2 text-sm font-semibold">{o.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{o.desc}</div>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nome da empresa</label>
        <input
          value={a.companyName}
          onChange={(e) => update({ companyName: e.target.value.slice(0, 120) })}
          className="mt-1 w-full rounded-md border border-border/60 bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          maxLength={120}
        />
      </div>
    </div>
  );
}

function Step2({ a, update, err }: StepProps) {
  const seasOpts: { id: WizardAnswers["seasonality"]; label: string; desc: string }[] = [
    { id: "estavel", label: "Estável", desc: "Receita parecida todo mês" },
    { id: "sazonal", label: "Sazonal", desc: "Variação ±15%, pico em dezembro" },
    { id: "crescimento", label: "Crescimento", desc: "Sobe linearmente no ano" },
  ];
  const preview = buildRevenueCurve(a.faturamentoMensal, a.seasonality);
  const annual = preview.reduce((acc, v) => acc + v, 0);
  return (
    <div>
      <StepHeader icon={<TrendingUp className="h-5 w-5" />} title="Quanto sua empresa fatura?" subtitle="Valor médio mensal. Vamos distribuir nos 12 meses conforme a sazonalidade." />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Faturamento mensal médio</label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            <input
              type="number"
              min={0}
              value={a.faturamentoMensal}
              onChange={(e) => update({ faturamentoMensal: parseFloat(e.target.value) || 0 })}
              className="num w-full rounded-md border border-border/60 bg-input/40 px-9 py-2 text-right text-sm outline-none focus:border-primary"
            />
          </div>
          <FieldError msg={err?.faturamentoMensal} />
          <p className="mt-2 text-[11px] text-muted-foreground">Anual projetado: <span className="font-semibold text-foreground">{fmtBRL(annual)}</span></p>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sazonalidade</label>
          <div className="mt-1 space-y-2">
            {seasOpts.map((s) => (
              <button
                key={s.id}
                onClick={() => update({ seasonality: s.id })}
                className={cn(
                  "block w-full rounded-md border p-2 text-left transition",
                  a.seasonality === s.id ? "border-primary bg-primary/10" : "border-border/60 bg-card/40 hover:border-primary/60",
                )}
              >
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-[11px] text-muted-foreground">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step3({ a, update }: StepProps) {
  const presets: { id: string; label: string; pmr: number; pmp: number }[] = [
    { id: "vista", label: "Recebo e pago à vista", pmr: 0, pmp: 0 },
    { id: "30", label: "30 dias para receber e pagar", pmr: 30, pmp: 30 },
    { id: "306090", label: "Vendo 30/60/90, pago em 30", pmr: 60, pmp: 30 },
    { id: "custom", label: "Personalizar", pmr: a.pmr, pmp: a.pmp },
  ];
  return (
    <div>
      <StepHeader icon={<Calendar className="h-5 w-5" />} title="Prazos médios de recebimento e pagamento" subtitle="PMR = dias entre venda e recebimento. PMP = dias entre compra e pagamento ao fornecedor." />
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => update({ pmr: p.pmr, pmp: p.pmp })}
            className={cn(
              "rounded-md border p-3 text-left text-sm transition",
              a.pmr === p.pmr && a.pmp === p.pmp ? "border-primary bg-primary/10" : "border-border/60 bg-card/40 hover:border-primary/60",
            )}
          >
            <div className="font-medium">{p.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">PMR {p.pmr}d · PMP {p.pmp}d</div>
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <NumberField label="PMR (dias para receber)" value={a.pmr} onChange={(v) => update({ pmr: v })} max={180} />
        <NumberField label="PMP (dias para pagar)" value={a.pmp} onChange={(v) => update({ pmp: v })} max={180} />
      </div>
    </div>
  );
}

function Step4({ a, update, err }: StepProps) {
  const total = a.funcionarios * a.salarioMedio;
  return (
    <div>
      <StepHeader icon={<Users className="h-5 w-5" />} title="Equipe CLT" subtitle="Quantos funcionários CLT e o salário médio. Encargos (~70%) são adicionados automaticamente." />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Nº de funcionários" value={a.funcionarios} onChange={(v) => update({ funcionarios: Math.round(v) })} max={9999} err={err?.funcionarios} />
        <NumberField label="Salário médio (R$)" value={a.salarioMedio} onChange={(v) => update({ salarioMedio: v })} max={1_000_000} err={err?.salarioMedio} prefix="R$" />
      </div>
      <div className="mt-4 rounded-md border border-border/60 bg-card/40 p-3 text-xs">
        <span className="text-muted-foreground">Folha bruta estimada:</span>{" "}
        <span className="font-semibold">{fmtBRL(total)}/mês</span>
        <div className="mt-1 text-[11px] text-muted-foreground">Com encargos (70%): {fmtBRL(total * 1.7)}/mês</div>
      </div>
    </div>
  );
}

function Step5({ a, update, err }: StepProps) {
  const total = a.aluguel + a.software + a.marketing + a.outrosFixos;
  return (
    <div>
      <StepHeader icon={<Wallet className="h-5 w-5" />} title="Custos fixos mensais" subtitle="Valores médios por mês. Pode deixar 0 se não se aplica." />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Aluguel" value={a.aluguel} onChange={(v) => update({ aluguel: v })} prefix="R$" err={err?.aluguel} />
        <NumberField label="Software / SaaS" value={a.software} onChange={(v) => update({ software: v })} prefix="R$" err={err?.software} />
        <NumberField label="Marketing" value={a.marketing} onChange={(v) => update({ marketing: v })} prefix="R$" err={err?.marketing} />
        <NumberField label="Outros fixos" value={a.outrosFixos} onChange={(v) => update({ outrosFixos: v })} prefix="R$" err={err?.outrosFixos} />
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        Total fixo mensal informado: <span className="font-semibold text-foreground">{fmtBRL(total)}</span>
      </div>
    </div>
  );
}

function Step6({ a, update }: StepProps) {
  const opts: { id: WizardAnswers["regimeEscolha"]; label: string; desc: string }[] = [
    { id: "simples", label: "Simples Nacional", desc: "Faturamento até R$ 4,8M, alíquota única" },
    { id: "presumido", label: "Lucro Presumido", desc: "Base presumida de IRPJ/CSLL" },
    { id: "real", label: "Lucro Real", desc: "Sobre o lucro efetivo (obrigatório acima de R$ 78M)" },
    { id: "auto", label: "Não sei — sugira para mim", desc: "Calculamos o regime de menor carga com seus dados" },
  ];
  return (
    <div>
      <StepHeader icon={<Receipt className="h-5 w-5" />} title="Regime tributário atual" subtitle="Se não souber, escolha a última opção e deixamos o sistema sugerir." />
      <div className="space-y-2">
        {opts.map((o) => (
          <button
            key={o.id}
            onClick={() => update({ regimeEscolha: o.id })}
            className={cn(
              "block w-full rounded-md border p-3 text-left transition",
              a.regimeEscolha === o.id ? "border-primary bg-primary/10" : "border-border/60 bg-card/40 hover:border-primary/60",
            )}
          >
            <div className="text-sm font-medium">{o.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step7({ a, update, err }: StepProps) {
  return (
    <div>
      <StepHeader icon={<Wallet className="h-5 w-5" />} title="Capital e dívida" subtitle="Capital próprio aproximado (patrimônio) e empréstimo onerosos existentes." />
      <NumberField label="Capital próprio aproximado" value={a.capitalProprio} onChange={(v) => update({ capitalProprio: v })} prefix="R$" err={err?.capitalProprio} />
      <div className="mt-4 rounded-md border border-border/60 bg-card/40 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={a.temEmprestimo}
            onChange={(e) => update({ temEmprestimo: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          A empresa tem empréstimo / financiamento ativo
        </label>
        {a.temEmprestimo && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberField label="Saldo devedor (R$)" value={a.saldoDivida} onChange={(v) => update({ saldoDivida: v })} prefix="R$" err={err?.saldoDivida} />
            <NumberField label="Taxa mensal (% a.m.)" value={a.taxaMensal} onChange={(v) => update({ taxaMensal: v })} suffix="%" err={err?.taxaMensal} step={0.1} />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ a, baseState }: { a: WizardAnswers; baseState: AppState }) {
  const newState = useMemo(() => applyWizard(a, baseState), [a, baseState]);
  const { dre } = buildDRE(newState, newState.tax.regime);
  const ind = calcIndicators(newState, dre);
  const items = [
    { label: "Receita anual", value: fmtBRL(dre.receitaBruta.reduce((s, v) => s + v, 0)) },
    { label: "EBITDA", value: fmtBRL(dre.ebitda.reduce((s, v) => s + v, 0)) },
    { label: "Margem EBITDA", value: `${ind.margemEbitda.toFixed(1)}%` },
    { label: "Lucro Líquido", value: fmtBRL(dre.lucroLiquido.reduce((s, v) => s + v, 0)) },
    { label: "Margem Líquida", value: `${ind.margemLiquida.toFixed(1)}%` },
    { label: "ROIC × WACC", value: `${ind.roic.toFixed(1)}% × ${ind.wacc.toFixed(1)}%` },
    { label: "Ponto de Equilíbrio", value: fmtBRL(ind.pontoEquilibrio) },
    { label: "Necessidade de Capital de Giro", value: fmtBRL(ind.ncg) },
  ];
  return (
    <div>
      <StepHeader icon={<Check className="h-5 w-5" />} title="Tudo pronto!" subtitle="Veja como seus números ficam. Você pode ajustar qualquer campo nas abas a qualquer momento." />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="rounded-md border border-border/60 bg-card/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{it.label}</div>
            <div className="mono mt-1 text-sm font-semibold">{it.value}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Regime tributário aplicado: <span className="font-semibold text-foreground">{labelRegime(newState.tax.regime)}</span>.
        Vá à aba <span className="font-semibold text-foreground">Diagnóstico</span> para ver alertas e ações recomendadas.
      </p>
    </div>
  );
}

function labelRegime(r: AppState["tax"]["regime"]) {
  return r === "simples" ? "Simples Nacional" : r === "presumido" ? "Lucro Presumido" : "Lucro Real";
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  max,
  step = 1,
  err,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  max?: number;
  step?: number;
  err?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="relative mt-1">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
        <input
          type="number"
          min={0}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={cn(
            "num w-full rounded-md border border-border/60 bg-input/40 py-2 text-right text-sm outline-none focus:border-primary",
            prefix ? "px-9" : "px-3",
            suffix ? "pr-7" : "",
          )}
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      <FieldError msg={err} />
    </div>
  );
}
