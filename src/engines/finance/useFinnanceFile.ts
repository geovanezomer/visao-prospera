// Hook orquestrador do ciclo de vida do arquivo .finnance.
// Inspirado no Excalidraw: autosave em localStorage + arquivo físico para portabilidade.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppState, Scenario } from "./types";
import { defaultFilename, serialize } from "./fileFormat";
import { downloadFinnanceFile, pickFinnanceFile } from "./fileIO";
import { collectExtras, applyExtras } from "./fileExtras";
import { loadKey, saveKeySync, removeKey } from "./persistence";
import { uploadBackup, isBackupEnabled, type BackupStatus } from "@/lib/api/cloudBackup";

interface ConfirmFn {
  (opts: {
    title: string;
    description?: string;
    confirmLabel?: string;
    destructive?: boolean;
  }): Promise<boolean>;
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
  /** ID do usuário autenticado — habilita backup silencioso na nuvem (banco do servidor). */
  userId?: string;
  /** Callback opcional notificado a cada transição de status do backup em nuvem. */
  onBackupStatus?: (status: BackupStatus) => void;
}

// Hash barato e estável para detectar "dirty" sem deep-equal pesado.
function snapshot(state: AppState, scenarios: Scenario[]): string {
  try {
    return JSON.stringify({ s: state, sc: scenarios });
  } catch {
    return "";
  }
}

// Chave do draft por empresa (auto-save de recuperação F5).
const draftKey = (company: string, userId?: string) =>
  `finnance:draft:${userId ?? "guest"}:${(company || "sem-empresa").trim().toLowerCase()}`;

interface DraftEnvelope {
  ts: number;
  state: AppState;
  scenarios: Scenario[];
}

export function useFinnanceFile({
  state,
  scenarios,
  setState,
  replaceScenarios,
  resetState,
  hydrated,
  confirm,
  userId,
  onBackupStatus,
}: Args) {
  // Fallback para window.confirm caso o consumidor não injete um confirm customizado.
  const askConfirm: ConfirmFn = useCallback(
    async (opts) => (confirm ? confirm(opts) : window.confirm(opts.description ?? opts.title)),
    [confirm],
  );

  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastModified, setLastModified] = useState<number | null>(null);
  const lastSavedSnapshot = useRef<string | null>(null);
  const recoveryChecked = useRef(false);
  // Debounce do upload em nuvem: agrupa Ctrl+S repetidos em um único PUT.
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBackup = useRef<{ filename: string; blob: Blob } | null>(null);
  const backupSeq = useRef(0);

  // Inicializa o snapshot na primeira hidratação para evitar dirty falso.
  useEffect(() => {
    if (!hydrated) return;
    if (lastSavedSnapshot.current === null) {
      lastSavedSnapshot.current = snapshot(state, scenarios);
    }
  }, [hydrated, state, scenarios]);

  // Marca dirty + última modificação quando o conteúdo diverge do último salvamento.
  useEffect(() => {
    if (!hydrated) return;
    const cur = snapshot(state, scenarios);
    const isDirty = cur !== lastSavedSnapshot.current;
    setDirty(isDirty);
    if (isDirty) setLastModified(Date.now());
  }, [state, scenarios, hydrated]);

  // Auto-save de rascunho por empresa (debounced 800ms). Permite recuperar
  // alterações após F5 ou crash sem precisar salvar arquivo físico.
  useEffect(() => {
    if (!hydrated || !dirty) return;
    const t = setTimeout(() => {
      try {
        const env: DraftEnvelope = { ts: Date.now(), state, scenarios };
        saveKeySync(draftKey(state.companyName, userId), env);
      } catch {
        /* quota / privacy mode — ignora */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [state, scenarios, hydrated, dirty, userId]);

  // Recuperação de rascunho na primeira hidratação. Se houver draft mais
  // recente que o estado atual para a mesma empresa, oferece recuperar.
  useEffect(() => {
    if (!hydrated || recoveryChecked.current) return;
    recoveryChecked.current = true;
    // Usa loadKey (IDB → LS) em vez de localStorage.getItem direto: se o
    // autosave anterior estourou a quota do LS, o draft fica SÓ no IDB.
    // Ler apenas LS perderia silenciosamente esses rascunhos.
    (async () => {
      try {
        const env = await loadKey<DraftEnvelope>(draftKey(state.companyName, userId));
        if (!env) return;
        const currentSnap = snapshot(state, scenarios);
        const draftSnap = snapshot(env.state, env.scenarios ?? []);
        if (draftSnap === currentSnap) return;
        toast.info("Rascunho não salvo encontrado", {
          description: `Alterações de ${new Date(env.ts).toLocaleString("pt-BR")} na empresa "${env.state.companyName}".`,
          duration: 15000,
          action: {
            label: "Recuperar",
            onClick: () => {
              setState(env.state);
              replaceScenarios(env.scenarios ?? []);
              toast.success("Rascunho recuperado");
            },
          },
        });
      } catch {
        /* draft corrompido — ignora */
      }
    })();
  }, [hydrated, state, scenarios, setState, replaceScenarios, userId]);

  // Constrói o payload + nome canônico do arquivo atual.
  const buildPayload = useCallback(() => {
    const name = defaultFilename(state);
    const extras = collectExtras(state.companyName);
    const payload = serialize(state, scenarios, extras);
    return { name, payload };
  }, [state, scenarios]);

  // Marca o estado atual como "salvo" e limpa o draft de recuperação.
  const markSaved = useCallback(
    (name: string) => {
      lastSavedSnapshot.current = snapshot(state, scenarios);
      setCurrentFileName(name);
      setDirty(false);
      setLastModified(Date.now());
      try {
        removeKey(draftKey(state.companyName, userId));
      } catch {
        /* ignora */
      }
    },
    [state, scenarios, userId],
  );

  // Salva APENAS no computador (download local).
  const saveToDisk = useCallback(() => {
    try {
      const { name, payload } = buildPayload();
      downloadFinnanceFile(payload, name);
      markSaved(name);
      toast.success(`Arquivo salvo: ${name}`);
    } catch (err) {
      toast.error("Falha ao salvar arquivo", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [buildPayload, markSaved]);

  // Faz upload imediato (sem debounce) na nuvem.
  // Retorna Promise para o caller poder aguardar feedback.
  const saveToCloud = useCallback(async (): Promise<void> => {
    if (!userId) {
      toast.error("Faça login para salvar na nuvem");
      return;
    }
    if (!isBackupEnabled()) {
      toast.error("Backup em nuvem está desativado");
      return;
    }
    try {
      const { name, payload } = buildPayload();
      const filename = name.endsWith(".finnance") ? name : `${name}.finnance`;
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      onBackupStatus?.("syncing");
      await uploadBackup(userId, filename, blob);
      onBackupStatus?.("synced");
      toast.success("Backup salvo na nuvem");
    } catch (err) {
      onBackupStatus?.("error");
      toast.error("Falha ao salvar na nuvem", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [userId, buildPayload, onBackupStatus]);

  // Save "tudo" (compat retro do Ctrl+S): grava no disco + dispara backup
  // silencioso debounced na nuvem — preserva UX original.
  const save = useCallback(() => {
    try {
      const { name, payload } = buildPayload();
      downloadFinnanceFile(payload, name);
      markSaved(name);
      toast.success(`Arquivo salvo: ${name}`);

      if (userId && isBackupEnabled()) {
        const filename = name.endsWith(".finnance") ? name : `${name}.finnance`;
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        pendingBackup.current = { filename, blob };
        onBackupStatus?.("syncing");
        if (backupTimer.current) clearTimeout(backupTimer.current);
        backupTimer.current = setTimeout(() => {
          const job = pendingBackup.current;
          pendingBackup.current = null;
          backupTimer.current = null;
          if (!job) return;
          const mySeq = ++backupSeq.current;
          uploadBackup(userId, job.filename, job.blob)
            .then(() => {
              if (mySeq === backupSeq.current) onBackupStatus?.("synced");
            })
            .catch((err) => {
              console.warn("[FinnancePRO] Backup falhou:", err);
              if (mySeq === backupSeq.current) onBackupStatus?.("error");
            });
        }, 1500);
      }
    } catch (err) {
      toast.error("Falha ao salvar arquivo", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [buildPayload, markSaved, userId, onBackupStatus]);

  // Limpa timer de backup pendente no unmount para evitar uploads órfãos
  // após o hook desmontar (navegação, logout, hot reload).
  useEffect(() => {
    return () => {
      if (backupTimer.current) {
        clearTimeout(backupTimer.current);
        backupTimer.current = null;
      }
      pendingBackup.current = null;
    };
  }, []);

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
      const {
        state: nextState,
        scenarios: nextScen,
        extras,
        filename,
        originalVersion,
        currentVersion,
        migrated,
      } = await pickFinnanceFile();
      setState(nextState);
      replaceScenarios(nextScen);
      // Replica os extras no localStorage sob a empresa do arquivo aberto,
      // garantindo que ações e cenários do simulador apareçam no novo PC.
      applyExtras(nextState.companyName, {
        actions: (extras.actions ?? []) as never,
        simScenarios: (extras.simScenarios ?? []) as never,
        memories: (extras.memories ?? []) as never,
      });
      setCurrentFileName(filename);
      // Snapshot do novo conteúdo evita marcar dirty logo após abrir.
      lastSavedSnapshot.current = snapshot(nextState, nextScen);
      setDirty(false);
      setLastModified(Date.now());
      if (migrated) {
        // Avisa o usuário que o arquivo foi migrado para o schema corrente.
        // Salvar agora regrava no formato novo (e mantém o original intacto até lá).
        toast.info(`Arquivo migrado de v${originalVersion} → v${currentVersion}`, {
          description: `"${filename}" foi atualizado para o formato atual do FinnancePRO. Salve para regravar no novo formato.`,
          duration: 10000,
        });
      } else {
        toast.success(`Arquivo aberto: ${filename}`);
      }
    } catch (err) {
      // Cancelamento do picker não é erro.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Nenhum arquivo")) return;
      toast.error("Não foi possível abrir o arquivo", { description: msg });
    }
  }, [dirty, setState, replaceScenarios, askConfirm]);

  // (removido: newFile — botão "Novo" foi descontinuado da UI;
  // o fluxo padrão é "Abrir" outro arquivo ou usar Reset.)

  const resetWithConfirm = useCallback(async () => {
    const ok = await askConfirm({
      title: "Restaurar dados?",
      description: "Isso resetará todos os valores atuais para o padrão.",
      confirmLabel: "Restaurar",
      destructive: true,
    });
    if (!ok) return;
    resetState();
  }, [askConfirm, resetState]);

  // [removido] Antes mostrávamos o aviso nativo `beforeunload` quando `dirty=true`,
  // mas o AppState já é persistido automaticamente em localStorage — o "dirty"
  // aqui refere-se apenas à exportação do arquivo .finance.json (snapshot manual),
  // o que tornava o popup "É possível que as alterações não sejam salvas" falso
  // e intrusivo a cada F5. Removido em favor da UX (zero risco de perda real).

  // Atalhos: Ctrl/Cmd+S salvar, Ctrl/Cmd+O abrir, Ctrl/Cmd+Shift+R reset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        save();
      } else if (k === "o") {
        e.preventDefault();
        void open();
      } else if (k === "r" && e.shiftKey) {
        e.preventDefault();
        void resetWithConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, open, resetWithConfirm]);

  // Indicador "arquivo sujo" no título da aba do navegador.
  // Sem cleanup por mudança de deps — evita flicker durante digitação.
  // Reset do título só ocorre no unmount real do hook.
  useEffect(() => {
    const base = "FinnancePRO — Diagnóstico & Simulação Empresarial";
    const company = state.companyName?.trim();
    const prefix = dirty ? "● " : "";
    document.title = `${prefix}${company ? `${company} · ` : ""}${base}`;
  }, [dirty, state.companyName]);

  useEffect(() => {
    return () => {
      document.title = "FinnancePRO — Diagnóstico & Simulação Empresarial";
    };
  }, []);

  return {
    currentFileName,
    dirty,
    lastModified,
    save,
    saveToDisk,
    saveToCloud,
    open,
    resetWithConfirm,
  };
}
