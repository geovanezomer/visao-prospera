/**
 * SociosCard — UI dedicada de Pró-labore × Distribuição de Lucros.
 * Faz CRUD dos sócios e exibe o cálculo mês-a-mês (líquido / custo PJ).
 *
 * SSOT: ao alterar a lista, chama applySociosChange que sincroniza
 * linhas system em state.costs — todos os módulos veem o custo.
 */
import { useMemo } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { SectionTitle } from "@/components/sim/shared/primitives";
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

export function SociosCard() {
  const { state } = useFinance();
  const update = useFinanceUpdate();
  const regime = resolveEffectiveRegime(state);
  const socios = state.socios ?? [];
  const salarioMin = getSalarioMinimo(state.tax);

  // Lucro mensal disponível para distribuição (proxy: lucro líquido anual / 12).
  // Não distribui se prejuízo.
  const lucroMensalDisponivel = useMemo(() => {
    try {
      // Calcula DRE EXCLUINDO os pró-labores já inseridos (evita dupla contagem
      // ao "ver" quanto sobra antes da retirada).
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

  const addSocio = () => setSocios([...socios, novoSocio(socios.length)]);
  const removeSocio = (id: string) => setSocios(socios.filter((s) => s.id !== id));
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
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionTitle>Pró-labore × Distribuição de Lucros</SectionTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Distribuição mensal disponível (estimativa): <b>{fmtBRL(lucroMensalDisponivel)}</b> ·
            Regime efetivo: <b className="uppercase">{regime}</b>
          </p>
        </div>
        <div className="flex gap-2">
          {socios.length > 0 && (
            <Button size="sm" variant="outline" onClick={otimizarTodos} title="Aplicar split ótimo (mínimo legal de pró-labore quando vantajoso)">
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
        <div className="mt-4 space-y-3">
          {socios.map((s, i) => {
            const r = resultados[i];
            const abaixoDoPiso = s.operacional && s.prolaboreMensal > 0 && s.prolaboreMensal < salarioMin;
            return (
              <div
                key={s.id}
                className="rounded-md border border-border/60 bg-background/40 p-3 sm:p-4"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,90px,140px,90px,90px,auto] sm:items-end">
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">Nome</Label>
                    <Input
                      value={s.nome}
                      onChange={(e) => patchSocio(s.id, { nome: e.target.value })}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">% partic.</Label>
                    <Input
                      type="number"
                      value={s.participacaoPct}
                      onChange={(e) =>
                        patchSocio(s.id, { participacaoPct: Number(e.target.value) || 0 })
                      }
                      className="h-9 text-right"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">Pró-labore/mês</Label>
                    <Input
                      type="number"
                      value={s.prolaboreMensal}
                      onChange={(e) =>
                        patchSocio(s.id, {
                          prolaboreMensal: Number(e.target.value) || 0,
                          modo: "manual",
                        })
                      }
                      className="h-9 text-right"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">Dep.</Label>
                    <Input
                      type="number"
                      value={s.dependentes}
                      onChange={(e) =>
                        patchSocio(s.id, { dependentes: Number(e.target.value) || 0 })
                      }
                      className="h-9 text-right"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-muted-foreground">Outras ded.</Label>
                    <Input
                      type="number"
                      value={s.outrasDeducoes}
                      onChange={(e) =>
                        patchSocio(s.id, { outrasDeducoes: Number(e.target.value) || 0 })
                      }
                      className="h-9 text-right"
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeSocio(s.id)}
                      title="Remover sócio"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px]">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={s.operacional}
                      onCheckedChange={(v) => patchSocio(s.id, { operacional: v })}
                    />
                    Sócio operacional (exige piso de salário mínimo)
                  </label>
                  <Select
                    value={s.modo}
                    onValueChange={(v) => patchSocio(s.id, { modo: v as "manual" | "otimizar" })}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="otimizar">Otimizar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {abaixoDoPiso && (
                  <div className="mt-2 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-2 py-1.5 text-[11px] text-[var(--warning)]">
                    ⚠️ Pró-labore abaixo do piso ({fmtBRL(salarioMin)}). Sócio operacional deve receber ao menos o salário mínimo (IN RFB 971/2009).
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-muted/30 p-2 text-[12px] sm:grid-cols-4">
                  <Resultado label="INSS sócio" valor={r.inssSocio} />
                  <Resultado label="INSS patronal" valor={r.inssPatronal} />
                  <Resultado label={`IRPF (${r.irpfModo === "simplificado" ? "simpl." : "trad."})`} valor={r.irpfMensal} />
                  <Resultado label="Dist. isenta" valor={r.distribuicaoIsentaMensal} pos />
                  {r.distribuicaoTributavelMensal > 0 && (
                    <Resultado
                      label="Dist. excedente"
                      valor={r.distribuicaoTributavelMensal}
                      destaque
                    />
                  )}
                  <Resultado label="Líquido sócio (mês)" valor={r.liquidoSocio} pos bold />
                  <Resultado label="Custo PJ (mês)" valor={r.custoTotalPJ} bold />
                </div>
              </div>
            );
          })}

          {!partOk && (
            <div className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[12px] text-[var(--warning)]">
              ⚠️ Soma das participações = <b>{somaPartic.toFixed(1)}%</b>. Ajuste para totalizar 100%.
            </div>
          )}

          {/* Resumo consolidado */}
          <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Resumo anual consolidado
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
              <Resultado label="Pró-labore/ano" valor={totaisAno.prolab} bold />
              <Resultado label="INSS patronal/ano" valor={totaisAno.patronal} />
              <Resultado label="Distribuição isenta/ano" valor={totaisAno.distIsenta} pos />
              <Resultado label="Carga tributária sócios/ano" valor={totaisAno.cargaTotal} destaque />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Resultado({
  label,
  valor,
  pos,
  destaque,
  bold,
}: {
  label: string;
  valor: number;
  pos?: boolean;
  destaque?: boolean;
  bold?: boolean;
}) {
  const cor = pos ? "text-pos" : destaque ? "text-[var(--warning)]" : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`num ${bold ? "text-sm font-semibold" : "text-sm"} ${cor}`}>
        {fmtBRL(valor)}
      </div>
    </div>
  );
}
