/**
 * SociosCard — UI dedicada de Pró-labore × Distribuição de Lucros.
 * Layout em tabela, padronizado com Receitas/Despesas.
 *
 * SSOT: ao alterar a lista, chama applySociosChange que sincroniza
 * linhas system em state.costs — todos os módulos (DRE, FCF, Indicadores)
 * enxergam o custo automaticamente.
 */
import { useMemo } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFinance, useFinanceUpdate } from "@/engines/finance/AppStateContext";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { buildDRE } from "@/engines/finance/dre";
import { fmtBRL } from "@/engines/finance/format";
import {
  applySociosChange,
  calcRetiradaSocio,
  otimizarProLabore,
  syncSociosToCosts,
} from "@/engines/finance/socios";
import type { SocioRetirada } from "@/engines/finance/types";
import { SectionTitle, renderHint } from "@/components/sim/shared/primitives";
import { getSalarioMinimo } from "@/engines/finance/taxDefaults";

function novoSocio(idx: number): SocioRetirada {
  return {
    id: `socio_${Date.now()}_${idx}`,
    nome: `Sócio ${idx + 1}`,
    participacaoPct: 0,
    operacional: true,
    prolaboreMensal: 0,
    dependentes: 0,
    outrasDeducoes: 0,
    modo: "manual",
  };
}

const HINT = {
  description:
    "Cadastre cada sócio em uma linha. O pró-labore vira despesa administrativa (linha sintética em Despesas) e o INSS patronal (Presumido/Real) também. A distribuição de lucros é estimada com base no lucro líquido projetado e respeita o limite isento. Impacta: DRE (custo de pessoal), Fluxo de Caixa (saída mensal), Tributos (Fator R no Simples) e Indicadores (margem líquida, EBITDA).",
  formula:
    "Líquido sócio = Pró-labore − INSS sócio − IRPF + Distribuição de Lucros\nCusto PJ = Pró-labore + INSS patronal",
  example:
    "A soma das participações deve fechar 100%. Use 'Otimizar' para sugerir o split que minimiza carga tributária respeitando o piso legal (salário mínimo para sócio operacional).",
};

export function SociosCard() {
  const { state } = useFinance();
  const update = useFinanceUpdate();
  const regime = resolveEffectiveRegime(state);
  const socios = state.socios ?? [];
  const salarioMin = getSalarioMinimo(state.tax);

  const lucroMensalDisponivel = useMemo(() => {
    try {
      const semSocios = syncSociosToCosts({ ...state, socios: [] }, regime);
      const { dre } = buildDRE(semSocios, regime);
      const lucroAno = dre.lucroLiquido.reduce((a, b) => a + b, 0);
      return Math.max(0, lucroAno / 12);
    } catch {
      return 0;
    }
  }, [state, regime]);

  const setSocios = (next: SocioRetirada[]) =>
    update((s) => applySociosChange(s, next, regime));

  const addSocio = () => {
    // Auto-distribui participação restante na nova linha.
    const usado = socios.reduce((a, s) => a + s.participacaoPct, 0);
    const restante = Math.max(0, 100 - usado);
    const novo = novoSocio(socios.length);
    novo.participacaoPct = Math.round(restante * 100) / 100;
    setSocios([...socios, novo]);
  };
  const removeSocio = (id: string) => {
    const restantes = socios.filter((s) => s.id !== id);
    if (restantes.length === 0) return setSocios([]);
    // Rebalanceia proporcionalmente para manter soma = 100%.
    const somaRest = restantes.reduce((a, s) => a + s.participacaoPct, 0);
    let rebalanced: SocioRetirada[];
    if (somaRest > 0) {
      const fator = 100 / somaRest;
      rebalanced = restantes.map((s) => ({
        ...s,
        participacaoPct: Math.round(s.participacaoPct * fator * 100) / 100,
      }));
    } else {
      // Todos zerados → divide igual.
      const cada = Math.round((100 / restantes.length) * 100) / 100;
      rebalanced = restantes.map((s) => ({ ...s, participacaoPct: cada }));
    }
    // Corrige resíduo de arredondamento na última linha.
    const soma = rebalanced.reduce((a, s) => a + s.participacaoPct, 0);
    const diff = Math.round((100 - soma) * 100) / 100;
    if (diff !== 0 && rebalanced.length > 0) {
      const last = rebalanced[rebalanced.length - 1];
      rebalanced[rebalanced.length - 1] = {
        ...last,
        participacaoPct: Math.round((last.participacaoPct + diff) * 100) / 100,
      };
    }
    setSocios(rebalanced);
  };
  const patchSocio = (id: string, patch: Partial<SocioRetirada>) =>
    setSocios(socios.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const otimizarTodos = () => {
    const next = socios.map((s) => {
      const totalRetirada =
        s.prolaboreMensal + (lucroMensalDisponivel * s.participacaoPct) / 100;
      const otimo = otimizarProLabore(s, totalRetirada, state, regime);
      return { ...s, prolaboreMensal: otimo, modo: "otimizar" as const };
    });
    setSocios(next);
  };

  const somaPartic = socios.reduce((a, s) => a + s.participacaoPct, 0);
  const partOk = socios.length === 0 || Math.abs(somaPartic - 100) < 0.01;

  const resultados = socios.map((s) =>
    calcRetiradaSocio(s, state, regime, (lucroMensalDisponivel * s.participacaoPct) / 100),
  );
  const totaisAno = {
    prolab: resultados.reduce((a, r) => a + r.prolaboreMensal, 0) * 12,
    patronal: resultados.reduce((a, r) => a + r.inssPatronal, 0) * 12,
    distIsenta: resultados.reduce((a, r) => a + r.distribuicaoIsentaMensal, 0) * 12,
    distTrib: resultados.reduce((a, r) => a + r.distribuicaoTributavelMensal, 0) * 12,
    cargaTotal:
      resultados.reduce(
        (a, r) => a + r.inssSocio + r.inssPatronal + r.irpfMensal,
        0,
      ) * 12,
    liquido: resultados.reduce((a, r) => a + r.liquidoSocio, 0) * 12,
    custoPJ: resultados.reduce((a, r) => a + r.custoTotalPJ, 0) * 12,
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionTitle hint={HINT}>Pró-labore × Distribuição de Lucros</SectionTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Lucro mensal estimado disponível para distribuição:{" "}
            <b>{fmtBRL(lucroMensalDisponivel)}</b> · Regime efetivo:{" "}
            <b className="uppercase">{regime}</b> · Piso legal (salário mínimo):{" "}
            <b>{fmtBRL(salarioMin)}</b>
          </p>
        </div>
        <div className="flex gap-2">
          {socios.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={otimizarTodos}
              title="Aplicar split ótimo (mínimo legal de pró-labore quando vantajoso)"
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Otimizar
            </Button>
          )}
          <Button size="sm" onClick={addSocio}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar sócio
          </Button>
        </div>
      </div>

      {socios.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nenhum sócio cadastrado. Clique em <b>Adicionar sócio</b> para começar.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Nome do sócio</th>
                <th className="px-2 py-2 font-medium text-right">Participação (%)</th>
                <th className="px-2 py-2 font-medium text-center">Operacional</th>
                <th className="px-2 py-2 font-medium text-center">Modo</th>
                <th className="px-2 py-2 font-medium text-right">Pró-labore (mês)</th>
                <th className="px-2 py-2 font-medium text-right">Dependentes</th>
                <th className="px-2 py-2 font-medium text-right">Outras deduções</th>
                <th className="px-2 py-2 font-medium text-right">INSS sócio</th>
                <th className="px-2 py-2 font-medium text-right">INSS patronal</th>
                <th className="px-2 py-2 font-medium text-right">IRPF</th>
                <th className="px-2 py-2 font-medium text-right">Distribuição isenta</th>
                <th className="px-2 py-2 font-medium text-right">Distribuição tributável</th>
                <th className="px-2 py-2 font-medium text-right">Líquido sócio (mês)</th>
                <th className="px-2 py-2 font-medium text-right">Custo PJ (mês)</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {socios.map((s, i) => {
                const r = resultados[i];
                const abaixoDoPiso =
                  s.operacional && s.prolaboreMensal > 0 && s.prolaboreMensal < salarioMin;
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border/40 hover:bg-muted/20"
                  >
                    <td className="px-2 py-1.5">
                      <Input
                        value={s.nome}
                        onChange={(e) => patchSocio(s.id, { nome: e.target.value })}
                        className="h-8 min-w-[140px]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={s.participacaoPct}
                        onChange={(e) =>
                          patchSocio(s.id, { participacaoPct: Number(e.target.value) || 0 })
                        }
                        className="h-8 w-[80px] text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <Switch
                        checked={s.operacional}
                        onCheckedChange={(v) => patchSocio(s.id, { operacional: v })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={s.modo}
                        onValueChange={(v) =>
                          patchSocio(s.id, { modo: v as "manual" | "otimizar" })
                        }
                      >
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">Manual</SelectItem>
                          <SelectItem value="otimizar">Otimizar</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={s.prolaboreMensal}
                        onChange={(e) =>
                          patchSocio(s.id, {
                            prolaboreMensal: Number(e.target.value) || 0,
                            modo: "manual",
                          })
                        }
                        className={`h-8 w-[110px] text-right ${
                          abaixoDoPiso ? "border-[var(--warning)]" : ""
                        }`}
                        title={
                          abaixoDoPiso
                            ? `Abaixo do piso de ${fmtBRL(salarioMin)} (IN RFB 971/2009)`
                            : undefined
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={s.dependentes}
                        onChange={(e) =>
                          patchSocio(s.id, { dependentes: Number(e.target.value) || 0 })
                        }
                        className="h-8 w-[70px] text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={s.outrasDeducoes}
                        onChange={(e) =>
                          patchSocio(s.id, { outrasDeducoes: Number(e.target.value) || 0 })
                        }
                        className="h-8 w-[100px] text-right"
                      />
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.inssSocio)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.inssPatronal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.irpfMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-pos">
                      {fmtBRL(r.distribuicaoIsentaMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[var(--warning)]">
                      {fmtBRL(r.distribuicaoTributavelMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold text-pos">
                      {fmtBRL(r.liquidoSocio)}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold">
                      {fmtBRL(r.custoTotalPJ)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeSocio(s.id)}
                        title="Remover sócio"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/60 bg-muted/20 text-[12px] font-semibold">
                <td className="px-2 py-2">Total anual</td>
                <td
                  className={`num px-2 py-2 text-right ${
                    partOk ? "text-foreground" : "text-[var(--warning)]"
                  }`}
                  title={partOk ? "Soma das participações = 100%" : "Soma deve fechar 100%"}
                >
                  {somaPartic.toFixed(2)}%
                </td>
                <td colSpan={2}></td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.prolab)}</td>
                <td colSpan={2}></td>
                <td className="num px-2 py-2 text-right">
                  {fmtBRL(
                    resultados.reduce((a, r) => a + r.inssSocio, 0) * 12,
                  )}
                </td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.patronal)}</td>
                <td className="num px-2 py-2 text-right">
                  {fmtBRL(resultados.reduce((a, r) => a + r.irpfMensal, 0) * 12)}
                </td>
                <td className="num px-2 py-2 text-right text-pos">
                  {fmtBRL(totaisAno.distIsenta)}
                </td>
                <td className="num px-2 py-2 text-right text-[var(--warning)]">
                  {fmtBRL(totaisAno.distTrib)}
                </td>
                <td className="num px-2 py-2 text-right text-pos">{fmtBRL(totaisAno.liquido)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.custoPJ)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>

          {!partOk && (
            <div className="mt-3 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[12px] text-[var(--warning)]">
              ⚠️ A soma das participações é <b>{somaPartic.toFixed(2)}%</b> e precisa fechar{" "}
              <b>100%</b> para que a distribuição de lucros seja calculada corretamente.
            </div>
          )}

          {/* Tooltip-style helper: nota legal */}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Sócio operacional deve receber pró-labore ≥ salário mínimo (IN RFB 971/2009). No
            Simples Nacional não há INSS patronal sobre pró-labore; em Presumido/Real aplica-se
            20%. A distribuição de lucros é isenta de IRPF dentro do limite contábil; valores
            acima do limite isento aparecem como tributáveis.
          </p>
        </div>
      )}
    </div>
  );
}
