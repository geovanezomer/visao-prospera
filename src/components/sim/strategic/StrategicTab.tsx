import {
  AppState,
  StrategicAnswers,
  ClientesPara80,
  TempoCliente,
  DependenciaCanal,
  SocioAfastado,
  QuemFechaContrato,
  ProcessosDoc,
  PlanoSucessao,
  ReajustePrecos,
  Elasticidade,
  RazaoContratacao,
  Concorrentes,
  SwitchingCost,
  ExposicaoRegulatoria,
} from "@/engines/finance/types";
import { useFinanceSelector, useFinanceUpdate } from "@/engines/finance/AppStateContext";
import { SectionTitle, HelpTip } from "@/components/sim/shared/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { RotateCcw, ShieldAlert } from "lucide-react";
import { fmtNum } from "@/engines/finance/format";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

const EMPTY: StrategicAnswers = {
  concentration: {},
  governance: {},
  competitive: {},
  regulatory: {},
};

function ensureStrategic(s: AppState["strategic"] | undefined): StrategicAnswers {
  const v = s ?? EMPTY;
  return {
    concentration: v.concentration ?? {},
    governance: v.governance ?? {},
    competitive: v.competitive ?? {},
    regulatory: v.regulatory ?? {},
  };
}

export function StrategicTab() {
  // Seletor granular: re-renderiza apenas quando `state.strategic` mudar
  // (não re-renderiza ao editar receitas/custos/etc.).
  const strategic = useFinanceSelector((s) => s.strategic);
  const update = useFinanceUpdate();
  const answers = ensureStrategic(strategic);

  const setSection = <K extends keyof StrategicAnswers>(
    key: K,
    patch: Partial<StrategicAnswers[K]>,
  ) => {
    update((s) => ({
      ...s,
      strategic: {
        ...ensureStrategic(s.strategic),
        [key]: { ...ensureStrategic(s.strategic)[key], ...patch },
      },
    }));
  };

  const clearAll = () => {
    update((s) => ({
      ...s,
      strategic: { concentration: {}, governance: {}, competitive: {}, regulatory: {} },
    }));
  };

  const hasAny =
    Object.values(answers.concentration).some((v) => v != null) ||
    Object.values(answers.governance).some((v) => v != null) ||
    Object.values(answers.competitive).some((v) => v != null) ||
    Object.values(answers.regulatory).some((v) => v != null);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-foreground">
              Governança — análise estratégica (opcional)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Indicadores financeiros não capturam concentração de receita, dependência de
              pessoas-chave ou posição competitiva. Responda o que souber — cada dimensão preenchida
              entra no cálculo de um <strong>Índice de Risco Estratégico</strong>.{" "}
              <strong>Os resultados aparecem na aba "Resultados".</strong>
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Frameworks: HHI (CADE), bus factor, 5 forças de Porter simplificadas.
            </p>
          </div>
          {hasAny && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <RotateCcw className="mr-2 h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <Section
        title="1. Concentração de clientes"
        subtitle="Quanto da sua receita está exposta se um cliente sair?"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="% da receita do seu maior cliente"
            help="HHI (Herfindahl) — CADE: >2500 alta, 1500–2500 moderada, <1500 baixa."
          >
            <PctSlider
              value={answers.concentration.pctMaiorCliente}
              onChange={(v) => setSection("concentration", { pctMaiorCliente: v })}
            />
          </Field>
          <Field label="Quantos clientes respondem por ~80% da receita?">
            <Choice<ClientesPara80>
              value={answers.concentration.clientesPara80Pct}
              onChange={(v) => setSection("concentration", { clientesPara80Pct: v })}
              options={[
                ["1-2", "1–2 clientes"],
                ["3-5", "3–5 clientes"],
                ["6-15", "6–15 clientes"],
                ["16+", "Mais de 15"],
              ]}
            />
          </Field>
          <Field label="Há quanto tempo o maior cliente está com você?">
            <Choice<TempoCliente>
              value={answers.concentration.tempoMaiorCliente}
              onChange={(v) => setSection("concentration", { tempoMaiorCliente: v })}
              options={[
                ["lt1", "Menos de 1 ano"],
                ["1-3", "1 a 3 anos"],
                ["3-5", "3 a 5 anos"],
                ["5+", "Mais de 5 anos"],
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="2. Fornecedores & canais de aquisição"
        subtitle="Risco de ruptura na entrada de insumos ou leads."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="% do CPV/CMV vindo do maior fornecedor"
            help="Concentração em um único fornecedor expõe a ruptura e poder de barganha."
          >
            <PctSlider
              value={answers.concentration.pctMaiorFornecedor}
              onChange={(v) => setSection("concentration", { pctMaiorFornecedor: v })}
            />
          </Field>
          <Field
            label="Depende de um único canal para gerar leads/vendas?"
            help="Ex.: 100% Google Ads, marketplace único. Risco invisível no balanço."
          >
            <Choice<DependenciaCanal>
              value={answers.concentration.dependeCanal}
              onChange={(v) => setSection("concentration", { dependeCanal: v })}
              options={[
                ["sim", "Sim, um único canal"],
                ["parcial", "Parcial, 2–3 canais"],
                ["nao", "Não, diversificado"],
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="3. Governança & dependência de pessoas-chave"
        subtitle="Bus factor: o que acontece se o sócio principal se ausenta?"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Se o sócio principal ficasse 60 dias afastado, o que aconteceria?">
            <Choice<SocioAfastado>
              value={answers.governance.socioAfastado60d}
              onChange={(v) => setSection("governance", { socioAfastado60d: v })}
              options={[
                ["normal", "Operação continua normal"],
                ["perde_eficiencia", "Perde eficiência, mas sobrevive"],
                ["para", "Para ou perde clientes relevantes"],
              ]}
            />
          </Field>
          <Field label="Quem, além do sócio, pode fechar um contrato novo?">
            <Choice<QuemFechaContrato>
              value={answers.governance.quemFechaContrato}
              onChange={(v) => setSection("governance", { quemFechaContrato: v })}
              options={[
                ["ninguem", "Ninguém — só o sócio"],
                ["socios", "Apenas outros sócios"],
                ["gerentes", "Gerentes treinados"],
                ["equipe", "Equipe comercial independente"],
              ]}
            />
          </Field>
          <Field label="Os processos críticos estão documentados?">
            <Choice<ProcessosDoc>
              value={answers.governance.processosDocumentados}
              onChange={(v) => setSection("governance", { processosDocumentados: v })}
              options={[
                ["nenhum", "Nenhum"],
                ["financeiros", "Apenas os financeiros"],
                ["operacionais", "Os operacionais"],
                ["maioria", "A maioria"],
              ]}
            />
          </Field>
          <Field label="Há plano de sucessão para pelo menos uma posição-chave?">
            <Choice<PlanoSucessao>
              value={answers.governance.planoSucessao}
              onChange={(v) => setSection("governance", { planoSucessao: v })}
              options={[
                ["sim", "Sim"],
                ["parcial", "Parcialmente"],
                ["nao", "Não"],
                ["nunca", "Nunca pensamos nisso"],
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="4. Posição competitiva"
        subtitle="Poder de precificação, switching cost e estrutura do mercado."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Nos últimos 2 anos, conseguiu reajustar preços acima da inflação?"
            help="Poder de precificação é o indicador mais direto de moat competitivo."
          >
            <Choice<ReajustePrecos>
              value={answers.competitive.reajustePrecos}
              onChange={(v) => setSection("competitive", { reajustePrecos: v })}
              options={[
                ["sem_resistencia", "Sim, sem resistência"],
                ["com_resistencia", "Sim, com alguma resistência"],
                ["nao_repassou", "Não consegui repassar"],
                ["reduziu", "Tive de reduzir preços"],
              ]}
            />
          </Field>
          <Field label="Se aumentasse o preço em 10% amanhã, o que aconteceria?">
            <Choice<Elasticidade>
              value={answers.competitive.elasticidade10pct}
              onChange={(v) => setSection("competitive", { elasticidade10pct: v })}
              options={[
                ["menos_5", "Perderia menos de 5% dos clientes"],
                ["5_20", "Perderia 5–20%"],
                ["mais_20", "Perderia mais de 20%"],
                ["nao_sei", "Não sei"],
              ]}
            />
          </Field>
          <Field label="Por que os clientes te contratam em vez do concorrente?">
            <Choice<RazaoContratacao>
              value={answers.competitive.razaoContratacao}
              onChange={(v) => setSection("competitive", { razaoContratacao: v })}
              options={[
                ["preco", "Preço mais baixo"],
                ["relacionamento", "Relacionamento pessoal"],
                ["qualidade", "Qualidade técnica"],
                ["unica_opcao", "Única opção na região"],
                ["prazo", "Prazo de entrega"],
                ["marca", "Marca / reputação"],
              ]}
            />
          </Field>
          <Field label="Quantos concorrentes diretos no seu segmento/região?">
            <Choice<Concorrentes>
              value={answers.competitive.concorrentes}
              onChange={(v) => setSection("competitive", { concorrentes: v })}
              options={[
                ["nenhum", "Nenhum"],
                ["1-3", "1 a 3"],
                ["4-10", "4 a 10"],
                ["10+", "Mais de 10"],
                ["nao_sei", "Não sei"],
              ]}
            />
          </Field>
          <Field
            label="Seus clientes teriam custo relevante para trocar de fornecedor?"
            help="Switching cost = barreira de saída. Quanto maior, mais defensável a receita."
          >
            <Choice<SwitchingCost>
              value={answers.competitive.switchingCost}
              onChange={(v) => setSection("competitive", { switchingCost: v })}
              options={[
                ["alto", "Alto (integração técnica ou contrato)"],
                ["medio", "Médio (aprendizado, relacionamento)"],
                ["baixo", "Baixo (troca fácil)"],
                ["commodity", "Nenhum (commodity pura)"],
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="5. Exposição regulatória, cambial ou contratual"
        subtitle="Riscos binários fora do controle da gestão."
      >
        <Field
          label="A operação depende de licença, certificação, contrato público, importação ou câmbio?"
          help="Risco binário: pode parar a operação independentemente da qualidade da gestão."
        >
          <Choice<ExposicaoRegulatoria>
            value={answers.regulatory.exposicaoRegulatoria}
            onChange={(v) => setSection("regulatory", { exposicaoRegulatoria: v })}
            options={[
              ["sim", "Sim, dependência clara"],
              ["parcial", "Parcial"],
              ["nao", "Não"],
            ]}
          />
        </Field>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="mb-4">
        <SectionTitle>{title}</SectionTitle>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {label}
        {help && <HelpTip text={help} />}
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-9 bg-input/40">
        <SelectValue placeholder="Selecione…" />
      </SelectTrigger>
      <SelectContent>
        {options.map(([k, label]) => (
          <SelectItem key={k} value={k}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PctSlider({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (n: number) => void;
}) {
  const v = value ?? 0;
  const filled = value != null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Slider
          value={[v]}
          min={0}
          max={100}
          step={1}
          onValueChange={(arr) => onChange(arr[0])}
          className="flex-1"
        />
        <div className="mono w-16 rounded border border-border/60 bg-input/40 px-2 py-1 text-right text-sm">
          {fmtNum(v, 0)}%
        </div>
      </div>
      {!filled && (
        <button
          onClick={() => onChange(0)}
          className="text-[11px] text-muted-foreground hover:text-primary"
        >
          (campo não preenchido — clique para começar)
        </button>
      )}
    </div>
  );
}
