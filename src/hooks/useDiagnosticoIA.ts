// =====================================================================
// Hook para o Diagnóstico Executivo da IA.
//
// PR2: lê AIConfig, gera, valida, exibe.
// PR3: adiciona cache persistente (localStorage) + telemetria local.
//
// - `enabled = false` → componente deve OCULTAR o card.
// - Cache em memória + cache persistente (7 dias) por
//   briefingHash + promptVersion + provider + model.
// - `regenerate()` força refetch ignorando ambos os caches.
// - Toda geração (ok, cache, erro) é registrada em telemetria local.
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { loadConfig, AI_CONFIG_CHANGED_EVENT, type AIConfig } from "@/engines/ai/providers";
import { gerarDiagnostico, isAIConfigured, type DiagnosticoResult } from "@/engines/ai/diagnostico";
import { PROMPT_VERSION } from "@/engines/ai/diagnosticoPrompt";
import type { Briefing } from "@/engines/finance/briefing";
import { briefingCacheKey } from "@/engines/finance/briefing";
import { getCached, setCached } from "@/engines/ai/diagnosticoCache";
import { recordTelemetry } from "@/engines/ai/diagnosticoTelemetry";

/** Cache em memória (sessão) — evita relê localStorage a cada render. */
const memCache = new Map<string, DiagnosticoResult>();

function cacheKey(briefing: Briefing, cfg: AIConfig): string {
  return `${PROMPT_VERSION}::${cfg.provider}::${cfg.model}::${briefingCacheKey(briefing)}`;
}

export interface UseDiagnosticoIA {
  /** Quando false, o componente deve ficar OCULTO (IA não configurada). */
  enabled: boolean;
  data: DiagnosticoResult | null;
  loading: boolean;
  error: string | null;
  /** True quando o `data` veio do cache (memória ou localStorage). */
  cached: boolean;
  /** Força nova geração ignorando cache. */
  regenerate: () => void;
}

export function useDiagnosticoIA(briefing: Briefing | null): UseDiagnosticoIA {
  const [cfg, setCfg] = useState<AIConfig>(() => loadConfig());
  const [data, setData] = useState<DiagnosticoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setIsFromCache] = useState(false);
  const [nonce, setNonce] = useState(0); // bump → força refetch

  // Reage a mudanças de config: storage (outras abas) + custom event (mesma aba).
  useEffect(() => {
    const onChange = () => setCfg(loadConfig());
    window.addEventListener("storage", onChange);
    window.addEventListener(AI_CONFIG_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(AI_CONFIG_CHANGED_EVENT, onChange);
    };
  }, []);

  const enabled = isAIConfigured(cfg);

  useEffect(() => {
    if (!enabled || !briefing) {
      setData(null);
      setError(null);
      setLoading(false);
      setIsFromCache(false);
      return;
    }

    const key = cacheKey(briefing, cfg);
    const bhash = briefingCacheKey(briefing);

    // 1) Cache em memória
    if (nonce === 0) {
      const mem = memCache.get(key);
      if (mem) {
        setData(mem);
        setError(null);
        setLoading(false);
        setIsFromCache(true);
        return;
      }
      // 2) Cache persistente (localStorage)
      const persisted = getCached(key);
      if (persisted) {
        memCache.set(key, persisted);
        setData(persisted);
        setError(null);
        setLoading(false);
        setIsFromCache(true);
        recordTelemetry({
          ts: new Date().toISOString(),
          provider: cfg.provider,
          model: cfg.model,
          promptVersion: PROMPT_VERSION,
          briefingHash: bhash,
          durationMs: 0,
          status: "cache",
        });
        return;
      }
    }

    const ac = new AbortController();
    let cancelled = false;
    const t0 = performance.now();
    setLoading(true);
    setError(null);
    setIsFromCache(false);

    gerarDiagnostico(briefing, cfg, ac.signal)
      .then((result) => {
        if (cancelled) return;
        memCache.set(key, result);
        setCached(key, result);
        setData(result);
        recordTelemetry({
          ts: new Date().toISOString(),
          provider: cfg.provider,
          model: cfg.model,
          promptVersion: PROMPT_VERSION,
          briefingHash: bhash,
          durationMs: Math.round(performance.now() - t0),
          status: "ok",
          outputChars: JSON.stringify(result.data).length,
        });
      })
      .catch((e: unknown) => {
        if (cancelled || ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setData(null);
        recordTelemetry({
          ts: new Date().toISOString(),
          provider: cfg.provider,
          model: cfg.model,
          promptVersion: PROMPT_VERSION,
          briefingHash: bhash,
          durationMs: Math.round(performance.now() - t0),
          status: "erro",
          errorMsg: msg,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, briefing && cacheKey(briefing, cfg), nonce]);

  const regenerate = useCallback(() => {
    if (briefing) memCache.delete(cacheKey(briefing, cfg));
    setNonce((n) => n + 1);
  }, [briefing, cfg]);

  return { enabled, data, loading, error, cached, regenerate };
}
