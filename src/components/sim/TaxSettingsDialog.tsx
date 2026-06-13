import { useState } from "react";
import { Settings, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { NumInput } from "./primitives";
import type { AppState, SimplesAnexo, BusinessType } from "@/lib/finance/types";
import {
  IRPJ_PCT, IRPJ_ADICIONAL_PCT, IRPJ_ADICIONAL_GATILHO_TRI, CSLL_PCT,
  PIS_CUM_PCT, COFINS_CUM_PCT, PIS_NAO_CUM_PCT, COFINS_NAO_CUM_PCT,
  SIMPLES_LIMITE, FATOR_R_MINIMO_PCT,
  SIMPLES_TABLES_DEFAULT, PRESUMIDO_BASES_DEFAULT,
  REFORMA_TRANSICAO_IBS_MULT, REFORMA_TRANSICAO_ICMS_ISS_MULT,
  type TaxRatesOverride, type SimplesFaixa,
} from "@/lib/finance/taxDefaults";

type Props = { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void };

const ANEXOS: SimplesAnexo[] = ["I", "II", "III", "IV", "V"];
const BUSINESS: { key: BusinessType; label: string }[] = [
  { key: "industria", label: "Indústria" },
  { key: "comercio",  label: "Comércio"  },
  { key: "servicos",  label: "Serviços"  },
];

export function TaxSettingsDialog({ state, update }: Props) {
  const [open, setOpen] = useState(false);
  const ov = state.tax.ratesOverride ?? {};

  const patchOv = (patch: Partial<TaxRatesOverride>) =>
    update((s) => ({ ...s, tax: { ...s.tax, ratesOverride: { ...(s.tax.ratesOverride ?? {}), ...patch } } }));

  const resetAll = () => update((s) => ({ ...s, tax: { ...s.tax, ratesOverride: undefined } }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Parâmetros tributários (alíquotas e tabelas)">
          <Settings className="mr-2 h-4 w-4" /> Parâmetros
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parâmetros tributários</DialogTitle>
          <DialogDescription>
            Alíquotas e tabelas oficiais brasileiras usadas nos cálculos. Os valores partem dos
            padrões legais — edite apenas se houver mudança regulatória ou para simular cenários.
            Tudo é salvo no cenário atual.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="federais" className="mt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="federais">Federais</TabsTrigger>
            <TabsTrigger value="simples">Simples Nacional</TabsTrigger>
            <TabsTrigger value="presumido">L. Presumido</TabsTrigger>
            <TabsTrigger value="reforma">Reforma</TabsTrigger>
          </TabsList>

          {/* ===================== FEDERAIS ===================== */}
          <TabsContent value="federais" className="space-y-3 pt-4">
            <Section title="Impostos sobre lucro (IRPJ + Adicional + CSLL)">
              <Row label="IRPJ" suffix="%" defaultVal={IRPJ_PCT}
                value={ov.irpj ?? IRPJ_PCT}
                onChange={(v) => patchOv({ irpj: v })}
                onReset={() => patchOv({ irpj: undefined })} />
              <Row label="Adicional IRPJ" suffix="%" defaultVal={IRPJ_ADICIONAL_PCT}
                value={ov.irpjAdicional ?? IRPJ_ADICIONAL_PCT}
                onChange={(v) => patchOv({ irpjAdicional: v })}
                onReset={() => patchOv({ irpjAdicional: undefined })} />
              <Row label="Gatilho trimestral do Adicional IRPJ" suffix="R$" defaultVal={IRPJ_ADICIONAL_GATILHO_TRI}
                value={ov.irpjAdicionalGatilhoTri ?? IRPJ_ADICIONAL_GATILHO_TRI}
                onChange={(v) => patchOv({ irpjAdicionalGatilhoTri: v })}
                onReset={() => patchOv({ irpjAdicionalGatilhoTri: undefined })} />
              <Row label="CSLL" suffix="%" defaultVal={CSLL_PCT}
                value={ov.csll ?? CSLL_PCT}
                onChange={(v) => patchOv({ csll: v })}
                onReset={() => patchOv({ csll: undefined })} />
            </Section>

            <Section title="PIS/COFINS — regime cumulativo (Lucro Presumido)">
              <Row label="PIS cumulativo" suffix="%" defaultVal={PIS_CUM_PCT}
                value={ov.pisCum ?? PIS_CUM_PCT}
                onChange={(v) => patchOv({ pisCum: v })}
                onReset={() => patchOv({ pisCum: undefined })} />
              <Row label="COFINS cumulativo" suffix="%" defaultVal={COFINS_CUM_PCT}
                value={ov.cofinsCum ?? COFINS_CUM_PCT}
                onChange={(v) => patchOv({ cofinsCum: v })}
                onReset={() => patchOv({ cofinsCum: undefined })} />
            </Section>

            <Section title="PIS/COFINS — regime não-cumulativo (Lucro Real)">
              <Row label="PIS não-cumulativo" suffix="%" defaultVal={PIS_NAO_CUM_PCT}
                value={ov.pisNaoCum ?? PIS_NAO_CUM_PCT}
                onChange={(v) => patchOv({ pisNaoCum: v })}
                onReset={() => patchOv({ pisNaoCum: undefined })} />
              <Row label="COFINS não-cumulativo" suffix="%" defaultVal={COFINS_NAO_CUM_PCT}
                value={ov.cofinsNaoCum ?? COFINS_NAO_CUM_PCT}
                onChange={(v) => patchOv({ cofinsNaoCum: v })}
                onReset={() => patchOv({ cofinsNaoCum: undefined })} />
            </Section>
          </TabsContent>

          {/* ===================== SIMPLES ===================== */}
          <TabsContent value="simples" className="space-y-3 pt-4">
            <Section title="Limites e regras">
              <Row label="Limite anual de enquadramento" suffix="R$" defaultVal={SIMPLES_LIMITE}
                value={ov.simplesLimite ?? SIMPLES_LIMITE}
                onChange={(v) => patchOv({ simplesLimite: v })}
                onReset={() => patchOv({ simplesLimite: undefined })} />
              <Row label="Fator R — folha/RBT12 mínimo" suffix="%" defaultVal={FATOR_R_MINIMO_PCT}
                value={ov.fatorRMinimo ?? FATOR_R_MINIMO_PCT}
                onChange={(v) => patchOv({ fatorRMinimo: v })}
                onReset={() => patchOv({ fatorRMinimo: undefined })} />
            </Section>

            <SimplesTableEditor ov={ov} patchOv={patchOv} />
          </TabsContent>

          {/* ===================== PRESUMIDO ===================== */}
          <TabsContent value="presumido" className="space-y-3 pt-4">
            <Section title="Bases de presunção por tipo de negócio (Lei 9.249/95)">
              <div className="grid grid-cols-[1fr,120px,120px,auto] items-center gap-2 text-xs">
                <div className="text-muted-foreground">Tipo</div>
                <div className="text-right text-muted-foreground">% IRPJ</div>
                <div className="text-right text-muted-foreground">% CSLL</div>
                <div></div>
                {BUSINESS.map(({ key, label }) => {
                  const def = PRESUMIDO_BASES_DEFAULT[key];
                  const cur = ov.presumidoBases?.[key] ?? def;
                  const setBases = (next: { irpj: number; csll: number } | undefined) => {
                    const cur = ov.presumidoBases ?? {};
                    if (next === undefined) {
                      const { [key]: _, ...rest } = cur;
                      patchOv({ presumidoBases: Object.keys(rest).length ? rest : undefined });
                    } else {
                      patchOv({ presumidoBases: { ...cur, [key]: next } });
                    }
                  };
                  return (
                    <div key={key} className="contents">
                      <div>{label} <span className="text-muted-foreground/70">(padrão: {def.irpj}% / {def.csll}%)</span></div>
                      <NumInput value={cur.irpj} onChange={(v) => setBases({ irpj: v, csll: cur.csll })} />
                      <NumInput value={cur.csll} onChange={(v) => setBases({ irpj: cur.irpj, csll: v })} />
                      <Button size="sm" variant="ghost" title="Restaurar padrão"
                        onClick={() => setBases(undefined)}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="ISS — alíquota municipal (Serviços)">
              <Row label="ISS" suffix="%" defaultVal={5}
                value={state.tax.issIcms ?? 5}
                onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, issIcms: v } }))}
                onReset={() => update((s) => ({ ...s, tax: { ...s.tax, issIcms: 5 } }))} />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Faixa legal: 2% (mínimo) a 5% (máximo) — definida por cada município.
              </p>
            </Section>
          </TabsContent>


          {/* ===================== REFORMA ===================== */}
          <TabsContent value="reforma" className="space-y-3 pt-4">
            <Section title="Alíquotas plenas CBS/IBS (EC 132/2023 + LC 214/2025)">
              <Row label="CBS — alíquota plena" suffix="%" defaultVal={8.8}
                value={state.tax.cbsAliquota ?? 8.8}
                onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, cbsAliquota: v } }))}
                onReset={() => update((s) => ({ ...s, tax: { ...s.tax, cbsAliquota: undefined } }))} />
              <Row label="IBS — alíquota plena de referência" suffix="%" defaultVal={17.7}
                value={state.tax.ibsAliquotaRef ?? 17.7}
                onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, ibsAliquotaRef: v } }))}
                onReset={() => update((s) => ({ ...s, tax: { ...s.tax, ibsAliquotaRef: undefined } }))} />
            </Section>

            <Section title="Multiplicadores da fase de transição (2027–2032)">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Fração da alíquota plena que vigora no período de transição. Padrão 0,5 = ponto
                médio (50%). Em 2027 começa em 0,1 e em 2032 chega a 0,9.
              </p>
              <Row label="Multiplicador IBS (transição)" suffix="×" defaultVal={REFORMA_TRANSICAO_IBS_MULT}
                value={ov.reformaTransicaoIbsMult ?? REFORMA_TRANSICAO_IBS_MULT}
                onChange={(v) => patchOv({ reformaTransicaoIbsMult: v })}
                onReset={() => patchOv({ reformaTransicaoIbsMult: undefined })} />
              <Row label="Multiplicador ICMS/ISS (transição)" suffix="×" defaultVal={REFORMA_TRANSICAO_ICMS_ISS_MULT}
                value={ov.reformaTransicaoIcmsIssMult ?? REFORMA_TRANSICAO_ICMS_ISS_MULT}
                onChange={(v) => patchOv({ reformaTransicaoIcmsIssMult: v })}
                onReset={() => patchOv({ reformaTransicaoIcmsIssMult: undefined })} />
            </Section>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex justify-between border-t border-border/60 pt-3">
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Restaurar TODOS os padrões oficiais
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============= helpers de UI =============
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label, suffix, defaultVal, value, onChange, onReset,
}: {
  label: string; suffix: string; defaultVal: number;
  value: number; onChange: (n: number) => void; onReset: () => void;
}) {
  const isDefault = value === defaultVal;
  return (
    <div className="grid grid-cols-[1fr,120px,28px,28px] items-center gap-2 text-sm">
      <div>
        <span>{label}</span>{" "}
        <span className="text-[10px] text-muted-foreground/70">
          (padrão: {defaultVal.toLocaleString("pt-BR")} {suffix})
        </span>
      </div>
      <NumInput value={value} onChange={onChange} />
      <div className="text-center text-[10px] text-muted-foreground">{suffix}</div>
      <Button size="icon" variant="ghost" className="h-7 w-7"
        disabled={isDefault} onClick={onReset} title="Restaurar padrão">
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function SimplesTableEditor({
  ov, patchOv,
}: {
  ov: TaxRatesOverride;
  patchOv: (p: Partial<TaxRatesOverride>) => void;
}) {
  const [anexo, setAnexo] = useState<SimplesAnexo>("III");
  const def = SIMPLES_TABLES_DEFAULT[anexo];
  const cur: SimplesFaixa[] = (ov.simplesTables?.[anexo] ?? def).map((f) => [...f] as SimplesFaixa);
  const isCustom = !!ov.simplesTables?.[anexo];

  const setFaixa = (i: number, j: 0 | 1 | 2, v: number) => {
    const next = cur.map((f) => [...f] as SimplesFaixa);
    next[i][j] = v;
    patchOv({ simplesTables: { ...(ov.simplesTables ?? {}), [anexo]: next } });
  };

  const resetAnexo = () => {
    const map = { ...(ov.simplesTables ?? {}) };
    delete map[anexo];
    patchOv({ simplesTables: Object.keys(map).length ? map : undefined });
  };

  return (
    <Section title={`Tabelas do Simples — Anexo ${anexo}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Anexo:</span>
          <Select value={anexo} onValueChange={(v) => setAnexo(v as SimplesAnexo)}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ANEXOS.map((a) => (
                <SelectItem key={a} value={a}>Anexo {a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isCustom && (
            <span className="text-[10px] text-[var(--warning)]">customizado</span>
          )}
        </div>
        <Button size="sm" variant="ghost" disabled={!isCustom} onClick={resetAnexo}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restaurar Anexo {anexo}
        </Button>
      </div>
      <div className="grid grid-cols-[40px,1fr,1fr,1fr] items-center gap-2 text-[11px]">
        <div className="text-muted-foreground">Faixa</div>
        <div className="text-right text-muted-foreground">Teto (R$)</div>
        <div className="text-right text-muted-foreground">Alíquota nominal (%)</div>
        <div className="text-right text-muted-foreground">Parcela a deduzir (R$)</div>
        {cur.map((f, i) => (
          <div key={i} className="contents">
            <div className="text-muted-foreground">{i + 1}ª</div>
            <NumInput value={f[0]} onChange={(v) => setFaixa(i, 0, v)} />
            <NumInput value={f[1]} onChange={(v) => setFaixa(i, 1, v)} />
            <NumInput value={f[2]} onChange={(v) => setFaixa(i, 2, v)} />
          </div>
        ))}
      </div>
    </Section>
  );
}
