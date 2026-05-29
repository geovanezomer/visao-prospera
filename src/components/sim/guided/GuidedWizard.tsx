import { useMemo, useState } from "react";
import { AppState } from "@/lib/finance/types";
import {
  applyWizard,
  WIZARD_DEFAULTS,
  WizardAnswers,
  wizardSchema,
  buildRevenueCurve,
  MARGEM_DEFAULTS,
  ESTOQUE_DEFAULTS,
} from "@/lib/finance/guided/wizardToState";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { fmtBRL } from "@/lib/finance/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Store,
  Factory,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Check,
  AlertCircle,
  Users,
  Wallet,
  Receipt,
  Calendar,
  Building,
  TrendingUp,
  Percent,
  CreditCard,
  UserCog,
  Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";

type StepProps = {
  a: WizardAnswers;
  update: (p: Partial<WizardAnswers>) => void;
  err?: Record<string, string>;
};

type StepDef = {
  id: string;
  render: (p: StepProps) => React.ReactNode;
  /** Se retornar false, o passo é pulado para esse businessType. */
  show?: (a: WizardAnswers) => boolean;
};

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
    margemCustoVendasPct: MARGEM_DEFAULTS[baseState.businessType],
    diasEstoque: ESTOQUE_DEFAULTS[baseState.businessType],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (patch: Partial<WizardAnswers>) => {
    setA((s) => {
      const next = { ...s, ...patch };
      // Quando muda o setor, ajusta defaults de margem/estoque se ainda estavam no default antigo
      if (patch.businessType && patch.businessType !== s.businessType) {
        if (s.margemCustoVendasPct === MARGEM_DEFAULTS[s.businessType]) {
          next.margemCustoVendasPct = MARGEM_DEFAULTS[patch.businessType];
        }
        if (s.diasEstoque === ESTOQUE_DEFAULTS[s.businessType]) {
          next.diasEstoque = ESTOQUE_DEFAULTS[patch.businessType];
        }
      }
      return next;
    });
  };

  // ===== Definição dinâmica dos passos =====
  const steps: StepDef[] = useMemo(
    () => [
      { id: "negocio", render: (p) => <StepNegocio {...p} /> },
      { id: "receita", render: (p) => <StepReceita {...p} /> },
      { id: "margem", render: (p) => <StepMargem {...p} /> },
      { id: "vendas", render: (p) => <StepVendas {...p} /> },
      { id: "equipe", render: (p) => <StepEquipe {...p} /> },
      { id: "socios", render: (p) => <StepSocios {...p} /> },
      { id: "fixos", render: (p) => <StepFixos {...p} /> },
      {
        id: "estoque",
        render: (p) => <StepEstoque {...p} />,
        show: (ans) => ans.businessType !== "servicos",
      },
      { id: "regime", render: (p) => <StepRegime {...p} /> },
      { id: "capital", render: (p) => <StepCapital {...p} /> },
    ],
    [],
  );

  const visibleSteps = steps.filter((s) => !s.show || s.show(a));
  const totalSteps = visibleSteps.length;
  const summaryStep = totalSteps + 1;

  const validateAll = (): boolean => {
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

  const next = () => setStep((s) => Math.min(summaryStep, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const handleFinish = () => {
    if (!validateAll()) return;
    const newState = applyWizard(a, baseState);
    onApply(newState);
    onOpenChange(false);
    setStep(1);
  };

  const currentStepIdx = Math.min(step, totalSteps) - 1;
  const currentStepDef = visibleSteps[currentStepIdx];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Modo Guiado — Setup em {totalSteps} passos
          </DialogTitle>
        </DialogHeader>

        <ProgressBar step={Math.min(step, totalSteps)} total={totalSteps} />

        <div className="min-h-[340px] py-2">
          {step <= totalSteps
            ? currentStepDef?.render({ a, update, err: errors })
            : <Summary a={a} baseState={baseState} />}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <div className="flex gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={prev}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
            )}
            {step <= totalSteps ? (
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

// ============ Helpers ============

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

function PresetRow({
  presets,
  current,
  onPick,
  fmt,
}: {
  presets: number[];
  current: number;
  onPick: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] transition",
            current === p
              ? "border-primary bg-primary/10 text-primary"
              : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/60",
          )}
        >
          {fmt ? fmt(p) : p}
        </button>
      ))}
    </div>
  );
}

// ============ Steps ============

function StepNegocio({ a, update }: StepProps) {
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

function StepReceita({ a, update, err }: StepProps) {
  const seasOpts: { id: WizardAnswers["seasonality"]; label: string; desc: string }[] = [
    { id: "estavel", label: "Estável", desc: "Receita parecida todo mês" },
    { id: "sazonal", label: "Sazonal", desc: "Variação ±15%, pico em dezembro" },
    { id: "crescimento", label: "Crescimento", desc: "Sobe ao longo do ano" },
  ];
  const preview = buildRevenueCurve(a.faturamentoMensal, a.seasonality, a.crescimentoAA);
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

      {a.seasonality === "crescimento" && (
        <div className="mt-4 rounded-md border border-border/60 bg-card/40 p-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Taxa de crescimento esperada (% ao ano)
          </label>
          <NumberField
            label=""
            value={a.crescimentoAA}
            onChange={(v) => update({ crescimentoAA: v })}
            suffix="% a.a."
            step={1}
            err={err?.crescimentoAA}
          />
          <PresetRow
            presets={[0, 10, 20, 30, 50, 100]}
            current={a.crescimentoAA}
            onPick={(v) => update({ crescimentoAA: v })}
            fmt={(v) => `${v}%`}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A média anual permanece igual ao faturamento informado — o que muda é a distribuição entre meses (composto mensal).
          </p>
        </div>
      )}
    </div>
  );
}

function StepMargem({ a, update, err }: StepProps) {
  const cvLabel =
    a.businessType === "industria" ? "CPV (Custo do Produto)" :
    a.businessType === "comercio" ? "CMV (Custo da Mercadoria)" :
    "CSP (Custo do Serviço)";
  const margemBruta = 100 - a.margemCustoVendasPct;
  const cmvMensal = (a.faturamentoMensal * a.margemCustoVendasPct) / 100;
  return (
    <div>
      <StepHeader
        icon={<Percent className="h-5 w-5" />}
        title="Margem — qual é o custo de cada venda?"
        subtitle={`A cada R$ 100 que você fatura, quanto vai embora em ${cvLabel.toLowerCase()}? Define seu lucro bruto.`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <NumberField
            label={`${cvLabel} sobre a receita`}
            value={a.margemCustoVendasPct}
            onChange={(v) => update({ margemCustoVendasPct: v })}
            suffix="%"
            step={1}
            err={err?.margemCustoVendasPct}
          />
          <PresetRow
            presets={[20, 30, 45, 55, 65, 75]}
            current={a.margemCustoVendasPct}
            onPick={(v) => update({ margemCustoVendasPct: v })}
            fmt={(v) => `${v}%`}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Benchmark do setor: <span className="font-semibold text-foreground">{MARGEM_DEFAULTS[a.businessType]}%</span>
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/40 p-3 text-xs">
          <div className="text-muted-foreground">Custo de vendas mensal médio:</div>
          <div className="mono mt-1 text-sm font-semibold">{fmtBRL(cmvMensal)}</div>
          <div className="mt-3 text-muted-foreground">Margem bruta resultante:</div>
          <div className={cn("mono mt-1 text-sm font-semibold", margemBruta < 25 ? "text-neg" : margemBruta < 45 ? "text-warn" : "text-pos")}>
            {margemBruta.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function StepVendas({ a, update, err }: StepProps) {
  const presets: { id: string; label: string; pmr: number; pmp: number }[] = [
    { id: "vista", label: "À vista", pmr: 0, pmp: 0 },
    { id: "30", label: "30/30", pmr: 30, pmp: 30 },
    { id: "306090", label: "30/60/90 venda, 30 compra", pmr: 60, pmp: 30 },
  ];
  return (
    <div>
      <StepHeader
        icon={<Calendar className="h-5 w-5" />}
        title="Vendas, recebimentos e inadimplência"
        subtitle="Prazos médios, perdas com calote e impacto da maquininha de cartão."
      />

      <div className="space-y-4">
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prazos médios</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => update({ pmr: p.pmr, pmp: p.pmp })}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition",
                  a.pmr === p.pmr && a.pmp === p.pmp
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/60",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberField label="PMR (dias para receber)" value={a.pmr} onChange={(v) => update({ pmr: v })} max={180} err={err?.pmr} />
            <NumberField label="PMP (dias para pagar)" value={a.pmp} onChange={(v) => update({ pmp: v })} max={180} err={err?.pmp} />
          </div>
        </section>

        <section className="rounded-md border border-border/60 bg-card/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inadimplência</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <NumberField
                label="% de calote / atraso"
                value={a.inadimplenciaPct}
                onChange={(v) => update({ inadimplenciaPct: v })}
                suffix="%"
                step={0.5}
                err={err?.inadimplenciaPct}
              />
              <PresetRow
                presets={[0, 1, 2, 5, 10]}
                current={a.inadimplenciaPct}
                onPick={(v) => update({ inadimplenciaPct: v })}
                fmt={(v) => `${v}%`}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-input/40 p-2 text-xs">
              <input
                type="checkbox"
                checked={a.inadimplenciaComoPDD}
                onChange={(e) => update({ inadimplenciaComoPDD: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="font-semibold text-foreground">Tratar como PDD</span>
                <span className="block text-[11px] text-muted-foreground">
                  Lança o calote como despesa operacional (Provisão Devedores Duvidosos). Mais correto contabilmente (CPC 47) — não reduz base de PIS/COFINS/ISS.
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-md border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> Cartão / maquininha
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <NumberField
                label="% das vendas no cartão"
                value={a.percentualCartao}
                onChange={(v) => update({ percentualCartao: v })}
                suffix="%"
                err={err?.percentualCartao}
              />
              <PresetRow
                presets={[0, 25, 50, 75, 100]}
                current={a.percentualCartao}
                onPick={(v) => update({ percentualCartao: v })}
                fmt={(v) => `${v}%`}
              />
            </div>
            <div>
              <NumberField
                label="Taxa média da maquininha"
                value={a.taxaCartaoPct}
                onChange={(v) => update({ taxaCartaoPct: v })}
                suffix="%"
                step={0.1}
                err={err?.taxaCartaoPct}
              />
              <PresetRow
                presets={[1.5, 2.0, 2.5, 3.5, 5.0]}
                current={a.taxaCartaoPct}
                onPick={(v) => update({ taxaCartaoPct: v })}
                fmt={(v) => `${v}%`}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Custo mensal de cartão estimado:{" "}
            <span className="font-semibold text-foreground">
              {fmtBRL((a.faturamentoMensal * a.percentualCartao * a.taxaCartaoPct) / 10000)}
            </span>
          </p>
        </section>
      </div>
    </div>
  );
}

function StepEquipe({ a, update, err }: StepProps) {
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

function StepSocios({ a, update, err }: StepProps) {
  const proLaboreTotal = a.numeroSocios * a.proLaboreMedio;
  const comissaoMensal = (a.faturamentoMensal * a.comissaoVendasPct) / 100;
  return (
    <div>
      <StepHeader
        icon={<UserCog className="h-5 w-5" />}
        title="Sócios e comissões"
        subtitle="Pró-labore é separado da folha CLT (INSS de 11% só) e impacta o Fator R do Simples."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="Nº de sócios com pró-labore"
          value={a.numeroSocios}
          onChange={(v) => update({ numeroSocios: Math.round(v) })}
          max={20}
          err={err?.numeroSocios}
        />
        <NumberField
          label="Pró-labore médio (R$/sócio)"
          value={a.proLaboreMedio}
          onChange={(v) => update({ proLaboreMedio: v })}
          prefix="R$"
          err={err?.proLaboreMedio}
        />
      </div>

      <div className="mt-4 rounded-md border border-border/60 bg-card/40 p-3">
        <NumberField
          label="Comissão de vendas (% sobre receita)"
          value={a.comissaoVendasPct}
          onChange={(v) => update({ comissaoVendasPct: v })}
          suffix="%"
          step={0.5}
          err={err?.comissaoVendasPct}
        />
        <PresetRow
          presets={[0, 1, 3, 5, 10]}
          current={a.comissaoVendasPct}
          onPick={(v) => update({ comissaoVendasPct: v })}
          fmt={(v) => `${v}%`}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Comissão mensal estimada: <span className="font-semibold text-foreground">{fmtBRL(comissaoMensal)}</span>
        </p>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Pró-labore total: <span className="font-semibold text-foreground">{fmtBRL(proLaboreTotal)}/mês</span>
      </div>
    </div>
  );
}

function StepFixos({ a, update, err }: StepProps) {
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

function StepEstoque({ a, update, err }: StepProps) {
  const cmvMensal = (a.faturamentoMensal * a.margemCustoVendasPct) / 100;
  const saldoEstoque = (cmvMensal * a.diasEstoque) / 30;
  return (
    <div>
      <StepHeader
        icon={<Boxes className="h-5 w-5" />}
        title="Giro de estoque"
        subtitle="Quantos dias de estoque sua empresa mantém. Impacta diretamente a Necessidade de Capital de Giro."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <NumberField
            label="Dias médios de estoque"
            value={a.diasEstoque}
            onChange={(v) => update({ diasEstoque: Math.round(v) })}
            suffix="dias"
            err={err?.diasEstoque}
          />
          <PresetRow
            presets={[7, 15, 30, 45, 60, 90]}
            current={a.diasEstoque}
            onPick={(v) => update({ diasEstoque: v })}
            fmt={(v) => `${v}d`}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Benchmark do setor: <span className="font-semibold text-foreground">{ESTOQUE_DEFAULTS[a.businessType]} dias</span>
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/40 p-3 text-xs">
          <div className="text-muted-foreground">Saldo médio de estoque estimado:</div>
          <div className="mono mt-1 text-sm font-semibold">{fmtBRL(saldoEstoque)}</div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Cada dia adicional imobiliza ~{fmtBRL(cmvMensal / 30)} em capital de giro.
          </div>
        </div>
      </div>
    </div>
  );
}

function StepRegime({ a, update }: StepProps) {
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

function StepCapital({ a, update, err }: StepProps) {
  return (
    <div>
      <StepHeader icon={<Wallet className="h-5 w-5" />} title="Capital e dívida" subtitle="Capital próprio aproximado (patrimônio) e empréstimos onerosos existentes." />
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
      {label && (
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      )}
      <div className={cn("relative", label && "mt-1")}>
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
            suffix ? "pr-16" : "",
          )}
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      <FieldError msg={err} />
    </div>
  );
}
