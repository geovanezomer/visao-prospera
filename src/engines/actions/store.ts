// Plano de ação rastreável — localStorage.
// IDs via nanoid (21 chars URL-safe). Soft delete: itens marcados com
// isDeleted=true são filtrados em listActions; permanecem no storage
// para suportar futuras features (undo, sync multi-aba, auditoria).
import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";

// =====================================================================
// Event bus — notifica painéis React quando o store muda (criar/editar/
// remover ação). Resolve o problema das tools serem fire-and-forget: ao
// chamar criar_acao no chat, qualquer painel inscrito re-renderiza.
// Também escuta 'storage' event para sincronizar entre abas.
// =====================================================================
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
  try {
    window.dispatchEvent(new CustomEvent("gz-actions-changed"));
  } catch {
    // SSR / ambiente sem window — multi-tab via CustomEvent é best-effort
  }
}

export function subscribeActions(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("gz-finance-actions-")) listener();
  };
  const onCustom = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("gz-actions-changed", onCustom);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("gz-actions-changed", onCustom);
  };
}

function applyFilter(
  all: ActionItem[],
  filter?: { status?: ActionStatus; includeDeleted?: boolean },
): ActionItem[] {
  const visible = filter?.includeDeleted ? all : all.filter((a) => !a.isDeleted);
  return filter?.status ? visible.filter((a) => a.status === filter.status) : visible;
}

/** Hook reativo: re-renderiza sempre que o store muda (chat ou UI). */
export function useActions(
  company: string,
  filter?: { status?: ActionStatus; includeDeleted?: boolean },
): ActionItem[] {
  const snapshot = useSyncExternalStore(
    subscribeActions,
    () => `${company}::${localStorage.getItem(KEY(company)) ?? ""}`,
    () => `${company}::`,
  );
  const raw = snapshot.slice(company.length + 2);
  try {
    const all = raw ? (JSON.parse(raw) as ActionItem[]) : [];
    return applyFilter(all, filter);
  } catch {
    return [];
  }
}

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
  /** Soft delete — filtrado em listActions por padrão. */
  isDeleted?: boolean;
}

const KEY = (company: string) => `gz-finance-actions-${company || "default"}`;

/** Lê o array bruto (inclui soft-deleted). Uso interno. */
function readRaw(company: string): ActionItem[] {
  try {
    const raw = localStorage.getItem(KEY(company));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function listActions(
  company: string,
  filter?: { status?: ActionStatus; includeDeleted?: boolean },
): ActionItem[] {
  const all = readRaw(company);
  const visible = filter?.includeDeleted ? all : all.filter((a) => !a.isDeleted);
  return filter?.status ? visible.filter((a) => a.status === filter.status) : visible;
}

export function createAction(
  company: string,
  input: Partial<ActionItem> & { titulo: string },
): ActionItem {
  const now = Date.now();
  const item: ActionItem = {
    id: nanoid(),
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
  const all = readRaw(company);
  all.unshift(item);
  localStorage.setItem(KEY(company), JSON.stringify(all));
  emit();
  return item;
}

export function updateAction(
  company: string,
  id: string,
  patch: Partial<ActionItem>,
): ActionItem | null {
  const all = readRaw(company);
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const now = Date.now();
  all[idx] = { ...all[idx], ...patch, updatedAt: now };
  if (patch.status === "concluida" && !all[idx].resolvedAt) all[idx].resolvedAt = now;
  localStorage.setItem(KEY(company), JSON.stringify(all));
  emit();
  return all[idx];
}

/** Soft delete: marca isDeleted=true e atualiza updatedAt. Não remove do storage. */
export function deleteAction(company: string, id: string) {
  const all = readRaw(company);
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], isDeleted: true, updatedAt: Date.now() };
  localStorage.setItem(KEY(company), JSON.stringify(all));
  emit();
}

/** Restaura um item soft-deleted (suporte a futuro undo). */
export function restoreAction(company: string, id: string) {
  const all = readRaw(company);
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], isDeleted: false, updatedAt: Date.now() };
  localStorage.setItem(KEY(company), JSON.stringify(all));
  emit();
}

export function actionsToMarkdown(items: ActionItem[]): string {
  if (!items.length) return "_Nenhuma ação cadastrada._";
  const rows = items
    .map(
      (a) =>
        `| ${a.titulo} | ${a.status} | ${a.responsavel ?? "—"} | ${a.prazo ?? "—"} | ${a.impactoEsperado ?? "—"} |`,
    )
    .join("\n");
  return `| Ação | Status | Responsável | Prazo | Impacto |\n| --- | --- | --- | --- | --- |\n${rows}`;
}
