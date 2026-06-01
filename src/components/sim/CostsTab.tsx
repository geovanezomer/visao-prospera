import { AppState, BusinessType, CostCategory, CostLine, COST_VENDAS_LABEL, SUBCATEGORIES } from "@/lib/finance/types";
import { fmtBRL, fmtPct, MESES, sum } from "@/lib/finance/format";
import { monthValues } from "@/lib/finance/calculations";
import { defaultCostsFor } from "@/lib/finance/defaults";
import { MoneyInput, SectionTitle, StatCard } from "./primitives";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

export function CostsTab({ state, update }: { state: AppState; update: Updater }) {
  const business = state.businessType;
  const receitaBrutaAnual = sum(state.revenue.bruta);
  const cvLabel = COST_VENDAS_LABEL[business];
  const subcats = SUBCATEGORIES[business];

  const byCat = (cat: CostCategory) => state.costs.filter((c) => c.category === cat);

  const updateLine = (id: string, patch: Partial<CostLine>) =>
    update((s) => ({ ...s, costs: s.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const setMonth = (id: string, i: number, v: number) => {
    const cur = state.costs.find((c) => c.id === id);
    if (!cur) return;
    updateLine(id, { values: cur.values.map((x, j) => (j === i ? v : x)) });
  };

  const setFixed = (id: string, fixed: boolean) => updateLine(id, { fixed });

  const addLine = (category: CostCategory, subcategory?: string) => {
    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newLine: CostLine = {
      id,
      label: "Nova rubrica",
      category,
      subcategory,
      values: Array(12).fill(0),
      fixed: true,
      custom: true,
    };
    update((s) => ({ ...s, costs: [...s.costs, newLine] }));
  };

  const removeLine = (id: string) =>
    update((s) => ({ ...s, costs: s.costs.filter((c) => c.id !== id) }));

  const setLabel = (id: string, label: string) => updateLine(id, { label });
  const setSubcat = (id: string, subcategory: string) =>
    updateLine(id, { subcategory, semCredito: subcategory === "icms_st" ? true : undefined });

  const reloadModel = () => {
    update((s) => ({ ...s, costs: defaultCostsFor(business) }));
  };

  // totais
  const totCV = sum(byCat("custo_vendas").flatMap(monthValues));
  const totFix = sum(byCat("fixo").flatMap(monthValues));
  const totVar = sum(byCat("variavel").flatMap(monthValues));
  const totFin = sum(byCat("financeiro").flatMap(monthValues));
  const totGeral = totCV + totFix + totVar + totFin;

  const pctRec = (v: number) => (receitaBrutaAnual > 0 ? v / receitaBrutaAnual : 0);

  return (
    <div className="space-y-6">
      {/* Sumário */}
      <div className="grid gap-3 md:grid-cols-5">
        <StatCard
          label={`${cvLabel.short} — Custo de Vendas`}
          value={fmtBRL(totCV)}
          tone="neg"
          sub={fmtPct(pctRec(totCV)) + " da receita"}
          hint={`${cvLabel.long}. Custos diretamente ligados ao produto/serviço vendido — variam com o volume.`}
        />
        <StatCard
          label="Custos Fixos"
          value={fmtBRL(totFix)}
          tone="neg"
          sub={fmtPct(pctRec(totFix)) + " da receita"}
          hint="Não variam com o volume vendido (aluguel, pró-labore, contabilidade…)."
        />
        <StatCard
          label="Custos Variáveis"
          value={fmtBRL(totVar)}
          tone="neg"
          sub={fmtPct(pctRec(totVar)) + " da receita"}
          hint="Variam com vendas, mas não são custo direto do produto (marketing, comissões, frete de venda…)."
        />
        <StatCard
          label="Custos Financeiros"
          value={fmtBRL(totFin)}
          tone="neg"
          sub={fmtPct(pctRec(totFin)) + " da receita"}
          hint="Juros, IOF, antecipação de recebíveis, tarifas bancárias."
        />
        <StatCard label="Total de Custos" value={fmtBRL(totGeral)} tone="neg" sub={fmtPct(pctRec(totGeral)) + " da receita"} hint={{ description: "Soma de todos os custos (vendas + fixos + variáveis + financeiros). Quanto menor o % sobre a receita, mais saudável a operação.", formula: "Custo de Vendas + Custos Fixos + Custos Variáveis + Custos Financeiros" }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/30 px-4 py-2 text-xs text-muted-foreground">
        <span>
          Empresa: <span className="font-medium text-foreground">{businessLabel(business)}</span> · rótulo do Custo de Vendas: <span className="font-mono text-primary">{cvLabel.short}</span>
        </span>
        <ConfirmDialog
          title={`Recarregar modelo de custos para ${businessLabel(business)}?`}
          description="Todas as linhas de custos atuais serão substituídas pelo modelo padrão deste tipo de empresa. Esta ação não pode ser desfeita."
          confirmLabel="Recarregar"
          destructive
          onConfirm={reloadModel}
          trigger={
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Recarregar modelo {businessLabel(business)}
            </Button>
          }
        />
      </div>

      {/* Custo de Vendas */}
      <SectionBlock
        title={`Custo de Vendas — ${cvLabel.short} (${cvLabel.long})`}
        hint="Custos diretamente ligados à produção/aquisição do que é vendido. Subcategorias seguem o tipo de empresa selecionado."
        accentClass="border-l-primary"
        onAdd={() => addLine("custo_vendas", subcats[0]?.id)}
      >
        {subcats.map((sc) => {
          const lines = byCat("custo_vendas").filter((l) => (l.subcategory || subcats[0].id) === sc.id);
          if (lines.length === 0) {
            return (
              <SubcatHeader key={sc.id} label={sc.label}>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => addLine("custo_vendas", sc.id)}>
                  <Plus className="mr-1 h-3 w-3" /> Adicionar
                </Button>
              </SubcatHeader>
            );
          }
          return (
            <div key={sc.id}>
              <SubcatHeader label={sc.label}>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => addLine("custo_vendas", sc.id)}>
                  <Plus className="mr-1 h-3 w-3" /> Adicionar
                </Button>
              </SubcatHeader>
              <CostTable
                lines={lines}
                receitaBrutaAnual={receitaBrutaAnual}
                onMonth={setMonth}
                onFixed={setFixed}
                onLabel={setLabel}
                onRemove={removeLine}
                onSubcat={setSubcat}
                subcats={subcats}
              />
            </div>
          );
        })}
        {/* Linhas sem subcategoria reconhecida (defensivo) */}
        {(() => {
          const known = new Set(subcats.map((s) => s.id));
          const orphan = byCat("custo_vendas").filter((l) => !l.subcategory || !known.has(l.subcategory));
          if (orphan.length === 0) return null;
          return (
            <div>
              <SubcatHeader label="Outros / sem classificação" />
              <CostTable
                lines={orphan}
                receitaBrutaAnual={receitaBrutaAnual}
                onMonth={setMonth}
                onFixed={setFixed}
                onLabel={setLabel}
                onRemove={removeLine}
                onSubcat={setSubcat}
                subcats={subcats}
              />
            </div>
          );
        })()}
      </SectionBlock>

      {/* Custos Fixos */}
      <SectionBlock
        title="Custos e Despesas Fixas"
        hint="Não variam com o volume vendido. Compõem a estrutura mínima de operação."
        accentClass="border-l-[color:var(--warning)]"
        onAdd={() => addLine("fixo")}
      >
        <CostTable
          lines={byCat("fixo")}
          receitaBrutaAnual={receitaBrutaAnual}
          onMonth={setMonth}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Custos Variáveis */}
      <SectionBlock
        title="Custos e Despesas Variáveis"
        hint="Variam proporcionalmente às vendas — comissões, marketing, frete sobre vendas etc."
        accentClass="border-l-[#5BA8F5]"
        onAdd={() => addLine("variavel")}
      >
        <CostTable
          lines={byCat("variavel")}
          receitaBrutaAnual={receitaBrutaAnual}
          onMonth={setMonth}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Custos Financeiros */}
      <SectionBlock
        title="Custos Financeiros"
        hint="Juros, IOF, tarifas bancárias e antecipação de recebíveis."
        accentClass="border-l-neg"
        onAdd={() => addLine("financeiro")}
      >
        <CostTable
          lines={byCat("financeiro")}
          receitaBrutaAnual={receitaBrutaAnual}
          onMonth={setMonth}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>
    </div>
  );
}

function businessLabel(b: BusinessType) {
  return b === "industria" ? "Indústria" : b === "comercio" ? "Comércio / Revenda" : "Prestadora de serviços";
}

function SectionBlock({
  title,
  hint,
  accentClass,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  accentClass: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border/60 border-l-4 bg-card/40 ${accentClass}`}>
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <Button size="sm" variant="outline" onClick={onAdd} className="h-7 text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
        </Button>
      </div>
      <div className="space-y-4 p-2">{children}</div>
    </div>
  );
}

function SubcatHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">{label}</span>
      {children}
    </div>
  );
}

function CostTable({
  lines,
  receitaBrutaAnual,
  onMonth,
  onFixed,
  onLabel,
  onRemove,
  onSubcat,
  subcats,
}: {
  lines: CostLine[];
  receitaBrutaAnual: number;
  onMonth: (id: string, i: number, v: number) => void;
  onFixed: (id: string, fixed: boolean) => void;
  onLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onSubcat?: (id: string, sc: string) => void;
  subcats?: { id: string; label: string }[];
}) {
  if (lines.length === 0) {
    return <div className="px-4 py-3 text-xs text-muted-foreground">Nenhuma rubrica nesta categoria. Use “+ Adicionar linha”.</div>;
  }
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[1200px] text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-56 px-3 py-2">Rubrica</th>
            <th className="w-24 px-2 py-2 text-center">Modo</th>
            {MESES.map((m) => (
              <th key={m} className="px-1 py-2 text-right">{m}</th>
            ))}
            <th className="px-3 py-2 text-right">Anual</th>
            <th className="w-14 px-2 py-2 text-right">% Rec</th>
            <th className="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {lines.map((c) => {
            const vals = monthValues(c);
            const anual = sum(vals);
            const pct = receitaBrutaAnual > 0 ? anual / receitaBrutaAnual : 0;
            return (
              <tr key={c.id} className="border-t border-border/40 align-middle">
                <td className="px-3 py-2">
                  {c.custom ? (
                    <input
                      value={c.label}
                      onChange={(e) => onLabel(c.id, e.target.value)}
                      className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  ) : (
                    <span className="text-xs">{c.label}</span>
                  )}
                  {subcats && onSubcat && c.custom && (
                    <div className="mt-1">
                      <Select value={c.subcategory || subcats[0].id} onValueChange={(v) => onSubcat(c.id, v)}>
                        <SelectTrigger className="h-6 w-full text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {subcats.map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-[10px]">{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>Fixo</span>
                    <Switch checked={!c.fixed} onCheckedChange={(v) => onFixed(c.id, !v)} />
                    <span>Mensal</span>
                  </div>
                </td>
                {c.fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                      <div className="w-36">
                        <MoneyInput
                          value={c.values[0]}
                          onChange={(n) => {
                            for (let i = 0; i < 12; i++) onMonth(c.id, i, n);
                          }}
                        />
                      </div>
                    </div>
                  </td>
                ) : (
                  vals.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => onMonth(c.id, i, n)} />
                    </td>
                  ))
                )}
                <td className="num px-3 py-2 text-right text-neg">{fmtBRL(anual)}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pct)}</td>
                <td className="px-1 py-2 text-center">
                  {c.custom && (
                    <button
                      onClick={() => onRemove(c.id)}
                      title="Remover linha"
                      className="text-muted-foreground transition hover:text-neg"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

