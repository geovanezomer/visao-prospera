// Card de Contratos de Dívida — substitui a entrada de "Empréstimos e
// financiamentos" por um detalhamento contrato a contrato (credor, saldo,
// taxa, sistema Price/SAC, prazo). Calcula serviço da dívida mensal
// e alimenta dividaOnerosa, cashflow.amortizacoes e o custo financeiro
// via a sincronização feita no parent (CapitalTab).
import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, Landmark } from "lucide-react";
import { fmtBRL, fmtNum } from "@/engines/finance/format";
import { MoneyInput, HelpTip, type HelpHint } from "@/components/sim/shared/primitives";
import type { DebtContract, DebtSystem } from "@/engines/finance/types";
import {
  aggregateContracts,
  scheduleContract,
  vencimentoLabel,
} from "@/engines/finance/debtContracts";

function newContract(): DebtContract {
  return {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    credor: "",
    descricao: "",
    saldoDevedor: 0,
    taxaAA: 18,
    sistema: "price",
    prazoMeses: 12,
  };
}

export function DebtContractsCard({
  contracts,
  onChange,
}: {
  contracts: DebtContract[];
  onChange: (next: DebtContract[]) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const agg = aggregateContracts(contracts);

  const update = (id: string, patch: Partial<DebtContract>) =>
    onChange(contracts.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id: string) => onChange(contracts.filter((c) => c.id !== id));
  const add = () => {
    const c = newContract();
    onChange([...contracts, c]);
    setExpanded(c.id);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" />
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Empréstimos e financiamentos
          </div>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            Novo
          </span>
        </div>
        <button
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs hover:border-primary/60 hover:text-primary transition"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar contrato
        </button>
      </div>

      {contracts.length === 0 ? (
        <button
          onClick={add}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-background/30 px-3 py-3 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar contrato de dívida (empréstimo, financiamento, debênture…)
        </button>
      ) : (
        <>
          {/* cabeçalho */}
          <div className="hidden md:grid grid-cols-[1.6fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr_24px] gap-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Credor / descrição</div>
            <div className="text-right">Saldo devedor</div>
            <div className="text-right inline-flex items-center justify-end gap-1">
              Taxa a.a.
              <HelpTip text="Taxa de juros anual do contrato (ao ano). Ex.: 18% a.a. equivale a aproximadamente 1,39% ao mês." />
            </div>
            <div className="text-center inline-flex items-center justify-center gap-1">
              Sistema
              <HelpTip text="Price = parcela mensal fixa (juros caem e amortização sobe ao longo do tempo). SAC = amortização constante (parcela começa maior e cai mês a mês). Bancos costumam usar Price em capital de giro e SAC em financiamentos longos." />
            </div>
            <div className="text-center">Vencimento</div>
            <div className="text-right">Parcela/mês</div>
            <div />
          </div>

          <div className="space-y-1">
            {contracts.map((c) => {
              const sch = scheduleContract(c);
              const isOpen = expanded === c.id;
              return (
                <div key={c.id} className="rounded-md border border-border/40 bg-background/30">
                  <div className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr_24px] gap-2 items-center px-2 py-2 text-xs">
                    <div className="col-span-2 md:col-span-1">
                      <div className="font-semibold text-foreground truncate">
                        {c.credor || "Sem credor"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.descricao || "—"}
                      </div>
                    </div>
                    <div className="text-right num font-semibold">{fmtBRL(c.saldoDevedor)}</div>
                    <div className="text-right num">{fmtNum(c.taxaAA, 1)}% a.a.</div>
                    <div className="text-center">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          c.sistema === "price"
                            ? "bg-primary/15 text-primary"
                            : "bg-success/15 text-success"
                        }`}
                      >
                        {c.sistema}
                      </span>
                    </div>
                    <div className="text-center text-[11px]">{vencimentoLabel(c.prazoMeses)}</div>
                    <div className="text-right num font-semibold text-warning">
                      {fmtBRL(sch.parcelaMes)}
                    </div>
                    <button
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                      className="ml-auto text-muted-foreground hover:text-primary"
                      aria-label="Detalhes"
                    >
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border/40 bg-background/40 p-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3 text-xs">
                      <Field label="Credor">
                        <input
                          value={c.credor}
                          onChange={(e) => update(c.id, { credor: e.target.value })}
                          placeholder="Ex.: Banco Bradesco"
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field label="Descrição">
                        <input
                          value={c.descricao ?? ""}
                          onChange={(e) => update(c.id, { descricao: e.target.value })}
                          placeholder="Ex.: Capital de giro"
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field
                        label="Saldo devedor (R$)"
                        hint="Quanto ainda falta pagar do contrato HOJE (principal em aberto). Não é o valor original do empréstimo — é o saldo atual que aparece no extrato do banco."
                      >
                        <MoneyInput
                          value={c.saldoDevedor}
                          onChange={(n) => update(c.id, { saldoDevedor: n })}
                        />
                      </Field>
                      <Field
                        label="Taxa a.a. (%)"
                        hint="Taxa de juros ANUAL do contrato. Se o banco informa só a taxa mensal, multiplique por 12 (aproximação) ou use: (1 + im)^12 − 1 para conversão exata."
                      >
                        <input
                          type="number"
                          step="0.1"
                          value={c.taxaAA}
                          onChange={(e) => update(c.id, { taxaAA: Number(e.target.value) || 0 })}
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field
                        label="Sistema de amortização"
                        hint="Price = parcela mensal FIXA (mais comum em capital de giro). SAC = você paga uma parcela maior no início que vai DIMINUINDO mês a mês (juros totais menores, comum em financiamentos longos do BNDES/imóveis)."
                      >
                        <select
                          value={c.sistema}
                          onChange={(e) => update(c.id, { sistema: e.target.value as DebtSystem })}
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        >
                          <option value="price">Price (parcela fixa)</option>
                          <option value="sac">SAC (amortização constante)</option>
                        </select>
                      </Field>
                      <Field label="Prazo restante (meses)">
                        <input
                          type="number"
                          step="1"
                          min={1}
                          value={c.prazoMeses}
                          onChange={(e) =>
                            update(c.id, {
                              prazoMeses: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                            })
                          }
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field
                        label="Mês da captação (1–12)"
                        hint="Mês do ano em que o desembolso (entrada de caixa) acontece. Deixe vazio (0) para contrato já existente — sem nova captação no ano. Alimenta automaticamente a linha '(+) Captação de empréstimos' no Fluxo de Caixa."
                      >
                        <input
                          type="number"
                          step="1"
                          min={0}
                          max={12}
                          value={c.mesCaptacao ?? 0}
                          onChange={(e) =>
                            update(c.id, {
                              mesCaptacao: Math.max(
                                0,
                                Math.min(12, Math.floor(Number(e.target.value) || 0)),
                              ),
                            })
                          }
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-right text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field
                        label="Valor captado (R$)"
                        hint="Valor liberado pelo banco no mês da captação. Aparece como (+) Captação de empréstimos no DFC. Para contratos antigos sem nova captação no ano, deixe 0."
                      >
                        <MoneyInput
                          value={c.valorCaptado ?? 0}
                          onChange={(n) => update(c.id, { valorCaptado: n })}
                        />
                      </Field>

                      <Field
                        label="Tipo de credor"
                        hint="Quem emprestou o dinheiro. Fomento (BNDES, FINEP, bancos de desenvolvimento) costuma ter taxa mais baixa. Sócio = empréstimo do dono à empresa (mútuo PF→PJ / AFAC) — exige contrato formal."
                      >
                        <select
                          value={c.tipoCredor ?? "banco"}
                          onChange={(e) =>
                            update(c.id, {
                              tipoCredor: e.target.value as DebtContract["tipoCredor"],
                            })
                          }
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        >
                          <option value="banco">Banco</option>
                          <option value="fomento">Fomento (BNDES, FINEP…)</option>
                          <option value="fornecedor">Fornecedor</option>
                          <option value="socio">Sócio (mútuo PF→PJ / AFAC)</option>
                          <option value="outro">Outro</option>
                        </select>
                      </Field>
                      <Field
                        label="Frequência de amortização"
                        hint="De quanto em quanto tempo você paga uma parcela. Bullet = paga só os juros durante o contrato e devolve TODO o principal de uma vez no vencimento (comum em capital de giro de curto prazo e debêntures)."
                      >
                        <select
                          value={c.frequenciaAmortizacao ?? "mensal"}
                          onChange={(e) =>
                            update(c.id, {
                              frequenciaAmortizacao: e.target
                                .value as DebtContract["frequenciaAmortizacao"],
                            })
                          }
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        >
                          <option value="mensal">Mensal</option>
                          <option value="trimestral">Trimestral</option>
                          <option value="semestral">Semestral</option>
                          <option value="anual">Anual</option>
                          <option value="bullet">Bullet (só no final)</option>
                        </select>
                      </Field>
                      <Field
                        label="Garantia"
                        hint="O que o banco pode tomar se você não pagar. Aval = um sócio (ou cônjuge) responde com o patrimônio pessoal. Alienação fiduciária = bem (imóvel/veículo) fica em nome do banco até a quitação."
                      >
                        <input
                          value={c.garantia ?? ""}
                          onChange={(e) => update(c.id, { garantia: e.target.value })}
                          placeholder="Ex.: Aval do sócio, imóvel mat. 1234"
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field
                        label="Covenants"
                        hint="Compromissos financeiros que você assina no contrato. Se quebrar, o banco pode antecipar a dívida toda. Exemplos: DSCR ≥ 1,25× (EBITDA precisa cobrir 1,25× o serviço da dívida) ou Dívida Líquida / EBITDA ≤ 3× (endividamento máximo)."
                      >
                        <input
                          value={c.covenants ?? ""}
                          onChange={(e) => update(c.id, { covenants: e.target.value })}
                          placeholder="Ex.: DSCR ≥ 1.25x; D.Líq/EBITDA ≤ 3x"
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <Field label="Observações">
                        <input
                          value={c.observacoes ?? ""}
                          onChange={(e) => update(c.id, { observacoes: e.target.value })}
                          placeholder="Notas livres do consultor"
                          className="w-full rounded-md border border-border/60 bg-input/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                      </Field>
                      <div className="sm:col-span-2 md:col-span-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
                        <div className="flex gap-3 text-[11px] text-muted-foreground">
                          <span>
                            Juros 12m:{" "}
                            <strong className="num text-warning">
                              {fmtBRL(sch.totalJurosAno)}
                            </strong>
                          </span>
                          <span>
                            Amort. 12m:{" "}
                            <strong className="num text-foreground">
                              {fmtBRL(sch.totalAmortAno)}
                            </strong>
                          </span>
                        </div>
                        <button
                          onClick={() => remove(c.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remover contrato
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={add}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-background/20 px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar contrato de dívida
          </button>

          {/* totais agregados */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
            <Stat
              label="Saldo total (Dívida onerosa)"
              value={fmtBRL(agg.saldoTotal)}
              hint="Dívida onerosa = empréstimos e financiamentos que PAGAM JUROS (banco, BNDES, debêntures). Não inclui fornecedores nem impostos a pagar. É a base para calcular Dívida Líquida, alavancagem e WACC."
            />
            <Stat
              label="Parcela total/mês"
              value={fmtBRL(agg.parcelaMesTotal)}
              tone="warn"
              hint="Soma das parcelas mensais de TODOS os contratos (juros + amortização do principal). É o que sai do caixa por mês — também chamado de 'serviço da dívida'."
            />
            <Stat
              label="Total amortizações/ano"
              value={fmtBRL(agg.totalAmortAno)}
              hint="Quanto do PRINCIPAL (saldo devedor) você devolve ao banco em 12 meses. Reduz a dívida no Balanço — não passa pela DRE (não é despesa, é devolução)."
            />
            <Stat
              label="Total juros/ano"
              value={fmtBRL(agg.totalJurosAno)}
              tone="warn"
              hint="Juros pagos em 12 meses. Esta é a parte que vira DESPESA FINANCEIRA na DRE e impacta o lucro líquido."
            />
          </div>
          <div className="text-[10px] text-muted-foreground">
            Os contratos alimentam automaticamente: Dívida Onerosa, Serviço da Dívida, DSCR,
            Cobertura de Juros, ROIC, WACC e o Custo Financeiro na DRE.
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: HelpHint;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {hint &&
          (typeof hint === "string" ? (
            <HelpTip text={hint} />
          ) : (
            <HelpTip text={hint.description} formula={hint.formula} example={hint.example} />
          ))}
      </div>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "warn";
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2">
      <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {hint && <HelpTip text={hint} />}
      </div>
      <div
        className={`mt-0.5 text-sm font-semibold num ${tone === "warn" ? "text-warning" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}
