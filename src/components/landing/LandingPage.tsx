// Landing page institucional do FinnancePRO.
// Tudo isolado em src/components/landing/ — não importa nada do app.
// Ativada/desativada via VITE_LANDING_PAGE no .env.

import { Link } from "@tanstack/react-router";
import { useBranding } from "@/hooks/useBranding";
import { BrandedLogo } from "@/components/BrandedLogo";
import { BrandHeader } from "@/components/BrandHeader";
import { TrialRequestDialog } from "@/components/landing/TrialRequestDialog";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Briefcase,
  Building2,
  Calculator,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Gauge,
  LineChart,
  Lock,
  PlayCircle,
  Quote,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
// CPF/telefone agora são coletados na página do provedor de pagamento.
import { PlansSection, type RawPlan } from "@/components/landing/PlansSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
            "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 70%), radial-gradient(50% 40% at 80% 20%, color-mix(in oklab, var(--info) 12%, transparent), transparent 70%)",
        }}
      />
      <div className="mx-auto max-w-4xl px-6 pt-20 pb-20 text-center lg:pt-28 lg:pb-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Finanças empresariais para não-financeiros
        </span>

        <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          O <span className="text-primary">Raio-X financeiro</span> que transforma você em um{" "}
          <span className="text-primary">CFO de alto nível</span>.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Impactos da Reforma Tributária e Split Payment, DRE, Balanço, Fluxo de Caixa,{" "}
          <strong className="text-foreground">+40 indicadores</strong> em um único painel — com{" "}
          <strong className="text-foreground">Inteligência Artificial</strong> que entrega
          diagnósticos e relatórios em PDF em tempo real.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#planos"
            className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:shadow-primary/40"
          >
            Ver Planos
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </a>
          <a
            href="#como-funciona"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-card"
          >
            Ver como funciona
          </a>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Engine atualizada periodicamente
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-4 w-4 text-primary" />
            IndexedDB - Dados ficam no seu navegador
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-primary" />
            Análises em tempo real
          </span>
        </div>
      </div>

      {/* faixa de métricas dentro da Hero */}
      <div className="relative border-t border-border/50">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--primary) 6%, transparent), transparent)",
          }}
        />
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-center sm:text-left">
              <div className="text-5xl font-semibold tracking-tight text-primary">+40</div>
              <div className="mt-2 text-sm font-semibold text-foreground">Indicadores</div>
              <div className="text-xs text-muted-foreground">calculados automaticamente</div>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-5xl font-semibold tracking-tight text-primary">15 min</div>
              <div className="mt-2 text-sm font-semibold text-foreground">Primeira análise</div>
              <div className="text-xs text-muted-foreground">do cadastro ao diagnóstico</div>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-5xl font-semibold tracking-tight text-primary">100%</div>
              <div className="mt-2 text-sm font-semibold text-foreground">Reforma Tributária</div>
              <div className="text-xs text-muted-foreground">CBS/IBS sob LC 214/2025</div>
            </div>
            <div className="text-center sm:text-left">
              <div className="text-5xl font-semibold tracking-tight text-primary">I.A.</div>
              <div className="mt-2 text-sm font-semibold text-foreground">Embarcada</div>
              <div className="text-xs text-muted-foreground">análises explicadas</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   AUDIÊNCIA — Para quem é
   ============================================================ */
function AudienceStrip() {
  const personas = [
    {
      icon: Building2,
      title: "Empresário",
      desc: "Entenda seu negócio sem depender de jargão. Saiba se está ganhando, perdendo e por quê — em linguagem clara.",
    },
    {
      icon: Briefcase,
      title: "Consultor",
      desc: "Entregue análise de alto valor ao seu cliente em horas, não dias. Reforma Tributária com SplitPayment já embutida.",
    },
    {
      icon: Target,
      title: "BPO Financeiro",
      desc: "Centralize indicadores, projete cenários e leve aos seus clientes dados financeiros com lastro estatístico.",
    },
  ];
  return (
    <section className="border-b border-border/50 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>Para quem é</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Feito para{" "}
            <span className="text-primary">empresários, consultores e BPOs Financeiros</span>
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Não importa se você comanda a empresa, consulta para ela ou cuida dos números dela — o
            FinnancePRO traduz complexidade financeira em decisões simplificadas.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {personas.map((p) => (
            <div
              key={p.title}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
            >
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, color-mix(in oklab, var(--primary) 60%, transparent), transparent)",
                }}
              />
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PROBLEMA / DOR
   ============================================================ */
function ProblemAgitation() {
  const dores = [
    {
      dor: "Planilhas frágeis que quebram",
      consequencia: "Decisão tomada sobre dados inconsistentes.",
    },
    {
      dor: "Reforma Tributária mudando o jogo",
      consequencia: "Margens desatualizados a cada trimestre.",
    },
    {
      dor: "Indicadores espalhados em 10 abas",
      consequencia: "Ninguém vê o todo. Ninguém age a tempo.",
    },
    {
      dor: "Horas formatando relatório",
      consequencia: "Pouco tempo sobra para de fato analisar.",
    },
    {
      dor: "Diagnóstico no 'achismo'",
      consequencia: "Reunião sem clareza vira reunião improdutiva.",
    },
    {
      dor: "Cenários impossíveis de simular",
      consequencia: "Cada hipótese custa um dia de retrabalho.",
    },
  ];
  return (
    <section className="relative border-b border-border/50 bg-card/30 py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(50% 40% at 50% 0%, color-mix(in oklab, var(--destructive) 8%, transparent), transparent 70%)",
        }}
      />
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <SectionEyebrow>O problema</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Você não precisa de mais uma planilha.
            <br />
            <span className="text-muted-foreground">Precisa de clareza em tempo real.</span>
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Toda decisão financeira mal calculada custa caro. E quase nunca aparece no extrato —
            aparece no resultado do próximo trimestre da empresa.
          </p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dores.map((d) => (
            <div
              key={d.dor}
              className="group flex items-start gap-4 rounded-xl border border-border bg-background/60 p-5 transition hover:border-destructive/40"
            >
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
                ✕
              </span>
              <div>
                <div className="text-sm font-semibold text-foreground">{d.dor}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {d.consequencia}
                </div>
              </div>
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
      desc: "DRE, Balanço, DFC e +40 indicadores conectados — uma única fonte de verdade para todo o ciclo da empresa.",
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
              <h3 className="mt-5 text-lg font-semibold text-foreground">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
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
      t: "DRE e Fluxo Caixa",
      d: "Mensal, Trimestral e anual por regime tributário, com simulação de cenários.",
    },
    {
      icon: TrendingUp,
      t: "+40 Indicadores",
      d: "EBITDA, ROIC, WACC, liquidez e outras dezenas — automáticos.",
    },
    {
      icon: BarChart3,
      t: "I.A Embarcada",
      d: "Inteligência artificial treinada para análise empresarial.",
    },
    {
      icon: Gauge,
      t: "Simulador de Cenários",
      d: "Mexa nas alavancas e veja o impacto recalculado em tempo real.",
    },
    {
      icon: ShieldCheck,
      t: "Reforma Tributária",
      d: "Impacto do Split Payment e do CBS/IBS no caixa da empresa.",
    },
    {
      icon: LineChart,
      t: "Fluxo de Caixa",
      d: "DFC projetada, gaps, cobertura e capacidade de pagamento.",
    },
    {
      icon: FileSpreadsheet,
      t: "Análise de Balanço",
      d: "Liquidez, endividamento, ciclo e estrutura de capital — auditados.",
    },
    {
      icon: Calculator,
      t: "Dashboard Gráfico",
      d: "KPIs visuais, comparativos e séries históricas em uma única tela.",
    },
  ];
  return (
    <section id="recursos" className="border-b border-border/50 bg-card/30 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <SectionEyebrow>Recursos</SectionEyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Tudo que um empresário precisa pra tomar boas decisões — em um clique.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.t}
              className="group flex flex-col gap-3 bg-card p-6 transition hover:bg-accent/30"
            >
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{f.t}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   MÉTRICAS — Faixa de números
   ============================================================ */
function MetricsBand() {
  const metrics = [
    { n: "+40", l: "Indicadores", s: "calculados automaticamente" },
    { n: "5 min", l: "Primeira análise", s: "do cadastro ao diagnóstico" },
    { n: "100%", l: "Reforma Tributária", s: "CBS/IBS sob LC 214/2025" },
    { n: "I.A.", l: "Embarcada", s: "análises explicadas" },
  ];
  return (
    <section className="relative border-b border-border/50 py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--primary) 6%, transparent), transparent)",
        }}
      />
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.l} className="text-center sm:text-left">
              <div className="text-5xl font-semibold tracking-tight text-primary">{m.n}</div>
              <div className="mt-2 text-sm font-semibold text-foreground">{m.l}</div>
              <div className="text-xs text-muted-foreground">{m.s}</div>
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
function getYouTubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    // youtu.be/<id>
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    // youtube.com/embed/<id>
    if (u.pathname.startsWith("/embed/")) {
      return `https://www.youtube.com${u.pathname}`;
    }
    // youtube.com/watch?v=<id>
    const v = u.searchParams.get("v");
    if (v) return `https://www.youtube.com/embed/${v}`;
    // youtube.com/shorts/<id>
    if (u.pathname.startsWith("/shorts/")) {
      const id = u.pathname.split("/")[2];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

function HowItWorks() {
  const { landingVideo } = useBranding();
  const [videoOpen, setVideoOpen] = useState(false);
  const embedUrl = useMemo(() => getYouTubeEmbedUrl(landingVideo.url), [landingVideo.url]);
  const showVideoBtn = landingVideo.enabled && !!embedUrl;

  const passos = [
    {
      n: "01",
      icon: FileSpreadsheet,
      t: "Cadastre seus dados",
      d: "Receita, custos, regime, ativos. Importa de Excel ou preenche guiado — em minutos.",
    },
    {
      n: "02",
      icon: Gauge,
      t: "Simule cenários",
      d: "Mexa nas alavancas: preço, custo, capital de giro, dívida. Tudo recalcula em tempo real.",
    },
    {
      n: "03",
      icon: Brain,
      t: "Receba o diagnóstico",
      d: "A IA explica o que está acontecendo e quais alavancas mexer para melhorar.",
    },
    {
      n: "04",
      icon: Sparkles,
      t: "Decida ou entregue",
      d: "Aja na sua empresa, ou exporte PDF / link público para o seu cliente acompanhar.",
    },
  ];
  return (
    <section id="como-funciona" className="border-b border-border/50 bg-card/30 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <SectionEyebrow>Como funciona</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Dos dados à decisão em <span className="text-primary">quatro passos</span>.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Sem curva complexa de aprendizado. Sem manual de 200 páginas.
          </p>
        </div>

        <div className="relative mt-14">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-[2.75rem] hidden h-px md:block"
            style={{
              background:
                "linear-gradient(90deg, transparent, color-mix(in oklab, var(--primary) 35%, transparent), transparent)",
            }}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {passos.map((p) => (
              <div
                key={p.n}
                className="group relative rounded-2xl border border-border bg-background/60 p-6 transition hover:-translate-y-1 hover:border-primary/40"
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-card text-primary">
                    <p.icon className="h-5 w-5" />
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">
                    Passo {p.n}
                  </div>
                </div>
                <h3 className="mt-5 text-base font-semibold text-foreground">{p.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.d}</p>
              </div>
            ))}
          </div>
        </div>

        {showVideoBtn && (
          <div className="mt-12 flex justify-center">
            <button
              type="button"
              onClick={() => setVideoOpen(true)}
              className="group inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:shadow-primary/40"
            >
              <PlayCircle className="h-5 w-5" />
              Assista ao Vídeo
            </button>
          </div>
        )}

        <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-border/60">
            <DialogHeader className="sr-only">
              <DialogTitle>Como funciona</DialogTitle>
              <DialogDescription>Vídeo demonstrativo</DialogDescription>
            </DialogHeader>
            <div className="relative aspect-video w-full">
              {embedUrl && videoOpen && (
                <iframe
                  src={`${embedUrl}?autoplay=1&rel=0`}
                  title="Como funciona"
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
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
    ["Erro de fórmula", "Comum", "Zero — engine atualizada"],
    ["Reforma Tributária CBS/IBS", "Cálculo manual", "Automático"],
    ["Diagnóstico executivo", "Você escreve", "IA gera, você revisa"],
    ["Relatório PDF com sua marca", "Edição manual", "Um clique"],
    ["Compartilhamento", "Anexo por e-mail", "Link público rastreável"],
    ["Atualização tributária", "Você acompanha", "Engine atualiza por você"],
  ];
  return (
    <section className="border-b border-border/50 py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="text-center">
          <SectionEyebrow>Comparativo</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Planilha Excel <span className="text-muted-foreground">vs.</span>{" "}
            <span className="text-primary">FinnancePRO</span>.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            A diferença entre montar relatório e tomar decisão.
          </p>
        </div>

        {/* Desktop: tabela tradicional */}
        <div className="relative mt-12 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/5 sm:block">
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 h-full w-1/2"
            style={{
              background:
                "radial-gradient(60% 50% at 70% 50%, color-mix(in oklab, var(--primary) 8%, transparent), transparent)",
            }}
          />
          <div className="grid grid-cols-[1.6fr_1fr_1fr] bg-background/60 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <div className="border-b border-border p-5">Critério</div>
            <div className="border-b border-l border-border p-5 text-center">Planilha</div>
            <div className="border-b border-l border-border bg-primary/10 p-5 text-center text-primary">
              FinnancePRO
            </div>
          </div>
          {linhas.map((l, i) => (
            <div key={i} className="grid grid-cols-[1.6fr_1fr_1fr] text-sm last:border-b-0">
              <div className="border-b border-border p-5 text-foreground/90">{l[0]}</div>
              <div className="flex items-center justify-center border-b border-l border-border p-5 text-center text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-[10px] text-destructive">
                    ✕
                  </span>
                  {l[1]}
                </span>
              </div>
              <div className="flex items-center justify-center border-b border-l border-border bg-primary/5 p-5 text-center font-medium text-primary">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {l[2]}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile: cards empilhados */}
        <div className="mt-12 space-y-4 sm:hidden">
          {linhas.map((l, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border bg-background/60 p-4 text-sm font-semibold text-foreground">
                {l[0]}
              </div>
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-xs text-destructive">
                    ✕
                  </span>
                  <span>{l[1]}</span>
                </div>
                <div className="flex flex-col items-center justify-center gap-2 bg-primary/5 p-4 text-center text-sm font-medium text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>{l[2]}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Seção "Planos" extraída para src/components/landing/PlansSection.tsx.

/* ============================================================
    AUTORIDADE
   ============================================================ */
function AuthorityBlock() {
  const { branding } = useBranding();
  return (
    <section className="border-b border-border/50 bg-card/30 py-24">
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
                <div className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 border-primary/40 bg-background text-2xl font-semibold text-primary">
                  {branding.authorPhotoUrl ? (
                    <img
                      src={branding.authorPhotoUrl}
                      alt="Geovane Zomer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    "GZ"
                  )}
                </div>
                <div className="mt-4 text-sm font-semibold text-foreground">Geovane Zomer</div>
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
                Engenharia financeira — adaptada para a realidade da PME brasileira.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                O FinnancePRO nasceu dentro da{" "}
                <strong className="text-foreground">
                  GZ Consultoria Financeira & Investimentos
                </strong>{" "}
                para resolver o que toda planilha falha: dar a empresários, consultores e BPOs
                Financeiros a mesma profundidade de análise que grandes corporações têm — sem o
                custo de um time de CFO.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-foreground/90">
                {[
                  "Engine financeira versionada e com updates constantes",
                  "Cálculos compatíveis com LC 214/2025 (CBS / IBS)",
                  "IA treinada em finanças empresariais com skills configuradas",
                  "Pensado para quem decide — não só para quem analisa",
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
      q: "Eu sou o dono, não sou financeiro. Pela primeira vez entendi o que cada número significa — e o que mudar.",
      a: "Sócio-fundador — Indústria, PR",
      icon: Building2,
    },
    {
      q: "Reduzi o tempo de fechamento mensal de três dias para uma manhã. O cliente passou a entender o que vê.",
      a: "Consultor Financeiro — SP",
      icon: Briefcase,
    },
    {
      q: "O módulo da Reforma Tributária sozinho já paga o sistema. Cheguei na reunião com cálculo, não com achismo.",
      a: "Contador Sênior — RS",
      icon: Users,
    },
  ];
  return (
    <section className="border-b border-border/50 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <SectionEyebrow>FINNANCEPRO</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Quem usa, <span className="text-primary">não volta</span> para a planilha.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {cases.map((c, i) => (
            <figure
              key={i}
              className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-7 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 transition group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(circle, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
                }}
              />
              <Quote className="h-7 w-7 text-primary/60" />
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground/90">
                "{c.q}"
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-border pt-5">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                  <c.icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{c.a}</span>
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
      q: "Preciso ser da área financeira para usar?",
      a: "Não. O FinnancePRO foi desenhado para traduzir números em decisão — qualquer empresário, consultor ou profissional consegue operar com fluxo guiado e diagnóstico em linguagem clara.",
    },
    {
      q: "Preciso instalar alguma coisa?",
      a: "Não. O FinnancePRO roda 100% no navegador. Login, insere os dados e começa a analisar sozinho ou com ajuda da I.A. literalmente conversando com os dados obtidos.",
    },
    {
      q: "Meus dados ficam seguros?",
      a: "Sim. O Sitema usa IndexeDB, os dados ficam no seu Navegador. Podendo ser, opcionalmente, armazenados na nuvem com backup através de arquivo baixável. Você controla o que sai do seu computador.",
    },
    {
      q: "O sistema está preparado para analisar a Reforma Tributária?",
      a: "Sim. O motor tributário acompanha a LC 214/2025 e as fases de transição CBS/IBS (2026-2033), incluindo Split Payment.",
    },
    {
      q: "Posso usar com vários clientes (ou várias empresas)?",
      a: "Sim. Você cria quantos cenários e empresas quiser, cada um com seu próprio conjunto de dados, relatórios e link de compartilhamento. Basta salvar um arquivo por cliente.",
    },
    {
      q: "Como funcionam as análises I.A. assistida?",
      a: "Traga sua chave da OpenAI ou Claude para gerar um diagnóstico executivo a partir dos números reais da empresa simulada. A I.A. faz as análises, você revisa, ajusta e entrega — com prompt versionado para auditoria.",
    },
    {
      q: "Posso cancelar quando quiser?",
      a: "Sim. Sem fidelidade, sem multa. Você cancela direto da sua conta, quando quiser.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="border-b border-border/50 bg-card/30 py-24">
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
                    className={`text-primary transition-transform ${isOpen ? "rotate-45" : ""}`}
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
function FinalCta({ onRequestTrial }: { onRequestTrial: () => void }) {
  return (
    <section className="relative overflow-hidden py-28">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 50%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklab, var(--primary) 50%, transparent), transparent)",
        }}
      />
      <div className="mx-auto max-w-3xl px-6 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
          <Clock className="h-3.5 w-3.5" />
          15 minutos até sua primeira análise
        </span>
        <h2 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          Pare de analisar planilhas.
          <br />
          <span className="text-primary">Comece a tomar decisões.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
          Em menos de 15 minutos você tem uma análise 360º de uma empresa.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#planos"
            className="group inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition hover:shadow-primary/50"
          >
            Ver Planos
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </a>

          <button
            type="button"
            onClick={onRequestTrial}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-6 py-3.5 text-sm font-medium text-foreground transition hover:bg-card"
          >
            Solicitar teste
          </button>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Engine atualizada periodicamente
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-4 w-4 text-primary" />
            IndexedDB - Dados ficam no seu navegador
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-primary" />
            Análises em tempo real
          </span>
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
        <Link to="/landing" className="flex items-center gap-2 min-h-8">
          <BrandHeader size="sm" />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#recursos" className="transition hover:text-foreground">
            Recursos
          </a>
          <a href="#como-funciona" className="transition hover:text-foreground">
            Como funciona
          </a>
          <a href="#planos" className="transition hover:text-foreground">
            Planos
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
          <a
            href="#planos"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Ver Planos
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
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
          © {new Date().getFullYear()} FinnancePRO · Desenvolvido por{" "}
          <strong className="text-foreground">GZ Consultoria Financeira & Investimentos</strong>
        </span>
        <div className="flex items-center gap-5">
          <Link to="/termos" className="transition hover:text-foreground">
            Termos
          </Link>
          <Link to="/privacidade" className="transition hover:text-foreground">
            Privacidade
          </Link>
          <Link to="/login" className="transition hover:text-foreground">
            Entrar
          </Link>
          <a href="#planos" className="transition hover:text-foreground">
            Ver Planos
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   EXPORT — composição final
   ============================================================ */

export function LandingPage({
  initialPlans,
  plansSource,
}: {
  initialPlans?: RawPlan[] | null;
  plansSource?: "db" | "fallback";
} = {}) {
  const [trialOpen, setTrialOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        <AudienceStrip />
        <ProblemAgitation />

        <FeatureGrid />
        <HowItWorks />
        <ComparisonTable />
        <PlansSection initialPlans={initialPlans ?? null} initialSource={plansSource} />
        <AuthorityBlock />
        <SocialProof />
        <div id="faq">
          <FaqAccordion />
        </div>
        <FinalCta onRequestTrial={() => setTrialOpen(true)} />
      </main>
      <Footer />
      <TrialRequestDialog open={trialOpen} onOpenChange={setTrialOpen} />
    </div>
  );
}
