// Aba Balanço — Fase 3: RAIO-X PATRIMONIAL READ-ONLY.
//
// Não tem mais inputs. O Balanço é DERIVADO POR CONSTRUÇÃO em:
//
//   model.balancoFechamento = deriveBalancoFechamento(abertura, DRE, DFC, PMR/PMP)
//
// Para editar uma rubrica, o usuário ajusta a CAUSA na aba apropriada:
//   • Caixa, CR, Estoques, Fornecedores, Impostos a pagar → Capital (abertura)
//                                                          + Receitas/Custos
//   • Imobilizado bruto, Capital Social, Reservas        → Capital (detalhes)
//   • Empréstimos                                        → Capital (contratos de dívida)
//   • Resultado do exercício                             → Receitas + Custos (DRE)
//
// Isso garante que Ativo ≡ Passivo + PL SEMPRE — sem ajustes manuais.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFinance, useFinanceReadOnly } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { calcBalancoTotals, snapshotAnterior } from "@/engines/finance/balanco";
import { calcAberturaTotals } from "@/components/sim/capital/AberturaCard";
import { fmtBRL } from "@/engines/finance/format";
import type { BalancoDetalhado } from "@/engines/finance/types";
import {
  GitCompare,
  CheckCircle2,
  AlertTriangle,
  Camera,
  ArrowRight,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/sim/shared/primitives";
import { AuditoriaPanel } from "./AuditoriaPanel";

type Modo = "padrao" | "completo";
const MODO_KEY = "finnance:balanco:modo";
const COMP_KEY = "finnance:balanco:comparativo";

type Path = string;

interface Rubrica {
  path: Path;
  label: string;
  modo: Modo;
  redutora?: boolean;
}

interface Grupo {
  titulo: string;
  rubricas: Rubrica[];
  subgrupos?: { titulo: string; rubricas: Rubrica[] }[];
}

// ─────────────────────────────── Schema ───────────────────────────────
const ATIVO: Grupo[] = [
  {
    titulo: "Ativo Circulante",
    rubricas: [
      { path: "ativoCirculante.caixaEquivalentes", label: "Caixa e equivalentes", modo: "padrao" },
      { path: "ativoCirculante.aplicacoesFinanceirasCP", label: "Aplicações financeiras CP", modo: "completo" },
      { path: "ativoCirculante.contasReceberClientes", label: "Contas a receber de clientes", modo: "padrao" },
      { path: "ativoCirculante.pdd", label: "(−) PDD", modo: "completo", redutora: true },
      { path: "ativoCirculante.estoques", label: "Estoques", modo: "padrao" },
      { path: "ativoCirculante.impostosRecuperar", label: "Impostos a recuperar", modo: "padrao" },
      { path: "ativoCirculante.adiantamentos", label: "Adiantamentos a fornecedores", modo: "completo" },
      { path: "ativoCirculante.outrosAtivosCirculantes", label: "Outros ativos circulantes", modo: "completo" },
    ],
  },
  {
    titulo: "Ativo Não Circulante",
    rubricas: [
      { path: "ativoNaoCirculante.investimentos", label: "Investimentos", modo: "completo" },
    ],
    subgrupos: [
      {
        titulo: "Imobilizado",
        rubricas: [
          { path: "ativoNaoCirculante.imobilizado.terrenos", label: "Terrenos", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.edificacoes", label: "Edificações", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.maquinasEquipamentos", label: "Máquinas e equipamentos", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.veiculos", label: "Veículos", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.moveisUtensilios", label: "Móveis e utensílios", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.outrosImobilizados", label: "Outros (inclui CAPEX do período)", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.depreciacaoAcumulada", label: "(−) Depreciação acumulada", modo: "padrao", redutora: true },
        ],
      },
      {
        titulo: "Intangível",
        rubricas: [
          { path: "ativoNaoCirculante.intangivel.marcasPatentes", label: "Marcas e patentes", modo: "padrao" },
          { path: "ativoNaoCirculante.intangivel.goodwill", label: "Goodwill", modo: "completo" },
          { path: "ativoNaoCirculante.intangivel.outrosIntangiveis", label: "Outros intangíveis", modo: "completo" },
          { path: "ativoNaoCirculante.intangivel.amortizacaoAcumulada", label: "(−) Amortização acumulada", modo: "padrao", redutora: true },
        ],
      },
    ],
  },
];

const PASSIVO_PL: Grupo[] = [
  {
    titulo: "Passivo Circulante",
    rubricas: [
      { path: "passivoCirculante.fornecedores", label: "Fornecedores", modo: "padrao" },
      { path: "passivoCirculante.emprestimosFinanciamentosCP", label: "Empréstimos e financiamentos CP", modo: "padrao" },
      { path: "passivoCirculante.impostosPagar", label: "Impostos a pagar", modo: "padrao" },
      { path: "passivoCirculante.salariosEncargos", label: "Salários e encargos", modo: "padrao" },
      { path: "passivoCirculante.outrosPassivosCirculantes", label: "Outros passivos circulantes", modo: "completo" },
    ],
  },
  {
    titulo: "Passivo Não Circulante",
    rubricas: [
      { path: "passivoNaoCirculante.emprestimosFinanciamentosLP", label: "Empréstimos e financiamentos LP", modo: "padrao" },
      { path: "passivoNaoCirculante.debentures", label: "Debêntures", modo: "completo" },
      { path: "passivoNaoCirculante.provisoesLP", label: "Provisões LP", modo: "completo" },
    ],
  },
  {
    titulo: "Patrimônio Líquido",
    rubricas: [
      { path: "patrimonioLiquido.capitalSocial", label: "Capital social", modo: "padrao" },
      { path: "patrimonioLiquido.reservasCapital", label: "Reservas de capital", modo: "padrao" },
      { path: "patrimonioLiquido.reservasLucros", label: "Reservas de lucros", modo: "completo" },
      { path: "patrimonioLiquido.lucrosPrejuizosAcumulados", label: "Lucros/prejuízos acumulados (abertura)", modo: "padrao" },
      { path: "patrimonioLiquido.resultadoExercicio", label: "Resultado do exercício (DRE)", modo: "padrao" },
    ],
  },
];

// ─────────────────────────────── Utils ───────────────────────────────
function getAt(obj: unknown, path: Path): number {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else return 0;
  }
  return typeof cur === "number" && isFinite(cur) ? cur : 0;
}

const modoRank: Record<Modo, number> = { padrao: 0, completo: 1 };
const isVisible = (rc: Modo, ma: Modo) => modoRank[rc] <= modoRank[ma];
const visibleRubricas = (rs: Rubrica[], m: Modo) =>
  rs.filter((r) => isVisible(r.modo, m));

// ─────────────────────────── Componente ───────────────────────────
export function BalancoTab() {
  const { state, update } = useFinance();
  const readOnly = useFinanceReadOnly();
  const model = useFinanceModel(state);

  const [modo, setModo] = useState<Modo>(() => {
    if (typeof window === "undefined") return "padrao";
    return localStorage.getItem(MODO_KEY) === "completo" ? "completo" : "padrao";
  });
  const [showAnterior, setShowAnterior] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COMP_KEY) === "1";
  });
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    localStorage.setItem(MODO_KEY, modo);
  }, [modo]);
  useEffect(() => {
    localStorage.setItem(COMP_KEY, showAnterior ? "1" : "0");
  }, [showAnterior]);

  // Balanço de fechamento DERIVADO (read-only).
  const fechamento = model.model.balancoFechamento;
  const balanco: BalancoDetalhado = fechamento.balanco;
  const anterior: BalancoDetalhado = state.capital.balanco?.anterior ?? {};

  const totalsAtual = useMemo(() => calcBalancoTotals(balanco), [balanco]);
  const totalsAnterior = useMemo(() => calcBalancoTotals(anterior), [anterior]);
  const totalsAbertura = useMemo(
    () => calcAberturaTotals(state, model.model.dre.impostosTotal),
    [state, model.model.dre.impostosTotal],
  );

  // Snapshot N-1: congela o fechamento atual em capital.balanco.anterior.
  const salvarComoNm1 = () => {
    const base = state.capital.balanco ?? {};
    const next = snapshotAnterior({ ...base, ...balanco });
    update((s) => ({ ...s, capital: { ...s.capital, balanco: next } }));
    setShowAnterior(true);
    toast.success("Snapshot N-1 salvo", {
      description: "Fechamento atual congelado como ano-base para análise horizontal.",
    });
  };

  const fechado = fechamento.totals.fechado;

  return (
    <div className="space-y-4">
      {/* KPIs derivados do balanço — no topo da página (padrão visual da aba Indicadores) */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Capital de Giro (CG)"
          value={fmtBRL(totalsAtual.ativoCirculante - totalsAtual.passivoCirculante)}
          tone={totalsAtual.ativoCirculante - totalsAtual.passivoCirculante >= 0 ? "pos" : "neg"}
          hint={{
            description:
              "Folga financeira de curto prazo: quanto sobra do ativo circulante após quitar todo o passivo circulante.",
            formula: "Ativo Circulante − Passivo Circulante",
            calc: `${fmtBRL(totalsAtual.ativoCirculante)} − ${fmtBRL(totalsAtual.passivoCirculante)}\n= ${fmtBRL(totalsAtual.ativoCirculante - totalsAtual.passivoCirculante)}`,
          }}
        />
        <StatCard
          label="Dívida onerosa"
          value={fmtBRL(totalsAtual.dividaOnerosa)}
          hint={{
            description:
              "Dívidas que geram juros (empréstimos, financiamentos e debêntures de CP + LP). Base do endividamento financeiro.",
            formula: "Empréstimos CP + Empréstimos LP + Debêntures",
            calc: `Total consolidado\n= ${fmtBRL(totalsAtual.dividaOnerosa)}`,
          }}
        />
        <StatCard
          label="Passivos não-onerosos"
          value={fmtBRL(totalsAtual.passivosNaoOnerosos)}
          hint={{
            description:
              "Obrigações operacionais sem juros (fornecedores, impostos, salários). Funcionam como funding gratuito do giro.",
            formula: "Fornecedores + Impostos a pagar + Salários + Outros operacionais",
            calc: `Total consolidado\n= ${fmtBRL(totalsAtual.passivosNaoOnerosos)}`,
          }}
        />
        <StatCard
          label="D/PL"
          value={`${(totalsAtual.patrimonioLiquido > 0 ? totalsAtual.dividaOnerosa / totalsAtual.patrimonioLiquido : 0).toFixed(2)}×`}
          tone={
            totalsAtual.patrimonioLiquido > 0 && totalsAtual.dividaOnerosa / totalsAtual.patrimonioLiquido > 1
              ? "neg"
              : "pos"
          }
          hint={{
            description:
              "Quanto a empresa deve (oneroso) para cada R$ 1 de capital próprio. Acima de 1× sinaliza alavancagem agressiva.",
            formula: "Dívida Onerosa ÷ Patrimônio Líquido",
            calc:
              totalsAtual.patrimonioLiquido > 0
                ? `${fmtBRL(totalsAtual.dividaOnerosa)} ÷ ${fmtBRL(totalsAtual.patrimonioLiquido)}\n= ${(totalsAtual.dividaOnerosa / totalsAtual.patrimonioLiquido).toFixed(2)}×`
                : "Patrimônio Líquido ≤ 0 — cálculo indisponível",
          }}
        />
      </div>


      {/* Header — toolbar apenas (escondida em modo somente leitura) */}
      {!readOnly && (
        <div className="rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ModoSelector modo={modo} onChange={setModo} />
            <Button
              size="sm"
              variant={showAudit ? "default" : "outline"}
              onClick={() => setShowAudit((v) => !v)}
              className="h-8 gap-1.5 text-[11px]"
              title="Mostra inputs e fórmulas de cada rubrica."
            >
              <Search className="h-3.5 w-3.5" />
              Auditoria
            </Button>
            <Button
              size="sm"
              variant={showAnterior ? "default" : "outline"}
              onClick={() => setShowAnterior((v) => !v)}
              className="h-8 gap-1.5 text-[11px]"
            >
              <GitCompare className="h-3.5 w-3.5" />
              N vs N-1
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={salvarComoNm1}
              className="h-8 gap-1.5 text-[11px]"
              title="Congela o fechamento atual como base de comparação (N-1)."
            >
              <Camera className="h-3.5 w-3.5" />
              Salvar como N-1
            </Button>
          </div>
        </div>
      )}

      {showAudit && <AuditoriaPanel onClose={() => setShowAudit(false)} />}


      {/* Validação de fechamento */}
      <div
        className={`rounded-lg border p-3 text-[12px] flex items-center gap-2 ${
          fechado
            ? "border-pos/30 bg-pos/5 text-pos"
            : "border-warning/40 bg-warning/10 text-warning"
        }`}
      >
        {fechado ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            <span>
              <strong>Balanço fechado por construção</strong> — Ativo (
              {fmtBRL(fechamento.totals.ativo)}) = Passivo + PL (
              {fmtBRL(fechamento.totals.passivo + fechamento.totals.pl)}). Diferença:{" "}
              {fmtBRL(fechamento.totals.diferenca)}.
            </span>
          </>
        ) : totalsAbertura.fechado ? (
          <>
            <AlertTriangle className="h-4 w-4" />
            <span>
              Diferença residual de <strong>{fmtBRL(fechamento.totals.diferenca)}</strong> —
              a abertura está equilibrada, o resíduo é técnico (arredondamentos ou
              rubricas de período). Investigue com <strong>Auditoria</strong> acima.
            </span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" />
            <span>
              A diferença origina-se na <strong>ABERTURA</strong> (
              {fmtBRL(totalsAbertura.diferenca)}). Ajuste na aba{" "}
              <button
                type="button"
                className="underline font-semibold hover:text-warning/80"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("gz-set-tab", { detail: "capital" }),
                  )
                }
              >
                Capital
              </button>{" "}
              antes de analisar o fechamento.
            </span>
          </>
        )}
      </div>




      {/* Abertura → Movimento → Fechamento */}
      <div className="grid grid-cols-3 gap-3 text-[11px]">
        <SnapshotCard
          title="Abertura"
          ativo={totalsAbertura.ativoIni}
          passivo={totalsAbertura.passivoIni}
          pl={totalsAbertura.plIni}
        />
        <div className="flex items-center justify-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <SnapshotCard
          title="Fechamento (derivado)"
          ativo={fechamento.totals.ativo}
          passivo={fechamento.totals.passivo}
          pl={fechamento.totals.pl}
          highlight
        />
      </div>

      {/* Duas colunas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Coluna
          titulo="ATIVO"
          accent="var(--success)"
          grupos={ATIVO}
          modo={modo}
          balanco={balanco}
          anterior={anterior}
          showAnterior={showAnterior}
          totalAtual={totalsAtual.ativoTotal}
          totalAnterior={totalsAnterior.ativoTotal}
          subtotais={[
            { label: "Total Ativo Circulante", atual: totalsAtual.ativoCirculante, ant: totalsAnterior.ativoCirculante, grupo: "Ativo Circulante" },
            { label: "Total Ativo Não Circulante", atual: totalsAtual.ativoNaoCirculante, ant: totalsAnterior.ativoNaoCirculante, grupo: "Ativo Não Circulante" },
          ]}
          totalLabel="TOTAL DO ATIVO"
        />
        <Coluna
          titulo="PASSIVO + PATRIMÔNIO LÍQUIDO"
          accent="var(--destructive)"
          grupos={PASSIVO_PL}
          modo={modo}
          balanco={balanco}
          anterior={anterior}
          showAnterior={showAnterior}
          totalAtual={totalsAtual.passivoTotal + totalsAtual.patrimonioLiquido}
          totalAnterior={totalsAnterior.passivoTotal + totalsAnterior.patrimonioLiquido}
          subtotais={[
            { label: "Total Passivo Circulante", atual: totalsAtual.passivoCirculante, ant: totalsAnterior.passivoCirculante, grupo: "Passivo Circulante" },
            { label: "Total Passivo Não Circulante", atual: totalsAtual.passivoNaoCirculante, ant: totalsAnterior.passivoNaoCirculante, grupo: "Passivo Não Circulante" },
            { label: "Total Patrimônio Líquido", atual: totalsAtual.patrimonioLiquido, ant: totalsAnterior.patrimonioLiquido, grupo: "Patrimônio Líquido" },
          ]}
          totalLabel="TOTAL PASSIVO + PL"
        />
      </div>

    </div>
  );
}

// ─────────────────────── Sub-componentes ───────────────────────

function ModoSelector({ modo, onChange }: { modo: Modo; onChange: (m: Modo) => void }) {
  const opts: { v: Modo; label: string; hint: string }[] = [
    { v: "padrao", label: "Padrão", hint: "Rubricas essenciais" },
    { v: "completo", label: "Completo", hint: "Todas as rubricas CPC/BR" },
  ];
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5 text-[11px]">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.v)}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${
            modo === o.v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SnapshotCard({
  title,
  ativo,
  passivo,
  pl,
  highlight,
}: {
  title: string;
  ativo: number;
  passivo: number;
  pl: number;
  highlight?: boolean;
}) {
  const diff = ativo - (passivo + pl);
  // Tolerância proporcional ao maior lado da equação (evita valor negativo
  // quando `ativo` é negativo — caso degenerado — mantendo o piso de R$ 100).
  const escala = Math.max(Math.abs(ativo), Math.abs(passivo + pl));
  const ok = Math.abs(diff) < Math.max(100, escala * 0.005);
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/30"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="mt-1.5 space-y-0.5 tabular-nums">
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Ativo</span>
          <span className="font-semibold">{fmtBRL(ativo)}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Passivo</span>
          <span>{fmtBRL(passivo)}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">PL</span>
          <span>{fmtBRL(pl)}</span>
        </div>
        <div
          className={`mt-1 flex justify-between border-t border-border/30 pt-1 text-[10px] ${
            ok ? "text-pos" : "text-warning"
          }`}
        >
          <span>Diferença</span>
          <span>{fmtBRL(diff)}</span>
        </div>
      </div>
    </div>
  );
}

interface ColunaProps {
  titulo: string;
  accent: string;
  grupos: Grupo[];
  modo: Modo;
  balanco: BalancoDetalhado;
  anterior: BalancoDetalhado;
  showAnterior: boolean;
  totalAtual: number;
  totalAnterior: number;
  subtotais: { label: string; atual: number; ant: number; grupo: string }[];
  totalLabel: string;
}

function Coluna({
  titulo,
  accent,
  grupos,
  modo,
  balanco,
  anterior,
  showAnterior,
  totalAtual,
  totalAnterior,
  subtotais,
  totalLabel,
}: ColunaProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div
        className="mb-3 border-b border-border/40 pb-2 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {titulo}
      </div>

      <div className="space-y-4">
        {grupos.map((g) => {
          const rubricasGrupo = visibleRubricas(g.rubricas, modo);
          const subgruposVis =
            g.subgrupos
              ?.map((sg) => ({ ...sg, rubricas: visibleRubricas(sg.rubricas, modo) }))
              .filter((sg) => sg.rubricas.length > 0) ?? [];
          if (rubricasGrupo.length === 0 && subgruposVis.length === 0) return null;
          const sub = subtotais.find((s) => s.grupo === g.titulo);

          return (
            <div key={g.titulo}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.titulo}
              </div>

              {rubricasGrupo.map((r) => (
                <RubricaRow
                  key={r.path}
                  r={r}
                  atual={getAt(balanco, r.path)}
                  anterior={getAt(anterior, r.path)}
                  showAnterior={showAnterior}
                />
              ))}

              {subgruposVis.map((sg) => (
                <div key={sg.titulo} className="mt-2 ml-2 border-l border-border/30 pl-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                    {sg.titulo}
                  </div>
                  {sg.rubricas.map((r) => (
                    <RubricaRow
                      key={r.path}
                      r={r}
                      atual={getAt(balanco, r.path)}
                      anterior={getAt(anterior, r.path)}
                      showAnterior={showAnterior}
                    />
                  ))}
                </div>
              ))}

              {sub && (
                <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-border/40 pt-1 text-[12px] font-semibold">
                  <span>{sub.label}</span>
                  <SubtotalCells atual={sub.atual} anterior={sub.ant} showAnterior={showAnterior} total={totalAtual} totalAnt={totalAnterior} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="mt-4 flex items-baseline justify-between border-t-2 pt-2 text-[13px] font-bold"
        style={{ borderColor: accent, color: accent }}
      >
        <span>{totalLabel}</span>
        <SubtotalCells
          atual={totalAtual}
          anterior={totalAnterior}
          showAnterior={showAnterior}
          total={totalAtual}
          totalAnt={totalAnterior}
        />
      </div>
    </div>
  );
}

function RubricaRow({
  r,
  atual,
  anterior,
  showAnterior,
}: {
  r: Rubrica;
  atual: number;
  anterior: number;
  showAnterior: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 py-1 text-[12px]">
      <span className="text-foreground/90">{r.label}</span>
      <div className="flex items-center gap-3 tabular-nums">
        {showAnterior && (
          <span className="w-24 text-right text-[11px] text-muted-foreground">
            {fmtBRL(anterior)}
          </span>
        )}
        <span className="w-28 text-right">{fmtBRL(atual)}</span>
      </div>
    </div>
  );
}

function SubtotalCells({
  atual,
  anterior,
  showAnterior,
  total,
  totalAnt,
}: {
  atual: number;
  anterior: number;
  showAnterior: boolean;
  total: number;
  totalAnt: number;
}) {
  const av = total > 0 ? (atual / total) * 100 : 0;
  const ah = anterior !== 0 ? ((atual - anterior) / Math.abs(anterior)) * 100 : 0;
  const avAnt = totalAnt > 0 ? (anterior / totalAnt) * 100 : 0;
  return (
    <div className="flex items-baseline gap-3 tabular-nums">
      {showAnterior && (
        <>
          <span className="w-24 text-right text-muted-foreground">{fmtBRL(anterior)}</span>
          <span className="w-10 text-right text-[10px] text-muted-foreground">
            {avAnt.toFixed(0)}%
          </span>
        </>
      )}
      <span className="w-28 text-right">{fmtBRL(atual)}</span>
      <span className="w-10 text-right text-[10px] text-muted-foreground">
        {av.toFixed(0)}%
      </span>
      {showAnterior && (
        <span
          className={`w-14 text-right text-[10px] font-medium ${
            ah > 0 ? "text-pos" : ah < 0 ? "text-neg" : "text-muted-foreground"
          }`}
        >
          {anterior !== 0 ? `${ah > 0 ? "+" : ""}${ah.toFixed(0)}%` : "—"}
        </span>
      )}
    </div>
  );
}
