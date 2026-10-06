// ============================================================================
// Guia de primeiros passos: abre sozinho no primeiro acesso (por usuário e por
// modo) e pode ser reaberto pelo botão de ajuda do cabeçalho. Cada etapa
// explica uma parte do app e leva direto à tela correspondente.
// ============================================================================
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Compass, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Etapa = { titulo: string; texto: string; aba?: string; botao?: string };

const MANUAL: Etapa[] = [
  {
    titulo: "Bem-vindo ao FinnancePRO",
    texto:
      "Aqui você monta o diagnóstico financeiro de uma empresa: DRE, balanço, fluxo de caixa, mais de 40 indicadores, tributação (inclusive a Reforma) e simulações. Os números que aparecem agora são de uma empresa de exemplo — troque pelos dados reais seguindo as próximas etapas.",
  },
  {
    titulo: "1. Empresa e regime tributário",
    texto:
      "No botão de engrenagem, no alto da tela, informe nome, setor e regime (Simples, Presumido ou Real). Alíquotas, Lalur, ICMS-ST/DIFAL e Reforma também ficam lá.",
    aba: "tributos",
    botao: "Abrir Regime Tributário",
  },
  {
    titulo: "2. Receitas",
    texto:
      "Lance o faturamento de cada mês, os prazos de recebimento e as deduções. É a base de tudo: DRE, impostos, caixa e indicadores reagem na hora.",
    aba: "receitas",
    botao: "Abrir Receitas",
  },
  {
    titulo: "3. Despesas, folha e pró-labore",
    texto:
      "Cadastre custos e despesas por categoria. Marque as linhas de folha CLT para o app calcular os encargos do regime. O pró-labore dos sócios fica na aba própria.",
    aba: "custos",
    botao: "Abrir Despesas",
  },
  {
    titulo: "4. Capital e dívidas",
    texto:
      "Informe o balanço de abertura (caixa, clientes, estoques, fornecedores) e os contratos de empréstimo. Sem isso, o balanço de fechamento e os indicadores de endividamento ficam incompletos.",
    aba: "capital",
    botao: "Abrir Capital",
  },
  {
    titulo: "5. Leia os resultados",
    texto:
      "Dashboard, DRE, Balanço, Fluxo de Caixa e Indicadores mostram a situação. O Diagnóstico aponta os problemas e as ações com maior efeito. Passe o mouse no ícone (i) de cada número para ver a fórmula e a memória de cálculo.",
    aba: "dashboard",
    botao: "Abrir Dashboard",
  },
  {
    titulo: "6. Simule e apresente",
    texto:
      "No Simulador, mova preço, volume, custos, prazos e dívida e veja o efeito em tudo. Salve simulações com nome, use o Modo Reunião para apresentar e exporte o relatório em PDF (com os insights estratégicos) pelo botão de impressora.",
    aba: "simulador",
    botao: "Abrir Simulador",
  },
];

const ODOO: Etapa[] = [
  {
    titulo: "Bem-vindo ao cockpit do Odoo",
    texto:
      "Os números realizados vêm direto da contabilidade do Odoo e ficam somente leitura: DRE, balanço e fluxo de caixa batem com o razão. Você ajusta só as premissas (regime, custo de capital) e simula a partir do realizado.",
  },
  {
    titulo: "1. Escolha a empresa e o período",
    texto:
      "Na barra do Odoo, escolha a empresa, uma filial ou o grupo consolidado, e o mês final da janela de 12 meses. A luz de confiança mostra se os dados passaram nas conferências (balancete, balanço, operações entre empresas, rascunhos, encerramentos).",
    aba: "cockpit",
    botao: "Abrir Cockpit",
  },
  {
    titulo: "2. Confira com o contador",
    texto:
      "No cockpit, o cartão “Conciliação com o Odoo” compara conta a conta o que o app usa com o balancete e baixa o CSV para o contador. O retroteste mostra o quanto as premissas de projeção teriam acertado no ano anterior.",
    aba: "cockpit",
    botao: "Ver conciliação",
  },
  {
    titulo: "3. Premissas",
    texto:
      "Regime tributário, custo de capital e cenários continuam editáveis (botão de engrenagem e aba Valuation). Cada empresa guarda as suas premissas.",
    aba: "tributos",
    botao: "Abrir Regime Tributário",
  },
  {
    titulo: "4. Simule a partir do realizado",
    texto:
      "No Simulador, as alavancas partem do resultado contabilizado. As simulações salvas e as alavancas ficam separadas por empresa. O Consolidado mostra o grupo já sem as operações internas.",
    aba: "simulador",
    botao: "Abrir Simulador",
  },
];

const ADMIN: Etapa = {
  titulo: "Para o administrador",
  texto:
    "Em Administração ficam a conexão com o Odoo (chave somente leitura), a classificação das contas, os usuários e a aba Status, com backup diário, teste de restauração, erros capturados e alertas por e-mail.",
};

const chave = (userId: string, modo: string) => `finnance:guia:v1:${userId}:${modo}`;

function lido(userId: string, modo: string): boolean {
  try {
    return window.localStorage.getItem(chave(userId, modo)) === "1";
  } catch {
    return true; // sem armazenamento, não insiste a cada abertura
  }
}

export function FirstStepsGuide({
  userId,
  modo,
  isAdmin,
  onIrPara,
  onEmpresaEmBranco,
}: {
  userId: string;
  modo: "manual" | "odoo";
  isAdmin: boolean;
  onIrPara: (aba: string) => void;
  /** Troca os dados de exemplo por uma empresa em branco (só enquanto são os de exemplo). */
  onEmpresaEmBranco?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const etapas = [...(modo === "odoo" ? ODOO : MANUAL), ...(isAdmin ? [ADMIN] : [])];
  const etapa = etapas[Math.min(i, etapas.length - 1)];

  // Primeiro acesso neste modo: abre sozinho.
  useEffect(() => {
    if (!lido(userId, modo)) {
      setI(0);
      setAberto(true);
    }
  }, [userId, modo]);

  // Botão de ajuda do cabeçalho reabre o guia.
  useEffect(() => {
    const abrir = () => {
      setI(0);
      setAberto(true);
    };
    window.addEventListener("gz-open-guide", abrir);
    return () => window.removeEventListener("gz-open-guide", abrir);
  }, []);

  const fechar = () => {
    try {
      window.localStorage.setItem(chave(userId, modo), "1");
    } catch {
      /* modo privado */
    }
    setAberto(false);
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" /> {etapa.titulo}
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
            {etapa.texto}
          </DialogDescription>
        </DialogHeader>
        {i === 0 && onEmpresaEmBranco && (
          <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs sm:flex-row sm:items-center">
            <span className="flex-1 text-muted-foreground">
              Vai lançar os dados de uma empresa real? Comece com tudo zerado, sem os números de
              exemplo.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onEmpresaEmBranco();
                setI(1);
              }}
            >
              Começar em branco
            </Button>
          </div>
        )}
        {etapa.aba && (
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              onIrPara(etapa.aba!);
              fechar();
            }}
          >
            {etapa.botao}
          </Button>
        )}
        <div className="flex justify-center gap-1.5 pt-1" aria-hidden="true">
          {etapas.map((_, k) => (
            <span
              key={k}
              className={cn("h-1.5 w-6 rounded-full", k === i ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={fechar}>
            {i === etapas.length - 1 ? "Fechar" : "Pular guia"}
          </Button>
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="outline" onClick={() => setI(i - 1)} aria-label="Etapa anterior">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {i < etapas.length - 1 ? (
              <Button onClick={() => setI(i + 1)}>
                Próximo <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={fechar}>Começar</Button>
            )}
          </div>
        </DialogFooter>
        <p className="text-center text-[11px] text-muted-foreground">
          Etapa {i + 1} de {etapas.length} · reabra pelo botão de ajuda (?) no alto da tela
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Botão do cabeçalho que reabre o guia. */
export function GuideButton() {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 w-8 p-0"
      title="Guia de primeiros passos"
      aria-label="Guia de primeiros passos"
      onClick={() => window.dispatchEvent(new Event("gz-open-guide"))}
    >
      <HelpCircle className="h-3.5 w-3.5" />
    </Button>
  );
}
