// =====================================================================
// Golden Set — casos de avaliação da IA.
//
// Cada caso combina uma fixture (empresa), uma pergunta, o modo AI
// e as expectativas de comportamento:
//   - toolsEsperadas: tools que deveriam ser invocadas (nivel A e B)
//   - numChavePayload: números/labels que precisam aparecer no
//     payload das tools quando executadas contra a fixture (nivel A)
//   - deveConter: substrings obrigatórios na resposta do LLM (nivel B)
//   - naoPodeConter: proibições semânticas na resposta do LLM (nivel B)
// =====================================================================

import type { AIMode } from "@/engines/ai/systemPrompt";
import type { FixtureId } from "./fixtures";

export interface EvalCase {
  id: string;
  fixture: FixtureId;
  pergunta: string;
  mode: AIMode;
  /** Substrings esperados na resposta do LLM (nivel B). */
  deveConter: RegExp[];
  /** Proibições semânticas (nivel B). */
  naoPodeConter: RegExp[];
  /** Tools que devem ser chamadas — 1 é suficiente (OR). */
  toolsEsperadas: string[];
  /** Padrões esperados nos payloads combinados das tools (nivel A). */
  numChavePayload?: RegExp[];
}

export const GOLDEN_SET: EvalCase[] = [
  // -------- divida-critica --------
  {
    id: "divida-critica/emprestimo-giro",
    fixture: "divida-critica",
    pergunta: "Devo pegar um empréstimo para capital de giro?",
    mode: "cfo",
    deveConter: [/DSCR/i, /renegoci|alongar|reperfil/i],
    naoPodeConter: [/recomendo\s+(contratar|pegar|tomar)\s+(o|um)?\s*empr[eé]stimo/i],
    toolsEsperadas: ["get_indicadores", "get_contratos_divida"],
    numChavePayload: [/DSCR/i],
  },
  {
    id: "divida-critica/estado-geral",
    fixture: "divida-critica",
    pergunta: "Qual o estado financeiro da empresa hoje?",
    mode: "chat",
    deveConter: [/dívida|endividamento/i, /DSCR|cobertura/i],
    naoPodeConter: [/saud[aá]vel|sob controle/i],
    toolsEsperadas: ["get_resumo_executivo", "get_indicadores"],
    numChavePayload: [/DSCR|Endivid/i],
  },
  {
    id: "divida-critica/renegociar",
    fixture: "divida-critica",
    pergunta: "Que ação prática eu tomo primeiro?",
    mode: "cfo",
    deveConter: [/renegoci|carência|prazo/i],
    naoPodeConter: [/expandir|contratar nova/i],
    toolsEsperadas: ["get_contratos_divida", "analisar_covenants", "get_prescritivo"],
    numChavePayload: [/dívida|contrato|amortiz/i],
  },

  // -------- caixa-apertado --------
  {
    id: "caixa-apertado/quebrar",
    fixture: "caixa-apertado",
    pergunta: "Vou quebrar nos próximos meses?",
    mode: "cfo",
    deveConter: [/caixa|fluxo/i, /NCG|ciclo|PMR/i],
    naoPodeConter: [/tranquilo|sem risco/i],
    toolsEsperadas: ["get_fluxo_caixa", "get_indicadores", "projetar_fluxo_caixa"],
    numChavePayload: [/PMR|PMP|caixa|fluxo/i],
  },
  {
    id: "caixa-apertado/pmr",
    fixture: "caixa-apertado",
    pergunta: "Como reduzir a necessidade de capital de giro?",
    mode: "cfo",
    deveConter: [/PMR|prazo m[eé]dio|recebimento/i, /PMP|fornecedor/i],
    naoPodeConter: [],
    toolsEsperadas: ["get_indicadores", "simular_alavanca"],
    numChavePayload: [/PMR|NCG|ciclo/i],
  },

  // -------- saudavel --------
  {
    id: "saudavel/como-esta",
    fixture: "saudavel",
    pergunta: "Como está minha empresa?",
    mode: "chat",
    deveConter: [/saud[aá]vel|s[oó]lida|indicadores? (verde|positivo)/i],
    naoPodeConter: [/cr[ií]tico|urgente|risco de insolv[eê]ncia|quebra iminente/i],
    toolsEsperadas: ["get_resumo_executivo", "get_indicadores"],
    numChavePayload: [/DSCR|Liquidez|Margem/i],
  },
  {
    id: "saudavel/expandir",
    fixture: "saudavel",
    pergunta: "Posso pensar em expansão?",
    mode: "cfo",
    deveConter: [/expans|crescimento|invest/i],
    naoPodeConter: [/n[aã]o (pense|considere) expandir|quebra/i],
    toolsEsperadas: ["get_indicadores", "get_valuation", "simular_alavanca"],
    numChavePayload: [/EBITDA|caixa|liquidez/i],
  },

  // -------- simples-estourado --------
  {
    id: "simples-estourado/regime-ideal",
    fixture: "simples-estourado",
    pergunta: "Qual meu regime tributário ideal?",
    mode: "tributarista",
    deveConter: [/desenquadr|limite do Simples|Presumido/i],
    naoPodeConter: [/mantenha o Simples/i],
    toolsEsperadas: ["simular_regime_tributario", "diagnostico_tributario"],
    numChavePayload: [/Simples|Presumido|RBT12|limite/i],
  },
  {
    id: "simples-estourado/limite",
    fixture: "simples-estourado",
    pergunta: "Estou no teto do Simples?",
    mode: "tributarista",
    deveConter: [/4[.,]?8|teto|limite|R\$\s?4/i, /Simples/i],
    naoPodeConter: [/dentro do limite com folga/i],
    toolsEsperadas: ["diagnostico_tributario", "get_regime_tributario"],
    numChavePayload: [/Simples|RBT|limite/i],
  },

  // -------- margem-baixa --------
  {
    id: "margem-baixa/onde-perco",
    fixture: "margem-baixa",
    pergunta: "Onde estou perdendo dinheiro?",
    mode: "controller",
    deveConter: [/margem|custo direto|CPV|CSP/i],
    naoPodeConter: [/margens saud[aá]veis/i],
    toolsEsperadas: ["get_despesas", "get_dre", "comparar_com_setor"],
    numChavePayload: [/Margem|Custo|CPV|CSP/i],
  },
  {
    id: "margem-baixa/folha",
    fixture: "margem-baixa",
    pergunta: "Minha folha está pesada?",
    mode: "controller",
    deveConter: [/folha|pessoal|colaborador/i],
    naoPodeConter: [],
    toolsEsperadas: ["get_despesas", "calc_custo_funcionario", "comparar_com_setor"],
    numChavePayload: [/pessoal|folha|colaborador|custo/i],
  },

  // -------- servicos-fator-r --------
  {
    id: "servicos-fator-r/fator-r",
    fixture: "servicos-fator-r",
    pergunta: "Vale mudar de anexo do Simples?",
    mode: "tributarista",
    deveConter: [/Fator R|Anexo III|Anexo V|28%/i],
    naoPodeConter: [/imposs[íi]vel mudar/i],
    toolsEsperadas: ["diagnostico_tributario", "simular_regime_tributario"],
    numChavePayload: [/Anexo|Fator|Simples/i],
  },
  {
    id: "servicos-fator-r/folha-para-anexo-iii",
    fixture: "servicos-fator-r",
    pergunta: "Quanto de folha eu preciso para ir para o Anexo III?",
    mode: "tributarista",
    deveConter: [/28%|Fator R|folha/i],
    naoPodeConter: [],
    toolsEsperadas: ["diagnostico_tributario"],
    numChavePayload: [/Fator|Anexo|folha|28/i],
  },

  // -------- casos board / auditor cruzados --------
  {
    id: "divida-critica/board-recomendacao",
    fixture: "divida-critica",
    pergunta: "Me dê a recomendação executiva do board para os próximos 90 dias.",
    mode: "board",
    deveConter: [/prioridade|a[cç][aã]o|prazo/i],
    naoPodeConter: [/n[aã]o h[aá] risco/i],
    toolsEsperadas: ["get_resumo_executivo", "get_prescritivo", "get_proximos_passos"],
    numChavePayload: [/DSCR|dívida|risco/i],
  },
  {
    id: "caixa-apertado/auditor",
    fixture: "caixa-apertado",
    pergunta: "Rode uma auditoria completa e me mostre os pontos de atenção.",
    mode: "auditor",
    deveConter: [/aten[cç][aã]o|risco|inconsist/i],
    naoPodeConter: [/nenhum ponto de aten[cç][aã]o/i],
    toolsEsperadas: ["get_relatorio_auditoria", "get_inconsistencias", "get_alertas_criticos"],
    numChavePayload: [/aten[cç][aã]o|risco|inconsist|alerta/i],
  },
];
