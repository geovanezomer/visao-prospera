// Coleta/aplica dados auxiliares persistidos em localStorage que NÃO fazem
// parte do AppState mas pertencem ao "dossiê" da empresa:
//  - Cenários do simulador (services/scenarios/store)
//  - Plano de ação rastreável (services/actions/store)
//  - Memórias do consultor (services/memory/store)
//
// Todos escopados por `companyName`. Para garantir que outro consultor abra
// o .finnance e veja exatamente o mesmo dossiê, replicamos o conteúdo no
// localStorage local sob a chave da empresa do arquivo aberto.
import type { ScenarioRecord } from "@/engines/scenarios/store";
import type { ActionItem } from "@/engines/actions/store";
import type { MemoryItem } from "@/engines/memory/store";
import { saveKeySync } from "@/engines/finance/persistence";

const ACTIONS_KEY = (company: string) => `gz-finance-actions-${company || "default"}`;
const SIMSCEN_KEY = (company: string) => `gz-finance-scenarios-${company || "default"}`;
const MEMORY_KEY = (company: string) => `gz-finance-memory-${company || "default"}`;

export interface FileExtras {
  actions: ActionItem[];
  simScenarios: ScenarioRecord[];
  memories: MemoryItem[];
}

export function collectExtras(company: string): FileExtras {
  const safe = <T>(key: string): T[] => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  };
  return {
    actions: safe<ActionItem>(ACTIONS_KEY(company)),
    simScenarios: safe<ScenarioRecord>(SIMSCEN_KEY(company)),
    memories: safe<MemoryItem>(MEMORY_KEY(company)),
  };
}

export function applyExtras(company: string, extras: Partial<FileExtras> | undefined) {
  if (!extras) return;
  try {
    if (Array.isArray(extras.actions)) {
      saveKeySync(ACTIONS_KEY(company), extras.actions);
    }
    if (Array.isArray(extras.simScenarios)) {
      saveKeySync(SIMSCEN_KEY(company), extras.simScenarios);
    }
    if (Array.isArray(extras.memories)) {
      saveKeySync(MEMORY_KEY(company), extras.memories);
    }
  } catch {
    // localStorage indisponível (modo privado/cota) — silencioso.
  }
}
