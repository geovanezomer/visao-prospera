// Plano de ação rastreável — localStorage.

export type ActionStatus = "aberta" | "em_andamento" | "concluida" | "cancelada";

export interface ActionItem {
  id: string;
  titulo: string;
  descricao?: string;
  origem: "chat" | "alerta" | "manual";
  responsavel?: string;
  prazo?: string; // ISO date
  status: ActionStatus;
  impactoEsperado?: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

const KEY = (company: string) => `gz-finance-actions-${company || "default"}`;

export function listActions(company: string, filter?: { status?: ActionStatus }): ActionItem[] {
  try {
    const raw = localStorage.getItem(KEY(company));
    const all: ActionItem[] = raw ? JSON.parse(raw) : [];
    return filter?.status ? all.filter(a => a.status === filter.status) : all;
  } catch { return []; }
}

export function createAction(
  company: string,
  input: Partial<ActionItem> & { titulo: string },
): ActionItem {
  const now = Date.now();
  const item: ActionItem = {
    id: `a-${now}-${Math.random().toString(36).slice(2, 6)}`,
    titulo: input.titulo,
    descricao: input.descricao,
    origem: input.origem ?? "chat",
    responsavel: input.responsavel,
    prazo: input.prazo,
    status: input.status ?? "aberta",
    impactoEsperado: input.impactoEsperado,
    createdAt: now,
    updatedAt: now,
  };
  const all = listActions(company);
  all.unshift(item);
  localStorage.setItem(KEY(company), JSON.stringify(all));
  return item;
}

export function updateAction(company: string, id: string, patch: Partial<ActionItem>): ActionItem | null {
  const all = listActions(company);
  const idx = all.findIndex(a => a.id === id);
  if (idx < 0) return null;
  const now = Date.now();
  all[idx] = { ...all[idx], ...patch, updatedAt: now };
  if (patch.status === "concluida" && !all[idx].resolvedAt) all[idx].resolvedAt = now;
  localStorage.setItem(KEY(company), JSON.stringify(all));
  return all[idx];
}

export function deleteAction(company: string, id: string) {
  const all = listActions(company).filter(a => a.id !== id);
  localStorage.setItem(KEY(company), JSON.stringify(all));
}

export function actionsToMarkdown(items: ActionItem[]): string {
  if (!items.length) return "_Nenhuma ação cadastrada._";
  const rows = items.map(a =>
    `| ${a.titulo} | ${a.status} | ${a.responsavel ?? "—"} | ${a.prazo ?? "—"} | ${a.impactoEsperado ?? "—"} |`
  ).join("\n");
  return `| Ação | Status | Responsável | Prazo | Impacto |\n| --- | --- | --- | --- | --- |\n${rows}`;
}
