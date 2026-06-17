// =====================================================================
// Hook para o Diagnóstico Executivo da IA.
//
// - Lê AIConfig do localStorage (mesma do chat — fonte única).
// - `enabled = false` → componente deve OCULTAR o card.
// - Cache por briefingCacheKey + promptVersion: mesmo cenário não regera.
// - `regenerate()` força refetch ignorando cache (botão "Regerar").
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { loadConfig, type AIConfig } from "@/engines/ai/providers";
import {
  gerarDiagnostico,
  isAIConfigured,
  type DiagnosticoResult,
} from "@/engines/ai/diagnostico";
import { PROMPT_VERSION } from "@/engines/ai/diagnosticoPrompt";
import type { Briefing } from "@/engines/finance/briefing";
import { briefingCacheKey } from "@/engines/finance/briefing";

/** Cache em memória — chave inclui modelo + prompt version pra evitar reuso indevido. */
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
  /** Força nova geração ignorando cache. */
  regenerate: () => void;
}

export function useDiagnosticoIA(briefing: Briefing | null): UseDiagnosticoIA {
  // Re-lê config a cada mount (pega edição feita no AIConfigDialog).
  const [cfg, setCfg] = useState<AIConfig>(() => loadConfig());
  const [data, setData] = useState<DiagnosticoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump → força refetch

  // Permite que o card reaja se o usuário abrir o dialog e mudar a config.
  useEffect(() => {
    const onStorage = () => setCfg(loadConfig());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const enabled = isAIConfigured(cfg);

  useEffect(() => {
    if (!enabled || !briefing) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const key = cacheKey(briefing, cfg);

    // Hit de cache (ignorado quando regenerate forçou nonce > 0 sem novo key).
    if (nonce === 0) {
      const cached = memCache.get(key);
      if (cached) {
        setData(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }

    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    gerarDiagnostico(briefing, cfg, ac.signal)
      .then((result) => {
        if (cancelled) return;
        memCache.set(key, result);
        setData(result);
      })
      .catch((e: unknown) => {
        if (cancelled || ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setData(null);
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

  return { enabled, data, loading, error, regenerate };
}
