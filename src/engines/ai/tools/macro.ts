// Tools macro: snapshot e séries históricas do BCB.

import {
  getMacroSnapshot,
  getSerieFormatted,
  MACRO_SERIES_KEYS,
  type SerieKey,
} from "@/engines/macro/bcb";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const defs: ToolDef[] = [
  {
    name: "get_macro",
    description:
      "Retorna os principais indicadores macro atuais (Selic, CDI, IPCA, IGP-M, câmbio) via API do Banco Central.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_serie_macro",
    description: "Retorna histórico de uma série macro do BCB.",
    parameters: {
      type: "object",
      properties: {
        serie: { type: "string", enum: MACRO_SERIES_KEYS as readonly string[] as string[] },
        ultimos: { type: "number", description: "Quantos pontos (padrão 12)." },
      },
      required: ["serie"],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  get_macro: () => getMacroSnapshot(),
  get_serie_macro: (args) => {
    const k = args?.serie as SerieKey;
    const n = Number(args?.ultimos) || 12;
    if (!k) return "Parâmetro 'serie' obrigatório.";
    return getSerieFormatted(k, n);
  },
};

export const macroTools: ToolModule = {
  category: "macro",
  description: "Indicadores macroeconômicos (BCB, Selic, IPCA)",
  defs,
  handlers,
};
