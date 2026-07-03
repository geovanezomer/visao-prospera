// Registro central das fixtures — acessadas por id string.
import type { AppState } from "@/engines/finance/types";
import { fixtureDividaCritica } from "./divida-critica";
import { fixtureCaixaApertado } from "./caixa-apertado";
import { fixtureSaudavel } from "./saudavel";
import { fixtureSimplesEstourado } from "./simples-estourado";
import { fixtureMargemBaixa } from "./margem-baixa";
import { fixtureServicosFatorR } from "./servicos-fator-r";

export const FIXTURES: Record<string, AppState> = {
  "divida-critica": fixtureDividaCritica,
  "caixa-apertado": fixtureCaixaApertado,
  saudavel: fixtureSaudavel,
  "simples-estourado": fixtureSimplesEstourado,
  "margem-baixa": fixtureMargemBaixa,
  "servicos-fator-r": fixtureServicosFatorR,
};

export type FixtureId = keyof typeof FIXTURES;
