import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  Crown,
  FileSpreadsheet,
  Gauge,
  Landmark,
  LineChart,
  LogIn,
  Sparkles,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FinnancePRO — CFO Estratégico para PMEs Brasileiras" },
      {
        name: "description",
        content:
          "Diagnóstico financeiro, DRE simulado, WACC, Valuation e Reforma Tributária CBS/IBS. Tudo em uma plataforma. Planos Mensal, Anual e Vitalício.",
      },
      { property: "og:title", content: "FinnancePRO — CFO Estratégico para PMEs" },
      {
        property: "og:description",
        content:
          "A plataforma completa de diagnóstico e simulação financeira para consultores e gestores. Decisões baseadas em dados, não em achismo.",
      },
    ],
  }),
  component: LandingPage,
});

// Planos de assinatura — preços-âncora padrão de mercado.
const PLANS = [
  {
    id: "mensal",
    name: "Mensal",
    tagline: "Para testar o poder da plataforma",
    price: "R$ 197",
    period: "/mês",
    cta: "Assinar Mensal",
    highlight: false,
    perks: [
      "Acesso completo a todos os módulos",
      "Diagnóstico, DRE, Fluxo de Caixa e Valuation",
      "Reforma Tributária CBS/IBS",
      "Suporte por e-mail",
      "Cancelamento a qualquer momento",
    ],
  },
  {
    id: "anual",
    name: "Anual",
    tagline: "O escolhido por 8 em cada 10 consultores",
    price: "R$ 1.497",
    period: "/ano",
    cta: "Assinar Anual",
    highlight: true,
    badge: "Mais Popular · 37% OFF",
    perks: [
      "Tudo do plano Mensal",
      "Economia equivalente a 4 meses grátis",
      "Consultor IA com contexto da sua empresa",
      "Cenários ilimitados e Monte Carlo",
      "Suporte prioritário em até 24h",
    ],
  },
  {
    id: "vitalicio",
    name: "Vitalício",
    tagline: "Pague uma vez. Use para sempre.",
    price: "R$ 4.997",
    period: "pagamento único",
    cta: "Garantir Vitalício",
    highlight: false,
    badge: "Edição Fundadores",
    perks: [
      "Acesso vitalício a todas as atualizações",
      "Sem mensalidades. Sem renovação.",
      "Selo de Membro Fundador",
      "Acesso antecipado a novos módulos",
      "Suporte VIP com Geovane Zomer",
    ],
  },
];

const FEATURES = [
  { icon: Gauge, title: "Diagnóstico em 360°", desc: "Liquidez, endividamento, ciclo financeiro, ROIC, NCG e Payback. Tudo calculado em segundos." },
  { icon: FileSpreadsheet, title: "DRE Inteligente", desc: "Visão mensal, trimestral e anual. Margem bruta, EBITDA, EBIT e líquida ao seu alcance." },
  { icon: Wallet, title: "Fluxo de Caixa Completo", desc: "Operacional, investimento e financiamento. Saiba exatamente onde seu dinheiro entra e sai." },
  { icon: Landmark, title: "Valuation Profissional", desc: "FCD, múltiplos e cenários. Avalie empresas como um banco de investimento." },
  { icon: ShieldCheck, title: "Reforma Tributária CBS/IBS", desc: "Atualizado para a LC 214/2025. Simule o impacto antes que ele chegue até você." },
  { icon: Bot, title: "Consultor IA Embarcado", desc: "Uma IA treinada como CFO sênior, com contexto total da sua operação financeira." },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ===== NAVBAR ===== */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <img src={logoAsset.url} alt="FinnancePRO" className="h-9 w-9 rounded-md object-contain" />
            <span className="text-base font-semibold tracking-tight">
              Finnance<span className="text-primary">PRO</span>
            </span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#funcionalidades" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Funcionalidades</a>
            <a href="#planos" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Planos</a>
            <a href="#faq" className="text-sm text-muted-foreground transition-colors hover:text-foreground">FAQ</a>
          </div>
          <Button asChild size="sm" variant="outline" className="h-9">
            <Link to="/login">
              <LogIn className="mr-2 h-3.5 w-3.5" />
              Entrar
            </Link>
          </Button>
        </nav>
      </header>

      {/* ===== HERO ===== */}
      <section
        className="relative overflow-hidden border-b border-border/40"
        style={{
          background:
            "radial-gradient(130% 90% at 10% 0%, color-mix(in oklab, var(--primary) 22%, transparent) 0%, transparent 55%), radial-gradient(100% 80% at 100% 100%, color-mix(in oklab, var(--primary) 14%, transparent) 0%, transparent 60%), linear-gradient(180deg, var(--background) 0%, color-mix(in oklab, var(--primary) 6%, var(--background)) 100%)",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="outline" className="mb-6 border-primary/40 bg-primary/10 text-primary">
              <Sparkles className="mr-1.5 h-3 w-3" />
              Atualizado para a Reforma Tributária CBS/IBS
            </Badge>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Pare de tomar decisões financeiras{" "}
              <span className="bg-gradient-to-br from-primary to-primary/60 bg-clip-text text-transparent">
                no escuro.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              O <strong className="text-foreground">FinnancePRO</strong> é a plataforma usada por consultores
              CVM e gestores de PMEs para diagnosticar, simular e projetar
              resultados financeiros com a precisão de um CFO de elite — em
              minutos, não meses.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-8 text-sm font-semibold">
                <a href="#planos">
                  Ver Planos e Preços
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-sm">
                <Link to="/login">Já sou cliente</Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              ⚡ Sem cartão para testar · Cancele quando quiser · Atualizações automáticas
            </p>
          </div>

          {/* Métricas de prova social */}
          <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              { v: "+R$ 2,8 Bi", l: "Analisados na plataforma" },
              { v: "37%", l: "Aumento médio em margem" },
              { v: "12 min", l: "Para um diagnóstico completo" },
              { v: "CVM 3354-5", l: "Metodologia certificada" },
            ].map((m) => (
              <div key={m.l} className="text-center">
                <div className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{m.v}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{m.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PAIN ===== */}
      <section className="border-b border-border/40 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">O problema</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Planilhas mentem. Achismo quebra empresas.
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              9 em cada 10 PMEs fecham por falta de gestão financeira estruturada.
              Não é falta de receita — é falta de clareza.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              "Você sabe se sua empresa é realmente lucrativa após impostos?",
              "Consegue projetar o impacto da Reforma Tributária nos seus preços?",
              "Tem um valuation defensável para captar investimento ou vender?",
            ].map((q) => (
              <div key={q} className="rounded-xl border border-border/60 bg-card p-6">
                <p className="text-sm font-medium text-foreground">{q}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Se hesitou, o FinnancePRO foi feito para você.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="funcionalidades" className="border-b border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">A solução</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Tudo que um CFO faz. Sem o salário de um CFO.
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              Cada módulo foi construído com a metodologia de um consultor financeiro CVM
              e a precisão matemática de um analista de Wall Street.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PLANS ===== */}
      <section id="planos" className="border-b border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Planos</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Escolha como quer dominar suas finanças.
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              Três caminhos. O mesmo destino: <strong className="text-foreground">controle absoluto</strong> sobre seu dinheiro.
            </p>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
                  p.highlight
                    ? "border-primary bg-gradient-to-b from-primary/10 to-card shadow-xl shadow-primary/10 lg:scale-105"
                    : "border-border/60 bg-card hover:border-primary/40"
                }`}
              >
                {p.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge
                      className={
                        p.highlight
                          ? "bg-primary text-primary-foreground"
                          : "bg-foreground text-background"
                      }
                    >
                      {p.id === "vitalicio" && <Crown className="mr-1 h-3 w-3" />}
                      {p.id === "anual" && <Zap className="mr-1 h-3 w-3" />}
                      {p.badge}
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold tracking-tight">{p.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                </div>

                <div className="mb-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight">{p.price}</span>
                  <span className="text-sm text-muted-foreground">{p.period}</span>
                </div>

                <ul className="mb-8 flex-1 space-y-3">
                  {p.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-3 text-sm">
                      <Check
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          p.highlight ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      <span className="text-foreground/90">{perk}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="lg"
                  variant={p.highlight ? "default" : "outline"}
                  className="w-full h-11"
                >
                  <Link to="/signup">
                    {p.cta}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-xs text-muted-foreground">
            🔒 Pagamento 100% seguro · 7 dias de garantia incondicional · Nota fiscal automática
          </p>
        </div>
      </section>

      {/* ===== TESTIMONIAL / AUTHORITY ===== */}
      <section className="border-b border-border/40 bg-gradient-to-b from-background to-primary/5 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <LineChart className="mx-auto h-8 w-8 text-primary" />
          <blockquote className="mt-6 text-xl font-medium leading-relaxed tracking-tight text-foreground sm:text-2xl">
            "Não construí o FinnancePRO para vender mais um software.
            Construí para que nenhum empresário precise mais aceitar o
            'achismo' como resposta sobre o futuro do próprio negócio."
          </blockquote>
          <div className="mt-6 text-sm text-muted-foreground">
            <strong className="text-foreground">Geovane Zomer</strong> — Consultor Financeiro CVM 3354-5
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="border-b border-border/40 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Perguntas frequentes
          </h2>
          <div className="mt-12 space-y-4">
            {[
              {
                q: "Preciso ter conhecimento contábil para usar?",
                a: "Não. A plataforma é guiada e os indicadores vêm interpretados. Se você sabe ler um extrato bancário, consegue operar o FinnancePRO.",
              },
              {
                q: "O plano Vitalício é realmente para sempre?",
                a: "Sim. Você paga uma única vez e tem acesso para toda a vida — incluindo todas as atualizações futuras e novos módulos.",
              },
              {
                q: "Posso cancelar quando quiser?",
                a: "Os planos Mensal e Anual podem ser cancelados a qualquer momento. O Vitalício tem 7 dias de garantia incondicional.",
              },
              {
                q: "A plataforma já contempla a Reforma Tributária?",
                a: "Sim. Estamos 100% atualizados com a LC 214/2025 (CBS/IBS) e simulamos os regimes de transição até 2033.",
              },
            ].map((item) => (
              <details
                key={item.q}
                className="group rounded-xl border border-border/60 bg-card p-5 transition-all hover:border-primary/40 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium">
                  {item.q}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <BarChart3 className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            Sua próxima decisão financeira pode mudar tudo.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            Comece agora. Em 12 minutos você terá o primeiro diagnóstico
            completo da sua empresa — com clareza que nenhuma planilha vai te dar.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-8 text-sm font-semibold">
              <a href="#planos">
                Quero começar agora
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-sm">
              <Link to="/login">
                <LogIn className="mr-2 h-4 w-4" />
                Acessar minha conta
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-border/40 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <img src={logoAsset.url} alt="FinnancePRO" className="h-6 w-6 rounded object-contain" />
            <span>© 2026 FinnancePRO · Geovane Zomer — CVM 3354-5</span>
          </div>
          <div className="flex gap-5">
            <Link to="/login" className="hover:text-foreground">Entrar</Link>
            <Link to="/signup" className="hover:text-foreground">Criar conta</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
