import { useMemo, useState, Fragment } from "react";
import type { RevenueDeducao } from "@/engines/finance/types";
import { usePeriodLabels } from "@/components/odoo/usePeriodLabels";
import { useOdooCockpitContext } from "@/components/odoo/cockpit";
import { useFinance, useFinanceReadOnly } from "@/engines/finance/AppStateContext";
import { usePeriodView } from "@/hooks/usePeriodView";
import {
  AppState,
  TaxRegime,
  COST_VENDAS_LABEL,
  TAX_ERA_SHORT,
  CostCategory,
} from "@/engines/finance/types";
type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

import { fmtBRL, fmtBRLCompact, fmtPct, sum } from "@/engines/finance/format";
import { buildIndicatorCalcs } from "@/engines/finance/indicatorCalc";
import { monthValues } from "@/engines/finance";
import { splitReceitasFinanceiras } from "@/engines/finance/shared";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HelpTip, SectionTitle, StatCard } from "@/components/sim/shared/primitives";
import { Badge } from "@/components/ui/badge";

import { DREComparison } from "@/components/sim/comparison/ComparisonView";
import { useAnnualSnapshots } from "@/hooks/useAnnualSnapshots";
import { useSelectedSnapshots } from "@/hooks/useSelectedSnapshots";
import { useComparisonMode } from "@/engines/scenarios/comparisonStore";
import { ChevronRight } from "lucide-react";

const CHART_COLORS = [
  "#00E5A0",
  "#5BA8F5",
  "#F5B85B",
  "#C77DFF",
  "#FF6B6B",
  "#7DD3FC",
  "#FACC15",
  "#F472B6",
  "#34D399",
  "#A78BFA",
  "#FB923C",
];

export function DRETab() {
  const MESES = usePeriodLabels();
  const cockpitAtivo = !!useOdooCockpitContext()?.active;
  const { state, update } = useFinance();
  const readOnly = useFinanceReadOnly();
  const [view, setView] = usePeriodView("trimestral");
  const annualSnaps = useAnnualSnapshots(3);
  const compareMode = useComparisonMode();
  const selectedSnaps = useSelectedSnapshots();
  const showCompare =
    (compareMode.active && selectedSnaps.length >= 2) ||
    (view === "anual" && annualSnaps.length >= 2);
  const compareSnaps =
    compareMode.active && selectedSnaps.length >= 2 ? selectedSnaps : annualSnaps;
  const compareTitle =
    compareMode.active && selectedSnaps.length >= 2
      ? `D.R.E. — Comparativo (${selectedSnaps.length} cenários selecionados)`
      : `D.R.E. — Comparativo anual (últimos ${annualSnaps.length - 1} anos + atual)`;

  // Períodos exibidos na tabela conforme o modo de visualização.
  const QUARTERS = cockpitAtivo
    ? [0, 3, 6, 9].map((i) => `${MESES[i]}–${MESES[i + 2]}`)
    : ["1º Tri", "2º Tri", "3º Tri", "4º Tri"];
  const periodLabels = view === "mensal" ? MESES : view === "trimestral" ? QUARTERS : [];
  const showPeriods = view !== "anual";
  // Agrega um vetor mensal (12) conforme o período selecionado.
  const aggregate = (arr: number[]): number[] => {
    if (view === "mensal") return arr;
    if (view === "trimestral")
      return [0, 1, 2, 3].map((q) => arr[q * 3] + arr[q * 3 + 1] + arr[q * 3 + 2]);
    return [];
  };

  // SSOT: useFinanceModel aplica `resolveEffectiveRegime` (Simples pode cair
  // automaticamente para Presumido se exceder o teto). Garante que DRE/ind/cf
  // sejam idênticos aos da aba Indicadores.
  const { regime, dre, ind, cf, cagrReceitas12m, model } = useFinanceModel(state);
  const tax = model.tax;

  const limiar = state.cashflow.limiarAlerta ?? -10000;
  const mesesCriticosIdx = new Set(
    cf.saldoFinal.map((s, i) => (s <= limiar ? i : -1)).filter((i) => i >= 0),
  );
  // Critical para o período renderizado: no modo mensal usa o índice direto;
  // no trimestral, o período é "crítico" se qualquer mês do trimestre estiver.
  const periodCritical = (i: number): boolean => {
    if (view === "mensal") return mesesCriticosIdx.has(i);
    if (view === "trimestral") return [0, 1, 2].some((o) => mesesCriticosIdx.has(i * 3 + o));
    return false;
  };

  const cvLabel = COST_VENDAS_LABEL[state.businessType];

  const rb = sum(dre.receitaBruta);
  const calcs = buildIndicatorCalcs(state, dre, ind, cagrReceitas12m);
  const ll = sum(dre.lucroLiquido);

  // Descontos Incondicionais e Abatimentos — busca por id em revenue.deducoes
  const dedById = (id: string) => state.revenue.deducoes?.find((d) => d.id === id);
  const descIncond = dedById("desc_incond")?.valores ?? Array(12).fill(0);
  const abatimentos = dedById("abatimentos")?.valores ?? Array(12).fill(0);

  // ===== Quebra de despesas por FUNÇÃO contábil (CPC 26 / Lei 6.404) =====
  const zeros = () => Array(12).fill(0);
  const despComerciais = zeros(); // despesa_comercial (+ alias legado: variavel)
  const despAdmin = zeros(); // despesa_administrativa (+ alias legado: fixo)
  const despFinanc = zeros(); // financeiro
  for (const c of state.costs) {
    const v = monthValues(c, regime);
    if (c.category === "despesa_comercial" || c.category === "variavel")
      for (let i = 0; i < 12; i++) despComerciais[i] += v[i];
    else if (c.category === "despesa_administrativa" || c.category === "fixo")
      for (let i = 0; i < 12; i++) despAdmin[i] += v[i];
    else if (c.category === "financeiro") for (let i = 0; i < 12; i++) despFinanc[i] += v[i];
  }
  // Receitas Financeiras — separar genuínas (rendimentos de aplicações, juros recebidos)
  // das operacionais (aluguéis, venda de ativos). As operacionais JÁ entram no EBITDA via
  // `dre.outrasReceitasOperacionais` (SSOT da engine) — usamos esse array diretamente para
  // evitar dupla contagem / divergência de cálculo.
  const { financeiras: receitasFinMensal } = splitReceitasFinanceiras(state);
  const outrasReceitasOpMensal = dre.outrasReceitasOperacionais;
  // Classificação SSOT (idem `splitReceitasFinanceiras`): usa `tipo` explícito
  // e cai para IDs legados apenas quando `tipo` é undefined. Filtrar por id
  // aqui divergia da engine e duplicava linhas custom.
  const OPERACIONAIS_IDS_LEGADO = new Set(["alugueis", "venda_ativos"]);
  const isOperacionalRF = (rf: { id: string; tipo?: RevenueDeducao["tipo"] }) =>
    rf.tipo === "operacional" || (rf.tipo === undefined && OPERACIONAIS_IDS_LEGADO.has(rf.id));
  const isNaoOperacionalRF = (rf: { tipo?: RevenueDeducao["tipo"] }) =>
    rf.tipo === "nao_operacional";
  // Linhas detalhadas (somente genuinamente financeiras) p/ o accordion pós-EBIT.
  const linhasReceitasFin = (state.revenue.receitasFinanceiras ?? [])
    .filter((rf) => !isOperacionalRF(rf) && !isNaoOperacionalRF(rf))
    .map((rf) => ({ label: rf.label, values: rf.valores ?? zeros() }))
    .filter((x) => sum(x.values) > 0);
  // Linhas detalhadas das receitas operacionais (aluguéis, venda de ativos, custom op) p/ o grupo "Outras Op.".
  const linhasOutrasReceitasOp = (state.revenue.receitasFinanceiras ?? [])
    .filter((rf) => isOperacionalRF(rf))
    .map((rf) => ({ label: rf.label, values: rf.valores ?? zeros() }))
    .filter((x) => sum(x.values) > 0);
  // Outras receitas e despesas NÃO operacionais (alienação de ativos etc.) — abaixo do EBIT.
  const ganhoAlienacao = dre.resultadoNaoOperacional;
  // Outras Despesas/Receitas Operacionais — Depreciação (−) + PDD líq. (−) + Outras Receitas Op. (+).
  // Inclui PDD para que a soma das linhas visíveis reconcilie com o EBIT da engine.
  const usaPDD = !!state.revenue.inadimplenciaComoPDD;
  const pddLine = usaPDD ? dre.pdd : zeros();
  const outrasOperacionais = dre.depreciacao.map(
    (d, i) => -d - pddLine[i] + outrasReceitasOpMensal[i],
  );

  // Lucro Operacional / EBIT = Lucro Bruto − Comerciais − Administrativas + Outras Op.
  // (matematicamente equivale a dre.ebit)
  const lucroOperacional = dre.ebit;
  // Lucro Antes do Financiamento e Tributos = EBIT + Receitas Financeiras + Ganho Alienação
  const laft = lucroOperacional.map((e, i) => e + receitasFinMensal[i] + ganhoAlienacao[i]);
  // EBT = LAFT − Despesas Financeiras (≡ dre.lair)
  const ebt = dre.lair;

  // Linhas para accordions. Aceita listas de categorias (suporta alias legado).
  const linhaPorCat = (cats: CostCategory[]) =>
    state.costs
      .filter((c) => cats.includes(c.category))
      .map((c) => ({ label: c.label, values: monthValues(c, regime) }))
      .filter((x) => sum(x.values) > 0);
  // Linhas detalhadas do CPV/CMV/CSP
  const linhasCpv = state.costs
    .filter((c) => c.category === "custo_vendas" || c.category === "direto_venda")
    .map((c) => ({ label: c.label, values: monthValues(c, regime) }))
    .filter((x) => sum(x.values) > 0);

  // Estado dos accordions por grupo
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) => setOpenGroups((s) => ({ ...s, [id]: !s[id] }));
  const [openCpv, setOpenCpv] = useState(false);

  type GroupRow = {
    kind: "grupo";
    id: string;
    titulo: string;
    v: number[]; // valores mensais já com sinal (negativo p/ despesas)
    tone: "neg" | "pos" | "mix";
    lines: Array<{ label: string; values: number[] }>;
    emptyMsg?: string;
  };
  type LinhaRow = {
    kind: "linha";
    k: string;
    v: number[];
    strong?: boolean;
    tone?: "pos" | "neg";
    margin?: number;
    highlight?: boolean;
  };
  type CpvRow = { kind: "cpv" };

  const rows: Array<LinhaRow | CpvRow | GroupRow> = [
    {
      kind: "linha",
      k: "(+) Receita Operacional Bruta",
      v: dre.receitaBruta,
      strong: true,
      tone: "pos",
    },
    {
      kind: "linha",
      k: usaPDD
        ? "(−) Inadimplência (contabilizada como PDD)"
        : "(−) Inadimplência (perdas estimadas)",
      v: dre.deducoesInadimplencia.map((x) => -x),
      tone: "neg",
    },
    { kind: "linha", k: "(−) Descontos Incondicionais", v: descIncond.map((x) => -x), tone: "neg" },
    { kind: "linha", k: "(−) Abatimentos", v: abatimentos.map((x) => -x), tone: "neg" },
    (() => {
      // Detalhamento por tributo — extrai do `tax.detail` apenas as chaves
      // de impostos sobre venda (PIS/COFINS/ICMS/ISS/CBS/IBS/DAS/…). O `detail`
      // é anual; distribuímos proporcionalmente à série mensal de impostosVendas
      // para preservar sazonalidade no accordion.
      const isVendasKey = (k: string) =>
        /^(PIS|COFINS|ICMS|ISS|CBS|IBS|DAS|ICMS\/ISS|ℹ|⚠)/i.test(k);
      const totalVendasAno = sum(dre.impostosVendas);
      const share = dre.impostosVendas.map((v) =>
        totalVendasAno > 0 ? v / totalVendasAno : 1 / 12,
      );
      const lines = Object.entries(tax.detail)
        .filter(([k, v]) => isVendasKey(k) && v !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([label, anual]) => ({
          label,
          values: share.map((s) => anual * s),
        }));
      return {
        kind: "grupo" as const,
        id: "trib_receita",
        titulo:
          regime === "simples"
            ? "(−) DAS Simples Nacional"
            : "(−) Tributos sobre Receita (PIS/COFINS/ICMS/ISS/CBS/IBS)",
        v: dre.impostosVendas.map((x) => -x),
        tone: "neg" as const,
        lines,
        emptyMsg: "Sem tributos sobre receita apurados no período.",
      };
    })(),

    { kind: "linha", k: "(=) Receita Operacional Líquida", v: dre.receitaLiquida, strong: true },
    { kind: "cpv" },
    {
      kind: "linha",
      k: "(=) LUCRO BRUTO",
      v: dre.lucroBruto,
      strong: true,
      tone: sum(dre.lucroBruto) >= 0 ? "pos" : "neg",
    },
    {
      kind: "grupo",
      id: "comerciais",
      titulo: "(−) Despesas Comerciais",
      v: despComerciais.map((x) => -x),
      tone: "neg",
      lines: linhaPorCat(["despesa_comercial", "variavel"]),
      emptyMsg: "Nenhuma despesa comercial cadastrada.",
    },
    {
      kind: "grupo",
      id: "admin",
      titulo: "(−) Despesas Administrativas",
      v: despAdmin.map((x) => -x),
      tone: "neg",
      lines: linhaPorCat(["despesa_administrativa", "fixo"]),
      emptyMsg: "Nenhuma despesa administrativa cadastrada.",
    },
    {
      kind: "grupo",
      id: "outras_op",
      titulo: "(±) Outras Despesas/Receitas Operacionais",
      v: outrasOperacionais,
      tone: "mix",
      lines: [
        { label: "Depreciação & Amortização", values: dre.depreciacao.map((d) => -d) },
        ...(usaPDD
          ? [{ label: "PDD — Perdas estimadas (líq. recup.)", values: pddLine.map((p) => -p) }]
          : []),
        ...linhasOutrasReceitasOp,
      ],
      emptyMsg: "Sem outras despesas/receitas operacionais.",
    },
    {
      kind: "linha",
      k: "(=) LUCRO OPERACIONAL / EBIT",
      v: lucroOperacional,
      strong: true,
      tone: sum(lucroOperacional) >= 0 ? "pos" : "neg",
    },
    {
      kind: "grupo",
      id: "rec_fin",
      titulo: "(+) Receitas Financeiras",
      v: receitasFinMensal,
      tone: "pos",
      lines: linhasReceitasFin,
      emptyMsg: "Sem receitas financeiras cadastradas.",
    },
    {
      kind: "linha",
      k: "(±) Outras receitas e despesas não operacionais",
      v: ganhoAlienacao,
      tone: sum(ganhoAlienacao) >= 0 ? "pos" : "neg",
    },
    {
      kind: "linha",
      k: "(=) LUCRO ANTES DO FINANCIAMENTO E TRIBUTOS",
      v: laft,
      strong: true,
      tone: sum(laft) >= 0 ? "pos" : "neg",
    },
    {
      kind: "grupo",
      id: "desp_fin",
      titulo: "(−) Despesas Financeiras",
      v: despFinanc.map((x) => -x),
      tone: "neg",
      lines: linhaPorCat(["financeiro"]),
      emptyMsg: "Nenhuma despesa financeira cadastrada.",
    },
    {
      kind: "linha",
      k: "(=) LUCRO ANTES DO IR/CSLL (EBT)",
      v: ebt,
      strong: true,
      tone: sum(ebt) >= 0 ? "pos" : "neg",
    },
    ...(() => {
      // Decompõe IR/CSLL em linhas separadas: IRPJ, Adicional IRPJ (10%), CSLL
      // e ajustes (compensação de prejuízo, IRRF s/ aplicações). Distribui a
      // parte anual proporcionalmente à série mensal de `dre.impostos` para
      // manter a sazonalidade nas colunas de mês/trimestre.
      const isLucroKey = (k: string) =>
        /^(IRPJ|CSLL|Adicional IRPJ|\(−\) Compensação|\(−\) IRRF)/i.test(k);
      const totalLucroAno = sum(dre.impostos);
      const share = dre.impostos.map((v) => (totalLucroAno > 0 ? v / totalLucroAno : 1 / 12));
      const baseNota = dre.impostosLucroBase === "receita_presumida" ? " (base presumida)" : "";
      const entries = Object.entries(tax.detail)
        .filter(([k, v]) => isLucroKey(k) && v !== 0)
        .sort((a, b) => b[1] - a[1]);
      // Fallback: se detail vier vazio (defensivo), mostra linha agregada.
      if (entries.length === 0) {
        return [
          {
            kind: "linha" as const,
            k: `(−) IR / CSLL${baseNota}`,
            v: dre.impostos.map((x) => -x),
            tone: "neg" as const,
          },
        ];
      }
      return entries.map(([label, anual]) => ({
        kind: "linha" as const,
        k: `(−) ${label}${baseNota}`,
        v: share.map((s) => -anual * s),
        tone: "neg" as const,
      }));
    })(),

    {
      kind: "linha",
      k: "(=) LUCRO LÍQUIDO DO EXERCÍCIO",
      v: dre.lucroLiquido,
      strong: true,
      tone: ll >= 0 ? "pos" : "neg",
      margin: ind.margemLiquida,
      highlight: true,
    },
  ];

  // chart data — memoizado: depende só dos arrays da engine (referências estáveis por render)
  const monthlyChart = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        Receita: dre.receitaLiquida[i],
        Custos:
          dre.cpv[i] +
          dre.despesasOperacionais[i] +
          dre.custosFinanceirosTotal[i] +
          dre.depreciacao[i],
        Lucro: dre.lucroLiquido[i],
      })),
    [
      dre.receitaLiquida,
      dre.cpv,
      dre.despesasOperacionais,
      dre.custosFinanceirosTotal,
      dre.depreciacao,
      dre.lucroLiquido,
      MESES,
    ],
  );

  const acumulado = useMemo(
    () =>
      dre.lucroLiquido.reduce<{ mes: string; valor: number }[]>((acc, v, i) => {
        const last = i === 0 ? 0 : acc[i - 1].valor;
        acc.push({ mes: MESES[i], valor: last + v });
        return acc;
      }, []),
    [dre.lucroLiquido, MESES],
  );

  const costPie = useMemo(
    () =>
      Object.entries(dre.despesasPorCategoria)
        .map(([k, v]) => ({ name: k, value: sum(v) }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value),
    [dre.despesasPorCategoria],
  );

  // Waterfall — inclui Deduções (inadimplência + descontos + abatimentos) e
  // Outras Receitas Operacionais para que a cadeia reconcilie até o Lucro Líq.
  // (antes, faltavam essas duas rubricas e o Lucro Líq. não fechava).
  const deducoesAnual = sum(dre.deducoesInadimplencia) + sum(descIncond) + sum(abatimentos);
  const waterfall = [
    { name: "Receita Bruta", value: sum(dre.receitaBruta) },
    { name: "− Deduções", value: -deducoesAnual },
    { name: "− Imp. Vendas", value: -sum(dre.impostosVendas) },
    { name: `− ${cvLabel.short}`, value: -sum(dre.cpv) },
    { name: "− Desp. Op.", value: -sum(dre.despesasOperacionais) },
    { name: "− D&A", value: -sum(dre.depreciacao) },
    { name: "+ Outras Rec. Op.", value: sum(outrasReceitasOpMensal) },
    { name: "± Financ.", value: sum(dre.resultadoFinanceiro) },
    { name: "− IRPJ/CSLL", value: -sum(dre.impostos) },
    { name: "Lucro Líq.", value: ll },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div
            role="tablist"
            aria-label="Período de visualização da DRE"
            className="inline-flex rounded-md border border-border/60 bg-card/40 p-1"
          >
            {(readOnly
              ? (["trimestral", "mensal"] as const)
              : (["anual", "trimestral", "mensal"] as const)
            ).map((v) => {
              const active = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="dre-tabela"
                  onClick={() => setView(v)}
                  className={`cursor-pointer select-none rounded px-3 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"} ${v === "mensal" ? "hidden lg:block" : ""}`}
                >
                  {v === "anual" ? "Anual" : v === "trimestral" ? "Trimestral" : "Mensal"}
                </button>
              );
            })}
          </div>

          {/* Seleção de regime fica na aba Tributário — aqui apenas refletimos o regime ativo abaixo. */}
        </div>
        <div className="text-xs text-muted-foreground">
          Período: <span className="num">{MESES[0]}</span> a{" "}
          <span className="num">{MESES[11]}</span> ·{" "}
          {cockpitAtivo ? (
            <Badge
              variant="outline"
              className="ml-1 border-primary/50 text-primary"
              title="Tributos sobre vendas e IRPJ/CSLL como lançados no Odoo. O regime configurado vale para simulações e para a conciliação (aba Consolidado)."
            >
              Tributos: contabilizados no Odoo
            </Badge>
          ) : (
            <>
              Regime ativo:{" "}
              <Badge variant="outline" className="ml-1">
                {regime === "simples" ? "Simples" : regime === "presumido" ? "Presumido" : "Real"}
              </Badge>
            </>
          )}
          <span className="ml-2">· Era:</span>
          <Badge
            variant="outline"
            className={`ml-1 ${(state.tax.era ?? "atual") !== "atual" ? "border-primary/50 text-primary" : ""}`}
          >
            {TAX_ERA_SHORT[state.tax.era ?? "atual"]}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Faturamento"
          value={fmtBRL(rb)}
          tone="pos"
          hint={{
            description: "Faturamento bruto anual.",
            formula: "Σ Receita Bruta",
            calc: `Σ dos 12 meses\n= ${fmtBRL(rb)}`,
          }}
        />
        <StatCard
          label="EBITDA"
          value={fmtBRL(sum(dre.ebitda))}
          sub={`${ind.margemEbitda.toFixed(1)}%`}
          tone={sum(dre.ebitda) >= 0 ? "pos" : "neg"}
          hint={{
            description:
              "Geração operacional de caixa antes de juros, impostos e depreciação. Mede a operação 'pura', sem efeitos de estrutura de capital nem fiscalidade.",
            formula: "Receita Líquida − CPV − Despesas Operacionais (excl. D&A)",
            calc: calcs.ebitda12m,
          }}
        />

        <StatCard
          label="EBIT"
          value={fmtBRL(sum(dre.ebit))}
          sub={`${ind.margemEbit.toFixed(1)}%`}
          tone={sum(dre.ebit) >= 0 ? "pos" : "neg"}
          hint={{
            description: "Resultado operacional após depreciação/amortização (LAJIR).",
            formula: "EBITDA − Depreciação/Amortização",
            calc: `${fmtBRL(sum(dre.ebitda))} − ${fmtBRL(sum(dre.depreciacao))}\n= ${fmtBRL(sum(dre.ebit))}`,
          }}
        />
        <StatCard
          label="Lucro Líq."
          value={fmtBRL(ll)}
          sub={`${ind.margemLiquida.toFixed(1)}%`}
          tone={ll >= 0 ? "pos" : "neg"}
          hint={{
            description: "Resultado final.",
            formula: "LAIR − Impostos",
            calc: calcs.lucroLiquido12m,
          }}
        />
        <StatCard
          label="Impostos"
          value={fmtBRL(tax.annual)}
          tone="warn"
          sub={`${fmtPct(tax.effective / 100)}`}
          hint={{
            description: "Carga tributária.",
            formula: "Impostos ÷ Receita Bruta",
            calc: `${fmtBRL(tax.annual)} ÷ ${fmtBRL(rb)} × 100\n= ${fmtPct(tax.effective / 100)}`,
          }}
        />
      </div>

      {/* DRE Table — substituída por comparação quando: (a) modo "Comparar" ativo
          com ≥ 2 selecionados, ou (b) view=anual com histórico. */}
      {showCompare ? (
        <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden shadow-sm">
          <div className="border-b border-border/60 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-semibold">{compareTitle}</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Regime de Competência · valores anuais lado a lado
            </p>
          </div>
          <div className="p-3 sm:p-4">
            <DREComparison snapshots={compareSnaps} />
          </div>
        </div>
      ) : (
        <>
          {/* DRE Table */}
          <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden shadow-sm">
            <div className="border-b border-border/60 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm sm:text-base font-semibold">
                  D.R.E. — Demonstração do Resultado do Exercício
                </h3>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Regime de Competência
                </p>
              </div>
            </div>
            <div className="scrollbar-none w-full overflow-x-auto overflow-y-hidden touch-pan-x">
              <table
                id="dre-tabela"
                aria-label="Demonstração do Resultado do Exercício"
                className="w-full min-w-[600px] md:min-w-full text-[clamp(0.65rem,1vw+0.3rem,0.875rem)] table-fixed md:table-auto"
              >
                <colgroup>
                  <col className="w-[120px] sm:w-auto" />
                  {showPeriods &&
                    periodLabels.map((_, i) => (
                      <col key={i} className={view === "mensal" ? "w-[70px]" : "w-[90px]"} />
                    ))}
                  <col className="w-[90px] md:w-auto" />
                  <col className="w-[50px] md:w-auto" />
                </colgroup>

                <thead>
                  <tr className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th
                      scope="col"
                      className="sticky left-0 z-20 bg-card px-4 py-2 text-left shadow-[1px_0_0_0_var(--border)]"
                    >
                      Descrição
                    </th>
                    {showPeriods &&
                      periodLabels.map((m, i) => (
                        <th
                          scope="col"
                          key={m}
                          className={`px-2 py-2 text-right ${periodCritical(i) ? "text-destructive" : ""}`}
                        >
                          {m}
                        </th>
                      ))}
                    <th scope="col" className="px-4 py-2 text-right">
                      Anual
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      % Rec
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row, idx) => {
                    if (row.kind === "grupo") {
                      const total = sum(row.v);
                      const pct = rb > 0 ? Math.abs(total) / rb : 0;
                      const isOpen = !!openGroups[row.id];
                      const toneCls =
                        row.tone === "neg" ? "text-neg" : row.tone === "pos" ? "text-pos" : "";
                      return (
                        <Fragment key={idx}>
                          <tr
                            className="border-t border-border/30 bg-accent/10 cursor-pointer hover:bg-accent/20"
                            onClick={() => toggleGroup(row.id)}
                          >
                            <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-[10px] sm:text-xs font-semibold truncate shadow-[1px_0_0_0_var(--border)]">
                              <span className="inline-flex items-center gap-1">
                                <ChevronRight
                                  className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                                />
                                {row.titulo}
                              </span>
                            </td>
                            {showPeriods &&
                              aggregate(row.v).map((v, i) => (
                                <td
                                  key={i}
                                  className={`num px-2 py-2 text-right text-xs ${periodCritical(i) ? "" : ""} ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-pos" : "text-muted-foreground"}`}
                                >
                                  {v === 0 ? "—" : fmtBRLCompact(v)}
                                </td>
                              ))}

                            <td
                              className={`num px-4 py-2 text-right font-semibold ${total < 0 ? "text-neg" : total > 0 ? toneCls || "text-foreground" : ""}`}
                            >
                              {fmtBRL(total)}
                            </td>
                            <td className="num px-3 py-2 text-right text-xs text-muted-foreground">
                              {fmtPct(pct)}
                            </td>
                          </tr>
                          {isOpen &&
                            row.lines.map((l, li) => {
                              const sgn = row.tone === "neg" ? -1 : 1;
                              const lTotal = sum(l.values) * sgn;
                              return (
                                <tr
                                  key={`${row.id}_${li}`}
                                  className="border-t border-border/20 bg-card"
                                >
                                  <td className="sticky left-0 z-10 bg-inherit px-4 py-1.5 pl-8 text-xs text-muted-foreground shadow-[1px_0_0_0_var(--border)]">
                                    {l.label}
                                  </td>
                                  {showPeriods &&
                                    aggregate(l.values).map((v, i) => {
                                      const sv = v * sgn;
                                      return (
                                        <td
                                          key={i}
                                          className={`num px-2 py-1.5 text-right text-xs ${sv < 0 ? "text-neg" : sv > 0 ? "text-pos" : "text-muted-foreground"}`}
                                        >
                                          {sv === 0 ? "—" : fmtBRLCompact(sv)}
                                        </td>
                                      );
                                    })}

                                  <td
                                    className={`num px-4 py-1.5 text-right text-xs ${lTotal < 0 ? "text-neg" : lTotal > 0 ? "text-pos" : ""}`}
                                  >
                                    {fmtBRL(lTotal)}
                                  </td>
                                  <td className="num px-3 py-1.5 text-right text-[10px] text-muted-foreground">
                                    {fmtPct(rb > 0 ? Math.abs(lTotal) / rb : 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          {isOpen && row.lines.length === 0 && (
                            <tr className="border-t border-border/20 bg-card">
                              <td
                                colSpan={(showPeriods ? periodLabels.length : 0) + 3}
                                className="px-4 py-1.5 pl-8 text-[10px] italic text-muted-foreground"
                              >
                                {row.emptyMsg ?? "Sem itens cadastrados."}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    }
                    if (row.kind === "cpv") {
                      const total = sum(dre.cpv);
                      const pct = rb > 0 ? total / rb : 0;
                      return (
                        <Fragment key={idx}>
                          <tr
                            className="border-t border-border/30 bg-accent/10 cursor-pointer hover:bg-accent/20"
                            onClick={() => setOpenCpv((v) => !v)}
                          >
                            <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-[10px] sm:text-xs font-semibold truncate shadow-[1px_0_0_0_var(--border)]">
                              <span className="inline-flex items-center gap-1">
                                <ChevronRight
                                  className={`h-3 w-3 shrink-0 transition-transform ${openCpv ? "rotate-90" : ""}`}
                                />
                                (−) {cvLabel.long}
                              </span>
                            </td>
                            {showPeriods &&
                              aggregate(dre.cpv).map((v, i) => (
                                <td
                                  key={i}
                                  className={`num px-2 py-2 text-right text-xs ${periodCritical(i) ? "" : ""} text-neg`}
                                >
                                  {v === 0 ? "—" : fmtBRLCompact(-v)}
                                </td>
                              ))}

                            <td className="num px-4 py-2 text-right font-semibold text-neg">
                              {fmtBRL(total ? -total : 0)}
                            </td>
                            <td className="num px-3 py-2 text-right text-xs text-muted-foreground">
                              {fmtPct(pct)}
                            </td>
                          </tr>
                          {openCpv &&
                            linhasCpv.map((l, li) => {
                              const lTotal = sum(l.values);
                              return (
                                <tr key={`cpv_${li}`} className="border-t border-border/20 bg-card">
                                  <td className="sticky left-0 z-10 bg-inherit px-4 py-1.5 pl-8 text-xs text-muted-foreground shadow-[1px_0_0_0_var(--border)]">
                                    {l.label}
                                  </td>
                                  {showPeriods &&
                                    aggregate(l.values).map((v, i) => (
                                      <td
                                        key={i}
                                        className="num px-2 py-1.5 text-right text-xs text-muted-foreground"
                                      >
                                        {v === 0 ? "—" : fmtBRLCompact(-v)}
                                      </td>
                                    ))}

                                  <td className="num px-4 py-1.5 text-right text-xs text-neg">
                                    {fmtBRL(lTotal ? -lTotal : 0)}
                                  </td>
                                  <td className="num px-3 py-1.5 text-right text-[10px] text-muted-foreground">
                                    {fmtPct(rb > 0 ? lTotal / rb : 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          {openCpv && linhasCpv.length === 0 && (
                            <tr className="border-t border-border/20 bg-card">
                              <td
                                colSpan={(showPeriods ? periodLabels.length : 0) + 3}
                                className="px-4 py-1.5 pl-8 text-[10px] italic text-muted-foreground"
                              >
                                Nenhum item classificado como {cvLabel.short} ainda. Cadastre custos
                                na categoria "Custo de Vendas" na aba Custos.
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    }

                    const total = sum(row.v);
                    const pct = rb > 0 ? total / rb : 0;
                    const toneCls =
                      row.tone === "pos" ? "text-pos" : row.tone === "neg" ? "text-neg" : "";
                    return (
                      <tr
                        key={idx}
                        className={`border-t border-border/30 ${row.highlight ? "bg-primary/10" : row.strong ? "bg-accent/20" : "bg-card"}`}
                      >
                        <td
                          className={`sticky left-0 z-10 bg-inherit shadow-[1px_0_0_0_var(--border)] px-3 py-2 ${row.strong ? "font-semibold" : "text-muted-foreground"} text-[10px] sm:text-xs truncate`}
                        >
                          {row.k}
                        </td>
                        {showPeriods &&
                          aggregate(row.v).map((v, i) => (
                            <td
                              key={i}
                              className={`num px-2 py-2 text-right text-xs ${periodCritical(i) ? "" : ""} ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-pos" : "text-muted-foreground"}`}
                            >
                              {v === 0 ? "—" : fmtBRLCompact(v)}
                            </td>
                          ))}

                        <td
                          className={`num px-4 py-2 text-right ${row.strong ? "font-semibold" : ""} ${total < 0 ? "text-neg" : total > 0 ? toneCls || "text-foreground" : ""}`}
                        >
                          {fmtBRL(total)}
                          {row.margin !== undefined && (
                            <div className="text-[10px] font-normal text-muted-foreground">
                              Margem {row.margin.toFixed(1)}%
                            </div>
                          )}
                        </td>
                        <td className="num px-3 py-2 text-right text-xs text-muted-foreground">
                          {fmtPct(pct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function Ind({
  label,
  v,
  desc,
  formula,
  tone,
}: {
  label: string;
  v: string;
  desc?: string;
  formula?: string;
  tone?: "pos" | "neg" | "warn";
}) {
  const cls =
    tone === "pos"
      ? "text-pos"
      : tone === "neg"
        ? "text-neg"
        : tone === "warn"
          ? "text-[var(--warning)]"
          : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label} {desc && <HelpTip text={desc} formula={formula} />}
      </div>
      <div className={`mono mt-1 text-lg font-semibold ${cls}`}>{v}</div>
    </div>
  );
}
