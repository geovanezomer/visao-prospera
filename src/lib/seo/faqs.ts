// Dados de FAQ usados na landing e como JSON-LD (FAQPage) nas rotas / e /landing.
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQS: FaqItem[] = [
  {
    q: "Preciso ser da área financeira para usar?",
    a: "Não. O FinnancePRO foi desenhado para traduzir números em decisão — qualquer empresário, consultor ou gestor consegue operar com fluxo guiado e diagnóstico em linguagem clara.",
  },
  {
    q: "Preciso instalar alguma coisa?",
    a: "Não. O FinnancePRO roda 100% no navegador. Login, insere os dados e começa a analisar sozinho ou com ajuda da I.A.",
  },
  {
    q: "Meus dados ficam seguros?",
    a: "Sim. O sistema usa IndexedDB, os dados ficam no seu navegador. Podendo ser, opcionalmente, armazenados na nuvem com backup através de arquivo baixável. Você controla o que sai do seu computador.",
  },
  {
    q: "A Reforma Tributária está realmente atualizada?",
    a: "Sim. O motor tributário acompanha a LC 214/2025 e as fases de transição CBS/IBS (2026-2033), incluindo Split Payment.",
  },
  {
    q: "Posso usar com vários clientes (ou várias empresas)?",
    a: "Sim. Você cria quantos cenários e empresas quiser, cada um com seu próprio conjunto de dados, relatórios e link de compartilhamento.",
  },
  {
    q: "Como funciona a IA?",
    a: "Traga sua chave da OpenAI ou Claude para gerar um diagnóstico executivo a partir dos números reais da empresa simulada. Você revisa, ajusta e entrega — com prompt versionado para auditoria.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim. Sem fidelidade, sem multa. Você cancela direto da sua conta.",
  },
];

export function faqPageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
