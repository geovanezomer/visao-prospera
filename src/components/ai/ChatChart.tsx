// Renderiza gráficos interativos embutidos no chat da IA.
// A IA emite um bloco markdown com linguagem "finance-chart" contendo JSON:
//   ```finance-chart
//   { "type": "bar"|"line"|"waterfall"|"tornado",
//     "title": "DRE Base × Simulado",
//     "data": [{ "label": "Receita", "base": 100, "sim": 110 }, ...],
//     "keys": ["base","sim"],                // bar/line: séries
//     "labelKey": "label",                    // default "label"
//     "format": "currency"|"percent"|"number" // default "currency"
//   }
//   ```
// Tudo client-side com recharts (já no bundle). Falha silenciosa: se o JSON
// estiver inválido renderiza o bloco como código, sem quebrar o chat.

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec, FormatKind } from "./chartSpec";

const COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground))", "#22c55e", "#ef4444"];

function fmt(v: number, kind: FormatKind = "currency"): string {
  if (!isFinite(v)) return "—";
  if (kind === "percent") return `${v.toFixed(1)}%`;
  if (kind === "number") return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  // currency (R$ k/M abreviado p/ caber no tooltip do chat)
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return `R$ ${v.toFixed(0)}`;
}

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const labelKey = spec.labelKey ?? "label";
  const format = spec.format ?? "currency";
  const keys = spec.keys ?? ["value"];

  // Waterfall: pré-processa para barras empilhadas (base invisível + delta colorido).
  const waterfallData = useMemo(() => {
    if (spec.type !== "waterfall") return [];
    let running = 0;
    return spec.data.map((d, idx) => {
      const v = Number(d.value ?? 0);
      const isTotal = d.total === true || d.total === "true" || idx === spec.data.length - 1;
      const start = isTotal ? 0 : running;
      const end = isTotal ? v : running + v;
      if (!isTotal) running = end;
      return {
        label: String(d[labelKey] ?? d.label ?? `#${idx}`),
        base: start,
        delta: Math.abs(end - start),
        positive: v >= 0,
        isTotal,
        absValue: isTotal ? v : v,
      };
    });
  }, [spec, labelKey]);

  const tornadoData = useMemo(() => {
    if (spec.type !== "tornado") return [];
    return [...spec.data]
      .map((d) => ({
        label: String(d[labelKey] ?? d.label ?? "?"),
        impact: Number(d.impact ?? d.value ?? 0),
      }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }, [spec, labelKey]);

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-card/40 p-3">
      {spec.title && (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {spec.title}
        </div>
      )}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "line" ? (
            <LineChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey={labelKey}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => fmt(v, format)}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
                formatter={(v: number) => fmt(v, format)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {keys.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          ) : spec.type === "waterfall" ? (
            <BarChart data={waterfallData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => fmt(v, format)}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
                formatter={(_v: number, _n, p) => fmt(Number(p?.payload?.absValue ?? 0), format)}
              />
              <Bar dataKey="base" stackId="w" fill="transparent" />
              <Bar dataKey="delta" stackId="w">
                {waterfallData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.isTotal ? "hsl(var(--primary))" : d.positive ? "#22c55e" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : spec.type === "tornado" ? (
            <BarChart
              layout="vertical"
              data={tornadoData}
              margin={{ top: 8, right: 12, left: 60, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                type="number"
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => fmt(v, format)}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                width={120}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
                formatter={(v: number) => fmt(v, format)}
              />
              <Bar dataKey="impact">
                {tornadoData.map((d, i) => (
                  <Cell key={i} fill={d.impact >= 0 ? "#22c55e" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey={labelKey}
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => fmt(v, format)}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
                formatter={(v: number) => fmt(v, format)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {keys.map((k, i) => (
                <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
