// Hook focado em pipelines multi-estágio: Pipeline 360° (sequencial cfo→controller→auditor)
// e Conselho Virtual (3 especialistas em paralelo + síntese de consenso).
// Extraído de useAIChat para isolar fluxos avançados do Board Mode.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChatMessage,
  touchThread,
  resolveConfigForTask,
  type AIConfig,
} from "@/engines/ai/providers";
import { streamChat } from "@/engines/ai/client";
import { buildLlmMessages } from "@/engines/ai/historyUtils";
import { recordChatTrail } from "@/engines/ai/chatTrail";
import { loadPipeline360, savePipeline360, clearPipeline360 } from "@/engines/ai/pipeline360Store";
import type { AIMode } from "@/engines/ai/systemPrompt";

type Pipeline360Stage = "cfo" | "controller" | "auditor";

export interface Pipeline360State {
  active: boolean;
  current: Pipeline360Stage | null;
  completed: Pipeline360Stage[];
  total: number;
  aborted?: boolean;
  /** Pergunta original — preservada para permitir Reiniciar após cancelar. */
  question?: string;
  /** Outputs já produzidos — passados ao próximo estágio no resume. */
  outputs?: Array<{ stage: Pipeline360Stage; output: string }>;
  /** Roteamento efetivo — usado para exibir badge de modelo no cabeçalho. */
  usedPremium?: boolean;
  usedFallback?: boolean;
  provider?: AIConfig["provider"];
  model?: string;
}

export interface UseChatPipelinesParams {
  companyName: string;
  activeId: string;
  mode: AIMode;
  config: AIConfig;
  streaming: boolean;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  abortRef: React.MutableRefObject<AbortController | null>;
  buildSysPrompt: (overrideMode?: AIMode) => { stable: string; dynamic: string };
  errToMd: (e: unknown) => string;
}

export interface UseChatPipelinesReturn {
  pipeline360: Pipeline360State;
  runPipeline360: (userQuestion?: string) => Promise<void>;
  resumePipeline360: () => Promise<void>;
  resetPipeline360: () => void;
  runConcilio: (userQuestion?: string) => Promise<void>;
}

// Conselho Virtual — 3 especialistas em paralelo.
const CONCILIO_SPECIALISTS: Array<{
  key: AIMode;
  label: string;
  instr: string;
}> = [
  {
    key: "cfo",
    label: "🧭 CFO Estratégico",
    instr:
      "Recomendação direta: 1 tese, 2-3 alavancas com impacto em R$ (EBITDA/FCF/EV). Máx 120 palavras. " +
      "**Obrigatório** encerrar com bloco `**📎 Fontes:**` em bullets curtos: " +
      "(a) tools usadas com o número citado — ex. `get_indicadores → EBITDA R$ 120k`; " +
      "(b) benchmark interno (P25/P50/P75 via `comparar_com_setor`) quando comparar margens/giro; " +
      "(c) fórmulas aplicadas — ex. `Alavanca = ΔEBITDA × múltiplo EV/EBITDA`, `FCF = EBITDA − Capex − ΔNCG − IR`.",
  },
  {
    key: "tributarista",
    label: "📋 Contador Tributarista",
    instr:
      "Avalie a pergunta sob a ótica fiscal: impacto em Fator R, Simples/Presumido/Real, CBS/IBS e riscos de compliance. 2-3 pontos com número. Máx 120 palavras. " +
      "**Obrigatório** encerrar com bloco `**📎 Fontes:**` em bullets: " +
      "(a) tools — ex. `get_regime_tributario`, `get_eras_reforma`, `simular_transicao_reforma`; " +
      "(b) base legal — ex. `LC 123/2006 art. 18` (Fator R), `LC 214/2025` (CBS/IBS), `RFB IN 2.121/22`; " +
      "(c) fórmulas — ex. `Fator R = Folha 12m / RBT12`, `CBS+IBS pleno ≈ 26,5% s/ base ampla`.",
  },
  {
    key: "controller",
    label: "📈 Economista / Valuation",
    instr:
      "Avalie a pergunta sob a ótica de valor: impacto em ROIC vs WACC, EV (R$ e múltiplo) e risco do retorno. Use get_valuation. 2-3 pontos. Máx 120 palavras. " +
      "**Obrigatório** encerrar com bloco `**📎 Fontes:**` em bullets: " +
      "(a) tools — ex. `get_valuation`, `get_wacc`, `get_indicadores`; " +
      "(b) múltiplos de benchmark setorial (P25/P50/P75 EV/EBITDA via `comparar_com_setor`); " +
      "(c) fórmulas — ex. `WACC = wE·Ke + wD·Kd·(1−t)`, `EV = EBITDA × múltiplo`, `Spread = ROIC − WACC`.",
  },
];

export function useChatPipelines(params: UseChatPipelinesParams): UseChatPipelinesReturn {
  const {
    companyName,
    activeId,
    mode,
    config,
    streaming,
    setStreaming,
    messages,
    setMessages,
    input,
    setInput,
    abortRef,
    buildSysPrompt,
    errToMd,
  } = params;

  const [pipeline360, setPipeline360] = useState<Pipeline360State>({
    active: false,
    current: null,
    completed: [],
    total: 3,
  });

  // Restaura pipeline persistido ao trocar de empresa/thread.
  useEffect(() => {
    if (!activeId) return;
    const persisted = loadPipeline360(companyName || "default", activeId);
    if (persisted) {
      setPipeline360({
        active: false,
        current: null,
        completed: persisted.completed,
        total: persisted.total,
        aborted: persisted.aborted,
        question: persisted.question,
        outputs: persisted.outputs,
      });
    } else {
      setPipeline360({ active: false, current: null, completed: [], total: 3 });
    }
  }, [activeId, companyName]);

  // Persiste mudanças relevantes (não persiste `active`/`current`).
  useEffect(() => {
    if (!activeId) return;
    const company = companyName || "default";
    if (pipeline360.completed.length === 0 && !pipeline360.question) {
      clearPipeline360(company, activeId);
      return;
    }
    savePipeline360(company, activeId, {
      completed: pipeline360.completed,
      total: pipeline360.total,
      aborted: pipeline360.aborted,
      question: pipeline360.question,
      outputs: pipeline360.outputs,
    });
  }, [
    activeId,
    companyName,
    pipeline360.completed,
    pipeline360.total,
    pipeline360.aborted,
    pipeline360.question,
    pipeline360.outputs,
  ]);

  // Executa N estágios a partir de `startIdx`, reaproveitando outputs prévios.
  const _runPipelineStages = async (
    q: string,
    startIdx: number,
    seedOutputs: Array<{ stage: Pipeline360Stage; output: string }>,
  ) => {
    if (!activeId) return;
    const { PIPELINE_360, buildStagePrompt, stageHeader } = await import("@/engines/ai/pipeline");
    setStreaming(true);
    touchThread(companyName, activeId);
    const ac = new AbortController();
    abortRef.current = ac;
    const outputs = [...seedOutputs];
    let convo: ChatMessage[] = messages.slice();
    let aborted = false;

    // Roteia o Pipeline 360° para modelo premium quando configurado.
    // Fallback silencioso preserva o comportamento atual.
    const {
      config: routedConfig,
      usedPremium,
      usedFallback,
    } = resolveConfigForTask(config, "pipeline360");

    try {
      for (let i = startIdx; i < PIPELINE_360.length; i++) {
        if (ac.signal.aborted) {
          aborted = true;
          break;
        }
        const stage = PIPELINE_360[i];
        setPipeline360((p) => ({
          ...p,
          current: stage,
          active: true,
          usedPremium,
          usedFallback,
          provider: routedConfig.provider,
          model: routedConfig.model,
        }));
        const stagePrompt = buildStagePrompt(stage, q, outputs);
        const sysPrompt = buildSysPrompt(stage);
        const header = stageHeader(stage, i);

        const llm = buildLlmMessages({
          systemPrompt: sysPrompt,
          history: convo,
          forTools: false,
          lastUserContent: stagePrompt,
        });

        let acc = header;
        convo = [...convo, { role: "assistant", content: acc, ts: Date.now() }];
        setMessages(convo);
        const stageStart = Date.now();
        try {
          for await (const delta of streamChat(routedConfig, llm, ac.signal)) {
            acc += delta;
            setMessages((prev) => {
              const copy = prev.slice();
              copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
              return copy;
            });
          }
          const body = acc.slice(header.length);
          outputs.push({ stage, output: body });
          convo = [...convo.slice(0, -1), { role: "assistant", content: acc, ts: Date.now() }];
          setPipeline360((p) => ({
            ...p,
            completed: [...p.completed, stage],
            current: null,
            outputs: [...outputs],
          }));
          recordChatTrail(companyName || "default", {
            threadId: activeId,
            mode: stage,
            provider: routedConfig.provider,
            model: routedConfig.model,
            userText: `[pipeline360 ${i + 1}/3] ${q}`,
            responseChars: body.length,
            tools: [],
            durationMs: Date.now() - stageStart,
            status: "ok",
          });
        } catch (e: unknown) {
          const stageAborted = ac.signal.aborted;
          aborted = aborted || stageAborted;
          acc += stageAborted ? "\n\n_(⏸ cancelado pelo usuário)_" : "\n\n" + errToMd(e);
          setMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
            return copy;
          });
          recordChatTrail(companyName || "default", {
            threadId: activeId,
            mode: stage,
            provider: routedConfig.provider,
            model: routedConfig.model,
            userText: `[pipeline360 ${i + 1}/3] ${q}`,
            responseChars: acc.length - header.length,
            tools: [],
            durationMs: Date.now() - stageStart,
            status: stageAborted ? "abortado" : "erro",
            errorMsg: e instanceof Error ? e.message : String(e),
          });
          break;
        }
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setPipeline360((p) => ({
        ...p,
        active: false,
        current: null,
        aborted,
        question: q,
        outputs: [...outputs],
      }));
    }
  };

  const runPipeline360 = async (userQuestion?: string) => {
    if (streaming || !activeId) return;
    if (mode !== "board") {
      toast.error("Análise 360° disponível apenas no Modo Conselho (Board).");
      return;
    }
    const q = (userQuestion ?? input).trim() || "Análise 360° para decisão de conselho.";
    const userMsg: ChatMessage = {
      role: "user",
      content: `🎯 **Análise 360° (pipeline cfo → controller → auditor)**\n\n${q}`,
      ts: Date.now(),
    };
    setMessages([...messages, userMsg]);
    setInput("");
    setPipeline360({
      active: true,
      current: null,
      completed: [],
      total: 3,
      question: q,
      outputs: [],
    });
    await Promise.resolve();
    await _runPipelineStages(q, 0, []);
  };

  const resumePipeline360 = async () => {
    if (streaming || !activeId) return;
    const startIdx = pipeline360.completed.length;
    if (startIdx >= pipeline360.total) {
      toast.info("Pipeline já concluído.");
      return;
    }
    if (!pipeline360.question) {
      toast.error("Sem pipeline anterior para retomar.");
      return;
    }
    setPipeline360((p) => ({ ...p, active: true, aborted: false, current: null }));
    await _runPipelineStages(pipeline360.question, startIdx, pipeline360.outputs ?? []);
  };

  const resetPipeline360 = () => {
    if (streaming) {
      toast.error("Cancele o pipeline em execução antes de limpar.");
      return;
    }
    clearPipeline360(companyName || "default", activeId);
    setPipeline360({ active: false, current: null, completed: [], total: 3 });
    toast.success("Pipeline 360° reiniciado.");
  };

  const runConcilio = async (userQuestion?: string) => {
    if (streaming || !activeId) return;
    if (mode !== "board") {
      toast.error("Conselho Virtual disponível apenas no Modo Conselho (Board).");
      return;
    }
    const q = (userQuestion ?? input).trim();
    if (!q) {
      toast.error("Digite a pergunta que o conselho deve debater.");
      return;
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: `🏛️ **Conselho Virtual (3 especialistas em paralelo)**\n\n${q}`,
      ts: Date.now(),
    };
    const placeholders: ChatMessage[] = CONCILIO_SPECIALISTS.map((s, i) => ({
      role: "assistant" as const,
      content: `### ${s.label}\n\n_aguardando…_`,
      ts: Date.now() + i + 1,
    }));
    const baseHistory = [...messages, userMsg];
    setMessages([...baseHistory, ...placeholders]);
    setInput("");
    setStreaming(true);
    touchThread(companyName, activeId);
    const ac = new AbortController();
    abortRef.current = ac;

    const updateByTs = (ts: number, content: string) =>
      setMessages((prev) => prev.map((m) => (m.ts === ts ? { ...m, content } : m)));

    const outputs: Array<{ label: string; text: string }> = [];
    await Promise.all(
      CONCILIO_SPECIALISTS.map(async (spec, i) => {
        const ts = placeholders[i].ts;
        const sysPrompt = buildSysPrompt(spec.key);
        const userPrompt = `[Conselho Virtual · voz ${i + 1}/3 — ${spec.label}]\nPergunta do conselho: ${q}\n\nResponda no seu papel. ${spec.instr}`;
        const llm = buildLlmMessages({
          systemPrompt: sysPrompt,
          history: baseHistory,
          forTools: false,
          lastUserContent: userPrompt,
        });
        let acc = `### ${spec.label}\n\n`;
        updateByTs(ts, acc);
        try {
          for await (const delta of streamChat(config, llm, ac.signal)) {
            acc += delta;
            updateByTs(ts, acc);
          }
          outputs.push({ label: spec.label, text: acc.slice(`### ${spec.label}\n\n`.length) });
        } catch (e) {
          const ab = ac.signal.aborted;
          acc += ab ? "\n\n_(⏸ cancelado)_" : "\n\n" + errToMd(e);
          updateByTs(ts, acc);
        }
      }),
    );

    // Síntese de consenso/divergência.
    if (!ac.signal.aborted && outputs.length === CONCILIO_SPECIALISTS.length) {
      const synthTs = Date.now() + 999;
      const synthPlaceholder: ChatMessage = {
        role: "assistant",
        content: "### 🧩 Síntese do Conselho\n\n_consolidando…_",
        ts: synthTs,
      };
      setMessages((prev) => [...prev, synthPlaceholder]);
      const synthPrompt = `Você é o secretário do conselho. As 3 vozes responderam à pergunta: "${q}".\n\n${outputs
        .map((o) => `## ${o.label}\n${o.text}`)
        .join(
          "\n\n",
        )}\n\nProduza em **máx. 180 palavras**:\n1. **Consenso** — onde os 3 concordam (1-2 bullets).\n2. **Divergência** — onde discordam (1-2 bullets, dizendo qual voz defende cada lado).\n3. **Recomendação final** — placar (ex.: "2 de 3 recomendam X") + decisão executiva sugerida com 1 número de impacto.\n4. **📎 Trilha de auditoria** — consolide as fontes citadas pelas 3 vozes em um bloco único, agrupado por tipo: **Tools** (lista deduplicada com o número/output principal), **Benchmark** (P25/P50/P75 citados), **Base legal** (artigos/LCs), **Fórmulas** (expressões usadas). Cite a voz responsável entre parênteses quando houver divergência de número.`;
      let acc = "### 🧩 Síntese do Conselho\n\n";
      updateByTs(synthTs, acc);
      try {
        const llm = buildLlmMessages({
          systemPrompt: buildSysPrompt("chat"),
          history: baseHistory,
          forTools: false,
          lastUserContent: synthPrompt,
        });
        for await (const delta of streamChat(config, llm, ac.signal)) {
          acc += delta;
          updateByTs(synthTs, acc);
        }
      } catch (e) {
        acc += "\n\n" + errToMd(e);
        updateByTs(synthTs, acc);
      }
    }

    setStreaming(false);
    abortRef.current = null;
  };

  return {
    pipeline360,
    runPipeline360,
    resumePipeline360,
    resetPipeline360,
    runConcilio,
  };
}
