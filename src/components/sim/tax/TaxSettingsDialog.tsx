import { useState, useMemo } from "react";
import {
  Settings,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
  Building2,
  Landmark,
  Scale,
  FileText,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { NumInput } from "@/components/sim/shared/primitives";
import type { AppState, SimplesAnexo, BusinessType } from "@/engines/finance/types";
import type { FaixaLegal } from "@/engines/finance/tax/validation";
import { FAIXAS_TRIBUTARIAS } from "@/engines/finance/tax/validation";
import { useFinance, usePatchTax } from "@/engines/finance/AppStateContext";
import {
  IRPJ_PCT,
  IRPJ_ADICIONAL_PCT,
  IRPJ_ADICIONAL_GATILHO_TRI,
  CSLL_PCT,
  PIS_CUM_PCT,
  COFINS_CUM_PCT,
  PIS_NAO_CUM_PCT,
  COFINS_NAO_CUM_PCT,
  SIMPLES_LIMITE,
  FATOR_R_MINIMO_PCT,
  SIMPLES_TABLES_DEFAULT,
  PRESUMIDO_BASES_DEFAULT,
  REFORMA_TRANSICAO_IBS_MULT,
  REFORMA_TRANSICAO_ICMS_ISS_MULT,
  CBS_ALIQUOTA_PLENA,
  IBS_ALIQUOTA_PLENA,
  SPLIT_PAYMENT_DEFAULT,
  SPLIT_PAYMENT_ANO_INICIO_DEFAULT,
  SALARIO_MINIMO_DEFAULT,
  INSS_SOCIO_ALIQ_DEFAULT,
  INSS_TETO_DEFAULT,
  INSS_PATRONAL_ALIQ_DEFAULT,
  IRPF_DEPENDENTE_DEDUCAO_DEFAULT,
  IRPF_DESCONTO_SIMPLIFICADO_DEFAULT,
  IRPF_TABLE_DEFAULT,
  type IrpfFaixa,
  type PayrollOverride,
  type TaxRatesOverride,
  type SimplesFaixa,
} from "@/engines/finance/taxDefaults";
import {
  getCbsCredCpvPct,
  getIbsCredCpvPct,
  ALIQ_PRESUMIDA_CBS_SN,
  ALIQ_PRESUMIDA_IBS_SN,
} from "@/engines/finance/tax/reforma";
import { CompanyConfigForm } from "@/components/sim/shared/CompanyConfigDialog";

const ANEXOS: SimplesAnexo[] = ["I", "II", "III", "IV", "V"];
const BUSINESS: { key: BusinessType; label: string; hint: string }[] = [
  { key: "industria", label: "Indústria", hint: "Fabricação e transformação." },
  { key: "comercio", label: "Comércio", hint: "Compra e revenda de mercadorias." },
  { key: "servicos", label: "Serviços", hint: "Prestação de serviços em geral." },
];

// Passos do wizard. Cada um traz um título amigável e ícone próprio.
type StepKey = "intro" | "empresa" | "federais" | "simples" | "presumido" | "folha" | "reforma" | "revisao";
const STEPS: { key: StepKey; label: string; icon: typeof Settings }[] = [
  { key: "intro", label: "Boas-vindas", icon: Sparkles },
  { key: "empresa", label: "Empresa", icon: Building2 },
  { key: "federais", label: "Federais", icon: Landmark },
  { key: "simples", label: "Simples", icon: FileText },
  { key: "presumido", label: "Presumido", icon: Building2 },
  { key: "folha", label: "Folha & Sócios", icon: Building2 },
  { key: "reforma", label: "Reforma", icon: Scale },
  { key: "revisao", label: "Revisão", icon: Check },
];

export function TaxSettingsDialog() {
  const { state } = useFinance();
  const patchTax = usePatchTax();
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const ov = state.tax.ratesOverride ?? {};

  const patchOv = (patch: Partial<TaxRatesOverride>) =>
    patchTax((cur) => ({ ratesOverride: { ...(cur.ratesOverride ?? {}), ...patch } }));

  const resetAll = () => patchTax({ ratesOverride: undefined });

  // Conta quantos parâmetros foram customizados — usado no resumo final.
  const customCount = useMemo(() => {
    let n = 0;
    const keys: (keyof TaxRatesOverride)[] = [
      "irpj",
      "irpjAdicional",
      "irpjAdicionalGatilhoTri",
      "csll",
      "pisCum",
      "cofinsCum",
      "pisNaoCum",
      "cofinsNaoCum",
      "simplesLimite",
      "fatorRMinimo",
      "simplesTables",
      "presumidoBases",
      "reformaTransicaoIbsMult",
      "reformaTransicaoIcmsIssMult",
    ];
    keys.forEach((k) => {
      if (ov[k] !== undefined) n++;
    });
    if (state.tax.cbsAliquota !== undefined) n++;
    if (state.tax.ibsAliquotaRef !== undefined) n++;
    return n;
  }, [ov, state.tax.cbsAliquota, state.tax.ibsAliquotaRef]);

  const step = STEPS[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  const close = () => {
    setOpen(false);
    setTimeout(() => setStepIdx(0), 200);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setTimeout(() => setStepIdx(0), 200);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Configurações da empresa e parâmetros tributários" aria-label="Configurações">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl w-screen h-[100dvh] max-h-[100dvh] rounded-none sm:rounded-lg sm:h-auto sm:max-h-[90vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="border-b border-border/60 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <step.icon className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">
              <span className="hidden sm:inline">Configurações — </span>
              {step.label}
            </span>
          </DialogTitle>
          <DialogDescription>
            Passo {stepIdx + 1} de {STEPS.length}. Todos os campos já vêm preenchidos com os valores
            oficiais. Só mude se você tiver certeza ou quiser simular um cenário.
          </DialogDescription>

          {/* Stepper visual — clicável */}
          <div className="mt-3 flex items-center gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < stepIdx;
              const current = i === stepIdx;
              return (
                <button
                  key={s.key}
                  onClick={() => setStepIdx(i)}
                  className={`flex flex-1 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] transition ${
                    current
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : done
                        ? "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/50"
                        : "border-border/40 text-muted-foreground/60 hover:border-primary/40"
                  }`}
                  title={s.label}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 sm:max-h-[58vh]">
          {step.key === "intro" && <StepIntro customCount={customCount} />}
          {step.key === "empresa" && <StepEmpresa />}
          {step.key === "federais" && (
            <StepFederais ov={ov} patchOv={patchOv} state={state} patchTax={patchTax} />
          )}
          {step.key === "simples" && <StepSimples ov={ov} patchOv={patchOv} />}
          {step.key === "presumido" && (
            <StepPresumido ov={ov} patchOv={patchOv} state={state} patchTax={patchTax} />
          )}
          {step.key === "folha" && <StepFolhaSocios ov={ov} patchOv={patchOv} />}
          {step.key === "reforma" && (
            <StepReforma ov={ov} patchOv={patchOv} state={state} patchTax={patchTax} />
          )}
          {step.key === "revisao" && <StepRevisao customCount={customCount} resetAll={resetAll} />}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 sm:px-6 py-3 shrink-0 bg-card">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            className="min-h-[40px]"
            title="Restaurar todos os campos aos valores oficiais"
          >
            <RotateCcw className="mr-1 sm:mr-2 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Restaurar tudo</span>
            <span className="sm:hidden">Reset</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              disabled={isFirst}
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Voltar</span>
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums sm:hidden">
              {stepIdx + 1}/{STEPS.length}
            </span>
            {isLast ? (
              <Button size="sm" className="min-h-[40px]" onClick={close}>
                <Check className="mr-1 h-3.5 w-3.5" /> Concluir
              </Button>
            ) : (
              <Button
                size="sm"
                className="min-h-[40px]"
                onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
              >
                <span className="hidden sm:inline">Avançar</span>
                <span className="sm:hidden">Próximo</span>
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// PASSOS
// =====================================================================

function StepIntro({ customCount }: { customCount: number }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <p>
        Bem-vindo às <b>Configurações</b> do FinnancePRO. Aqui você define tanto os{" "}
        <b>dados da sua empresa</b> (nome, CNPJ, setor, ramo, número de colaboradores,
        regime tributário e período de análise) quanto as <b>alíquotas e tabelas
        tributárias brasileiras</b> usadas pelos cálculos. Você <b>não precisa</b> ser
        especialista: os valores já vêm preenchidos com os <b>padrões oficiais</b>.
      </p>

      <Callout tone="info" title="Comece pela Empresa">
        <p className="text-[13px]">
          O próximo passo é <b>Empresa</b>: confira nome, CNPJ, setor/ramo, número de
          colaboradores e regime tributário. Esses dados alimentam todos os indicadores
          (por colaborador, por setor) e definem qual passo tributário se aplica a você.
        </p>
      </Callout>

      <Callout tone="info" title="Quando mudar algum valor tributário?">
        <ul className="ml-4 list-disc space-y-1 text-[13px]">
          <li>
            Quando houver <b>mudança regulatória</b> (ex.: novo decreto, lei).
          </li>
          <li>
            Para <b>simular cenários</b> (ex.: "e se o IRPJ subir para 20%?").
          </li>
          <li>
            Quando seu município tiver <b>ISS diferente</b> de 5%.
          </li>
        </ul>
      </Callout>

      <Callout tone="ok" title="O que esperar a seguir">
        <p className="text-[13px]">
          Você passará pela <b>Empresa</b> e por 4 áreas tributárias (Federais, Simples,
          Presumido e Reforma). Em cada uma, os campos vêm com a <b>fonte legal</b> e o
          botão <RotateCcw className="inline h-3 w-3" /> para voltar ao padrão oficial.
          Ao final, uma tela de <b>revisão</b> resume tudo.
        </p>
      </Callout>

      {customCount > 0 && (
        <Callout tone="warn" title={`Atenção: ${customCount} parâmetro(s) já estão customizados`}>
          <p className="text-[13px]">
            Esta empresa já possui ajustes manuais. Você pode mantê-los, editá-los nos próximos
            passos ou usar "Restaurar tudo" no rodapé para voltar a 100% padrão oficial.
          </p>
        </Callout>
      )}
    </div>
  );
}

function StepEmpresa() {
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Dados da empresa">
        <p className="text-[13px]">
          Estas configurações são <b>compartilhadas por todos os módulos</b>: cálculos
          tributários, indicadores por colaborador, benchmarks setoriais e comparações
          históricas. As mudanças são salvas <b>automaticamente</b> a cada campo.
        </p>
      </Callout>
      <CompanyConfigForm />
    </div>
  );
}


function StepFederais({
  ov,
  patchOv,
  state,
  patchTax,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
  state: AppState;
  patchTax: ReturnType<typeof usePatchTax>;
}) {
  return (
    <div className="space-y-4">
      <Callout tone="info" title="O que são impostos federais sobre lucro?">
        <p className="text-[13px]">
          São o <b>IRPJ</b> (Imposto de Renda da Pessoa Jurídica), seu <b>adicional</b> de 10%
          quando o lucro trimestral passa de R$ 60 mil, e a <b>CSLL</b> (Contribuição Social sobre o
          Lucro Líquido). Juntos, formam a famosa "carga de 34%" do Lucro Real.
        </p>
      </Callout>

      <Section title="Impostos sobre o lucro (IRPJ + Adicional + CSLL)">
        <FriendlyRow
          label="IRPJ"
          suffix="%"
          defaultVal={IRPJ_PCT}
          help="Imposto de Renda Pessoa Jurídica — alíquota base. Fixado em 15% pela Lei 9.249/95."
          value={ov.irpj ?? IRPJ_PCT}
          onChange={(v) => patchOv({ irpj: v })}
          onReset={() => patchOv({ irpj: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.irpj}
        />
        <FriendlyRow
          label="Adicional de IRPJ"
          suffix="%"
          defaultVal={IRPJ_ADICIONAL_PCT}
          help="10% extras que incidem APENAS sobre a parcela do lucro trimestral que ultrapassa o gatilho abaixo."
          value={ov.irpjAdicional ?? IRPJ_ADICIONAL_PCT}
          onChange={(v) => patchOv({ irpjAdicional: v })}
          onReset={() => patchOv({ irpjAdicional: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.irpjAdicional}
        />
        <FriendlyRow
          label="Gatilho trimestral do Adicional"
          suffix="R$"
          defaultVal={IRPJ_ADICIONAL_GATILHO_TRI}
          help="Lucro trimestral acima deste valor sofre o adicional de 10%. Padrão R$ 60.000 (R$ 20 mil/mês)."
          value={ov.irpjAdicionalGatilhoTri ?? IRPJ_ADICIONAL_GATILHO_TRI}
          onChange={(v) => patchOv({ irpjAdicionalGatilhoTri: v })}
          onReset={() => patchOv({ irpjAdicionalGatilhoTri: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.irpjAdicionalGatilhoTri}
        />
        <FriendlyRow
          label="CSLL"
          suffix="%"
          defaultVal={CSLL_PCT}
          help="Contribuição Social sobre o Lucro Líquido. 9% para empresas em geral (financeiras pagam 15%)."
          value={ov.csll ?? CSLL_PCT}
          onChange={(v) => patchOv({ csll: v })}
          onReset={() => patchOv({ csll: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.csll}
        />
      </Section>

      <Callout
        tone="info"
        title="PIS e COFINS — qual a diferença entre cumulativo e não-cumulativo?"
      >
        <p className="text-[13px]">
          <b>Cumulativo</b> (Lucro Presumido): alíquota menor (3,65%) mas{" "}
          <i>sem direito a crédito</i>.<br />
          <b>Não-cumulativo</b> (Lucro Real): alíquota maior (9,25%) mas{" "}
          <i>permite descontar créditos</i>
          de compras. Atenção: serão substituídos pela CBS na Reforma Tributária.
        </p>
      </Callout>

      <Section title="PIS/COFINS — Lucro Presumido (cumulativo)">
        <FriendlyRow
          label="PIS cumulativo"
          suffix="%"
          defaultVal={PIS_CUM_PCT}
          help="0,65% sem direito a crédito. Aplicado sobre receita bruta."
          value={ov.pisCum ?? PIS_CUM_PCT}
          onChange={(v) => patchOv({ pisCum: v })}
          onReset={() => patchOv({ pisCum: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.pisCum}
        />
        <FriendlyRow
          label="COFINS cumulativo"
          suffix="%"
          defaultVal={COFINS_CUM_PCT}
          help="3% sem direito a crédito. Aplicado sobre receita bruta."
          value={ov.cofinsCum ?? COFINS_CUM_PCT}
          onChange={(v) => patchOv({ cofinsCum: v })}
          onReset={() => patchOv({ cofinsCum: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.cofinsCum}
        />
      </Section>

      <Section title="PIS/COFINS — Lucro Real (não-cumulativo)">
        <FriendlyRow
          label="PIS não-cumulativo"
          suffix="%"
          defaultVal={PIS_NAO_CUM_PCT}
          help="1,65% com direito a crédito sobre insumos."
          value={ov.pisNaoCum ?? PIS_NAO_CUM_PCT}
          onChange={(v) => patchOv({ pisNaoCum: v })}
          onReset={() => patchOv({ pisNaoCum: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.pisNaoCum}
        />
        <FriendlyRow
          label="COFINS não-cumulativo"
          suffix="%"
          defaultVal={COFINS_NAO_CUM_PCT}
          help="7,6% com direito a crédito sobre insumos."
          value={ov.cofinsNaoCum ?? COFINS_NAO_CUM_PCT}
          onChange={(v) => patchOv({ cofinsNaoCum: v })}
          onReset={() => patchOv({ cofinsNaoCum: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.cofinsNaoCum}
        />
      </Section>



    </div>
  );
}

function StepSimples({
  ov,
  patchOv,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
}) {
  return (
    <div className="space-y-4">
      <Callout tone="info" title="O que é o Simples Nacional?">
        <p className="text-[13px]">
          Regime simplificado para micro e pequenas empresas. Unifica IRPJ, CSLL, PIS, COFINS, IPI,
          ICMS, ISS e CPP em uma única guia (DAS). A alíquota efetiva depende do
          <b> faturamento dos últimos 12 meses (RBT12)</b> e do <b>Anexo</b> da sua atividade.
        </p>
      </Callout>

      <Section title="Limites e regras gerais">
        <FriendlyRow
          label="Teto anual de enquadramento"
          suffix="R$"
          defaultVal={SIMPLES_LIMITE}
          help="Faturamento máximo nos últimos 12 meses para permanecer no Simples. Padrão LC 123/2006: R$ 4,8 milhões."
          value={ov.simplesLimite ?? SIMPLES_LIMITE}
          onChange={(v) => patchOv({ simplesLimite: v })}
          onReset={() => patchOv({ simplesLimite: undefined })}
        />
        <FriendlyRow
          label="Fator R — % mínimo da folha"
          suffix="%"
          defaultVal={FATOR_R_MINIMO_PCT}
          help="Se a folha (12 meses) for ≥ 28% da receita, a atividade migra do Anexo V (mais caro) para o III (mais barato). Vale para serviços."
          value={ov.fatorRMinimo ?? FATOR_R_MINIMO_PCT}
          onChange={(v) => patchOv({ fatorRMinimo: v })}
          onReset={() => patchOv({ fatorRMinimo: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.fatorRMinimo}
        />
      </Section>

      <Callout tone="warn" title="Editar as tabelas dos Anexos é avançado">
        <p className="text-[13px]">
          As tabelas oficiais raramente mudam (última atualização: LC 155/2016). Edite apenas se a
          Receita Federal publicar nova tabela. Você pode escolher qual Anexo visualizar abaixo.
        </p>
      </Callout>

      <SimplesTableEditor ov={ov} patchOv={patchOv} />
    </div>
  );
}

function StepPresumido({
  ov,
  patchOv,
  state,
  patchTax,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
  state: AppState;
  patchTax: ReturnType<typeof usePatchTax>;
}) {
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Como funciona o Lucro Presumido?">
        <p className="text-[13px]">
          A Receita "presume" qual é seu lucro aplicando um <b>percentual sobre a receita bruta</b>
          (a "base de presunção"). Sobre essa base presumida incidem IRPJ (15%) e CSLL (9%). Os
          percentuais variam por <b>tipo de negócio</b>:
        </p>
      </Callout>

      <Section title="Bases de presunção por tipo de negócio (Lei 9.249/95)">
        <div className="grid grid-cols-[1fr,110px,110px,auto] items-center gap-2 text-xs">
          <div className="text-muted-foreground">Tipo de negócio</div>
          <div className="text-right text-muted-foreground">% base IRPJ</div>
          <div className="text-right text-muted-foreground">% base CSLL</div>
          <div></div>
          {BUSINESS.map(({ key, label, hint }) => {
            const def = PRESUMIDO_BASES_DEFAULT[key];
            const cur = ov.presumidoBases?.[key] ?? def;
            const setBases = (next: { irpj: number; csll: number } | undefined) => {
              const curMap = ov.presumidoBases ?? {};
              if (next === undefined) {
                const { [key]: _drop, ...rest } = curMap;
                patchOv({ presumidoBases: Object.keys(rest).length ? rest : undefined });
              } else {
                patchOv({ presumidoBases: { ...curMap, [key]: next } });
              }
            };
            return (
              <div key={key} className="contents">
                <div>
                  <div className="font-medium">{label}</div>
                  <div className="text-[10px] text-muted-foreground/80">
                    {hint} Padrão: {def.irpj}% / {def.csll}%
                  </div>
                </div>
                <NumInput
                  value={cur.irpj}
                  onChange={(v) => setBases({ irpj: v, csll: cur.csll })}
                />
                <NumInput
                  value={cur.csll}
                  onChange={(v) => setBases({ irpj: cur.irpj, csll: v })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Restaurar padrão"
                  onClick={() => setBases(undefined)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </Section>

      <Callout tone="info" title="ISS — Imposto sobre Serviços">
        <p className="text-[13px]">
          Cobrado pelo município onde está sua empresa. A lei federal (LC 116/2003) limita entre{" "}
          <b>2% e 5%</b>. A maioria das capitais cobra 5%. Confira a alíquota do seu município na
          prefeitura.
        </p>
      </Callout>

      <Section title="ISS — alíquota municipal">
        <FriendlyRow
          label="ISS"
          suffix="%"
          defaultVal={5}
          help="Defina a alíquota do município onde sua empresa está estabelecida (entre 2% e 5%)."
          value={state.tax.issIcms ?? 5}
          onChange={(v) => patchTax({ issIcms: v })}
          onReset={() => patchTax({ issIcms: 5 })}
        faixa={FAIXAS_TRIBUTARIAS.iss}
        />
      </Section>
    </div>
  );
}

function StepReforma({
  ov,
  patchOv,
  state,
  patchTax,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
  state: AppState;
  patchTax: ReturnType<typeof usePatchTax>;
}) {
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Reforma Tributária (EC 132/2023 + LC 214/2025)">
        <p className="text-[13px]">
          A partir de <b>2026</b>, PIS/COFINS são substituídos pela <b>CBS</b> (federal) e ICMS/ISS
          pelo <b>IBS</b> (estadual + municipal). A transição vai até <b>2033</b>, com alíquotas
          crescentes — em 2027 começa em 10% da carga plena, em 2032 chega a 90%.
        </p>
      </Callout>

      <Callout tone="ok" title="Crédito amplo (LC 214/2025, arts. 47-56)">
        <p className="text-[13px]">
          CBS/IBS geram <b>crédito sobre praticamente todos os insumos</b> —
          aluguel, energia, frete, serviços tomados, marketing, TI, etc. — e não
          apenas sobre o CPV. As exceções são <b>folha de pagamento</b> (art. 57),
          despesas financeiras e linhas marcadas <b>"sem crédito"</b> (uso e
          consumo pessoal). Isso reduz a carga efetiva especialmente para
          empresas de <b>serviços</b> (CPV baixo, OpEx alto).
        </p>
      </Callout>

      <Section title="Alíquotas plenas CBS/IBS (após 2033)">
        <FriendlyRow
          label="CBS — alíquota plena"
          suffix="%"
          defaultVal={CBS_ALIQUOTA_PLENA}
          help="Contribuição sobre Bens e Serviços (federal). Estimativa oficial: 8,8%. Substitui PIS+COFINS."
          value={state.tax.cbsAliquota ?? CBS_ALIQUOTA_PLENA}
          onChange={(v) => patchTax({ cbsAliquota: v })}
          onReset={() => patchTax({ cbsAliquota: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.cbsAliquota}
        />
        <FriendlyRow
          label="IBS — alíquota de referência"
          suffix="%"
          defaultVal={IBS_ALIQUOTA_PLENA}
          help="Imposto sobre Bens e Serviços (estadual+municipal). Estimativa de referência: 17,7%. Substitui ICMS+ISS."
          value={state.tax.ibsAliquotaRef ?? IBS_ALIQUOTA_PLENA}
          onChange={(v) => patchTax({ ibsAliquotaRef: v })}
          onReset={() => patchTax({ ibsAliquotaRef: undefined })}
        faixa={FAIXAS_TRIBUTARIAS.ibsAliquotaRef}
        />
        <FriendlyRow
          label="% do CPV vindo de fornecedor Simples Nacional"
          suffix="%"
          defaultVal={0}
          help="Percentual das compras (CPV) feitas a fornecedores no Simples Nacional sem destaque de CBS/IBS. Nessas notas o crédito é PRESUMIDO (~3% CBS, ~1,2% IBS), não a alíquota cheia. Aumentar este valor reduz o crédito tributável e aumenta o imposto efetivo a pagar. Default 0% (assume todos fornecedores no regime regular)."
          value={state.tax.fornecedorSimplesNacionalPct ?? 0}
          onChange={(v) => patchTax({ fornecedorSimplesNacionalPct: v })}
          onReset={() => patchTax({ fornecedorSimplesNacionalPct: undefined })}
        />
        <SnPresumidoExplainer
          snPct={state.tax.fornecedorSimplesNacionalPct ?? 0}
          cbsPct={state.tax.cbsAliquota ?? CBS_ALIQUOTA_PLENA}
          ibsPct={state.tax.ibsAliquotaRef ?? IBS_ALIQUOTA_PLENA}
        />
      </Section>

      <Callout tone="warn" title="Multiplicadores de transição (uso avançado)">
        <p className="text-[13px]">
          Fração da alíquota plena vigente entre 2027 e 2032. <b>0,5 = 50%</b> da carga plena (ponto
          médio). Em 2027 começa em 0,1, em 2032 chega a 0,9. Mude apenas para simular cenários
          alternativos de transição.
        </p>
      </Callout>

      <Section title="Multiplicadores da fase de transição">
        <FriendlyRow
          label="Multiplicador IBS"
          suffix="×"
          defaultVal={REFORMA_TRANSICAO_IBS_MULT}
          help="Fração da alíquota plena IBS aplicada no período de transição. Padrão: 0,5 (50%)."
          value={ov.reformaTransicaoIbsMult ?? REFORMA_TRANSICAO_IBS_MULT}
          onChange={(v) => patchOv({ reformaTransicaoIbsMult: v })}
          onReset={() => patchOv({ reformaTransicaoIbsMult: undefined })}
        />
        <FriendlyRow
          label="Multiplicador ICMS/ISS"
          suffix="×"
          defaultVal={REFORMA_TRANSICAO_ICMS_ISS_MULT}
          help="Fração da carga antiga (ICMS/ISS) ainda em vigor durante a transição. Padrão: 0,5 (50%)."
          value={ov.reformaTransicaoIcmsIssMult ?? REFORMA_TRANSICAO_ICMS_ISS_MULT}
          onChange={(v) => patchOv({ reformaTransicaoIcmsIssMult: v })}
          onReset={() => patchOv({ reformaTransicaoIcmsIssMult: undefined })}
        />
      </Section>

      <Section title="Split Payment (LC 214/2025)">
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium">
              Aplicar Split Payment no fluxo de caixa
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Com Split ATIVO, CBS e IBS são retidos no momento da liquidação financeira (lag 0)
              em vez de recolhidos no mês seguinte. Isso elimina o <i>float</i> tributário e reduz
              permanentemente o caixa operacional — todos os indicadores (DSCR, NCG, Liquidez,
              Runway) recalculam automaticamente. Padrão ligado a partir de{" "}
              <b>{state.tax.splitPaymentAnoInicio ?? SPLIT_PAYMENT_ANO_INICIO_DEFAULT}</b>.
              Desligue apenas para comparar com o "mundo antigo".
            </p>
          </div>
          <Switch
            checked={state.tax.splitPaymentAtivo ?? SPLIT_PAYMENT_DEFAULT}
            onCheckedChange={(v) => patchTax({ splitPaymentAtivo: v })}
            aria-label="Ativar Split Payment"
          />
        </div>
      </Section>
    </div>
  );
}

function StepRevisao({ customCount, resetAll }: { customCount: number; resetAll: () => void }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {customCount === 0 ? (
        <Callout tone="ok" title="Tudo nos padrões oficiais">
          <p className="text-[13px]">
            Nenhum parâmetro foi customizado. Os cálculos do FinnancePRO usarão integralmente as
            alíquotas e tabelas oficiais brasileiras vigentes.
          </p>
        </Callout>
      ) : (
        <Callout tone="warn" title={`${customCount} parâmetro(s) customizado(s)`}>
          <p className="text-[13px]">
            Os valores customizados serão usados nos cálculos desta empresa. Você pode voltar aos
            passos anteriores para revisar, ou restaurar tudo aos padrões oficiais.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={resetAll}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restaurar todos aos padrões oficiais
          </Button>
        </Callout>
      )}

      <Callout tone="info" title="Pronto!">
        <p className="text-[13px]">
          Clique em <b>Concluir</b> abaixo para fechar o assistente. Os cálculos do simulador serão
          atualizados automaticamente. Você pode reabrir este assistente a qualquer momento pelo
          botão <b>Parâmetros</b> no topo.
        </p>
      </Callout>
    </div>
  );
}

// =====================================================================
// HELPERS DE UI
// =====================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "info" | "ok" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === "ok"
      ? "border-pos/40 bg-pos/5"
      : tone === "warn"
        ? "border-[var(--warning)]/40 bg-[var(--warning)]/5"
        : "border-primary/30 bg-primary/5";
  const Icon = tone === "warn" ? AlertCircle : tone === "ok" ? Check : Sparkles;
  const iconCls =
    tone === "ok" ? "text-pos" : tone === "warn" ? "text-[var(--warning)]" : "text-primary";
  return (
    <div className={`rounded-lg border ${styles} p-3`}>
      <div className={`mb-1.5 flex items-center gap-2 text-sm font-semibold ${iconCls}`}>
        <Icon className="h-4 w-4" /> {title}
      </div>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}

/** Callout dinâmico: mostra a alíquota efetiva de crédito CBS/IBS e um
 *  exemplo numérico, recalculado conforme o usuário altera o % SN. */
function SnPresumidoExplainer({
  snPct,
  cbsPct,
  ibsPct,
}: {
  snPct: number;
  cbsPct: number;
  ibsPct: number;
}) {
  const cbsCredEff = getCbsCredCpvPct(cbsPct, snPct);
  const ibsCredEff = getIbsCredCpvPct(ibsPct, snPct);
  const cpvExemplo = 100_000;
  const credCbsEff = cpvExemplo * (cbsCredEff / 100);
  const credIbsEff = cpvExemplo * (ibsCredEff / 100);
  const credCbsCheio = cpvExemplo * (cbsPct / 100);
  const credIbsCheio = cpvExemplo * (ibsPct / 100);
  const perdaCbs = credCbsCheio - credCbsEff;
  const perdaIbs = credIbsCheio - credIbsEff;
  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const pct = (n: number) => n.toFixed(2).replace(".", ",") + "%";
  const tone = snPct > 0 ? "warn" : "info";
  return (
    <Callout
      tone={tone}
      title={
        snPct > 0
          ? `Com ${pct(snPct)} do CPV em fornecedor SN, seu crédito cai`
          : "Como funciona o crédito presumido SN"
      }
    >
      <div className="space-y-2 text-[13px]">
        <p>
          Fornecedor no Simples Nacional não destaca CBS/IBS na nota — o comprador (Lucro Real/
          Presumido) só tem direito a um <b>crédito presumido</b> de{" "}
          <b>{ALIQ_PRESUMIDA_CBS_SN.toFixed(1).replace(".", ",")}% CBS</b> e{" "}
          <b>{ALIQ_PRESUMIDA_IBS_SN.toFixed(1).replace(".", ",")}% IBS</b>, e não da alíquota
          cheia.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded bg-background/60 p-2 font-mono text-[12px]">
          <div>
            <div className="text-foreground/60">Alíquota efetiva CBS</div>
            <div className="text-base">{pct(cbsCredEff)}</div>
            <div className="text-foreground/50">cheia: {pct(cbsPct)}</div>
          </div>
          <div>
            <div className="text-foreground/60">Alíquota efetiva IBS</div>
            <div className="text-base">{pct(ibsCredEff)}</div>
            <div className="text-foreground/50">cheia: {pct(ibsPct)}</div>
          </div>
        </div>
        <details className="text-[12px]">
          <summary className="cursor-pointer text-foreground/70 hover:text-foreground">
            Ver exemplo: CPV de {fmt(cpvExemplo)}/mês
          </summary>
          <div className="mt-2 space-y-1 rounded bg-background/60 p-2">
            <div>
              Crédito CBS: <b>{fmt(credCbsEff)}</b>{" "}
              <span className="text-foreground/60">
                (cheio {fmt(credCbsCheio)} − perda {fmt(perdaCbs)})
              </span>
            </div>
            <div>
              Crédito IBS: <b>{fmt(credIbsEff)}</b>{" "}
              <span className="text-foreground/60">
                (cheio {fmt(credIbsCheio)} − perda {fmt(perdaIbs)})
              </span>
            </div>
            <div className="mt-1 border-t border-border/40 pt-1">
              Imposto adicional a pagar/mês:{" "}
              <b className="text-amber-500">{fmt(perdaCbs + perdaIbs)}</b>
            </div>
          </div>
        </details>
      </div>
    </Callout>
  );
}

/** Linha amigável: rótulo + ajuda em linguagem simples + input + reset + indicador "padrão/customizado". */
function FriendlyRow({
  label,
  suffix,
  defaultVal,
  help,
  value,
  onChange,
  onReset,
  faixa,
}: {
  label: string;
  suffix: string;
  defaultVal: number;
  help: string;
  value: number;
  onChange: (n: number) => void;
  onReset: () => void;
  faixa?: FaixaLegal;
}) {
  const isDefault = value === defaultVal;
  const resultado = faixa ? validarPelaFaixa(faixa, value) : { ok: true, nivel: "ok" as const, msg: undefined };
  const guardedOnChange = (n: number) => {
    if (faixa) {
      const r = validarPelaFaixa(faixa, n);
      if (r.nivel === "erro") return; // bloqueia patch
    }
    onChange(n);
  };
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>{label}</span>
            {isDefault ? (
              <span className="rounded-full bg-muted/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                padrão
              </span>
            ) : (
              <span className="rounded-full bg-[var(--warning)]/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--warning)]">
                customizado
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{help}</p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            Valor oficial:{" "}
            <b>
              {defaultVal.toLocaleString("pt-BR")} {suffix}
            </b>
          </p>
        </div>
        <div className="flex items-center gap-1 sm:shrink-0">
          <div className="flex-1 sm:w-[110px] sm:flex-none">
            <NumInput
              value={value}
              onChange={guardedOnChange}
              min={faixa?.min}
              max={faixa?.max}
            />
          </div>
          <span className="w-6 text-center text-[10px] text-muted-foreground">{suffix}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 sm:h-7 sm:w-7"
            disabled={isDefault}
            onClick={onReset}
            title="Restaurar padrão"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {resultado.msg && resultado.nivel !== "ok" ? (
        <p
          className={`mt-2 text-[11px] ${
            resultado.nivel === "erro"
              ? "text-[var(--destructive)]"
              : "text-[var(--warning)]"
          }`}
          role={resultado.nivel === "erro" ? "alert" : undefined}
        >
          {resultado.nivel === "erro" ? "⛔ " : "⚠️ "}
          {resultado.msg}
        </p>
      ) : null}
    </div>
  );
}

// Valida direto pela faixa (bypass da tabela por chave — útil quando o
// FriendlyRow recebe a faixa explícita e não precisa lookup por string).
function validarPelaFaixa(
  faixa: FaixaLegal,
  valor: number,
): { ok: boolean; nivel: "erro" | "aviso" | "ok"; msg?: string } {
  const fmt = (v: number) =>
    Number.isInteger(v) ? v.toString() : v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  if (!Number.isFinite(valor)) {
    return { ok: false, nivel: "erro", msg: `${faixa.label}: informe um número válido.` };
  }
  if (valor < faixa.min || valor > faixa.max) {
    return {
      ok: false,
      nivel: "erro",
      msg: `${faixa.label}: valor deve estar entre ${fmt(faixa.min)} e ${fmt(faixa.max)}.`,
    };
  }
  const lo = faixa.legalMin;
  const hi = faixa.legalMax;
  if ((lo !== undefined && valor < lo) || (hi !== undefined && valor > hi)) {
    const faixaTxt =
      lo !== undefined && hi !== undefined && lo === hi
        ? `${fmt(lo)}`
        : `${fmt(lo ?? faixa.min)}–${fmt(hi ?? faixa.max)}`;
    return {
      ok: true,
      nivel: "aviso",
      msg: `${faixa.label}: fora da faixa legal usual (${faixaTxt}). Confirme a base normativa.`,
    };
  }
  return { ok: true, nivel: "ok" };
}


function SimplesTableEditor({
  ov,
  patchOv,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
}) {
  const [anexo, setAnexo] = useState<SimplesAnexo>("III");
  const def = SIMPLES_TABLES_DEFAULT[anexo];
  const cur: SimplesFaixa[] = (ov.simplesTables?.[anexo] ?? def).map((f) => [...f] as SimplesFaixa);
  const isCustom = !!ov.simplesTables?.[anexo];

  const setFaixa = (i: number, j: 0 | 1 | 2, v: number) => {
    const next = cur.map((f) => [...f] as SimplesFaixa);
    next[i][j] = v;
    patchOv({ simplesTables: { ...(ov.simplesTables ?? {}), [anexo]: next } });
  };

  const resetAnexo = () => {
    const map = { ...(ov.simplesTables ?? {}) };
    delete map[anexo];
    patchOv({ simplesTables: Object.keys(map).length ? map : undefined });
  };

  return (
    <Section title={`Tabelas do Simples — Anexo ${anexo}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Visualizar Anexo:</span>
          <Select value={anexo} onValueChange={(v) => setAnexo(v as SimplesAnexo)}>
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANEXOS.map((a) => (
                <SelectItem key={a} value={a}>
                  Anexo {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isCustom && (
            <span className="rounded-full bg-[var(--warning)]/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--warning)]">
              customizado
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" disabled={!isCustom} onClick={resetAnexo}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restaurar Anexo {anexo}
        </Button>
      </div>
      <div className="grid grid-cols-[40px,1fr,1fr,1fr] items-center gap-2 text-[11px]">
        <div className="text-muted-foreground">Faixa</div>
        <div className="text-right text-muted-foreground">Teto (R$)</div>
        <div className="text-right text-muted-foreground">Alíquota (%)</div>
        <div className="text-right text-muted-foreground">P. deduzir (R$)</div>
        {cur.map((f, i) => (
          <div key={i} className="contents">
            <div className="text-muted-foreground">{i + 1}ª</div>
            <NumInput value={f[0]} onChange={(v) => setFaixa(i, 0, v)} />
            <NumInput value={f[1]} onChange={(v) => setFaixa(i, 1, v)} />
            <NumInput value={f[2]} onChange={(v) => setFaixa(i, 2, v)} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// =====================================================================
// STEP — Folha & Sócios (Plano v3)
// =====================================================================
function StepFolhaSocios({
  ov,
  patchOv,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
}) {
  const pr: PayrollOverride = ov.payroll ?? {};
  const patchPr = (patch: Partial<PayrollOverride>) =>
    patchOv({ payroll: { ...pr, ...patch } });

  const irpfTable = pr.irpfTable ?? IRPF_TABLE_DEFAULT;
  const isIrpfCustom = !!pr.irpfTable;

  const setIrpfFaixa = (i: number, j: 0 | 1 | 2, v: number) => {
    const next = irpfTable.map((f) => [...f] as IrpfFaixa);
    next[i][j] = v;
    patchPr({ irpfTable: next });
  };
  const resetIrpf = () => patchPr({ irpfTable: undefined });

  return (
    <div className="space-y-4">
      <Callout tone="info" title="Por que esta tela existe?">
        <p className="text-[13px]">
          O cartão <b>"Pró-labore × Distribuição de Lucros"</b> em Tributos usa estes parâmetros
          para calcular INSS do sócio, INSS patronal, IRPF mensal e o limite de distribuição
          isenta. Todos os valores vêm preenchidos com os padrões oficiais 2025 — só mude se houver
          alteração regulatória ou para simulações.
        </p>
      </Callout>

      <Section title="Salário mínimo & piso legal de pró-labore">
        <FriendlyRow
          label="Salário mínimo nacional"
          suffix="R$"
          defaultVal={SALARIO_MINIMO_DEFAULT}
          help="Piso aplicado ao pró-labore quando o sócio é OPERACIONAL (IN RFB 971/2009, art. 55). Sócio investidor não exige piso."
          value={pr.salarioMinimo ?? SALARIO_MINIMO_DEFAULT}
          onChange={(v) => patchPr({ salarioMinimo: v })}
          onReset={() => patchPr({ salarioMinimo: undefined })}
        />
      </Section>

      <Section title="INSS do sócio (contribuinte individual)">
        <FriendlyRow
          label="Alíquota INSS sócio"
          suffix="%"
          defaultVal={INSS_SOCIO_ALIQ_DEFAULT}
          help="Plano simplificado (Lei 9.876/99). Padrão 11% sobre o pró-labore limitado ao teto."
          value={pr.inssSocioAliq ?? INSS_SOCIO_ALIQ_DEFAULT}
          onChange={(v) => patchPr({ inssSocioAliq: v })}
          onReset={() => patchPr({ inssSocioAliq: undefined })}
        />
        <FriendlyRow
          label="Teto contributivo INSS"
          suffix="R$"
          defaultVal={INSS_TETO_DEFAULT}
          help="Teto mensal de contribuição (Portaria MPS 2025). Pró-labore acima do teto não gera INSS adicional."
          value={pr.inssTeto ?? INSS_TETO_DEFAULT}
          onChange={(v) => patchPr({ inssTeto: v })}
          onReset={() => patchPr({ inssTeto: undefined })}
        />
        <FriendlyRow
          label="Cota patronal (Presumido/Real)"
          suffix="%"
          defaultVal={INSS_PATRONAL_ALIQ_DEFAULT}
          help="20% sobre o pró-labore, devido pela PJ no Lucro Presumido e Real. No Simples já está embutido no DAS (exceto Anexo IV)."
          value={pr.inssPatronalAliq ?? INSS_PATRONAL_ALIQ_DEFAULT}
          onChange={(v) => patchPr({ inssPatronalAliq: v })}
          onReset={() => patchPr({ inssPatronalAliq: undefined })}
        />
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium">Aplicar patronal também no Simples (Anexo IV)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Empresas no Anexo IV recolhem patronal por fora do DAS. Para os demais anexos, manter desligado.
            </p>
          </div>
          <Switch
            checked={pr.inssPatronalSimples ?? false}
            onCheckedChange={(v) => patchPr({ inssPatronalSimples: v })}
          />
        </div>
      </Section>

      <Section title="IRPF mensal — tabela e deduções">
        <FriendlyRow
          label="Dedução por dependente"
          suffix="R$"
          defaultVal={IRPF_DEPENDENTE_DEDUCAO_DEFAULT}
          help="Dedução mensal por dependente no IRPF (modelo tradicional)."
          value={pr.irpfDependenteDeducao ?? IRPF_DEPENDENTE_DEDUCAO_DEFAULT}
          onChange={(v) => patchPr({ irpfDependenteDeducao: v })}
          onReset={() => patchPr({ irpfDependenteDeducao: undefined })}
        />
        <FriendlyRow
          label="Desconto simplificado mensal"
          suffix="R$"
          defaultVal={IRPF_DESCONTO_SIMPLIFICADO_DEFAULT}
          help="Lei 14.973/2024 — desconto único opcional. Sistema escolhe automaticamente o mais vantajoso."
          value={pr.irpfDescontoSimplificado ?? IRPF_DESCONTO_SIMPLIFICADO_DEFAULT}
          onChange={(v) => patchPr({ irpfDescontoSimplificado: v })}
          onReset={() => patchPr({ irpfDescontoSimplificado: undefined })}
        />
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium">Escolher automaticamente tradicional × simplificado</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Quando ligado, o sistema testa os dois modelos para cada sócio e aplica o que resulta em menor IRPF.
            </p>
          </div>
          <Switch
            checked={pr.irpfSimplificadoAuto ?? true}
            onCheckedChange={(v) => patchPr({ irpfSimplificadoAuto: v })}
          />
        </div>

        <div className="rounded-md border border-border/40 bg-background/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tabela mensal IRPF{" "}
              {isIrpfCustom && (
                <span className="ml-1 rounded-full bg-[var(--warning)]/15 px-1.5 py-0.5 text-[9px] uppercase text-[var(--warning)]">
                  customizado
                </span>
              )}
            </div>
            <Button size="sm" variant="ghost" disabled={!isIrpfCustom} onClick={resetIrpf}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restaurar
            </Button>
          </div>
          <div className="grid grid-cols-[40px,1fr,1fr,1fr] items-center gap-2 text-[11px]">
            <div className="text-muted-foreground">Faixa</div>
            <div className="text-right text-muted-foreground">Até (R$)</div>
            <div className="text-right text-muted-foreground">Alíquota (%)</div>
            <div className="text-right text-muted-foreground">P. deduzir (R$)</div>
            {irpfTable.map((f, i) => (
              <div key={i} className="contents">
                <div className="text-muted-foreground">{i + 1}ª</div>
                <NumInput
                  value={Number.isFinite(f[0]) ? f[0] : 999999}
                  onChange={(v) => setIrpfFaixa(i, 0, v)}
                />
                <NumInput value={f[1]} onChange={(v) => setIrpfFaixa(i, 1, v)} />
                <NumInput value={f[2]} onChange={(v) => setIrpfFaixa(i, 2, v)} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Distribuição de lucros isenta">
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium">
              Limitar distribuição no Presumido (sem escrituração completa)
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Quando ligado, a engine aplica o limite "Base de Presunção − tributos federais"
              (RIR/2018 art. 238) como teto de distribuição isenta. Desligue se a empresa mantém
              escrituração contábil regular — nesse caso, distribuição é livre.
            </p>
          </div>
          <Switch
            checked={pr.distribuicaoLimitePresumidoAuto ?? true}
            onCheckedChange={(v) => patchPr({ distribuicaoLimitePresumidoAuto: v })}
          />
        </div>
      </Section>
    </div>
  );
}
