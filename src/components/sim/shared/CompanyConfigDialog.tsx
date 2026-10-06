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
import { ChevronDown, ChevronRight, RotateCcw, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/sim/shared/primitives";
// RadioGroup removido: headcount agora é input numérico exato.
import { useFinance, usePatchTax } from "@/engines/finance/AppStateContext";
import type { AppState, BusinessType, TaxRegime, SocioRetirada } from "@/engines/finance/types";
import { listSectors, getSector } from "@/engines/benchmark/sectors";
import { archiveYearAsHistorical, listHistoricals } from "@/engines/scenarios/store";
import { applySociosChange } from "@/engines/finance/socios";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { toast } from "sonner";
import { renomearEmpresaArmazenada } from "@/engines/scenarios/store";

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
  companyName: z.string().trim().min(1, "Nome obrigatório").max(120, "Máximo 120 caracteres"),
  businessType: z.enum(["servicos", "comercio", "industria"]),
  ramoAtuacao: z.string().trim().max(60).optional().or(z.literal("")),
  benchmarkCustom: benchmarkCustomSchema,
  numColaboradores: z
    .number({ error: "Informe um número" })
    .int("Use um número inteiro")
    .min(0, "Não pode ser negativo")
    .max(100000, "Valor irreal"),
  // numSocios removido: agora é derivado de state.socios.length na seção Sócios.
  regime: z.enum(["simples", "presumido", "real"]),
  periodoAnaliseMeses: z.union([z.literal(6), z.literal(12), z.literal(24), z.literal(36)]),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  margemAlvoPct: z.number().min(-100, "Margem inválida").max(100, "Margem inválida").optional(),
  payoutPolicyPct: z.number().min(0).max(100),
  reservaMinimaMensal: z.number().min(0).max(1_000_000_000),
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Empresa</DialogTitle>
          <DialogDescription>
            Dados centralizados da empresa, regime tributário, sócios e período de análise. Estas
            configurações afetam cálculos em todas as abas.
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
    state.numSocios,
    state.headcountRange,
    state.periodoAnaliseMeses,
    state.fiscalYearStartMonth,
    state.margemAlvoPct,
    state.payoutPolicyPct,
    state.reservaMinimaMensal,
    state.tax.regime,
  ]);

  // Lista de setores (benchmarks) disponíveis para o businessType corrente.
  const setoresDisponiveis = useMemo(() => listSectors(form.businessType), [form.businessType]);

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
      payoutPolicyPct: d.payoutPolicyPct,
      reservaMinimaMensal: d.reservaMinimaMensal,
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
              // Grava ao sair do campo: o nome identifica o arquivo da empresa
              // (anos arquivados, plano de ação); gravar a cada letra criava uma
              // cópia por trecho digitado ("A", "Ac", "Acm"…).
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              onBlur={() => {
                const antigo = state.companyName;
                commit(form);
                const novo = form.companyName.trim();
                if (novo && novo !== antigo) renomearEmpresaArmazenada(antigo, novo);
              }}
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
              <HelpTip
                text="Você define apenas a mediana (P50) de cada indicador. O sistema deriva os quartis P25 e P75 automaticamente, mantendo a comparação consistente sem precisar digitar 24 valores."
                formula="P25 = P50 × 0,80   ·   P75 = P50 × 1,20"
                example="Se a Margem EBITDA P50 = 15%, então P25 = 12% e P75 = 18%."
              />
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
                Ajuste a mediana (P50) de cada indicador para refletir a realidade do seu cliente.
                Os quartis P25/P75 são derivados automaticamente como ±20%. Campos em branco usam o
                valor padrão do setor <strong>{setorSelecionado.label}</strong>.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {BENCHMARK_FIELDS.map((f) => {
                  const sectorBand = setorSelecionado[f.key];
                  const defaultP50 = sectorBand.p50;
                  const current = form.benchmarkCustom?.[f.key];
                  const isCustom = current != null;
                  const effectiveP50 = isCustom ? current : defaultP50;
                  const p25 = +(effectiveP50 * 0.8).toFixed(2);
                  const p75 = +(effectiveP50 * 1.2).toFixed(2);
                  const fmt = (n: number) =>
                    `${n}${f.unit === "%" ? "%" : f.unit === "x" ? "x" : " " + f.unit}`;
                  return (
                    <div key={f.key} className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Label htmlFor={`bm-${f.key}`} className="text-[11px]">
                          {f.label} ({f.unit})
                        </Label>
                        <HelpTip
                          text={`Origem: ${
                            isCustom ? "valor personalizado" : `setor ${setorSelecionado.label}`
                          }. Quartis efetivos: P25 ${fmt(p25)} · P50 ${fmt(effectiveP50)} · P75 ${fmt(p75)}.${
                            isCustom ? ` Padrão do setor: ${fmt(defaultP50)}.` : ""
                          }`}
                          formula="P25 = P50 × 0,80   ·   P75 = P50 × 1,20"
                          example={`P50 = ${fmt(effectiveP50)} → P25 = ${fmt(p25)}, P75 = ${fmt(p75)}`}
                        />
                      </div>
                      <Input
                        id={`bm-${f.key}`}
                        type="number"
                        step={f.step}
                        value={current ?? ""}
                        placeholder={String(defaultP50)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateBenchField(f.key, raw === "" ? undefined : Number(raw));
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
        <div className="grid gap-3 sm:grid-cols-2">
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
            />
            <p className="text-[10px] text-muted-foreground">
              Base para indicadores de produtividade (Receita/Colaborador, Lucro/Colaborador etc.).
            </p>
          </div>
          {/* Campo "Número de sócios / acionistas" removido: derivado automaticamente
              do cadastro de sócios (seção abaixo). */}
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

      {/* Política de Distribuição de Lucros */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Política de Distribuição de Lucros
          </h3>
          <HelpTip
            text="Define quanto do lucro líquido mensal é distribuído aos sócios e quanto fica retido na empresa para reinvestimento, formação de caixa ou reserva. Usado no cartão 'Pró-labore × Distribuição de Lucros' para limitar a distribuição isenta proporcional à participação de cada sócio."
            formula="Lucro distribuível = max(0, Lucro Líquido mensal − Reserva mínima) × Payout%"
            example="LL = R$ 100.000/mês · Reserva = R$ 20.000 · Payout 60% → distribuível = (100.000 − 20.000) × 60% = R$ 48.000/mês. Os outros R$ 52.000 ficam em caixa/reservas."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="payoutPolicyPct">Payout — % do lucro distribuído</Label>
            <Input
              id="payoutPolicyPct"
              type="number"
              min={0}
              max={100}
              step={1}
              value={Number.isFinite(form.payoutPolicyPct) ? form.payoutPolicyPct : 100}
              onChange={(e) =>
                commit({
                  ...form,
                  payoutPolicyPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                })
              }
            />
            <p className="text-[10px] text-muted-foreground">
              Padrão 100% (distribui todo o lucro). Use 0% para reter integralmente.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reservaMinimaMensal">Reserva mínima mensal (R$)</Label>
            <Input
              id="reservaMinimaMensal"
              type="number"
              min={0}
              step={100}
              value={Number.isFinite(form.reservaMinimaMensal) ? form.reservaMinimaMensal : 0}
              onChange={(e) =>
                commit({
                  ...form,
                  reservaMinimaMensal: Math.max(0, Number(e.target.value) || 0),
                })
              }
            />
            <p className="text-[10px] text-muted-foreground">
              Valor absoluto retido antes do payout (capital de giro, reserva legal,
              reinvestimento).
            </p>
          </div>
        </div>
      </section>

      {/* Sócios — cadastro centralizado (usado em Pró-labore × Distribuição) */}
      <SociosSection />

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
            Arquiva o AppState atual como snapshot histórico. Após 2+ snapshots, o cabeçalho das
            abas com histórico mostra pills para navegar e comparar períodos.
          </p>
          <ArchiveYearButton onClose={() => onCommitted?.()} />
        </section>
      )}
    </div>
  );
}

/** Deriva a faixa de headcount a partir do número exato (para benchmarks). */
function rangeFromNumber(n: number): "1-9" | "10-49" | "50-99" | "100+" {
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
      case "10-49":
        return 10;
      case "50-99":
        return 50;
      case "100+":
        return 100;
      case "1-9":
      default:
        return 1;
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
    payoutPolicyPct: state.payoutPolicyPct ?? 100,
    reservaMinimaMensal: state.reservaMinimaMensal ?? 0,
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
      jaArquivado ? `Snapshot ${year} atualizado` : `Ano ${year} arquivado como snapshot histórico`,
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

/* ============================================================================
 * SociosSection — cadastro centralizado dos sócios.
 *
 * Editado aqui (Configurações → Empresa) e exibido em modo somente-leitura
 * no card "Pró-labore × Distribuição de Lucros". Os campos Operacional,
 * Pró-labore e Dependentes ficam APENAS aqui; o card de retiradas calcula
 * INSS, IRPF e Distribuição com base nestes dados.
 * ========================================================================== */
function novoSocio(idx: number, restantePct: number): SocioRetirada {
  return {
    id: `socio_${Date.now()}_${idx}`,
    nome: `Sócio ${idx + 1}`,
    participacaoPct: Math.max(0, Math.round(restantePct * 100) / 100),
    operacional: true,
    prolaboreMensal: 0,
    dependentes: 0,
    outrasDeducoes: 0,
    modo: "manual",
  };
}

function SociosSection() {
  const { state, update } = useFinance();
  const regime = resolveEffectiveRegime(state);
  const socios = state.socios ?? [];

  // Mantém state.numSocios sincronizado com o tamanho do cadastro (SSOT).
  // Substitui o antigo campo manual "Número de sócios / acionistas".
  useEffect(() => {
    if (state.numSocios !== socios.length) {
      update({ numSocios: socios.length });
    }
  }, [socios.length, state.numSocios, update]);

  const setSocios = (next: SocioRetirada[]) =>
    update((s) => ({ ...applySociosChange(s, next, regime), numSocios: next.length }));

  const addSocio = () => {
    const usado = socios.reduce((a, s) => a + s.participacaoPct, 0);
    const restante = Math.max(0, 100 - usado);
    setSocios([...socios, novoSocio(socios.length, restante)]);
  };

  const removeSocio = (id: string) => {
    const restantes = socios.filter((s) => s.id !== id);
    if (restantes.length === 0) return setSocios([]);
    const somaRest = restantes.reduce((a, s) => a + s.participacaoPct, 0);
    let rebal: SocioRetirada[];
    if (somaRest > 0) {
      const fator = 100 / somaRest;
      rebal = restantes.map((s) => ({
        ...s,
        participacaoPct: Math.round(s.participacaoPct * fator * 100) / 100,
      }));
    } else {
      const cada = Math.round((100 / restantes.length) * 100) / 100;
      rebal = restantes.map((s) => ({ ...s, participacaoPct: cada }));
    }
    const soma = rebal.reduce((a, s) => a + s.participacaoPct, 0);
    const diff = Math.round((100 - soma) * 100) / 100;
    if (diff !== 0) {
      const last = rebal[rebal.length - 1];
      rebal[rebal.length - 1] = {
        ...last,
        participacaoPct: Math.round((last.participacaoPct + diff) * 100) / 100,
      };
    }
    setSocios(rebal);
  };

  const patchSocio = (id: string, patch: Partial<SocioRetirada>) =>
    setSocios(socios.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const somaPartic = socios.reduce((a, s) => a + s.participacaoPct, 0);
  const partOk = socios.length === 0 || Math.abs(somaPartic - 100) < 0.01;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sócios
          </h3>
          <HelpTip
            text="Cadastro dos sócios. Estes dados alimentam o card 'Pró-labore × Distribuição de Lucros'. A soma das participações deve fechar 100%. Pró-labore vira despesa administrativa (linha sintética) e INSS patronal (em Presumido/Real) é adicionado automaticamente."
            formula="Σ Participações = 100%"
            example="Sócio A: 60% · Sócio B: 40%"
          />
        </div>
        <Button size="sm" onClick={addSocio}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar sócio
        </Button>
      </div>

      {socios.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          Nenhum sócio cadastrado. Clique em <b>Adicionar sócio</b>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/60">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Nome do sócio</th>
                <th className="px-2 py-2 font-medium text-right">Participação (%)</th>
                <th className="px-2 py-2 font-medium text-center">Operacional</th>
                <th className="px-2 py-2 font-medium text-right">Pró-labore (mês)</th>
                <th className="px-2 py-2 font-medium text-right">Dependentes</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {socios.map((s) => (
                <tr key={s.id} className="border-b border-border/40 last:border-b-0">
                  <td className="px-2 py-1.5">
                    <Input
                      value={s.nome}
                      onChange={(e) => patchSocio(s.id, { nome: e.target.value })}
                      className="h-8 min-w-[160px]"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      value={s.participacaoPct}
                      onChange={(e) =>
                        patchSocio(s.id, { participacaoPct: Number(e.target.value) || 0 })
                      }
                      className="h-8 w-[90px] text-right"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Switch
                      checked={s.operacional}
                      onCheckedChange={(v) => patchSocio(s.id, { operacional: v })}
                    />
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
                      className="h-8 w-[120px] text-right"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      value={s.dependentes}
                      onChange={(e) =>
                        patchSocio(s.id, { dependentes: Number(e.target.value) || 0 })
                      }
                      className="h-8 w-[80px] text-right"
                    />
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
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/20 text-[11px] font-semibold">
                <td className="px-2 py-2 text-right">Total</td>
                <td
                  className={`px-2 py-2 text-right ${
                    partOk ? "text-foreground" : "text-[var(--warning)]"
                  }`}
                >
                  {somaPartic.toFixed(2)}%
                </td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!partOk && (
        <p className="text-[11px] text-[var(--warning)]">
          ⚠️ A soma das participações precisa fechar <b>100%</b> para a distribuição de lucros ser
          calculada corretamente.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Sócio operacional deve receber pró-labore ≥ salário mínimo (IN RFB 971/2009). No Simples
        Nacional não há INSS patronal sobre pró-labore; em Presumido/Real aplica-se 20%.
      </p>
    </section>
  );
}
