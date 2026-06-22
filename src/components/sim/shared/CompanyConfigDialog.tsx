// ============================================================================
// CompanyConfigDialog — Cadastro centralizado da empresa (Fase 2).
//
// Substitui inputs inline da sidebar e o seletor de regime na TaxTab.
// Centraliza tudo que descreve a empresa: identidade, setor/ramo, headcount,
// regime tributário e período de análise.
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, RotateCcw, Info } from "lucide-react";
// RadioGroup removido: headcount agora é input numérico exato.
import { useFinance, usePatchTax } from "@/engines/finance/AppStateContext";
import type { AppState, BusinessType, TaxRegime } from "@/engines/finance/types";
import { listSectors, getSector } from "@/engines/benchmark/sectors";
import { archiveYearAsHistorical, listHistoricals } from "@/engines/scenarios/store";
import { toast } from "sonner";

const MESES_FISCAIS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Validação Zod — bloqueia entradas absurdas antes de persistir no AppState. */
const benchmarkCustomSchema = z
  .object({
    margemBruta: z.number().min(0).max(100).optional(),
    margemEbitda: z.number().min(-50).max(100).optional(),
    margemLiquida: z.number().min(-50).max(100).optional(),
    giroAtivo: z.number().min(0).max(20).optional(),
    endividamento: z.number().min(0).max(100).optional(),
    pmr: z.number().min(0).max(365).optional(),
    pmp: z.number().min(0).max(365).optional(),
    evEbitda: z.number().min(0).max(30).optional(),
  })
  .optional();

const formSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Nome obrigatório")
    .max(120, "Máximo 120 caracteres"),
  businessType: z.enum(["servicos", "comercio", "industria"]),
  ramoAtuacao: z.string().trim().max(60).optional().or(z.literal("")),
  benchmarkCustom: benchmarkCustomSchema,
  numColaboradores: z
    .number({ invalid_type_error: "Informe um número" })
    .int("Use um número inteiro")
    .min(0, "Não pode ser negativo")
    .max(100000, "Valor irreal"),
  regime: z.enum(["simples", "presumido", "real"]),
  periodoAnaliseMeses: z.union([
    z.literal(6),
    z.literal(12),
    z.literal(24),
    z.literal(36),
  ]),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  margemAlvoPct: z
    .number()
    .min(-100, "Margem inválida")
    .max(100, "Margem inválida")
    .optional(),
});

/** Métricas do benchmark personalizável (P50). Mantém ordem de exibição. */
const BENCHMARK_FIELDS = [
  { key: "margemBruta", label: "Margem Bruta", unit: "%", step: 0.5 },
  { key: "margemEbitda", label: "Margem EBITDA", unit: "%", step: 0.5 },
  { key: "margemLiquida", label: "Margem Líquida", unit: "%", step: 0.5 },
  { key: "giroAtivo", label: "Giro do Ativo", unit: "x", step: 0.1 },
  { key: "endividamento", label: "Endividamento", unit: "%", step: 1 },
  { key: "pmr", label: "PMR", unit: "dias", step: 1 },
  { key: "pmp", label: "PMP", unit: "dias", step: 1 },
  { key: "evEbitda", label: "EV/EBITDA", unit: "x", step: 0.5 },
] as const;
type BenchmarkKey = (typeof BENCHMARK_FIELDS)[number]["key"];

type FormData = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompanyConfigDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Empresa</DialogTitle>
          <DialogDescription>
            Dados centralizados da empresa, regime tributário atual e período de análise.
            Estas configurações afetam cálculos em todas as abas.
          </DialogDescription>
        </DialogHeader>
        <CompanyConfigForm onCommitted={() => onOpenChange(false)} showArchiveSection />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Formulário de configuração da empresa em formato embarcável (sem Dialog).
 * Usado dentro de TaxSettingsDialog (passo "Empresa") e também pelo wrapper
 * CompanyConfigDialog. Commita campos diretamente no AppState a cada mudança.
 */
export function CompanyConfigForm({
  onCommitted,
  showArchiveSection = false,
}: {
  onCommitted?: () => void;
  showArchiveSection?: boolean;
}) {
  const { state, update } = useFinance();
  const setTax = usePatchTax();
  const [form, setForm] = useState<FormData>(() => buildFormFromState(state));

  // Re-sincroniza quando o AppState muda externamente.
  useEffect(() => {
    setForm(buildFormFromState(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.companyName,
    state.businessType,
    state.ramoAtuacao,
    state.benchmarkCustom,
    state.numColaboradores,
    state.headcountRange,
    state.periodoAnaliseMeses,
    state.fiscalYearStartMonth,
    state.margemAlvoPct,
    state.tax.regime,
  ]);

  // Lista de setores (benchmarks) disponíveis para o businessType corrente.
  const setoresDisponiveis = useMemo(
    () => listSectors(form.businessType),
    [form.businessType],
  );

  // Setor selecionado (referência para defaults do benchmark personalizado).
  const setorSelecionado = useMemo(
    () => (form.ramoAtuacao ? getSector(form.ramoAtuacao) : undefined) ?? setoresDisponiveis[0],
    [form.ramoAtuacao, setoresDisponiveis],
  );

  const [benchOpen, setBenchOpen] = useState(false);

  /** Commit imediato (após validação leve). Mostra toast apenas em erro. */
  const commit = (next: FormData) => {
    setForm(next);
    const parsed = formSchema.safeParse(next);
    if (!parsed.success) return; // mantém valor local sem persistir
    const d = parsed.data;
    update({
      companyName: d.companyName,
      businessType: d.businessType,
      ramoAtuacao: d.ramoAtuacao || undefined,
      benchmarkCustom:
        d.benchmarkCustom && Object.values(d.benchmarkCustom).some((v) => v != null)
          ? d.benchmarkCustom
          : undefined,
      numColaboradores: d.numColaboradores,
      headcountRange: rangeFromNumber(d.numColaboradores),
      periodoAnaliseMeses: d.periodoAnaliseMeses,
      fiscalYearStartMonth: d.fiscalYearStartMonth,
      margemAlvoPct: d.margemAlvoPct,
      moedaBase: "BRL",
    });
    setTax({ regime: d.regime });
  };

  /** Atualiza um único campo do benchmark personalizado. */
  const updateBenchField = (key: BenchmarkKey, value: number | undefined) => {
    const nextCustom = { ...(form.benchmarkCustom ?? {}), [key]: value };
    if (value === undefined) delete (nextCustom as Record<string, unknown>)[key];
    commit({ ...form, benchmarkCustom: nextCustom });
  };

  /** Limpa todo o benchmark personalizado (volta para os defaults do setor). */
  const resetBenchmark = () => {
    commit({ ...form, benchmarkCustom: undefined });
    toast.success("Benchmark restaurado para os valores do setor");
  };

  return (
    <div className="space-y-5 py-2">
      {/* Identidade */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Identidade
        </h3>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Nome da Empresa / Arquivo *</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => commit({ ...form, companyName: e.target.value })}
              maxLength={120}
              placeholder="Minha Empresa LTDA"
            />
          </div>
        </div>
      </section>

      {/* Setor e Ramo */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Setor de Atuação
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Setor *</Label>
            <Select
              value={form.businessType}
              onValueChange={(v) => {
                const bt = v as BusinessType;
                const firstSector = listSectors(bt)[0]?.id ?? "";
                // Ao trocar setor, default para o 1º ramo e zera benchmark custom.
                commit({
                  ...form,
                  businessType: bt,
                  ramoAtuacao: firstSector,
                  benchmarkCustom: undefined,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="servicos">Serviços</SelectItem>
                <SelectItem value="comercio">Comércio</SelectItem>
                <SelectItem value="industria">Indústria</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ramo de atuação</Label>
            <Select
              value={form.ramoAtuacao || setoresDisponiveis[0]?.id || ""}
              onValueChange={(v) =>
                // Ao trocar ramo, zera benchmark personalizado (defaults vêm do novo setor).
                commit({ ...form, ramoAtuacao: v, benchmarkCustom: undefined })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {setoresDisponiveis.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Define os benchmarks comparativos. Valores pré-calibrados por setor.
            </p>
          </div>
        </div>

        {/* Benchmark personalizado (avançado) */}
        {setorSelecionado && (
          <Collapsible open={benchOpen} onOpenChange={setBenchOpen}>
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/60 px-3 py-2">
              <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left text-xs font-medium">
                {benchOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Benchmark do Setor Personalizado{" "}
                <span className="text-[10px] font-normal text-muted-foreground">
                  (opcional — já preenchido com valores do setor)
                </span>
              </CollapsibleTrigger>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Como os quartis são calculados"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-[11px] leading-snug">
                    Você define apenas a <strong>mediana (P50)</strong> de cada indicador.
                    O sistema deriva os quartis automaticamente:
                    <br />• <strong>P25</strong> = P50 × 0,80 (pior 25%)
                    <br />• <strong>P75</strong> = P50 × 1,20 (melhor 25%)
                    <br />Assim a comparação por quartil continua coerente sem você precisar
                    digitar 24 valores.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  resetBenchmark();
                }}
                disabled={!form.benchmarkCustom}
                className="h-7 px-2 text-[11px]"
                title="Voltar aos valores padrão do setor selecionado"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Restaurar
              </Button>
            </div>
            <CollapsibleContent className="mt-2 space-y-2 rounded-md border border-border/40 p-3">
              <p className="text-[11px] text-muted-foreground">
                Ajuste a mediana (P50) de cada indicador para refletir a realidade do seu
                cliente. Os quartis P25/P75 são derivados automaticamente como ±20%. Campos em
                branco usam o valor padrão do setor <strong>{setorSelecionado.label}</strong>.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {BENCHMARK_FIELDS.map((f) => {
                  const defaultP50 = setorSelecionado[f.key].p50;
                  const current = form.benchmarkCustom?.[f.key];
                  return (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`bm-${f.key}`} className="text-[11px]">
                        {f.label} ({f.unit})
                      </Label>
                      <Input
                        id={`bm-${f.key}`}
                        type="number"
                        step={f.step}
                        value={current ?? ""}
                        placeholder={String(defaultP50)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateBenchField(
                            f.key,
                            raw === "" ? undefined : Number(raw),
                          );
                        }}
                        className="h-8"
                      />
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>


      {/* Porte */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Porte
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="numColaboradores">Número de colaboradores *</Label>
          <Input
            id="numColaboradores"
            type="number"
            min={0}
            max={100000}
            step={1}
            value={Number.isFinite(form.numColaboradores) ? form.numColaboradores : 0}
            onChange={(e) =>
              commit({
                ...form,
                numColaboradores: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
            className="w-32"
          />
          <p className="text-[10px] text-muted-foreground">
            Base para indicadores de produtividade (Receita/Colaborador, Lucro/Colaborador etc.).
            A faixa para benchmarks é derivada automaticamente: {rangeFromNumber(form.numColaboradores)}.
          </p>
        </div>
      </section>

      {/* Tributação */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tributação
        </h3>
        <div className="space-y-1.5">
          <Label>Regime tributário atual *</Label>
          <Select
            value={form.regime}
            onValueChange={(v) => commit({ ...form, regime: v as TaxRegime })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simples">Simples Nacional</SelectItem>
              <SelectItem value="presumido">Lucro Presumido</SelectItem>
              <SelectItem value="real">Lucro Real</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Os passos seguintes detalham alíquotas e parâmetros desse regime.
          </p>
        </div>
      </section>

      {/* Análise */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Período de Análise
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Janela de análise</Label>
            <Select
              value={String(form.periodoAnaliseMeses)}
              onValueChange={(v) =>
                commit({
                  ...form,
                  periodoAnaliseMeses: Number(v) as FormData["periodoAnaliseMeses"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">Últimos 6 meses</SelectItem>
                <SelectItem value="12">Últimos 12 meses</SelectItem>
                <SelectItem value="24">Últimos 24 meses</SelectItem>
                <SelectItem value="36">Últimos 36 meses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Início do exercício fiscal</Label>
            <Select
              value={String(form.fiscalYearStartMonth)}
              onValueChange={(v) => commit({ ...form, fiscalYearStartMonth: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESES_FISCAIS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {showArchiveSection && (
        <section className="space-y-2 rounded-md border border-dashed border-border/60 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fechamento de ano
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Arquiva o AppState atual como snapshot histórico. Após 2+ snapshots, o
            cabeçalho das abas com histórico mostra pills para navegar e comparar períodos.
          </p>
          <ArchiveYearButton onClose={() => onCommitted?.()} />
        </section>
      )}
    </div>
  );
}

/** Deriva a faixa de headcount a partir do número exato (para benchmarks). */
export function rangeFromNumber(n: number): "1-9" | "10-49" | "50-99" | "100+" {
  const v = Math.max(0, Math.floor(n || 0));
  if (v < 10) return "1-9";
  if (v < 50) return "10-49";
  if (v < 100) return "50-99";
  return "100+";
}

/** Converte AppState → estado inicial do formulário com defaults sensatos. */
function buildFormFromState(state: AppState): FormData {
  // Migração leve: usa número exato; se ausente, infere a partir da faixa antiga.
  const inferNum = (): number => {
    if (typeof state.numColaboradores === "number") return state.numColaboradores;
    switch (state.headcountRange) {
      case "10-49": return 10;
      case "50-99": return 50;
      case "100+": return 100;
      case "1-9":
      default: return 1;
    }
  };
  // Se ramoAtuacao salvo não bate com SECTORS (legado do RAMOS_POR_SETOR), cai
  // para o 1º setor do businessType — assim os benchmarks sempre têm um valor válido.
  const ramoSalvo = state.ramoAtuacao ?? "";
  const ramoEfetivo = getSector(ramoSalvo)?.id ?? listSectors(state.businessType)[0]?.id ?? "";
  return {
    companyName: state.companyName ?? "",
    businessType: state.businessType,
    ramoAtuacao: ramoEfetivo,
    benchmarkCustom: state.benchmarkCustom,
    numColaboradores: inferNum(),
    regime: state.tax.regime,
    periodoAnaliseMeses: state.periodoAnaliseMeses ?? 12,
    fiscalYearStartMonth: state.fiscalYearStartMonth ?? 1,
    margemAlvoPct: state.margemAlvoPct,
  };
}

/** Botão para arquivar o ano corrente como snapshot histórico. */
function ArchiveYearButton({ onClose }: { onClose: () => void }) {
  const { state } = useFinance();
  const company = state.companyName || "default";
  // Default: ano corrente do calendário (poderia derivar do fiscalYearStartMonth
  // em versão futura — por ora, simples e previsível).
  const [year, setYear] = useState(() => new Date().getFullYear());
  const existing = listHistoricals(company);
  const jaArquivado = existing.some((h) => h.fiscalYear === year);

  const handleArchive = () => {
    archiveYearAsHistorical(company, year, state);
    toast.success(
      jaArquivado
        ? `Snapshot ${year} atualizado`
        : `Ano ${year} arquivado como snapshot histórico`,
    );
    onClose();
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor="archiveYear" className="text-[11px]">
          Ano fiscal
        </Label>
        <Input
          id="archiveYear"
          type="number"
          min={2000}
          max={2100}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
          className="h-8 w-24"
        />
      </div>
      <Button size="sm" variant="secondary" onClick={handleArchive}>
        {jaArquivado ? `Atualizar snapshot ${year}` : `Arquivar ano ${year}`}
      </Button>
      {existing.length > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {existing.length} snapshot{existing.length > 1 ? "s" : ""} salvo
          {existing.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
