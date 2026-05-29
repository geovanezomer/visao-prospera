/// <reference lib="webworker" />
import type { AppState } from "@/lib/finance/types";
import type { MCConfig } from "@/lib/finance/montecarlo";
import { runMonteCarlo } from "@/lib/finance/montecarlo";

self.onmessage = (e: MessageEvent<{ state: AppState; cfg: MCConfig }>) => {
  try {
    const result = runMonteCarlo(e.data.state, e.data.cfg);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
