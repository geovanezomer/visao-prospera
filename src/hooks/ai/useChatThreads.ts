// Hook focado em ciclo de vida de threads e mensagens.
// Responsabilidades: bootstrap por empresa, troca de thread, persistência,
// injeção de briefing inicial e operações CRUD de thread.
// Extraído de useAIChat para isolar persistência local de chat de outras concerns.

import { useEffect, useState } from "react";
import {
  ChatMessage,
  ChatThread,
  createThread,
  deleteThread,
  loadMessages,
  loadThreads,
  saveMessages,
  saveThreads,
} from "@/engines/ai/providers";

export interface UseChatThreadsParams {
  companyName: string;
  /** Retorna markdown do briefing inicial, ou null para não injetar. */
  getBriefingMd: () => string | null;
}

export interface UseChatThreadsReturn {
  threads: ChatThread[];
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  activeId: string;
  setActiveId: React.Dispatch<React.SetStateAction<string>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  handleNewThread: () => void;
  handleDeleteThread: (id: string) => void;
  reloadThreads: () => void;
}

export function useChatThreads({
  companyName,
  getBriefingMd,
}: UseChatThreadsParams): UseChatThreadsReturn {
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads(companyName));
  const [activeId, setActiveId] = useState<string>(() => {
    const ts = loadThreads(companyName);
    return ts[0]?.id ?? "";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Injeta briefing inicial estilo CFO em conversa nova/vazia.
  const injectBriefingIfEmpty = (company: string, threadId: string, currentMsgs: ChatMessage[]) => {
    if (currentMsgs.length > 0) return currentMsgs;
    const md = getBriefingMd();
    if (!md) return currentMsgs;
    const briefingMsg: ChatMessage = { role: "assistant", content: md, ts: Date.now() };
    const next = [briefingMsg];
    saveMessages(company, threadId, next);
    return next;
  };

  // === Bootstrap por empresa ===
  useEffect(() => {
    const ts = loadThreads(companyName);
    if (ts.length === 0) {
      const t = createThread(companyName, "Conversa principal");
      setThreads([t]);
      setActiveId(t.id);
      setMessages(injectBriefingIfEmpty(companyName, t.id, []));
    } else {
      setThreads(ts);
      const cur = ts.find((t) => t.id === activeId) ?? ts[0];
      setActiveId(cur.id);
      const loaded = loadMessages(companyName, cur.id);
      setMessages(injectBriefingIfEmpty(companyName, cur.id, loaded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyName]);

  // === Carrega msgs ao trocar thread ===
  useEffect(() => {
    if (activeId) {
      const loaded = loadMessages(companyName, activeId);
      setMessages(injectBriefingIfEmpty(companyName, activeId, loaded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, companyName]);

  // === Persiste msgs ===
  // Não salva array vazio: no primeiro render o efeito dispara antes do bootstrap
  // carregar as mensagens do storage, e gravar [] apagaria o histórico salvo.
  useEffect(() => {
    if (activeId && messages.length > 0) saveMessages(companyName, activeId, messages);
  }, [messages, companyName, activeId]);

  const handleNewThread = () => {
    const t = createThread(companyName, `Conversa ${threads.length + 1}`);
    const next = [t, ...threads];
    setThreads(next);
    saveThreads(companyName, next);
    setActiveId(t.id);
    setMessages(injectBriefingIfEmpty(companyName, t.id, []));
  };

  const handleDeleteThread = (id: string) => {
    deleteThread(companyName, id);
    const next = threads.filter((t) => t.id !== id);
    setThreads(next);
    if (id === activeId) {
      const fallback = next[0] ?? createThread(companyName, "Conversa principal");
      if (!next.length) {
        setThreads([fallback]);
        saveThreads(companyName, [fallback]);
      }
      setActiveId(fallback.id);
      setMessages(
        injectBriefingIfEmpty(companyName, fallback.id, loadMessages(companyName, fallback.id)),
      );
    }
  };

  const reloadThreads = () => setThreads(loadThreads(companyName));

  return {
    threads,
    setThreads,
    activeId,
    setActiveId,
    messages,
    setMessages,
    handleNewThread,
    handleDeleteThread,
    reloadThreads,
  };
}
