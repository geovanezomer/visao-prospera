// Landing page institucional do FinancePRO.
// Tudo isolado em src/components/landing/ — não importa nada do app.
// Ativada/desativada via VITE_LANDING_PAGE no .env.

import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Calculator,
  CheckCircle2,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  LineChart,
  Lock,
  PieChart,
  Quote,
  Scale,
  ShieldCheck,
  Sparkles,
  Split,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { useState } from "react";

/* ============================================================
   HERO
   ============================================================ */
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/50">
      {/* glow decorativo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 20% 0%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 70%), radial-gradient(50% 40% at 90% 10%, color-mix(in oklab, var(--info) 14%, transparent), transparent 70%)",
        }}
      />
      <div className="mx-auto max-w-6xl px-6 pt-20 pb-24 lg:pt-28 lg:pb-32">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Finanças Empresariais para Não-Financeiros
            </span>

            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              O <span className="text-primary">Raio-X financeiro</span> que
              transforma você em um <span className="text-primary">CFO</span>{" "}
              de alto nível.
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              DRE, Balanço, Fluxo de Caixa, impactos da Reforma Tributária e{" "}
              <strong className="text-foreground">+40 indicadores</strong> em um
              único painel inteligente — com{" "}
              <strong className="text-foreground">IA</strong> que entrega o
              diagnóstico que seu cliente espera ouvir.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:shadow-primary/40"
              >
                Começar gratuitamente
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#como-funciona"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-card"
              >
                Ver como funciona
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Consultoria registrada CVM
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-primary" />
                Dados criptografados
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-primary" />
                Sem cartão de crédito
              </span>
            </div>
          </div>

          {/* mockup decorativo */}
          <HeroMockup />
        </div>
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 rounded-3xl opacity-50 blur-2xl"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--primary) 30%, transparent), color-mix(in oklab, var(--info) 20%, transparent))",
        }}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-border bg-background/40 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          <span className="ml-3 text-[11px] text-muted-foreground">
            financepro.app / dashboard
          </span>
        </div>
        <div className="space-y-4 p-5">
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { l: "Receita", v: "R$ 4,2M", t: "+18%" },
              { l: "EBITDA", v: "28%", t: "+3,2pp" },
              { l: "FCF", v: "R$ 612k", t: "+24%" },
            ].map((k) => (
              <div
                key={k.l}
                className="rounded-lg border border-border bg-background/40 p-3"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {k.l}
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {k.v}
                </div>
                <div className="text-[11px] font-medium text-primary">
                  {k.t}
                </div>
              </div>
            ))}
          </div>
          {/* chart fake */}
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Fluxo de Caixa Projetado</span>
              <span className="text-primary">12M</span>
            </div>
            <svg viewBox="0 0 320 110" className="h-28 w-full">
              <defs>
                <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--primary)"
                    stopOpacity="0.5"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--primary)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path
                d="M0,80 L30,70 L60,75 L90,55 L120,60 L150,40 L180,45 L210,30 L240,35 L270,20 L300,25 L320,15 L320,110 L0,110 Z"
                fill="url(#grad)"
              />
              <path
                d="M0,80 L30,70 L60,75 L90,55 L120,60 L150,40 L180,45 L210,30 L240,35 L270,20 L300,25 L320,15"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2"
              />
            </svg>
          </div>
          {/* bars */}
          <div className="grid grid-cols-6 gap-2">
            {[40, 65, 50, 80, 70, 95].map((h, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{ height: `${h * 0.5}px` }}
                />
                <div className="text-[9px] text-muted-foreground">
                  M{i + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PROBLEMA / DOR
   ============================================================ */
function ProblemAgitation() {
  const dores = [
    "Planilhas frágeis que quebram a cada alteração do cliente",
    "Reforma Tributária (CBS/IBS) mudando o jogo a cada trimestre",
    "Cliente PME exigindo decisão, não tabela",
    "Horas perdidas formatando relatório em vez de analisar",
    "Indicadores espalhados, sem visão única do negócio",
    "Risco de erro em cálculo que custa a reputação CVM",
  ];
  return (
    <section className="border-b border-border/50 bg-card/30 py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Você não vende planilha.<br />
            <span className="text-muted-foreground">Vende decisão.</span>
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Mas o seu dia ainda é refém de fórmulas quebradas, abas infinitas e
            uma Reforma Tributária que muda o chão debaixo dos pés.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          {dores.map((d) => (
            <div
              key={d}
              className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-4"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-destructive/40 text-destructive">
                ✕
              </span>
              <span className="text-sm text-foreground/90">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PILARES
   ============================================================ */
function SolutionPillars() {
  const pilares = [
    {
      icon: BarChart3,
      title: "Raio-X Financeiro",
      desc: "DRE, Balanço, DFC e +40 indicadores conectados — uma única fonte de verdade para todo o ciclo da PME.",
    },
    {
      icon: ShieldCheck,
      title: "Reforma CBS / IBS",
      desc: "Cálculo automático dos impactos da LC 214/2025 sobre margem, preço e fluxo de caixa. Atualizado a cada fase de transição.",
    },
    {
      icon: Brain,
      title: "IA Estratégica",
      desc: "Diagnóstico executivo gerado por IA treinada em CFO PME brasileira. Sugere alavancas. Justifica decisões.",
    },
  ];
  return (
    <section className="border-b border-border/50 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionEyebrow>O sistema que faltava</SectionEyebrow>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Três pilares que substituem dez planilhas e meia consultoria.
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {pilares.map((p) => (
            <div
              key={p.title}
              className="group relative overflow-hidden rounded-xl border border-border bg-card p-7 transition hover:border-primary/40"
            >
              <div
                aria-hidden
                className="absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 transition group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(circle, color-mix(in oklab, var(--primary) 25%, transparent), transparent 70%)",
                }}
              />
              <p.icon className="h-7 w-7 text-primary" />
              <h3 className="mt-5 text-lg font-semibold text-foreground">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   GRID DE FEATURES
   ============================================================ */
function FeatureGrid() {
  const features = [
    {
      icon: LineChart,
      t: "DRE Inteligente",
      d: "Mensal e anual por regime tributário, com simulação de cenários.",
    },
    {
      icon: TrendingUp,
      t: "+40 Indicadores",
      d: "EBITDA, ROIC, WACC, NCG, liquidez, endividamento, cobertura — tudo automático.",
    },
    {
      icon: BarChart3,
      t: "Valuation DCF",
      d: "Fluxo de caixa descontado + múltiplos. Sensibilidade integrada.",
    },
    {
      icon: GitBranch,
      t: "Simulador de Cenários",
      d: "Compare otimista, base e pessimista lado a lado em segundos.",
    },
    {
      icon: Split,
      t: "Split Payment",
      d: "Simule a retenção automática de CBS/IBS no recebimento e o efeito no caixa.",
    },
    {
      icon: Wallet,
      t: "Fluxo de Caixa",
      d: "DFC direto e indireto, projeção mensal e alertas de ruptura.",
    },
    {
      icon: Scale,
      t: "Análise de Balanço",
      d: "Balanço Patrimonial estruturado com auditoria automática de consistência.",
    },
    {
      icon: PieChart,
      t: "Dashboard Gráfico",
      d: "Visão executiva com gráficos de receita, margem, indicadores e tendências.",
    },
    {
      icon: ShieldCheck,
      t: "CBS / IBS",
      d: "Impacto da Reforma Tributária no preço, na margem e no caixa.",
    },
    {
      icon: Calculator,
      t: "Calculadoras Trabalhistas",
      d: "CLT vs PJ, rescisão, 13º, férias, horas extras. Exporta PDF.",
    },
    {
      icon: Brain,
      t: "Diagnóstico IA",
      d: "Relatório executivo gerado por IA — pronto para entregar ao cliente.",
    },
    {
      icon: FileSpreadsheet,
      t: "Compartilhamento",
      d: "Link público auditável para o cliente PME acompanhar em tempo real.",
    },
  ];
  return (
    <section
      id="recursos"
      className="border-b border-border/50 bg-card/30 py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionEyebrow>Recursos</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Tudo que um CFO de banca de investimento usaria — em um clique.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.t}
              className="group flex flex-col gap-3 bg-card p-6 transition hover:bg-accent/30"
            >
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{f.t}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {f.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   COMO FUNCIONA
   ============================================================ */
function HowItWorks() {
  const passos = [
    {
      n: "01",
      t: "Importe ou crie",
      d: "Cadastre os dados da PME — receita, custos, regime, ativos. Em minutos, não dias.",
    },
    {
      n: "02",
      t: "Simule cenários",
      d: "Mexa nas alavancas: preço, custo, capital de giro, dívida. O sistema recalcula tudo em tempo real.",
    },
    {
      n: "03",
      t: "Entregue a decisão",
      d: "Exporte relatório PDF com identidade visual, ou envie link público auditável ao cliente.",
    },
  ];
  return (
    <section
      id="como-funciona"
      className="border-b border-border/50 py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <SectionEyebrow>Como funciona</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Do dado bruto ao diagnóstico em três passos.
        </h2>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {passos.map((p, i) => (
            <div
              key={p.n}
              className="relative rounded-xl border border-border bg-card p-7"
            >
              <div className="text-5xl font-semibold tracking-tighter text-primary/40">
                {p.n}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-foreground">
                {p.t}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {p.d}
              </p>
              {i < passos.length - 1 && (
                <ArrowRight className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-border md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   COMPARATIVO
   ============================================================ */
function ComparisonTable() {
  const linhas = [
    ["Tempo para gerar análise completa", "8 a 20 horas", "Minutos"],
    ["Erro de fórmula", "Comum", "Zero — engine auditada"],
    ["Reforma Tributária CBS/IBS", "Cálculo manual", "Automático"],
    ["Diagnóstico executivo", "Você escreve", "IA gera, você revisa"],
    ["Relatório PDF com sua marca", "Edição manual", "Um clique"],
    ["Compartilhamento ao cliente", "Anexo por e-mail", "Link público auditável"],
  ];
  return (
    <section className="border-b border-border/50 bg-card/30 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <SectionEyebrow>Comparativo</SectionEyebrow>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Planilha Excel vs. Consultor com FinancePRO.
        </h2>

        <div className="mt-10 overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-[1.6fr_1fr_1fr] bg-background/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <div className="border-b border-border p-4">Critério</div>
            <div className="border-b border-l border-border p-4 text-center">
              Planilha
            </div>
            <div className="border-b border-l border-border bg-primary/10 p-4 text-center text-primary">
              FinancePRO
            </div>
          </div>
          {linhas.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[1.6fr_1fr_1fr] text-sm last:border-b-0"
            >
              <div className="border-b border-border p-4 text-foreground/90">
                {l[0]}
              </div>
              <div className="border-b border-l border-border p-4 text-center text-muted-foreground">
                {l[1]}
              </div>
              <div className="border-b border-l border-border bg-primary/5 p-4 text-center font-medium text-primary">
                {l[2]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   AUTORIDADE
   ============================================================ */
function AuthorityBlock() {
  return (
    <section className="border-b border-border/50 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid gap-0 md:grid-cols-[1fr_1.4fr]">
            <div
              className="relative flex items-center justify-center p-10"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in oklab, var(--primary) 18%, var(--card)), var(--card))",
              }}
            >
              <div className="text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/40 bg-background text-2xl font-semibold text-primary">
                  GZ
                </div>
                <div className="mt-4 text-sm font-semibold text-foreground">
                  Geovane Zomer
                </div>
                <div className="text-xs text-muted-foreground">
                  Consultor Financeiro & Investimentos
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                  <ShieldCheck className="h-3 w-3" />
                  CVM 3354-5
                </div>
              </div>
            </div>
            <div className="p-10">
              <SectionEyebrow>Construído por quem vive isso</SectionEyebrow>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Um sistema desenhado por um consultor CVM — para consultores
                CVM.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                O FinancePRO nasceu dentro da{" "}
                <strong className="text-foreground">
                  GZ Consultoria Financeira & Investimentos
                </strong>{" "}
                para resolver, na prática, o que toda planilha falha: dar ao
                consultor a velocidade, o rigor e a profundidade que a PME
                brasileira merece — agora com a Reforma Tributária no jogo.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-foreground/90">
                {[
                  "Engine financeira auditada e versionada",
                  "Cálculos compatíveis com LC 214/2025 (CBS / IBS)",
                  "IA com prompt versionado para rastreabilidade CVM",
                ].map((i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PROVA SOCIAL
   ============================================================ */
function SocialProof() {
  const cases = [
    {
      q: "Reduzi o tempo de fechamento mensal de três dias para uma manhã. O cliente passou a entender o que vê.",
      a: "Consultor Financeiro — SP",
    },
    {
      q: "O módulo da Reforma Tributária sozinho já paga o sistema. Cheguei na reunião com cálculo, não com achismo.",
      a: "Contador Sênior — RS",
    },
    {
      q: "O diagnóstico de IA virou meu rascunho executivo. Edito, assino e entrego. Game changer.",
      a: "Family Office — MG",
    },
  ];
  return (
    <section className="border-b border-border/50 bg-card/30 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionEyebrow>Prova social</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Quem usa, não volta para a planilha.
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {cases.map((c, i) => (
            <figure
              key={i}
              className="flex h-full flex-col rounded-xl border border-border bg-card p-7"
            >
              <Quote className="h-7 w-7 text-primary/60" />
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground/90">
                "{c.q}"
              </blockquote>
              <figcaption className="mt-5 border-t border-border pt-4 text-xs font-medium text-muted-foreground">
                {c.a}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */
function FaqAccordion() {
  const faqs = [
    {
      q: "Preciso instalar alguma coisa?",
      a: "Não. O FinancePRO roda 100% no navegador. Login, importa os dados e começa a analisar.",
    },
    {
      q: "Meus dados ficam seguros?",
      a: "Sim. Os dados são criptografados e armazenados em infraestrutura na nuvem com backup opcional. Você controla o que sai do seu computador.",
    },
    {
      q: "A Reforma Tributária está realmente atualizada?",
      a: "Sim. O motor tributário acompanha a LC 214/2025 e as fases de transição CBS/IBS (2026-2033), incluindo Split Payment e Cashback.",
    },
    {
      q: "Posso usar com vários clientes?",
      a: "Sim. Você cria quantos cenários e empresas quiser, cada um com seu próprio conjunto de dados, relatórios e link de compartilhamento.",
    },
    {
      q: "Como funciona a IA?",
      a: "A IA gera o diagnóstico executivo a partir dos números reais da empresa simulada. Você revisa, ajusta e entrega — com prompt versionado para auditoria.",
    },
    {
      q: "Posso cancelar quando quiser?",
      a: "Sim. Sem fidelidade, sem multa. Você cancela direto da sua conta.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="border-b border-border/50 py-24">
      <div className="mx-auto max-w-3xl px-6">
        <SectionEyebrow>Perguntas frequentes</SectionEyebrow>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          O que você precisa saber.
        </h2>
        <div className="mt-10 divide-y divide-border rounded-xl border border-border bg-card">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left text-sm font-medium text-foreground transition hover:bg-accent/30"
                  aria-expanded={isOpen}
                >
                  <span>{f.q}</span>
                  <span
                    className={`text-primary transition-transform ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   CTA FINAL
   ============================================================ */
function FinalCta() {
  return (
    <section className="relative overflow-hidden py-24">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 50%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
        }}
      />
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          Pare de analisar planilhas.<br />
          <span className="text-primary">Comece a tomar decisões.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
          Em menos de 5 minutos você roda sua primeira análise e gera um
          relatório baseado em dados.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="group inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition hover:shadow-primary/50"
          >
            Criar minha conta gratuita
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-6 py-3.5 text-sm font-medium text-foreground transition hover:bg-card"
          >
            Já tenho conta
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   HEADER + FOOTER + helpers
   ============================================================ */
function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
      {children}
    </span>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link to="/landing" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            F
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            FinancePRO
          </span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#recursos" className="transition hover:text-foreground">
            Recursos
          </a>
          <a href="#como-funciona" className="transition hover:text-foreground">
            Como funciona
          </a>
          <a href="#faq" className="transition hover:text-foreground">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            Entrar
          </Link>
          <Link
            to="/signup"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Começar
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-xs text-muted-foreground sm:flex-row">
        <span>
          © {new Date().getFullYear()} FinancePRO · Desenvolvido por{" "}
          <strong className="text-foreground">
            GZ Consultoria Financeira & Investimentos
          </strong>
        </span>
        <div className="flex items-center gap-5">
          <Link to="/login" className="transition hover:text-foreground">
            Entrar
          </Link>
          <Link to="/signup" className="transition hover:text-foreground">
            Criar conta
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   EXPORT — composição final
   ============================================================ */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <ProblemAgitation />
        <SolutionPillars />
        <FeatureGrid />
        <HowItWorks />
        <ComparisonTable />
        <AuthorityBlock />
        <SocialProof />
        <div id="faq">
          <FaqAccordion />
        </div>
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
