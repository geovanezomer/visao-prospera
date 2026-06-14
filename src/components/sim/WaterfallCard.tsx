import { useMemo } from "react";
import { AppState } from "@/lib/finance/types";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionTitle } from "./primitives";

// Helper para somar arrays de 12 meses
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

// Formatador BRL compacto
const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}k`;
  return fmtBRL(n);
};

// Status de cor: verde (saudável), amarelo (atenção), vermelho (crítico)
type Status = "ok" | "warn" | "crit";

const COLORS: Record<Status, string> = {
  ok: "hsl(var(--success, 142 72% 45%))",
  warn: "hsl(var(--warning, 38 92% 50%))",
  crit: "hsl(var(--destructive, 0 84% 60%))",
};

// Faixa cinza para "base" invisível usada na técnica de waterfall com BarChart empilhado
const BASE_FILL = "transparent";

interface Step {
  name: string;
  // Para subtotais: value = total acumulado; base = 0; isTotal = true
  // Para deltas: value = |Δ|; base = nível inferior da barra flutuante
  base: number;
  value: number;
  isTotal: boolean;
  // Valor "real" exibido nos labels e usado para classificar
  raw: number;
  status: Status;
}

interface DreLike {
  receitaBruta: number[];
  deducoesInadimplencia: number[];
  outrasDeducoes: number[];
  impostosVendas: number[];
  receitaLiquida: number[];
  cpv: number[];
  lucroBruto: number[];
  despesasOperacionais: number[];
  ebitda: number[];
  depreciacao: number[];
  ebit: number[];
  resultadoFinanceiro: number[];
  lair: number[];
  impostos: number[];
  lucroLiquido: number[];
}

interface IndLike {
  margemBruta: number;
  margemEbitda: number;
  margemLiquida: number;
}

export function WaterfallCard({ dre, ind }: { dre: DreLike; ind: IndLike }) {
  const steps = useMemo<Step[]>(() => {
    const RB = sum(dre.receitaBruta);
    const DED =
      sum(dre.deducoesInadimplencia) + sum(dre.outrasDeducoes) + sum(dre.impostosVendas);
    const RL = sum(dre.receitaLiquida);
    const CPV = sum(dre.cpv);
    const LB = sum(dre.lucroBruto);
    const DOP = sum(dre.despesasOperacionais);
    const EBITDA = sum(dre.ebitda);
    const DEP = sum(dre.depreciacao);
    const RF = sum(dre.resultadoFinanceiro); // negativo = despesa
    const IMP = sum(dre.impostos);
    const LL = sum(dre.lucroLiquido);

    // Classificação de subtotais por margem
    const stTotal = (pct: number, okMin: number, warnMin: number): Status =>
      pct >= okMin ? "ok" : pct >= warnMin ? "warn" : "crit";

    // Classificação de deltas pelo peso sobre Receita Líquida
    const stDelta = (peso: number, warnMax: number, critMax: number): Status =>
      peso <= warnMax ? "ok" : peso <= critMax ? "warn" : "crit";

    const dedPct = RB > 0 ? (DED / RB) * 100 : 0;
    const cpvPct = RL > 0 ? (CPV / RL) * 100 : 100;
    const dopPct = RL > 0 ? (DOP / RL) * 100 : 100;
    const jurosPct = RL > 0 ? (Math.abs(Math.min(RF, 0)) / RL) * 100 : 100;
    const impPct = RL > 0 ? (IMP / RL) * 100 : 0;

    // Construção da waterfall — base e value calculados a partir do nível corrente
    const list: Step[] = [];
    let cursor = 0;

    // Receita Bruta (sobe de 0 até RB)
    list.push({
      name: "Receita Bruta",
      base: 0,
      value: RB,
      isTotal: true,
      raw: RB,
      status: RB > 0 ? "ok" : "crit",
    });
    cursor = RB;

    // (−) Deduções
    cursor -= DED;
    list.push({
      name: "(−) Deduções",
      base: cursor,
      value: DED,
      isTotal: false,
      raw: -DED,
      status: stDelta(dedPct, 20, 35),
    });

    // (=) Receita Líquida
    list.push({
      name: "Receita Líquida",
      base: 0,
      value: RL,
      isTotal: true,
      raw: RL,
      status: RL > 0 ? "ok" : "crit",
    });
    cursor = RL;

    // (−) CPV
    cursor -= CPV;
    list.push({
      name: "(−) CPV",
      base: cursor,
      value: CPV,
      isTotal: false,
      raw: -CPV,
      status: stDelta(cpvPct, 50, 70),
    });

    // (=) Margem Bruta / Lucro Bruto
    list.push({
      name: "Margem Bruta",
      base: LB >= 0 ? 0 : LB,
      value: Math.abs(LB),
      isTotal: true,
      raw: LB,
      status: stTotal(ind.margemBruta, 30, 15),
    });
    cursor = LB;

    // (−) Despesas Fixas
    cursor -= DOP;
    list.push({
      name: "(−) Fixos",
      base: cursor,
      value: DOP,
      isTotal: false,
      raw: -DOP,
      status: stDelta(dopPct, 25, 40),
    });

    // (=) EBITDA
    list.push({
      name: "EBITDA",
      base: EBITDA >= 0 ? 0 : EBITDA,
      value: Math.abs(EBITDA),
      isTotal: true,
      raw: EBITDA,
      status: stTotal(ind.margemEbitda, 15, 5),
    });
    cursor = EBITDA;

    // (−) Depreciação
    cursor -= DEP;
    list.push({
      name: "(−) Depreciação",
      base: cursor,
      value: DEP,
      isTotal: false,
      raw: -DEP,
      status: "ok",
    });

    // (±) Resultado Financeiro (juros)
    const rfAbs = Math.abs(RF);
    if (RF < 0) {
      cursor += RF; // diminui
      list.push({
        name: "(−) Juros",
        base: cursor,
        value: rfAbs,
        isTotal: false,
        raw: RF,
        status: stDelta(jurosPct, 3, 8),
      });
    } else {
      list.push({
        name: "(+) Result. Fin.",
        base: cursor,
        value: rfAbs,
        isTotal: false,
        raw: RF,
        status: "ok",
      });
      cursor += RF;
    }

    // (−) IR/CSLL
    cursor -= IMP;
    list.push({
      name: "(−) IR/CSLL",
      base: cursor,
      value: IMP,
      isTotal: false,
      raw: -IMP,
      status: stDelta(impPct, 10, 18),
    });

    // (=) Lucro Líquido
    list.push({
      name: "Lucro Líquido",
      base: LL >= 0 ? 0 : LL,
      value: Math.abs(LL),
      isTotal: true,
      raw: LL,
      status: stTotal(ind.margemLiquida, 10, 3),
    });

    return list;
  }, [dre, ind]);

  // Identifica o pior step (status crítico de maior magnitude) para a chamada narrativa
  const ancor = useMemo(() => {
    const crits = steps.filter((s) => s.status === "crit");
    if (crits.length === 0) return null;
    return crits.reduce((a, b) => (Math.abs(b.raw) > Math.abs(a.raw) ? b : a));
  }, [steps]);

  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-5">
      <SectionTitle hint="Mostra como cada linha do DRE consome a receita até chegar ao lucro. Verde = saudável, amarelo = atenção, vermelho = crítico.">
        Waterfall do resultado
      </SectionTitle>

      {ancor && (
        <div className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-3 text-xs leading-relaxed">
          <span className="font-semibold text-neg">Onde o resultado se perde:</span>{" "}
          <span className="text-foreground">{ancor.name}</span>{" "}
          <span className="text-muted-foreground">
            ({fmtBRL(ancor.raw)}) — concentra o maior impacto negativo do período.
          </span>
        </div>
      )}

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={steps} margin={{ top: 24, right: 16, left: 8, bottom: 48 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              angle={-25}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={fmtCompact}
              width={70}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.2)" }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(_v: number, _k: string, item: { payload?: Step }) => {
                const p = item?.payload;
                if (!p) return ["", ""];
                return [fmtBRL(p.raw), p.isTotal ? "Subtotal" : "Variação"];
              }}
              labelFormatter={(l: string) => l}
            />
            {/* Base invisível (técnica para barras flutuantes) */}
            <Bar dataKey="base" stackId="w" fill={BASE_FILL} isAnimationActive={false} />
            {/* Valor visível, colorido por status */}
            <Bar dataKey="value" stackId="w" isAnimationActive={false} radius={[4, 4, 0, 0]}>
              {steps.map((s, i) => (
                <Cell key={i} fill={COLORS[s.status]} fillOpacity={s.isTotal ? 1 : 0.85} />
              ))}
              <LabelList
                dataKey="raw"
                position="top"
                formatter={(v: number) => fmtCompact(v)}
                style={{ fontSize: 10, fill: "hsl(var(--foreground))", fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.ok }} /> Saudável
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.warn }} /> Atenção
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.crit }} /> Crítico
        </span>
      </div>
    </section>
  );
}
