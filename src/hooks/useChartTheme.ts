// ============================================================================
// useChartTheme — paleta semântica para Recharts derivada dos CSS variables
// configurados pelo admin (`--primary`, `--accent`, etc.). Como os tokens
// já são injetados no <head> via SSR (ver __root.tsx) + atualizados em
// runtime pelo BrandingApplier, qualquer mudança de cor no painel se
// reflete instantaneamente em gráficos — sem re-render tardio.
//
// Use SEMPRE estes valores (ou diretamente `var(--primary)` em props
// estáticas) ao invés de hex codes literais.
// ============================================================================
export const chartTheme = {
  primary: "var(--primary)",
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
  muted: "var(--muted-foreground)",
  grid: "var(--border)",
  background: "var(--background)",
  // Série categórica para múltiplas linhas/barras (1..5).
  series: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ] as const,
};

export type ChartTheme = typeof chartTheme;

export function useChartTheme(): ChartTheme {
  // Hook por simetria com outros temas e para permitir extensões futuras
  // (ex.: ler `useBranding()` para overrides específicos). Os valores
  // retornados são apontadores para CSS vars — sempre atuais no DOM.
  return chartTheme;
}
