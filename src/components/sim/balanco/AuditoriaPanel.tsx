// Auditoria do Balanço de Fechamento.
// Para cada rubrica, mostra: INPUTS (de onde vem) + FÓRMULA + VALOR.
// Mesma lógica de deriveBalancoFechamento, mas exposta para auditoria humana.
import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { deriveAbertura } from "@/engines/finance/aberturaDerivada";
import { fmtBRL } from "@/engines/finance/format";
import { Button } from "@/components/ui/button";
import { X, Search } from "lucide-react";

const n = (v: number | undefined) => (typeof v === "number" && isFinite(v) ? v : 0);
const sum = (a: number[] | undefined) => (a ?? []).reduce((x, y) => x + (y || 0), 0);

interface LinhaAuditoria {
  grupo: string;
  rubrica: string;
  inputs: { label: string; origem: string; valor: number }[];
  formula: string;
  resultado: number;
}

export function AuditoriaPanel({ onClose }: { onClose: () => void }) {
  const { state } = useFinance();
  const { model } = useFinanceModel(state);
  const dre = model.dre;
  const cf = model.cf;
  const cap = state.capital;
  // `capital.abertura` é consumido via `deriveAbertura` (SSOT) abaixo.
  const balConst = cap.balanco ?? {};
  const imo = balConst.ativoNaoCirculante?.imobilizado ?? {};
  const intg = balConst.ativoNaoCirculante?.intangivel ?? {};
  const pl = balConst.patrimonioLiquido ?? {};

  const linhas: LinhaAuditoria[] = useMemo(() => {
    // SSOT — todos os saldos de abertura vêm daqui, com `origem` declarando a fonte real.
    const ssot = deriveAbertura({ state, impostosTotalMensais: dre.impostosTotal });

    const receitaBruta = sum(state.revenue?.bruta);
    const cpv = (state.costs ?? [])
      .filter((l) => ["custo_vendas", "direto_venda"].includes(l.category))
      .reduce((a, l) => a + sum(l.values), 0);
    const folha = (state.costs ?? [])
      .filter((l) => ["fixo", "variavel"].includes(l.category))
      .reduce((a, l) => a + sum(l.values), 0);
    const lucroLiq = sum(dre.lucroLiquido);
    const impostos = sum(dre.impostos);
    const dividendos = sum(cf.dividendos);
    const pmr = state.revenue?.pmr || 0;
    const pmp = state.revenue?.pmp || 0;
    const capex = (cap.capexAtivacao ?? []).reduce((a, c) => a + (c.valor || 0), 0);
    const depAtiv = (cap.capexAtivacao ?? []).reduce((a, c) => {
      if (!c || !(c.valor > 0)) return a;
      const meses = Math.max(0, 13 - (c.mes || 1));
      const vu = c.vidaUtilMeses > 0 ? c.vidaUtilMeses : 60;
      return a + (c.valor / vu) * meses;
    }, 0);
    const depPeriodo = (cap.depreciacaoMensal || 0) * 12 + depAtiv;

    return [
      // ATIVO CIRCULANTE
      {
        grupo: "Ativo Circulante",
        rubrica: "Caixa e equivalentes",
        inputs: [{ label: "Saldo final DFC (dez)", origem: "DFC", valor: n(cf.saldoFinal?.[11]) }],
        formula: "Caixa_fim = DFC.saldoFinal[dez]",
        resultado: n(cf.saldoFinal?.[11]),
      },
      {
        grupo: "Ativo Circulante",
        rubrica: "Contas a receber",
        inputs: [
          { label: "Receita Bruta anual", origem: "Receitas", valor: receitaBruta },
          { label: "PMR (dias)", origem: "Receitas", valor: pmr },
          {
            label: `CR abertura (fallback)`,
            origem: ssot.contasReceber.origem,
            valor: ssot.contasReceber.value,
          },
        ],
        formula: pmr > 0 ? "CR_fim = Receita Bruta × PMR / 360" : "CR_fim = CR_abertura (PMR=0)",
        resultado: pmr > 0 ? (receitaBruta * pmr) / 360 : ssot.contasReceber.value,
      },
      {
        grupo: "Ativo Circulante",
        rubrica: "Estoques",
        inputs: [
          { label: "Estoque declarado (Capital)", origem: "Capital", valor: n(cap.estoques) },
          {
            label: "Estoque abertura (SSOT)",
            origem: ssot.estoques.origem,
            valor: ssot.estoques.value,
          },
        ],
        formula: "Estoques_fim = capital.estoques OU abertura SSOT",
        resultado: cap.estoques > 0 ? cap.estoques : ssot.estoques.value,
      },
      {
        grupo: "Ativo Circulante",
        rubrica: "Impostos a recuperar",
        inputs: [
          {
            label: "Abertura (editável)",
            origem: ssot.impostosRecuperar.origem,
            valor: ssot.impostosRecuperar.value,
          },
        ],
        formula: "Constante = abertura (sem modelo de crédito tributário)",
        resultado: ssot.impostosRecuperar.value,
      },
      // IMOBILIZADO
      {
        grupo: "Imobilizado",
        rubrica: "Terrenos / Edificações / Máquinas / Veículos / Móveis",
        inputs: [
          { label: "Terrenos", origem: "Capital → Balanço", valor: n(imo.terrenos) },
          { label: "Edificações", origem: "Capital → Balanço", valor: n(imo.edificacoes) },
          { label: "Máquinas", origem: "Capital → Balanço", valor: n(imo.maquinasEquipamentos) },
          { label: "Veículos", origem: "Capital → Balanço", valor: n(imo.veiculos) },
          { label: "Móveis", origem: "Capital → Balanço", valor: n(imo.moveisUtensilios) },
        ],
        formula: "Constantes (valor histórico declarado em Capital)",
        resultado:
          n(imo.terrenos) +
          n(imo.edificacoes) +
          n(imo.maquinasEquipamentos) +
          n(imo.veiculos) +
          n(imo.moveisUtensilios),
      },
      {
        grupo: "Imobilizado",
        rubrica: "Outros (inclui CAPEX do período)",
        inputs: [
          {
            label: "Outros (abertura)",
            origem: "Capital → Balanço",
            valor: n(imo.outrosImobilizados),
          },
          { label: "CAPEX ativado no período", origem: "Capital → Ativações", valor: capex },
        ],
        formula: "Outros_fim = Outros_abertura + Σ CAPEX ativado",
        resultado: n(imo.outrosImobilizados) + capex,
      },
      {
        grupo: "Imobilizado",
        rubrica: "(−) Depreciação acumulada",
        inputs: [
          {
            label: "Depreciação acum. abertura",
            origem: ssot.depreciacaoAcumulada.origem,
            valor: ssot.depreciacaoAcumulada.value,
          },
          {
            label: "Depreciação mensal × 12",
            origem: "Capital",
            valor: (cap.depreciacaoMensal || 0) * 12,
          },
          { label: "Depreciação das ativações", origem: "Capital → Ativações", valor: depAtiv },
        ],
        formula: "DepAcum_fim = abertura + depMensal×12 + Σ(CAPEX/vu × meses)",
        resultado: ssot.depreciacaoAcumulada.value + depPeriodo,
      },
      // INTANGÍVEL
      {
        grupo: "Intangível",
        rubrica: "Marcas, Goodwill, Outros",
        inputs: [
          {
            label: "Marcas e patentes",
            origem: "Capital → Balanço",
            valor: n(intg.marcasPatentes),
          },
          { label: "Goodwill", origem: "Capital → Balanço", valor: n(intg.goodwill) },
          {
            label: "Outros intangíveis",
            origem: "Capital → Balanço",
            valor: n(intg.outrosIntangiveis),
          },
        ],
        formula: "Constantes (declarados em Capital)",
        resultado: n(intg.marcasPatentes) + n(intg.goodwill) + n(intg.outrosIntangiveis),
      },
      {
        grupo: "Intangível",
        rubrica: "(−) Amortização acumulada",
        inputs: [
          {
            label: "Abertura (override)",
            origem: ssot.amortizacaoAcumulada.origem,
            valor: ssot.amortizacaoAcumulada.value,
          },
        ],
        formula: "AmortAcum_fim = abertura (sem fluxo modelado)",
        resultado: ssot.amortizacaoAcumulada.value,
      },
      // PASSIVO CIRCULANTE
      {
        grupo: "Passivo Circulante",
        rubrica: "Fornecedores",
        inputs: [
          { label: "CPV anual", origem: "Despesas (custo_vendas + direto_venda)", valor: cpv },
          { label: "PMP (dias)", origem: "Receitas", valor: pmp },
          {
            label: "Fornecedores abertura (SSOT)",
            origem: ssot.fornecedores.origem,
            valor: ssot.fornecedores.value,
          },
        ],
        formula:
          pmp > 0 ? "Fornecedores_fim = CPV × PMP / 360" : "Fornecedores_fim = abertura (PMP=0)",
        resultado: pmp > 0 ? (cpv * pmp) / 360 : ssot.fornecedores.value,
      },
      {
        grupo: "Passivo Circulante",
        rubrica: "Empréstimos CP",
        inputs: [
          {
            label: "Empréstimos CP (SSOT)",
            origem: ssot.emprestimosCP.origem,
            valor: ssot.emprestimosCP.value,
          },
        ],
        formula: "EmprCP = Σ contratos com prazo ≤ 12m (sem contratos = 0)",
        resultado: ssot.emprestimosCP.value,
      },
      {
        grupo: "Passivo Circulante",
        rubrica: "Impostos a pagar",
        inputs: [
          { label: "Impostos anuais (DRE)", origem: "DRE", valor: impostos },
          {
            label: "Impostos abertura (SSOT)",
            origem: ssot.impostosPagar.origem,
            valor: ssot.impostosPagar.value,
          },
        ],
        formula: "ImpostosPagar = impostos_anuais / 12 (≈ 1 mês DARF)",
        resultado: impostos > 0 ? impostos / 12 : 0,
      },
      {
        grupo: "Passivo Circulante",
        rubrica: "Salários e encargos",
        inputs: [
          { label: "Folha anual", origem: "Despesas (fixo + variável)", valor: folha },
          {
            label: "Salários abertura (SSOT)",
            origem: ssot.salariosEncargos.origem,
            valor: ssot.salariosEncargos.value,
          },
        ],
        formula: "Salários_pagar = folha_anual / 12",
        resultado: folha > 0 ? folha / 12 : 0,
      },
      // PASSIVO NÃO CIRCULANTE
      {
        grupo: "Passivo Não Circulante",
        rubrica: "Empréstimos LP",
        inputs: [
          {
            label: "Empréstimos LP (SSOT)",
            origem: ssot.emprestimosLP.origem,
            valor: ssot.emprestimosLP.value,
          },
        ],
        formula: "EmprLP = Σ contratos com prazo > 12m (sem contratos = 0)",
        resultado: ssot.emprestimosLP.value,
      },
      // PL
      {
        grupo: "Patrimônio Líquido",
        rubrica: "Capital social / Reservas",
        inputs: [
          { label: "Capital social", origem: "Capital → Balanço/PL", valor: n(pl.capitalSocial) },
          {
            label: "Reservas de capital",
            origem: "Capital → Balanço/PL",
            valor: n(pl.reservasCapital),
          },
          {
            label: "Reservas de lucros",
            origem: "Capital → Balanço/PL",
            valor: n(pl.reservasLucros),
          },
        ],
        formula: "Constantes (declarados em Capital)",
        resultado: n(pl.capitalSocial) + n(pl.reservasCapital) + n(pl.reservasLucros),
      },
      {
        grupo: "Patrimônio Líquido",
        rubrica: "Lucros acumulados (abertura)",
        inputs: [
          {
            label: "Lucros acumulados (SSOT)",
            origem: ssot.lucrosAcumulados.origem,
            valor: ssot.lucrosAcumulados.value,
          },
        ],
        formula: "Lucros_acum_fim = abertura (resultado e dividendos vão em rubricas separadas)",
        resultado: ssot.lucrosAcumulados.value,
      },
      {
        grupo: "Patrimônio Líquido",
        rubrica: "(−) Dividendos pagos no período",
        inputs: [{ label: "Dividendos pagos", origem: "DFC", valor: dividendos }],
        formula: "Redutora separada do PL = −Σ Dividendos pagos",
        resultado: -dividendos,
      },
      {
        grupo: "Patrimônio Líquido",
        rubrica: "Resultado do exercício",
        inputs: [{ label: "Lucro Líquido anual", origem: "DRE", valor: lucroLiq }],
        formula: "Resultado = Σ Lucro Líquido da DRE (sem dividendos)",
        resultado: lucroLiq,
      },
    ];
  }, [state, dre, cf, cap, balConst, imo, intg, pl]);

  // Agrupa por grupo
  const grupos = useMemo(() => {
    const map = new Map<string, LinhaAuditoria[]>();
    linhas.forEach((l) => {
      const arr = map.get(l.grupo) ?? [];
      arr.push(l);
      map.set(l.grupo, arr);
    });
    return Array.from(map.entries());
  }, [linhas]);

  return (
    <div className="rounded-lg border border-primary/30 bg-card/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Auditoria — rubrica × inputs × fórmula</h3>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} className="h-7 gap-1 text-[11px]">
          <X className="h-3.5 w-3.5" />
          Fechar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Para cada rubrica do Balanço de Fechamento: de onde vêm os inputs, qual fórmula é aplicada e
        o valor resultante.
      </p>

      <div className="space-y-4">
        {grupos.map(([grupo, items]) => (
          <div key={grupo} className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
              {grupo}
            </div>
            <div className="space-y-2">
              {items.map((l) => (
                <div
                  key={l.rubrica}
                  className="rounded-md border border-border/40 bg-muted/20 p-3 space-y-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-[12.5px] font-medium">{l.rubrica}</div>
                    <div className="text-[12.5px] font-mono font-semibold">
                      {fmtBRL(l.resultado)}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {l.inputs.map((i, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground"
                      >
                        <span className="truncate">
                          <span className="text-foreground/80">{i.label}</span>
                          <span className="opacity-60"> — {i.origem}</span>
                        </span>
                        <span className="font-mono shrink-0">{fmtBRL(i.valor)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded bg-background/60 px-2 py-1 text-[10.5px] font-mono text-primary/90 border border-primary/15">
                    {l.formula}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
