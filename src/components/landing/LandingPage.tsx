// Landing page institucional do FinnancePRO — v4 (final).
// Funde: estratégia de audiência explícita (Empresário / Consultor / BPO)
// + identidade visual própria (paleta "papel/tinta contábil", tipografia
// Fraunces + Inter + IBM Plex Mono, DRE Ticker como elemento de assinatura,
// estrutura em progressão de DRE) + seção de preço (ausente nas v1-v3).
// Isolado em src/components/landing/ — não importa nada do app.
// Ativada via VITE_LANDING_PAGE no .env.
//
// Fontes novas (Google Fonts): Fraunces (display) + IBM Plex Mono (dados).
// Inter já está no projeto — mantido para corpo de texto.

import { Link } from "@tanstack/react-router";
import { ArrowRight, Briefcase, Building2, CheckCircle2, Quote, ShieldCheck, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* ============================================================
   TOKENS — paleta "papel / tinta contábil", escopados ao wrapper
   da landing para não colidir com o tema shadcn do app principal.
   ============================================================ */
const LANDING_VARS = `
  --lp-bg: #0F1611;
  --lp-bg-raised: #161F19;
  --lp-paper: #F2F0E8;
  --lp-paper-dim: #C8C6BC;
  --lp-green: #2F9D63;
  --lp-green-dim: #1F6B45;
  --lp-red: #C75450;
  --lp-amber: #C99A4A;
  --lp-graphite: #9C9D95;
  --lp-line: rgba(242, 240, 232, 0.10);
  --lp-line-strong: rgba(242, 240, 232, 0.18);
  --font-display: "Fraunces", ui-serif, Georgia, serif;
  --font-body: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
`;

/* ============================================================
   DRE TICKER — elemento de assinatura. Anima uma vez ao entrar
   na viewport: 13 linhas reais de DRE colapsam em 3 resultados.
   ============================================================ */
const DRE_LINES = [
  { label: "Receita Operacional Bruta", value: "907.000", sign: "+" },
  { label: "Deduções e Tributos s/ Receita", value: "82.976", sign: "−" },
  { label: "Custo do Serviço Prestado", value: "174.000", sign: "−" },
  { label: "Despesas Comerciais", value: "73.800", sign: "−" },
  { label: "Despesas Administrativas", value: "388.200", sign: "−" },
  { label: "Resultado Financeiro", value: "5.292", sign: "+" },
  { label: "IR / CSLL (Presumido)", value: "97.448", sign: "−" },
] as const;

const DRE_RESULT = [
  { label: "Margem Bruta", value: "78,4%" },
  { label: "Lucro Líquido", value: "97.323" },
  { label: "Caixa Projetado", value: "108.216" },
] as const;

function DreTicker() {
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<"idle" | "lines" | "collapsed">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && stage === "idle") {
          setStage("lines");
          window.setTimeout(() => setStage("collapsed"), DRE_LINES.length * 220 + 500);
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-md border"
      style={{ borderColor: "var(--lp-line-strong)", background: "var(--lp-bg-raised)" }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--lp-line)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--lp-green)" }} />
        <span
          className="text-[11px] uppercase tracking-[0.14em]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--lp-graphite)" }}
        >
          D.R.E. — Minha Empresa LTDA · Regime Presumido
        </span>
      </div>

      <div className="min-h-[260px] p-4">
        {stage !== "collapsed" ? (
          <div className="space-y-1.5">
            {DRE_LINES.map((l, i) => (
              <div
                key={l.label}
                className="flex items-center justify-between rounded-sm px-2 py-1.5 transition-all duration-300"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12.5px",
                  opacity: stage === "lines" ? 1 : 0,
                  transform: stage === "lines" ? "translateY(0)" : "translateY(4px)",
                  transitionDelay: `${i * 220}ms`,
                  borderBottom: "1px solid var(--lp-line)",
                }}
              >
                <span style={{ color: "var(--lp-paper-dim)" }}>
                  ({l.sign}) {l.label}
                </span>
                <span style={{ color: l.sign === "−" ? "var(--lp-red)" : "var(--lp-green)" }}>R$ {l.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid animate-in fade-in grid-cols-3 gap-3 duration-500">
            {DRE_RESULT.map((r) => (
              <div
                key={r.label}
                className="rounded-md border p-3.5"
                style={{ borderColor: "var(--lp-green-dim)", background: "rgba(47,157,99,0.08)" }}
              >
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--lp-graphite)" }}>
                  {r.label}
                </div>
                <div className="mt-1.5 text-lg" style={{ fontFamily: "var(--font-mono)", color: "var(--lp-green)" }}>
                  {r.label === "Margem Bruta" ? r.value : `R$ ${r.value}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="border-t px-4 py-2.5 text-[11px]"
        style={{ borderColor: "var(--lp-line)", color: "var(--lp-graphite)", fontFamily: "var(--font-mono)" }}
      >
        13 linhas de demonstração → 3 números que importam. Em tempo real.
      </div>
    </div>
  );
}

/* ============================================================
   PRIMITIVOS
   ============================================================ */
function Eyebrow({ sign, children }: { sign: "+" | "−" | "="; children: React.ReactNode }) {
  const color = sign === "−" ? "var(--lp-red)" : sign === "+" ? "var(--lp-green)" : "var(--lp-amber)";
  return (
    <span
      className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em]"
      style={{ fontFamily: "var(--font-mono)", color }}
    >
      <span className="text-sm">({sign})</span>
      {children}
    </span>
  );
}

function Display({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      className={`tracking-tight ${className}`}
      style={{ fontFamily: "var(--font-display)", color: "var(--lp-paper)", fontWeight: 480 }}
    >
      {children}
    </h2>
  );
}

/* ============================================================
   HERO — (+) primeira linha
   ============================================================ */
function Hero() {
  return (
    <section className="relative border-b px-6 pb-20 pt-20 lg:pb-28 lg:pt-28" style={{ borderColor: "var(--lp-line)" }}>
      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Eyebrow sign="+">Receita bruta da sua operação financeira</Eyebrow>

          <Display className="mt-6 text-4xl leading-[1.08] sm:text-5xl lg:text-[3.4rem]">
            Toda empresa tem uma história nos números.
            <br />
            <span style={{ color: "var(--lp-green)" }}>A maioria nunca chega a ler.</span>
          </Display>

          <p
            className="mt-6 max-w-xl text-base leading-relaxed sm:text-lg"
            style={{ color: "var(--lp-paper-dim)", fontFamily: "var(--font-body)" }}
          >
            DRE, Balanço, Fluxo de Caixa e o impacto real da Reforma Tributária — processados em um motor auditado, não
            estimados em uma planilha que quebra a cada alteração.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-medium transition"
              style={{ background: "var(--lp-green)", color: "#0F1611", borderRadius: "6px" }}
            >
              Começar gratuitamente
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#prova"
              className="inline-flex items-center gap-2 border px-5 py-3 text-sm"
              style={{ borderColor: "var(--lp-line-strong)", color: "var(--lp-paper)", borderRadius: "6px" }}
            >
              Ver um relatório real
            </a>
          </div>

          <div
            className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs"
            style={{ color: "var(--lp-graphite)", fontFamily: "var(--font-mono)" }}
          >
            <span>Engine auditada</span>
            <span>·</span>
            <span>Dados criptografados</span>
            <span>·</span>
            <span>Sem cartão de crédito</span>
          </div>
        </div>

        <DreTicker />
      </div>
    </section>
  );
}

/* ============================================================
   AUDIÊNCIA — (=) para quem é, nomeado explicitamente (herdado
   e mantido da versão anterior — acerto estratégico real)
   ============================================================ */
function AudienceStrip() {
  const personas = [
    {
      icon: Building2,
      title: "Empresário & Sócio",
      desc: "Entenda seu negócio sem depender de jargão. Saiba se está ganhando, perdendo e por quê — em linguagem clara.",
    },
    {
      icon: Briefcase,
      title: "Consultor",
      desc: "Entregue análise de alto valor ao seu cliente em horas, não dias. Reforma Tributária com Split Payment já embutida.",
    },
    {
      icon: Target,
      title: "BPO Financeiro",
      desc: "Centralize indicadores, projete cenários e leve aos seus clientes dados financeiros com lastro estatístico.",
    },
  ];
  return (
    <section className="border-b px-6 py-20" style={{ borderColor: "var(--lp-line)" }}>
      <div className="mx-auto max-w-6xl">
        <Eyebrow sign="=">Para quem é</Eyebrow>
        <Display className="mt-4 max-w-2xl text-3xl sm:text-4xl">
          Feito para quem decide, e para quem ajuda a decidir.
        </Display>

        <div className="mt-12 grid gap-0 border md:grid-cols-3" style={{ borderColor: "var(--lp-line)" }}>
          {personas.map((p, i) => (
            <div key={p.title} className="p-7" style={{ borderLeft: i > 0 ? "1px solid var(--lp-line)" : undefined }}>
              <div
                className="inline-flex h-10 w-10 items-center justify-center border"
                style={{ borderColor: "var(--lp-green-dim)", color: "var(--lp-green)" }}
              >
                <p.icon className="h-4.5 w-4.5" />
              </div>
              <h3 className="mt-5 text-base font-medium" style={{ color: "var(--lp-paper)" }}>
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--lp-paper-dim)" }}>
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
   DEDUÇÕES — (−) o que está custando caro hoje
   ============================================================ */
function Deductions() {
  const itens = [
    { t: "Horas em planilha", d: "8 a 20 horas para montar uma análise que deveria levar minutos." },
    { t: "Fórmula que quebra", d: "Uma célula errada e a margem que você apresentou ontem já não existe mais." },
    { t: "Reforma Tributária às escuras", d: "CBS, IBS, transição até 2033 — calculado manualmente, sem certeza." },
    { t: "Número sem tradução", d: "Indicador isolado não diz se a empresa está bem. Só o contexto diz." },
  ];
  return (
    <section
      className="border-b px-6 py-24"
      style={{ borderColor: "var(--lp-line)", background: "var(--lp-bg-raised)" }}
    >
      <div className="mx-auto max-w-5xl">
        <Eyebrow sign="−">O que está saindo do seu resultado hoje</Eyebrow>
        <Display className="mt-4 max-w-2xl text-3xl sm:text-4xl">
          Não é falta de esforço. É a ferramenta errada.
        </Display>

        <div className="mt-12 grid gap-px overflow-hidden border" style={{ borderColor: "var(--lp-line)" }}>
          {itens.map((it, i) => (
            <div
              key={it.t}
              className="grid grid-cols-[auto_1fr] gap-4 p-6 sm:grid-cols-[140px_1fr]"
              style={{ background: "var(--lp-bg)", borderTop: i > 0 ? "1px solid var(--lp-line)" : undefined }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--lp-red)", fontSize: "13px" }}>
                −R$ {(i + 1) * 1250}/mês¹
              </span>
              <div>
                <h3 className="text-sm font-medium" style={{ color: "var(--lp-paper)" }}>
                  {it.t}
                </h3>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--lp-paper-dim)" }}>
                  {it.d}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px]" style={{ color: "var(--lp-graphite)", fontFamily: "var(--font-mono)" }}>
          ¹ Estimativa de custo de oportunidade com base em hora técnica média de mercado — varia por operação.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   PILARES — (=) resultado parcial
   ============================================================ */
function Pillars() {
  const pilares = [
    {
      n: "01",
      t: "Raio-X Financeiro",
      d: "DRE, Balanço, DFC e +40 indicadores conectados — uma única fonte de verdade, recalculada a cada alteração.",
    },
    {
      n: "02",
      t: "Reforma CBS / IBS",
      d: "Cronograma completo da LC 214/2025 simulado fase a fase, do regime atual ao pleno em 2033, com Split Payment.",
    },
    {
      n: "03",
      t: "Diagnóstico por IA",
      d: "A IA lê os números já calculados pelo motor e devolve a leitura executiva — nunca inventa, nunca recalcula.",
    },
  ];
  return (
    <section className="border-b px-6 py-24" style={{ borderColor: "var(--lp-line)" }}>
      <div className="mx-auto max-w-6xl">
        <Eyebrow sign="=">O que sobra depois de cortar o retrabalho</Eyebrow>
        <Display className="mt-4 max-w-3xl text-3xl sm:text-4xl">Três frentes. Um motor só.</Display>

        <div className="mt-12 grid gap-0 border md:grid-cols-3" style={{ borderColor: "var(--lp-line)" }}>
          {pilares.map((p, i) => (
            <div
              key={p.t}
              className="group relative p-8"
              style={{ borderLeft: i > 0 ? "1px solid var(--lp-line)" : undefined }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--lp-graphite)", fontSize: "12px" }}>
                {p.n}
              </span>
              <h3 className="mt-4 text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--lp-paper)" }}>
                {p.t}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--lp-paper-dim)" }}>
                {p.d}
              </p>
              <span
                className="mt-5 block h-px w-0 transition-all duration-300 group-hover:w-12"
                style={{ background: "var(--lp-green)" }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   MÉTRICAS — faixa de números (herdada, mantida — boa adição)
   ============================================================ */
function MetricsBand() {
  const metrics = [
    { n: "+40", l: "Indicadores", s: "calculados automaticamente" },
    { n: "5 min", l: "Primeira análise", s: "do cadastro ao diagnóstico" },
    { n: "100%", l: "Reforma Tributária", s: "CBS/IBS sob LC 214/2025" },
    { n: "0", l: "Erros de fórmula", s: "engine versionada e auditada" },
  ];
  return (
    <section
      className="border-b px-6 py-16"
      style={{ borderColor: "var(--lp-line)", background: "var(--lp-bg-raised)" }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.l}>
              <div style={{ fontFamily: "var(--font-mono)", color: "var(--lp-green)" }} className="text-4xl">
                {m.n}
              </div>
              <div className="mt-2 text-sm font-medium" style={{ color: "var(--lp-paper)" }}>
                {m.l}
              </div>
              <div className="text-xs" style={{ color: "var(--lp-graphite)" }}>
                {m.s}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   COMO FUNCIONA — 4 passos (herdado da v3, mantido)
   ============================================================ */
function HowItWorks() {
  const passos = [
    {
      n: "01",
      t: "Cadastre seus dados",
      d: "Receita, custos, regime, ativos. Importa de Excel ou preenche guiado — em minutos.",
    },
    {
      n: "02",
      t: "Simule cenários",
      d: "Mexa nas alavancas: preço, custo, capital de giro, dívida. Tudo recalcula em tempo real.",
    },
    {
      n: "03",
      t: "Receba o diagnóstico",
      d: "A IA explica o que está acontecendo, o porquê e quais alavancas mexer para melhorar.",
    },
    {
      n: "04",
      t: "Decida ou entregue",
      d: "Aja na sua empresa, ou exporte PDF / link público para acompanhamento — somente leitura.",
    },
  ];
  return (
    <section className="border-b px-6 py-24" style={{ borderColor: "var(--lp-line)" }}>
      <div className="mx-auto max-w-6xl">
        <Eyebrow sign="=">Do dado bruto à decisão</Eyebrow>
        <Display className="mt-4 max-w-2xl text-3xl sm:text-4xl">Quatro passos. Sem planilha no meio.</Display>

        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {passos.map((p) => (
            <div key={p.n}>
              <div
                className="flex h-11 w-11 items-center justify-center border text-sm"
                style={{ borderColor: "var(--lp-green-dim)", color: "var(--lp-green)", fontFamily: "var(--font-mono)" }}
              >
                {p.n}
              </div>
              <h3 className="mt-4 text-base font-medium" style={{ color: "var(--lp-paper)" }}>
                {p.t}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--lp-paper-dim)" }}>
                {p.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PROVA — (+) readição de confiança, 3 personas (herdado da v3)
   ============================================================ */
function Proof() {
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
      icon: Target,
    },
  ];
  return (
    <section
      id="prova"
      className="border-b px-6 py-24"
      style={{ borderColor: "var(--lp-line)", background: "var(--lp-bg-raised)" }}
    >
      <div className="mx-auto max-w-6xl">
        <Eyebrow sign="+">Quem já fechou as contas com isso</Eyebrow>
        <Display className="mt-4 max-w-2xl text-3xl sm:text-4xl">Não é teoria. É reconciliação real.</Display>

        <div className="mt-12 grid gap-px border md:grid-cols-3" style={{ borderColor: "var(--lp-line)" }}>
          {cases.map((c, i) => (
            <figure
              key={i}
              className="flex flex-col p-7"
              style={{ background: "var(--lp-bg)", borderLeft: i > 0 ? "1px solid var(--lp-line)" : undefined }}
            >
              <Quote className="h-5 w-5" style={{ color: "var(--lp-green-dim)" }} />
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed" style={{ color: "var(--lp-paper)" }}>
                "{c.q}"
              </blockquote>
              <figcaption
                className="mt-5 flex items-center gap-2.5 border-t pt-4 text-xs"
                style={{ borderColor: "var(--lp-line)", color: "var(--lp-graphite)" }}
              >
                <c.icon className="h-3.5 w-3.5" style={{ color: "var(--lp-green)" }} />
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
   PREÇO — (=) resultado final antes da decisão (ausente nas
   versões anteriores — adição que fecha a lacuna de conversão)
   ============================================================ */
function Pricing() {
  const planos = [
    {
      nome: "Essencial",
      preco: "97",
      desc: "Para quem analisa a própria operação.",
      itens: ["1 empresa ativa", "DRE, Balanço e Fluxo de Caixa", "Relatório PDF com sua marca", "Suporte por e-mail"],
    },
    {
      nome: "Profissional",
      preco: "247",
      desc: "Para quem analisa para terceiros.",
      destaque: true,
      itens: [
        "Empresas ilimitadas",
        "Reforma Tributária completa (CBS/IBS)",
        "Diagnóstico executivo por IA",
        "Link de compartilhamento somente leitura",
        "Suporte prioritário",
      ],
    },
    {
      nome: "Escritório",
      preco: "597",
      desc: "Para equipes, consultorias e BPOs.",
      itens: [
        "Tudo do Profissional",
        "Múltiplos usuários",
        "Marca própria no relatório e no link",
        "Onboarding assistido",
      ],
    },
  ];
  return (
    <section className="border-b px-6 py-24" style={{ borderColor: "var(--lp-line)" }}>
      <div className="mx-auto max-w-6xl">
        <Eyebrow sign="=">Resultado do exercício</Eyebrow>
        <Display className="mt-4 max-w-2xl text-3xl sm:text-4xl">Um plano para cada estágio da operação.</Display>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {planos.map((p) => (
            <div
              key={p.nome}
              className="flex flex-col border p-7"
              style={{
                borderColor: p.destaque ? "var(--lp-green)" : "var(--lp-line)",
                background: p.destaque ? "rgba(47,157,99,0.06)" : "var(--lp-bg-raised)",
                borderRadius: p.destaque ? "10px" : "6px",
              }}
            >
              {p.destaque && (
                <span
                  className="mb-3 inline-block text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--lp-green)", fontFamily: "var(--font-mono)" }}
                >
                  Mais escolhido
                </span>
              )}
              <h3 className="text-base font-medium" style={{ color: "var(--lp-paper)" }}>
                {p.nome}
              </h3>
              <p className="mt-1 text-xs" style={{ color: "var(--lp-graphite)" }}>
                {p.desc}
              </p>
              <div className="mt-5 flex items-baseline gap-1">
                <span style={{ color: "var(--lp-paper)", fontFamily: "var(--font-mono)" }} className="text-3xl">
                  R$ {p.preco}
                </span>
                <span className="text-xs" style={{ color: "var(--lp-graphite)" }}>
                  /mês
                </span>
              </div>
              <ul className="mt-6 flex-1 space-y-2.5">
                {p.itens.map((it) => (
                  <li key={it} className="flex items-start gap-2 text-sm" style={{ color: "var(--lp-paper-dim)" }}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--lp-green)" }} />
                    {it}
                  </li>
                ))}
              </ul>
              <Link
                to="/signup"
                className="mt-7 inline-flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition"
                style={{
                  background: p.destaque ? "var(--lp-green)" : "transparent",
                  color: p.destaque ? "#0F1611" : "var(--lp-paper)",
                  border: p.destaque ? "none" : "1px solid var(--lp-line-strong)",
                  borderRadius: "6px",
                }}
              >
                Começar
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs" style={{ color: "var(--lp-graphite)" }}>
          7 dias de teste em qualquer plano. Sem multa de cancelamento, sem fidelidade.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   AUTORIDADE
   ============================================================ */
function Authority() {
  return (
    <section
      className="border-b px-6 py-24"
      style={{ borderColor: "var(--lp-line)", background: "var(--lp-bg-raised)" }}
    >
      <div className="mx-auto max-w-5xl border" style={{ borderColor: "var(--lp-line)" }}>
        <div className="grid md:grid-cols-[1fr_1.4fr]">
          <div
            className="flex flex-col items-center justify-center gap-3 p-10 text-center"
            style={{ borderRight: "1px solid var(--lp-line)" }}
          >
            <div
              className="flex h-16 w-16 items-center justify-center border text-lg"
              style={{
                borderColor: "var(--lp-green-dim)",
                color: "var(--lp-green)",
                fontFamily: "var(--font-display)",
              }}
            >
              GZ
            </div>
            <div className="text-sm font-medium" style={{ color: "var(--lp-paper)" }}>
              Geovane Zomer
            </div>
            <div className="text-xs" style={{ color: "var(--lp-graphite)" }}>
              Consultor Financeiro & Investimentos
            </div>
            <div
              className="inline-flex items-center gap-1.5 border px-2.5 py-1 text-[10px] uppercase tracking-wider"
              style={{ borderColor: "var(--lp-amber)", color: "var(--lp-amber)" }}
            >
              <ShieldCheck className="h-3 w-3" />
              CVM 3354-5
            </div>
          </div>
          <div className="p-10">
            <Eyebrow sign="=">Quem construiu</Eyebrow>
            <Display className="mt-3 text-2xl sm:text-3xl">
              Engenharia financeira de banca — para a realidade da PME brasileira.
            </Display>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--lp-paper-dim)" }}>
              O FinnancePRO nasceu dentro de uma operação de consultoria real, para resolver o que toda planilha falha:
              dar a empresários, consultores e BPOs a mesma profundidade de análise que grandes corporações têm — com a
              Reforma Tributária já dentro do motor, não como anexo manual.
            </p>
            <ul className="mt-6 space-y-2 text-sm" style={{ color: "var(--lp-paper)" }}>
              {[
                "Engine financeira auditada de forma independente, linha a linha",
                "Cálculos compatíveis com a LC 214/2025 (CBS / IBS, incluindo Split Payment)",
                "IA com prompt versionado — sem cálculo às escuras",
                "Pensado para quem decide, não só para quem audita",
              ].map((i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--lp-green)" }} />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */
function Faq() {
  const faqs = [
    {
      q: "Preciso ser da área financeira para usar?",
      a: "Não. O fluxo é guiado e o diagnóstico vem em linguagem clara — qualquer empresário, consultor ou gestor consegue operar.",
    },
    {
      q: "Preciso instalar alguma coisa?",
      a: "Não. Roda 100% no navegador — entra, descreve a operação e já vê o resultado.",
    },
    {
      q: "Meus dados ficam seguros?",
      a: "Sim. Dados criptografados, com backup na nuvem. Você decide o que compartilha e com quem.",
    },
    {
      q: "A Reforma Tributária está atualizada?",
      a: "Sim. O motor segue a LC 214/2025 e as fases de transição CBS/IBS (2026–2033), incluindo Split Payment.",
    },
    {
      q: "Funciona pra mais de uma empresa?",
      a: "Sim, nos planos Profissional e Escritório. Cada empresa com seus próprios dados e relatórios.",
    },
    {
      q: "Como funciona a IA?",
      a: "Ela lê os números já calculados pelo motor e devolve a leitura executiva. Nunca recalcula nem inventa valor.",
    },
    { q: "Posso cancelar quando quiser?", a: "Sim, sem multa e sem fidelidade — direto da sua conta." },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="border-b px-6 py-24" style={{ borderColor: "var(--lp-line)" }}>
      <div className="mx-auto max-w-3xl">
        <Eyebrow sign="=">Antes de decidir</Eyebrow>
        <Display className="mt-4 text-3xl sm:text-4xl">Perguntas que sempre aparecem.</Display>

        <div className="mt-10 divide-y border" style={{ borderColor: "var(--lp-line)" }}>
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderColor: "var(--lp-line)" }}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left text-sm font-medium"
                  style={{ color: "var(--lp-paper)" }}
                  aria-expanded={isOpen}
                >
                  <span>{f.q}</span>
                  <span style={{ color: "var(--lp-green)" }}>{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-sm leading-relaxed" style={{ color: "var(--lp-paper-dim)" }}>
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
   CTA FINAL — (=) última linha, o resultado do exercício
   ============================================================ */
function FinalCta() {
  return (
    <section className="px-6 py-28 text-center" style={{ background: "var(--lp-bg-raised)" }}>
      <div className="mx-auto max-w-2xl">
        <Eyebrow sign="=">Resultado do exercício</Eyebrow>
        <Display className="mt-5 text-4xl leading-tight sm:text-5xl">
          O número certo,
          <br />
          <span style={{ color: "var(--lp-green)" }}>na hora certa.</span>
        </Display>
        <p className="mx-auto mt-5 max-w-md text-base" style={{ color: "var(--lp-paper-dim)" }}>
          Em menos de 5 minutos sua primeira análise está pronta — sem cartão, sem planilha, sem retrabalho.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="group inline-flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition"
            style={{ background: "var(--lp-green)", color: "#0F1611", borderRadius: "6px" }}
          >
            Criar minha conta gratuita
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 border px-6 py-3.5 text-sm"
            style={{ borderColor: "var(--lp-line-strong)", color: "var(--lp-paper)", borderRadius: "6px" }}
          >
            Já tenho conta
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   HEADER + FOOTER
   ============================================================ */
function Header() {
  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur-md"
      style={{ borderColor: "var(--lp-line)", background: "rgba(15,22,17,0.85)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link to="/landing" className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center text-xs font-medium"
            style={{ background: "var(--lp-green)", color: "#0F1611", borderRadius: "4px" }}
          >
            F
          </div>
          <span style={{ fontFamily: "var(--font-display)", color: "var(--lp-paper)" }} className="text-sm">
            FinnancePRO
          </span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm md:flex" style={{ color: "var(--lp-paper-dim)" }}>
          <a href="#prova" style={{ opacity: 0.85 }}>
            Prova
          </a>
          <a href="#faq" style={{ opacity: 0.85 }}>
            Perguntas
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden px-3 py-2 text-sm sm:inline-flex"
            style={{ color: "var(--lp-paper-dim)" }}
          >
            Entrar
          </Link>
          <Link
            to="/signup"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium"
            style={{ background: "var(--lp-green)", color: "#0F1611", borderRadius: "6px" }}
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
    <footer className="px-6 py-10">
      <div
        className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs sm:flex-row"
        style={{ color: "var(--lp-graphite)" }}
      >
        <span>© {new Date().getFullYear()} FinnancePRO · GZ Consultoria Financeira & Investimentos</span>
        <div className="flex items-center gap-5">
          <Link to="/login" style={{ color: "var(--lp-paper-dim)" }}>
            Entrar
          </Link>
          <Link to="/signup" style={{ color: "var(--lp-paper-dim)" }}>
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
    <>
      <style>{`.lp-root { ${LANDING_VARS} }`}</style>
      <div className="lp-root min-h-screen" style={{ background: "var(--lp-bg)", fontFamily: "var(--font-body)" }}>
        <Header />
        <main>
          <Hero />
          <AudienceStrip />
          <Deductions />
          <Pillars />
          <MetricsBand />
          <HowItWorks />
          <Proof />
          <Pricing />
          <Authority />
          <div id="faq">
            <Faq />
          </div>
          <FinalCta />
        </main>
        <Footer />
      </div>
    </>
  );
}
