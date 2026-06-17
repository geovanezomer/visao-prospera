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
import { Button } from "@/components/ui/button";
import { NumInput } from "./primitives";
import type { AppState, SimplesAnexo, BusinessType } from "@/engines/finance/types";
import { useFinance, type FinanceUpdater } from "@/engines/finance/AppStateContext";
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
  type TaxRatesOverride,
  type SimplesFaixa,
} from "@/engines/finance/taxDefaults";
import {
  getCbsCredCpvPct,
  getIbsCredCpvPct,
  ALIQ_PRESUMIDA_CBS_SN,
  ALIQ_PRESUMIDA_IBS_SN,
} from "@/engines/finance/tax/reforma";

const ANEXOS: SimplesAnexo[] = ["I", "II", "III", "IV", "V"];
const BUSINESS: { key: BusinessType; label: string; hint: string }[] = [
  { key: "industria", label: "Indústria", hint: "Fabricação e transformação." },
  { key: "comercio", label: "Comércio", hint: "Compra e revenda de mercadorias." },
  { key: "servicos", label: "Serviços", hint: "Prestação de serviços em geral." },
];

// Passos do wizard. Cada um traz um título amigável e ícone próprio.
type StepKey = "intro" | "federais" | "simples" | "presumido" | "reforma" | "revisao";
const STEPS: { key: StepKey; label: string; icon: typeof Settings }[] = [
  { key: "intro", label: "Boas-vindas", icon: Sparkles },
  { key: "federais", label: "Federais", icon: Landmark },
  { key: "simples", label: "Simples", icon: FileText },
  { key: "presumido", label: "Presumido", icon: Building2 },
  { key: "reforma", label: "Reforma", icon: Scale },
  { key: "revisao", label: "Revisão", icon: Check },
];

export function TaxSettingsDialog() {
  const { state, update } = useFinance();
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const ov = state.tax.ratesOverride ?? {};

  const patchOv = (patch: Partial<TaxRatesOverride>) =>
    update((s) => ({
      ...s,
      tax: { ...s.tax, ratesOverride: { ...(s.tax.ratesOverride ?? {}), ...patch } },
    }));

  const resetAll = () => update((s) => ({ ...s, tax: { ...s.tax, ratesOverride: undefined } }));

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
        <Button size="sm" variant="ghost" title="Tributos (assistente de parâmetros tributários)">
          <Settings className="mr-2 h-4 w-4" /> Tributos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <step.icon className="h-5 w-5 text-primary" />
            Assistente de parâmetros tributários — {step.label}
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

        <div className="max-h-[58vh] overflow-y-auto px-6 py-5">
          {step.key === "intro" && <StepIntro customCount={customCount} />}
          {step.key === "federais" && <StepFederais ov={ov} patchOv={patchOv} />}
          {step.key === "simples" && <StepSimples ov={ov} patchOv={patchOv} />}
          {step.key === "presumido" && (
            <StepPresumido ov={ov} patchOv={patchOv} state={state} update={update} />
          )}
          {step.key === "reforma" && (
            <StepReforma ov={ov} patchOv={patchOv} state={state} update={update} />
          )}
          {step.key === "revisao" && <StepRevisao customCount={customCount} resetAll={resetAll} />}
        </div>

        <div className="flex items-center justify-between border-t border-border/60 px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            title="Restaurar todos os campos aos valores oficiais"
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restaurar tudo
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isFirst}
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar
            </Button>
            {isLast ? (
              <Button size="sm" onClick={close}>
                <Check className="mr-1 h-3.5 w-3.5" /> Concluir
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
              >
                Avançar <ChevronRight className="ml-1 h-3.5 w-3.5" />
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
        Este assistente reúne as <b>alíquotas e tabelas tributárias brasileiras</b> usadas pelos
        cálculos do FinancePRO. Você <b>não precisa</b> entender de tributação para usar: os valores
        já vêm preenchidos com os <b>padrões oficiais</b> da legislação vigente.
      </p>

      <Callout tone="info" title="Quando mudar algum valor?">
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
          Você vai passar por 4 áreas tributárias (Federais, Simples, Presumido e Reforma). Em cada
          uma, os campos vêm com a <b>fonte legal</b> e o botão{" "}
          <RotateCcw className="inline h-3 w-3" /> para voltar ao padrão oficial. Ao final, uma tela
          de <b>revisão</b> resume tudo.
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

function StepFederais({
  ov,
  patchOv,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
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
        />
        <FriendlyRow
          label="Adicional de IRPJ"
          suffix="%"
          defaultVal={IRPJ_ADICIONAL_PCT}
          help="10% extras que incidem APENAS sobre a parcela do lucro trimestral que ultrapassa o gatilho abaixo."
          value={ov.irpjAdicional ?? IRPJ_ADICIONAL_PCT}
          onChange={(v) => patchOv({ irpjAdicional: v })}
          onReset={() => patchOv({ irpjAdicional: undefined })}
        />
        <FriendlyRow
          label="Gatilho trimestral do Adicional"
          suffix="R$"
          defaultVal={IRPJ_ADICIONAL_GATILHO_TRI}
          help="Lucro trimestral acima deste valor sofre o adicional de 10%. Padrão R$ 60.000 (R$ 20 mil/mês)."
          value={ov.irpjAdicionalGatilhoTri ?? IRPJ_ADICIONAL_GATILHO_TRI}
          onChange={(v) => patchOv({ irpjAdicionalGatilhoTri: v })}
          onReset={() => patchOv({ irpjAdicionalGatilhoTri: undefined })}
        />
        <FriendlyRow
          label="CSLL"
          suffix="%"
          defaultVal={CSLL_PCT}
          help="Contribuição Social sobre o Lucro Líquido. 9% para empresas em geral (financeiras pagam 15%)."
          value={ov.csll ?? CSLL_PCT}
          onChange={(v) => patchOv({ csll: v })}
          onReset={() => patchOv({ csll: undefined })}
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
        />
        <FriendlyRow
          label="COFINS cumulativo"
          suffix="%"
          defaultVal={COFINS_CUM_PCT}
          help="3% sem direito a crédito. Aplicado sobre receita bruta."
          value={ov.cofinsCum ?? COFINS_CUM_PCT}
          onChange={(v) => patchOv({ cofinsCum: v })}
          onReset={() => patchOv({ cofinsCum: undefined })}
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
        />
        <FriendlyRow
          label="COFINS não-cumulativo"
          suffix="%"
          defaultVal={COFINS_NAO_CUM_PCT}
          help="7,6% com direito a crédito sobre insumos."
          value={ov.cofinsNaoCum ?? COFINS_NAO_CUM_PCT}
          onChange={(v) => patchOv({ cofinsNaoCum: v })}
          onReset={() => patchOv({ cofinsNaoCum: undefined })}
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
  update,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
  state: AppState;
  update: FinanceUpdater;
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
          onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, issIcms: v } }))}
          onReset={() => update((s) => ({ ...s, tax: { ...s.tax, issIcms: 5 } }))}
        />
      </Section>
    </div>
  );
}

function StepReforma({
  ov,
  patchOv,
  state,
  update,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
  state: AppState;
  update: FinanceUpdater;
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

      <Section title="Alíquotas plenas CBS/IBS (após 2033)">
        <FriendlyRow
          label="CBS — alíquota plena"
          suffix="%"
          defaultVal={8.8}
          help="Contribuição sobre Bens e Serviços (federal). Estimativa oficial: 8,8%. Substitui PIS+COFINS."
          value={state.tax.cbsAliquota ?? 8.8}
          onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, cbsAliquota: v } }))}
          onReset={() => update((s) => ({ ...s, tax: { ...s.tax, cbsAliquota: undefined } }))}
        />
        <FriendlyRow
          label="IBS — alíquota de referência"
          suffix="%"
          defaultVal={17.7}
          help="Imposto sobre Bens e Serviços (estadual+municipal). Estimativa de referência: 17,7%. Substitui ICMS+ISS."
          value={state.tax.ibsAliquotaRef ?? 17.7}
          onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, ibsAliquotaRef: v } }))}
          onReset={() => update((s) => ({ ...s, tax: { ...s.tax, ibsAliquotaRef: undefined } }))}
        />
        <FriendlyRow
          label="% do CPV vindo de fornecedor Simples Nacional"
          suffix="%"
          defaultVal={0}
          help="Percentual das compras (CPV) feitas a fornecedores no Simples Nacional sem destaque de CBS/IBS. Nessas notas o crédito é PRESUMIDO (~3% CBS, ~1,2% IBS), não a alíquota cheia. Aumentar este valor reduz o crédito tributável e aumenta o imposto efetivo a pagar. Default 0% (assume todos fornecedores no regime regular)."
          value={state.tax.fornecedorSimplesNacionalPct ?? 0}
          onChange={(v) =>
            update((s) => ({ ...s, tax: { ...s.tax, fornecedorSimplesNacionalPct: v } }))
          }
          onReset={() =>
            update((s) => ({ ...s, tax: { ...s.tax, fornecedorSimplesNacionalPct: undefined } }))
          }
        />
        <SnPresumidoExplainer
          snPct={state.tax.fornecedorSimplesNacionalPct ?? 0}
          cbsPct={state.tax.cbsAliquota ?? 8.8}
          ibsPct={state.tax.ibsAliquotaRef ?? 17.7}
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
    </div>
  );
}

function StepRevisao({ customCount, resetAll }: { customCount: number; resetAll: () => void }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {customCount === 0 ? (
        <Callout tone="ok" title="Tudo nos padrões oficiais">
          <p className="text-[13px]">
            Nenhum parâmetro foi customizado. Os cálculos do FinancePRO usarão integralmente as
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

/** Linha amigável: rótulo + ajuda em linguagem simples + input + reset + indicador "padrão/customizado". */
function FriendlyRow({
  label,
  suffix,
  defaultVal,
  help,
  value,
  onChange,
  onReset,
}: {
  label: string;
  suffix: string;
  defaultVal: number;
  help: string;
  value: number;
  onChange: (n: number) => void;
  onReset: () => void;
}) {
  const isDefault = value === defaultVal;
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-3">
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
        <div className="flex items-center gap-1">
          <div className="w-[110px]">
            <NumInput value={value} onChange={onChange} />
          </div>
          <span className="w-6 text-center text-[10px] text-muted-foreground">{suffix}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={isDefault}
            onClick={onReset}
            title="Restaurar padrão"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
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
