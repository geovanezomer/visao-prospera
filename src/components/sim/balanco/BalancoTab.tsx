// Aba Balanço — Balanço Patrimonial detalhado (Fase 2 completa).
//
// 2 modos de profundidade:
//   - Padrão    → rubricas essenciais (empresário / PME com contador)
//   - Completo  → todas as rubricas CPC/BR (raio-X consultor/CVM)
// + comparativo opcional N vs N-1 (AV% e AH%).
//
// Recursos:
//   - "Pré-preencher do operacional": deriva caixa, CR, estoques, fornecedores,
//     empréstimos CP/LP, imobilizado/depreciação e resultado do exercício a
//     partir de Receitas/Custos/Capital/DRE — SEM sobrescrever campos digitados.
//   - "Salvar como N-1": congela o N atual como ano-base para análise horizontal.
//   - Validação de fechamento (Ativo = Passivo + PL) em tempo real.
//   - Sub-totais e totais SEMPRE derivados (nunca digitados).
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import {
  calcBalancoTotals,
  mergeBalancoPreservandoUsuario,
  snapshotAnterior,
  suggestBalancoFromState,
} from "@/engines/finance/balanco";
import { fmtBRL } from "@/engines/finance/format";
import type { BalancoDetalhado } from "@/engines/finance/types";
import { Scale, Download, GitCompare, CheckCircle2, AlertTriangle, Wand2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Modo = "padrao" | "completo";
const MODO_KEY = "finnance:balanco:modo";
const COMP_KEY = "finnance:balanco:comparativo";

// path: ex. "ativoCirculante.caixaEquivalentes" | "ativoNaoCirculante.imobilizado.terrenos"
type Path = string;

interface Rubrica {
  path: Path;
  label: string;
  modo: Modo; // mostrar a partir deste modo
  hint?: string;
  /** true = valor entra como POSITIVO mas é REDUTOR no sub-total. */
  redutora?: boolean;
}

interface Grupo {
  titulo: string;
  rubricas: Rubrica[];
  /** Sub-grupo aninhado (imobilizado, intangível, realizável LP). */
  subgrupos?: { titulo: string; rubricas: Rubrica[] }[];
}

// -------------------------------------------------------------------- Schema
const ATIVO: Grupo[] = [
  {
    titulo: "Ativo Circulante",
    rubricas: [
      { path: "ativoCirculante.caixaEquivalentes", label: "Caixa e equivalentes", modo: "simples" },
      { path: "ativoCirculante.aplicacoesFinanceirasCP", label: "Aplicações financeiras CP", modo: "padrao" },
      { path: "ativoCirculante.contasReceberClientes", label: "Contas a receber de clientes", modo: "simples" },
      { path: "ativoCirculante.pdd", label: "(−) PDD — Devedores duvidosos", modo: "padrao", redutora: true },
      { path: "ativoCirculante.estoques", label: "Estoques", modo: "simples" },
      { path: "ativoCirculante.impostosRecuperar", label: "Impostos a recuperar", modo: "padrao" },
      { path: "ativoCirculante.adiantamentos", label: "Adiantamentos a fornecedores", modo: "padrao" },
      { path: "ativoCirculante.despesasAntecipadas", label: "Despesas antecipadas", modo: "completo" },
      { path: "ativoCirculante.outrosAtivosCirculantes", label: "Outros ativos circulantes", modo: "completo" },
    ],
  },
  {
    titulo: "Ativo Não Circulante",
    rubricas: [
      { path: "ativoNaoCirculante.investimentos", label: "Investimentos", modo: "padrao" },
    ],
    subgrupos: [
      {
        titulo: "Realizável a Longo Prazo",
        rubricas: [
          { path: "ativoNaoCirculante.realizavelLP.creditosLP", label: "Créditos a LP", modo: "padrao" },
          { path: "ativoNaoCirculante.realizavelLP.depositosJudiciais", label: "Depósitos judiciais", modo: "completo" },
          { path: "ativoNaoCirculante.realizavelLP.impostosDiferidos", label: "Impostos diferidos", modo: "completo" },
          { path: "ativoNaoCirculante.realizavelLP.outros", label: "Outros realizáveis LP", modo: "completo" },
        ],
      },
      {
        titulo: "Imobilizado",
        rubricas: [
          { path: "ativoNaoCirculante.imobilizado.terrenos", label: "Terrenos", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.edificacoes", label: "Edificações e benfeitorias", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.maquinasEquipamentos", label: "Máquinas e equipamentos", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.veiculos", label: "Veículos", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.moveisUtensilios", label: "Móveis e utensílios", modo: "padrao" },
          { path: "ativoNaoCirculante.imobilizado.outrosImobilizados", label: "Outros imobilizados", modo: "simples" },
          { path: "ativoNaoCirculante.imobilizado.depreciacaoAcumulada", label: "(−) Depreciação acumulada", modo: "padrao", redutora: true },
        ],
      },
      {
        titulo: "Intangível",
        rubricas: [
          { path: "ativoNaoCirculante.intangivel.software", label: "Software", modo: "padrao" },
          { path: "ativoNaoCirculante.intangivel.marcasPatentes", label: "Marcas e patentes", modo: "completo" },
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
      { path: "passivoCirculante.fornecedores", label: "Fornecedores", modo: "simples" },
      { path: "passivoCirculante.emprestimosFinanciamentosCP", label: "Empréstimos e financiamentos CP", modo: "simples" },
      { path: "passivoCirculante.impostosPagar", label: "Impostos a pagar", modo: "simples" },
      { path: "passivoCirculante.salariosEncargos", label: "Salários e encargos", modo: "padrao" },
      { path: "passivoCirculante.adiantamentosClientes", label: "Adiantamentos de clientes", modo: "padrao" },
      { path: "passivoCirculante.dividendosPagar", label: "Dividendos a pagar", modo: "completo" },
      { path: "passivoCirculante.provisoesCP", label: "Provisões CP", modo: "completo" },
      { path: "passivoCirculante.outrosPassivosCirculantes", label: "Outros passivos circulantes", modo: "completo" },
    ],
  },
  {
    titulo: "Passivo Não Circulante",
    rubricas: [
      { path: "passivoNaoCirculante.emprestimosFinanciamentosLP", label: "Empréstimos e financiamentos LP", modo: "simples" },
      { path: "passivoNaoCirculante.impostosParcelados", label: "Impostos parcelados", modo: "padrao" },
      { path: "passivoNaoCirculante.debentures", label: "Debêntures", modo: "completo" },
      { path: "passivoNaoCirculante.provisoesLP", label: "Provisões LP", modo: "completo" },
      { path: "passivoNaoCirculante.impostosDiferidos", label: "Impostos diferidos passivos", modo: "completo" },
      { path: "passivoNaoCirculante.outrasObrigacoesLP", label: "Outras obrigações LP", modo: "completo" },
    ],
  },
  {
    titulo: "Patrimônio Líquido",
    rubricas: [
      { path: "patrimonioLiquido.capitalSocial", label: "Capital social", modo: "simples" },
      { path: "patrimonioLiquido.reservasCapital", label: "Reservas de capital", modo: "padrao" },
      { path: "patrimonioLiquido.reservasLucros", label: "Reservas de lucros", modo: "padrao" },
      { path: "patrimonioLiquido.lucrosPrejuizosAcumulados", label: "Lucros/prejuízos acumulados", modo: "padrao" },
      { path: "patrimonioLiquido.resultadoExercicio", label: "Resultado do exercício", modo: "simples", hint: "Use 'Puxar do DRE' para preencher automaticamente." },
      { path: "patrimonioLiquido.ajustesAvaliacaoPatrimonial", label: "Ajustes de avaliação patrimonial", modo: "completo" },
      { path: "patrimonioLiquido.acoesEmTesouraria", label: "(−) Ações em tesouraria", modo: "completo", redutora: true },
    ],
  },
];

// ---------------------------------------------------------------- Utilities
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

function setAt(obj: BalancoDetalhado, path: Path, value: number): BalancoDetalhado {
  const parts = path.split(".");
  const next = JSON.parse(JSON.stringify(obj ?? {})) as Record<string, unknown>;
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return next as BalancoDetalhado;
}

const modoRank: Record<Modo, number> = { simples: 0, padrao: 1, completo: 2 };
const isVisible = (modoCampo: Modo, modoAtivo: Modo) => modoRank[modoCampo] <= modoRank[modoAtivo];

const visibleRubricas = (rs: Rubrica[], modo: Modo) =>
  rs.filter((r) => isVisible(r.modo, modo));

// ============================================================== Componente
export function BalancoTab() {
  const { state, update } = useFinance();
  const { dre } = useFinanceModel(state);

  const [modo, setModo] = useState<Modo>(() => {
    if (typeof window === "undefined") return "simples";
    return (localStorage.getItem(MODO_KEY) as Modo) ?? "simples";
  });
  const [showAnterior, setShowAnterior] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COMP_KEY) === "1";
  });

  useEffect(() => {
    localStorage.setItem(MODO_KEY, modo);
  }, [modo]);
  useEffect(() => {
    localStorage.setItem(COMP_KEY, showAnterior ? "1" : "0");
  }, [showAnterior]);

  const balanco: BalancoDetalhado = state.capital.balanco ?? {};
  const anterior: BalancoDetalhado = balanco.anterior ?? {};

  const totalsAtual = useMemo(() => calcBalancoTotals(balanco), [balanco]);
  const totalsAnterior = useMemo(() => calcBalancoTotals(anterior), [anterior]);

  // Resultado do exercício a partir do DRE (soma 12m).
  const resultadoDRE = useMemo(
    () => (dre.lucroLiquido ?? []).reduce((a: number, b: number) => a + (b || 0), 0),
    [dre],
  );

  const setCampo = (path: Path, value: number) => {
    const next = setAt(balanco, path, value);
    update((s) => ({ ...s, capital: { ...s.capital, balanco: next } }));
  };

  const setCampoAnterior = (path: Path, value: number) => {
    const nextAnt = setAt(anterior, path, value);
    update((s) => ({
      ...s,
      capital: { ...s.capital, balanco: { ...balanco, anterior: nextAnt } },
    }));
  };

  const puxarResultadoDRE = () => setCampo("patrimonioLiquido.resultadoExercicio", resultadoDRE);

  const fechado = Math.abs(totalsAtual.diferenca) < Math.max(100, totalsAtual.ativoTotal * 0.001);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Scale className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Balanço Patrimonial</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Raio-X patrimonial — Ativo · Passivo · PL. Totais derivados, fechamento
                contábil validado em tempo real.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ModoSelector modo={modo} onChange={setModo} />
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
              onClick={puxarResultadoDRE}
              className="h-8 gap-1.5 text-[11px]"
              title="Soma do Lucro Líquido (12m) do DRE atual"
            >
              <Download className="h-3.5 w-3.5" />
              Puxar Resultado do DRE ({fmtBRL(resultadoDRE)})
            </Button>
          </div>
        </div>
      </div>

      {/* Fechamento */}
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
            Balanço fechado — Ativo ({fmtBRL(totalsAtual.ativoTotal)}) = Passivo + PL (
            {fmtBRL(totalsAtual.passivoTotal + totalsAtual.patrimonioLiquido)}).
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" />
            Diferença de <strong>{fmtBRL(totalsAtual.diferenca)}</strong> entre Ativo (
            {fmtBRL(totalsAtual.ativoTotal)}) e Passivo+PL (
            {fmtBRL(totalsAtual.passivoTotal + totalsAtual.patrimonioLiquido)}). Ajuste as
            rubricas ou use "Puxar Resultado do DRE".
          </>
        )}
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
          onChange={setCampo}
          onChangeAnterior={setCampoAnterior}
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
          onChange={setCampo}
          onChangeAnterior={setCampoAnterior}
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

      {/* KPIs derivados */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Capital de Giro (CG)" value={totalsAtual.ativoCirculante - totalsAtual.passivoCirculante} />
        <KPI label="Dívida onerosa" value={totalsAtual.dividaOnerosa} />
        <KPI label="Passivos não-onerosos" value={totalsAtual.passivosNaoOnerosos} />
        <KPI
          label="D/PL"
          value={
            totalsAtual.patrimonioLiquido > 0
              ? totalsAtual.dividaOnerosa / totalsAtual.patrimonioLiquido
              : 0
          }
          format={(v) => `${v.toFixed(2)}×`}
        />
      </div>
    </div>
  );
}

// ====================================================== Sub-componentes

function ModoSelector({ modo, onChange }: { modo: Modo; onChange: (m: Modo) => void }) {
  const opts: { v: Modo; label: string; hint: string }[] = [
    { v: "simples", label: "Simples", hint: "Empresário — rubricas essenciais" },
    { v: "padrao", label: "Padrão", hint: "PME com contador" },
    { v: "completo", label: "Completo", hint: "Raio-X CVM/consultor" },
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

interface ColunaProps {
  titulo: string;
  accent: string;
  grupos: Grupo[];
  modo: Modo;
  balanco: BalancoDetalhado;
  anterior: BalancoDetalhado;
  showAnterior: boolean;
  onChange: (path: Path, v: number) => void;
  onChangeAnterior: (path: Path, v: number) => void;
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
  onChange,
  onChangeAnterior,
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
                  onChange={(v) => onChange(r.path, v)}
                  onChangeAnterior={(v) => onChangeAnterior(r.path, v)}
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
                      onChange={(v) => onChange(r.path, v)}
                      onChangeAnterior={(v) => onChangeAnterior(r.path, v)}
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

      {/* Total geral */}
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
          bold
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
  onChange,
  onChangeAnterior,
}: {
  r: Rubrica;
  atual: number;
  anterior: number;
  showAnterior: boolean;
  onChange: (v: number) => void;
  onChangeAnterior: (v: number) => void;
}) {
  const id = `bal-${r.path}`;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 py-1 text-[12px]">
      <Label htmlFor={id} className="cursor-help text-foreground/90" title={r.hint}>
        {r.label}
      </Label>
      <div className={`flex items-center gap-1 ${showAnterior ? "" : ""}`}>
        {showAnterior && (
          <CurrencyInput
            id={`${id}-ant`}
            value={anterior}
            onChange={onChangeAnterior}
            placeholder="N-1"
            muted
          />
        )}
        <CurrencyInput id={id} value={atual} onChange={onChange} />
      </div>
    </div>
  );
}

function CurrencyInput({
  id,
  value,
  onChange,
  placeholder,
  muted,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  muted?: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      step="any"
      value={value || ""}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      placeholder={placeholder ?? "0"}
      className={`h-7 w-28 text-right text-[12px] tabular-nums ${
        muted ? "border-dashed text-muted-foreground" : ""
      }`}
    />
  );
}

function SubtotalCells({
  atual,
  anterior,
  showAnterior,
  total,
  totalAnt,
  bold,
}: {
  atual: number;
  anterior: number;
  showAnterior: boolean;
  total: number;
  totalAnt: number;
  bold?: boolean;
}) {
  const av = total > 0 ? (atual / total) * 100 : 0;
  const ah = anterior !== 0 ? ((atual - anterior) / Math.abs(anterior)) * 100 : 0;
  const avAnt = totalAnt > 0 ? (anterior / totalAnt) * 100 : 0;
  return (
    <div className={`flex items-baseline gap-3 tabular-nums ${bold ? "" : ""}`}>
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

function KPI({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">
        {format ? format(value) : fmtBRL(value)}
      </div>
    </div>
  );
}
