import { useMemo } from "react";
import {
  AppState,
  StrategicAnswers,
  ConcentrationAnswers,
  GovernanceAnswers,
  CompetitiveAnswers,
  RegulatoryAnswers,
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
} from "@/lib/finance/types";
import { computeStrategic, quadrant, type SubScore } from "@/lib/finance/strategic";
import { computeHealth } from "@/lib/finance/health";
import { SectionTitle, StatCard, HelpTip } from "./primitives";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle, RotateCcw, ShieldAlert, TriangleAlert } from "lucide-react";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

const EMPTY: StrategicAnswers = { concentration: {}, governance: {}, competitive: {}, regulatory: {} };

function ensure(state: AppState): StrategicAnswers {
  const s = state.strategic ?? EMPTY;
  return {
    concentration: s.concentration ?? {},
    governance: s.governance ?? {},
    competitive: s.competitive ?? {},
    regulatory: s.regulatory ?? {},
  };
}

export function StrategicTab({ state, update }: { state: AppState; update: Updater }) {
  const answers = ensure(state);
  const strategic = useMemo(() => computeStrategic(state), [state]);
  const health = useMemo(() => computeHealth(state), [state]);
  const quad = useMemo(() => quadrant(health.financial, strategic), [health.financial, strategic]);

  const setSection = <K extends keyof StrategicAnswers>(key: K, patch: Partial<StrategicAnswers[K]>) => {
    update((s) => ({
      ...s,
      strategic: {
        ...ensure(s),
        [key]: { ...ensure(s)[key], ...patch },
      },
    }));
  };

  const clearAll = () => {
    update((s) => ({ ...s, strategic: { concentration: {}, governance: {}, competitive: {}, regulatory: {} } }));
  };

  return (
    <div className="space-y-6">
      {/* Banner explicativo */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-foreground">Análise Estratégica — opcional</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Indicadores financeiros não capturam concentração de receita, dependência de pessoas-chave ou posição
              competitiva. Esta seção é qualitativa: responda o que souber — cada dimensão preenchida entra no cálculo
              de um <strong>Índice de Risco Estratégico</strong> que aplica um <strong>haircut dinâmico</strong> sobre
              o health financeiro. <strong>Seções vazias não penalizam o score.</strong>
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Frameworks usados: HHI (parâmetro CADE), bus factor (governança), 5 forças de Porter simplificadas.
            </p>
          </div>
          {strategic.hasAnyAnswer && (
            <Button variant="ghost" size="sm" onClick={clearAll} title="Limpar todas as respostas">
              <RotateCcw className="mr-2 h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Painel de resultado */}
      {strategic.hasAnyAnswer && (
        <ResultPanel financial={health.financial} totalScore={health.total} strategic={strategic} quad={quad} />
      )}

      {/* Concentração de clientes */}
      <Section
        title="1. Concentração de clientes"
        subtitle="Quanto da sua receita está exposta se um cliente sair?"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="% da receita do seu maior cliente"
            help="HHI (Herfindahl) — parâmetro CADE: >2500 = alta concentração, 1500–2500 = moderada, <1500 = baixa."
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

      {/* Fornecedores e canais */}
      <Section
        title="2. Fornecedores & canais de aquisição"
        subtitle="Risco de ruptura na entrada de insumos ou de leads."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="% do CPV/CMV vindo do maior fornecedor"
            help="Concentração em um único fornecedor expõe a empresa a ruptura de fornecimento e poder de barganha."
          >
            <PctSlider
              value={answers.concentration.pctMaiorFornecedor}
              onChange={(v) => setSection("concentration", { pctMaiorFornecedor: v })}
            />
          </Field>

          <Field
            label="Depende de um único canal para gerar leads/vendas?"
            help="Ex.: 100% via Google Ads, marketplace único, indicação de 1 parceiro. Risco invisível no balanço."
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

      {/* Governança */}
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

      {/* Posição competitiva */}
      <Section
        title="4. Posição competitiva"
        subtitle="Poder de precificação, switching cost e estrutura do mercado (5 forças de Porter)."
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

      {/* Regulatório */}
      <Section
        title="5. Exposição regulatória, cambial ou contratual"
        subtitle="Riscos binários fora do controle da gestão."
      >
        <Field
          label="A operação depende de licença, certificação, contrato público, importação ou câmbio?"
          help="Risco binário: uma mudança regulatória pode parar a operação independentemente da qualidade da gestão."
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

// ============================================================
// Subcomponentes
// ============================================================

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
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
  value, onChange, options,
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
          <SelectItem key={k} value={k}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PctSlider({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
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
          {v.toFixed(0)}%
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

// ============================================================
// Painel de resultado
// ============================================================

function ResultPanel({
  financial, totalScore, strategic, quad,
}: {
  financial: number;
  totalScore: number;
  strategic: ReturnType<typeof computeStrategic>;
  quad: ReturnType<typeof quadrant>;
}) {
  const levelTone =
    strategic.level === "robusto" ? "pos"
    : strategic.level === "adequado" ? "default"
    : strategic.level === "frágil" ? "warn"
    : "neg";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Índice de Risco Estratégico"
          value={`${strategic.index}/100`}
          tone={levelTone as "pos" | "default" | "warn" | "neg"}
          sub={`Nível: ${strategic.level}`}
        />
        <StatCard
          label="Haircut aplicado"
          value={`${(strategic.haircut * 100).toFixed(0)}%`}
          tone={strategic.haircut === 0 ? "pos" : strategic.haircut > 0.2 ? "neg" : "warn"}
          sub="reduz o health financeiro"
        />
        <StatCard
          label="Health score ajustado"
          value={`${totalScore.toFixed(0)}/100`}
          sub={`Financeiro puro: ${financial.toFixed(0)}`}
        />
      </div>

      {/* Headline */}
      <div className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
        <div className="text-foreground">{strategic.headline}</div>
      </div>

      {/* Matriz 2x2 */}
      <Matrix financial={financial} strategic={strategic.index} quad={quad} />

      {/* Sub-scores */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {strategic.subscores.filter((s) => s.filled).map((s) => (
          <SubscoreCard key={s.key} sub={s} />
        ))}
        {strategic.subscores.filter((s) => !s.filled).length > 0 && (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
            <div className="mb-2 flex items-center gap-1.5 font-medium">
              <HelpCircle className="h-4 w-4" /> Dimensões não respondidas
            </div>
            <ul className="space-y-1">
              {strategic.subscores.filter((s) => !s.filled).map((s) => (
                <li key={s.key} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" /> {s.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] italic">Não penalizam o score — apenas reduzem a precisão do diagnóstico.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SubscoreCard({ sub }: { sub: SubScore }) {
  const tone =
    sub.status === "ok" ? { bar: "bg-pos", icon: <CheckCircle2 className="h-4 w-4 text-pos" />, label: "Robusto" }
    : sub.status === "warn" ? { bar: "bg-[var(--warning)]", icon: <TriangleAlert className="h-4 w-4 text-[var(--warning)]" />, label: "Atenção" }
    : { bar: "bg-neg", icon: <AlertTriangle className="h-4 w-4 text-neg" />, label: "Crítico" };
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {tone.icon} {sub.label}
        </div>
        <div className="mono text-sm font-semibold">{sub.score.toFixed(0)}</div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
        <div className={`h-full ${tone.bar}`} style={{ width: `${sub.score}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
        {sub.highlights.map((h, i) => (
          <li key={i} className="flex gap-1.5">
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Matrix({
  financial, strategic, quad,
}: {
  financial: number;
  strategic: number;
  quad: ReturnType<typeof quadrant>;
}) {
  // posiciona ponto: x = strategic (0 esq = alto risco, 100 dir = baixo risco)
  // y = financial  (0 baixo = fraco, 100 topo = forte)
  const x = strategic;
  const y = financial;

  const quadStyle = (key: "robusta" | "fragil_rica" | "vulneravel" | "critica") =>
    quad.q === key
      ? "border-primary bg-primary/10"
      : "border-border/40 bg-muted/10";

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Matriz Financeiro × Estratégico</SectionTitle>
        <div className="text-xs">
          <span className="text-muted-foreground">Quadrante: </span>
          <span className="font-semibold text-primary">{quad.label}</span>
        </div>
      </div>

      <div className="relative">
        <div className="grid grid-cols-2 gap-2">
          {/* y top */}
          <div className={`flex h-32 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("vulneravel")}`}>
            <div>
              <div className="font-semibold">Vulnerável</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Fin. fraco / Estrat. sólido</div>
            </div>
          </div>
          <div className={`flex h-32 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("robusta")}`}>
            <div>
              <div className="font-semibold">Robusta</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Fin. forte / Estrat. sólido</div>
            </div>
          </div>
          <div className={`flex h-32 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("critica")}`}>
            <div>
              <div className="font-semibold">Crítica</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Fin. fraco / Estrat. frágil</div>
            </div>
          </div>
          <div className={`flex h-32 items-center justify-center rounded border p-3 text-center text-xs ${quadStyle("fragil_rica")}`}>
            <div>
              <div className="font-semibold">Frágil-rica</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Fin. forte / Estrat. frágil</div>
            </div>
          </div>
        </div>

        {/* ponto da empresa */}
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-lg ring-2 ring-primary/40"
          style={{
            // inverte x: quanto MENOR strategic score → MAIOR risco → mais à esquerda
            // mas no layout, esquerda = estratégico ruim (Vulneravel/Critica)
            // Layout: linha1 [Vulneravel, Robusta], linha2 [Critica, Fragil-rica]
            // Estratégico bom (>=55) = direita; ruim = esquerda
            // Financeiro forte (>=60) = topo; fraco = baixo
            left: `${x}%`,
            top: `${100 - y}%`,
          }}
          title={`Fin: ${y.toFixed(0)} · Estrat: ${x.toFixed(0)}`}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{quad.description}</p>

      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>← Estratégico frágil</span>
        <span>Estratégico sólido →</span>
      </div>
    </div>
  );
}
