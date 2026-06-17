// Coleta/aplica dados auxiliares persistidos em localStorage que NÃO fazem
// parte do AppState mas pertencem ao "dossiê" da empresa:
//  - Cenários do simulador (services/scenarios/store)
//  - Plano de ação rastreável (services/actions/store)
//
// Ambos são escopados por `companyName`. Para garantir que outro consultor
// abra o .finnance e veja exatamente o mesmo dossiê, replicamos o conteúdo
// no localStorage local sob a chave da empresa do arquivo aberto.
import type { ScenarioRecord } from "@/services/scenarios/store";
import type { ActionItem } from "@/services/actions/store";

const ACTIONS_KEY = (company: string) => `gz-finance-actions-${company || "default"}`;
const SIMSCEN_KEY = (company: string) => `gz-finance-scenarios-${company || "default"}`;

export interface FileExtras {
  actions: ActionItem[];
  simScenarios: ScenarioRecord[];
}

export function collectExtras(company: string): FileExtras {
  const safe = <T,>(key: string): T[] => {
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
  };
}

export function applyExtras(company: string, extras: FileExtras | undefined) {
  if (!extras) return;
  try {
    if (Array.isArray(extras.actions)) {
      localStorage.setItem(ACTIONS_KEY(company), JSON.stringify(extras.actions));
    }
    if (Array.isArray(extras.simScenarios)) {
      localStorage.setItem(SIMSCEN_KEY(company), JSON.stringify(extras.simScenarios));
    }
  } catch {
    // localStorage indisponível (modo privado/cota) — silencioso.
  }
}
