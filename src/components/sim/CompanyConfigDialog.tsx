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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useFinance, usePatchTax } from "@/engines/finance/AppStateContext";
import type { AppState, BusinessType, TaxRegime } from "@/engines/finance/types";
import { RAMOS_POR_SETOR } from "@/engines/finance/companyProfile";
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
const formSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Nome obrigatório")
    .max(120, "Máximo 120 caracteres"),
  cnpj: z
    .string()
    .trim()
    .max(20, "CNPJ inválido")
    .optional()
    .or(z.literal("")),
  businessType: z.enum(["servicos", "comercio", "industria"]),
  ramoAtuacao: z.string().trim().max(60).optional().or(z.literal("")),
  headcountRange: z.enum(["1-9", "10-49", "50-99", "100+"]),
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

type FormData = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompanyConfigDialog({ open, onOpenChange }: Props) {
  const { state, update } = useFinance();
  const setTax = usePatchTax();

  // Estado local — só persiste no AppState ao clicar "Salvar".
  const [form, setForm] = useState<FormData>(() => buildFormFromState(state));

  // Re-sincroniza ao reabrir o dialog (estado pode ter mudado por outra ação).
  useEffect(() => {
    if (open) setForm(buildFormFromState(state));
  }, [open, state]);

  const ramosDisponiveis = useMemo(
    () => RAMOS_POR_SETOR[form.businessType] ?? [],
    [form.businessType],
  );

  const handleSubmit = () => {
    const parsed = formSchema.safeParse(form);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      toast.error(firstError?.message ?? "Dados inválidos");
      return;
    }
    const d = parsed.data;
    // Patch parcial em AppState (campos top-level) + tax.regime via `set`.
    update({
      companyName: d.companyName,
      cnpj: d.cnpj || undefined,
      businessType: d.businessType,
      ramoAtuacao: d.ramoAtuacao || undefined,
      headcountRange: d.headcountRange,
      periodoAnaliseMeses: d.periodoAnaliseMeses,
      fiscalYearStartMonth: d.fiscalYearStartMonth,
      margemAlvoPct: d.margemAlvoPct,
      moedaBase: "BRL",
    });
    setTax({ regime: d.regime });
    toast.success("Configurações da empresa atualizadas");
    onOpenChange(false);
  };

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

        <div className="space-y-5 py-2">
          {/* Identidade */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Identidade
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Nome da empresa *</Label>
                <Input
                  id="companyName"
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  maxLength={120}
                  placeholder="Minha Empresa LTDA"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input
                  id="cnpj"
                  value={form.cnpj ?? ""}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  maxLength={20}
                  placeholder="00.000.000/0000-00"
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
                  onValueChange={(v) =>
                    // Ao trocar setor, limpa ramo (lista muda).
                    setForm({ ...form, businessType: v as BusinessType, ramoAtuacao: "" })
                  }
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
                  value={form.ramoAtuacao || ""}
                  onValueChange={(v) => setForm({ ...form, ramoAtuacao: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ramosDisponiveis.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Usado para comparar com benchmarks setoriais.
                </p>
              </div>
            </div>
          </section>

          {/* Porte */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Porte
            </h3>
            <div className="space-y-1.5">
              <Label>Número de colaboradores</Label>
              <RadioGroup
                value={form.headcountRange}
                onValueChange={(v) =>
                  setForm({ ...form, headcountRange: v as FormData["headcountRange"] })
                }
                className="grid grid-cols-4 gap-2"
              >
                {(["1-9", "10-49", "50-99", "100+"] as const).map((range) => (
                  <label
                    key={range}
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                  >
                    <RadioGroupItem value={range} className="sr-only" />
                    {range}
                  </label>
                ))}
              </RadioGroup>
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
                onValueChange={(v) => setForm({ ...form, regime: v as TaxRegime })}
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
                Detalhes de alíquotas e comparativo continuam na aba Regime Tributário.
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
                    setForm({
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
                  onValueChange={(v) =>
                    setForm({ ...form, fiscalYearStartMonth: Number(v) })
                  }
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
            <div className="space-y-1.5">
              <Label htmlFor="margemAlvo">Margem-alvo do consultor (%) — opcional</Label>
              <Input
                id="margemAlvo"
                type="number"
                step="0.5"
                value={form.margemAlvoPct ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    margemAlvoPct:
                      e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="Ex: 15"
              />
              <p className="text-[10px] text-muted-foreground">
                Usada como benchmark interno adicional ao setorial.
              </p>
            </div>
          </section>

          {/* Arquivamento de ano fiscal — alimenta as pills de período. */}
          <section className="space-y-2 rounded-md border border-dashed border-border/60 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fechamento de ano
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Arquiva o AppState atual como snapshot histórico. Após 2+ snapshots, o
              cabeçalho de Indicadores/DRE mostra pills para comparar períodos.
            </p>
            <ArchiveYearButton onClose={() => onOpenChange(false)} />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Converte AppState → estado inicial do formulário com defaults sensatos. */
function buildFormFromState(state: AppState): FormData {
  // Migração leve: se vier número de colaboradores antigo, mapeia para faixa.
  const inferRange = (): FormData["headcountRange"] => {
    if (state.headcountRange) return state.headcountRange;
    const n = state.numColaboradores ?? 0;
    if (n < 10) return "1-9";
    if (n < 50) return "10-49";
    if (n < 100) return "50-99";
    return "100+";
  };
  return {
    companyName: state.companyName ?? "",
    cnpj: state.cnpj ?? "",
    businessType: state.businessType,
    ramoAtuacao: state.ramoAtuacao ?? "",
    headcountRange: inferRange(),
    regime: state.tax.regime,
    periodoAnaliseMeses: state.periodoAnaliseMeses ?? 12,
    fiscalYearStartMonth: state.fiscalYearStartMonth ?? 1,
    margemAlvoPct: state.margemAlvoPct,
  };
}
