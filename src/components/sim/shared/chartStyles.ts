// Estilos compartilhados dos tooltips do recharts (tema claro/escuro via CSS vars).
export const chartTooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

export const chartTooltipItemStyle = { color: "var(--popover-foreground)" } as const;
export const chartTooltipLabelStyle = {
  color: "var(--popover-foreground)",
  fontWeight: 600,
} as const;
