// Hook orquestrador do ciclo de vida do arquivo .finnance.
// Inspirado no Excalidraw: autosave em localStorage + arquivo físico para portabilidade.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppState, Scenario } from "./types";
import {
  defaultFilename,
  serialize,
} from "./fileFormat";
import { downloadFinnanceFile, pickFinnanceFile } from "./fileIO";

interface ConfirmFn {
  (opts: { title: string; description?: string; confirmLabel?: string; destructive?: boolean }): Promise<boolean>;
}

interface Args {
  state: AppState;
  scenarios: Scenario[];
  setState: (s: AppState) => void;
  replaceScenarios: (s: Scenario[]) => void;
  resetState: () => void;
  hydrated: boolean;
  /** Confirm programático (padronizado via AlertDialog). Fallback: window.confirm. */
  confirm?: ConfirmFn;
}

// Hash barato e estável para detectar "dirty" sem deep-equal pesado.
function snapshot(state: AppState, scenarios: Scenario[]): string {
  try { return JSON.stringify({ s: state, sc: scenarios }); } catch { return ""; }
}

export function useFinnanceFile({
  state,
  scenarios,
  setState,
  replaceScenarios,
  resetState,
  hydrated,
  confirm,
}: Args) {
  // Fallback para window.confirm caso o consumidor não injete um confirm customizado.
  const askConfirm: ConfirmFn = useCallback(
    async (opts) => (confirm ? confirm(opts) : window.confirm(opts.description ?? opts.title)),
    [confirm],
  );

  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const lastSavedSnapshot = useRef<string>("");

  // Inicializa o snapshot na primeira hidratação para evitar dirty falso.
  useEffect(() => {
    if (!hydrated) return;
    if (lastSavedSnapshot.current === "") {
      lastSavedSnapshot.current = snapshot(state, scenarios);
    }
  }, [hydrated, state, scenarios]);

  // Marca dirty quando o conteúdo diverge do último salvamento.
  useEffect(() => {
    if (!hydrated) return;
    const cur = snapshot(state, scenarios);
    setDirty(cur !== lastSavedSnapshot.current);
  }, [state, scenarios, hydrated]);

  const save = useCallback(() => {
    const name = currentFileName ?? defaultFilename(state);
    try {
      const payload = serialize(state, scenarios);
      downloadFinnanceFile(payload, name);
      lastSavedSnapshot.current = snapshot(state, scenarios);
      setCurrentFileName(name);
      setDirty(false);
      toast.success(`Arquivo salvo: ${name}`);
    } catch (err) {
      toast.error("Falha ao salvar arquivo", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [state, scenarios, currentFileName]);

  const open = useCallback(async () => {
    if (dirty) {
      const ok = await askConfirm({
        title: "Descartar alterações?",
        description: "Você tem alterações não salvas. Deseja descartá-las e abrir outro arquivo?",
        confirmLabel: "Descartar e abrir",
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      const { state: nextState, scenarios: nextScen, filename } = await pickFinnanceFile();
      setState(nextState);
      replaceScenarios(nextScen);
      setCurrentFileName(filename);
      // Snapshot do novo conteúdo evita marcar dirty logo após abrir.
      lastSavedSnapshot.current = snapshot(nextState, nextScen);
      setDirty(false);
      toast.success(`Arquivo aberto: ${filename}`);
    } catch (err) {
      // Cancelamento do picker não é erro.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Nenhum arquivo")) return;
      toast.error("Não foi possível abrir o arquivo", { description: msg });
    }
  }, [dirty, setState, replaceScenarios, askConfirm]);

  const newFile = useCallback(async () => {
    if (dirty) {
      const ok = await askConfirm({
        title: "Começar um novo arquivo?",
        description: "Você tem alterações não salvas. Deseja descartá-las e começar do zero?",
        confirmLabel: "Descartar e criar novo",
        destructive: true,
      });
      if (!ok) return;
    }
    resetState();
    replaceScenarios([]);
    setCurrentFileName(null);
    // Snapshot só será recalculado no próximo efeito; força reset agora.
    lastSavedSnapshot.current = "";
    setDirty(false);
    toast.success("Novo arquivo criado");
  }, [dirty, resetState, replaceScenarios, askConfirm]);

  // Aviso nativo do navegador ao fechar a aba com alterações pendentes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Atalhos Ctrl/Cmd+S e Ctrl/Cmd+O.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        save();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, open]);

  return { currentFileName, dirty, save, open, newFile };
}
