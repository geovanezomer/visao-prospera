
# Plano Revisado v2 — Otimização Pró-labore × Distribuição de Lucros

Mudanças desta revisão:
1. **Zero hardcode tributário.** Todas as tabelas e alíquotas (INSS sócio, IRPF, salário mínimo, redução Lei 15.000/2025, limites de presunção) vivem em `taxDefaults.ts` no padrão atual e são editáveis na **lightbox de Configurações** (`TaxSettingsDialog.tsx`).
2. **Card dedicado** "Pró-labore × Distribuição" dentro de `TaxTab.tsx`, separado dos cards de regime/Fator R, com seu próprio header, CRUD e otimizador.
3. Tudo o mais (engine pura, separação de regex em `regime.ts`, `injectSociosCostLine`, card prescritivo, ordem de implementação) segue a v1 já validada.

---

## A. Configuração — sem hardcode

### A.1. `taxDefaults.ts` — novas constantes (defaults editáveis)

Seguir o padrão já estabelecido (`IRPJ_PCT`, `SIMPLES_TABLES_DEFAULT`, etc.):

```typescript
// === Pró-labore / Distribuição — defaults 2026, REVISAR ANUALMENTE ===
export const SALARIO_MINIMO_DEFAULT = 1_518;          // Decreto anual
export const INSS_SOCIO_ALIQ_DEFAULT = 0.11;          // contribuinte individual
export const INSS_PATRONAL_ALIQ_DEFAULT = 0.20;       // Presumido/Real
export const INSS_TETO_CONTRIB_DEFAULT = 8_475.55;    // Portaria MPS/MF
export const IRPF_DEDUCAO_DEPENDENTE_DEFAULT = 189.59;
export const IRPF_LIMITE_PGBL_PCT_DEFAULT = 0.12;
export const IRPF_FAIXAS_DEFAULT: IrpfFaixa[] = [
  { ate: 2_428.80, aliquota: 0,     deduzir: 0 },
  { ate: 2_826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3_751.05, aliquota: 0.15,  deduzir: 394.16 },
  { ate: 4_664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
];
// Lei 15.000/2025 — desconto simplificado faixa R$5k–R$7,35k
export const IRPF_REDUCAO_LEI_15000_DEFAULT = {
  ativo: true,
  isencaoAte: 5_000,
  fimReducao: 7_350,
};
// Presumido sem ECD — % de presunção que vira limite de distribuição isenta
export const PRESUMIDO_BASE_DISTRIB_ISENTA_DEFAULT = {
  comercio: 0.08, servicos: 0.32, industria: 0.08,
};

export type IrpfFaixa = { ate: number; aliquota: number; deduzir: number };

export interface PayrollOverride {
  salarioMinimo?: number;
  inssSocioAliq?: number;
  inssPatronalAliq?: number;
  inssTetoContrib?: number;
  irpfDeducaoDependente?: number;
  irpfLimitePgblPct?: number;
  irpfFaixas?: IrpfFaixa[];
  irpfReducaoLei15000?: { ativo: boolean; isencaoAte: number; fimReducao: number };
}
```

Acrescentar `payroll?: PayrollOverride` ao tipo de override já consumido pelo dialog (mesmo padrão de `taxRatesOverride`). Todos os reads dentro da engine fazem `state.tax.payroll?.X ?? X_DEFAULT`.

### A.2. `TaxSettingsDialog.tsx` — novo passo "Folha / Sócios"

Adicionar `{ key: "folha", label: "Folha", icon: Users }` à constante `STEPS` (entre `reforma` e `revisao`). Campos do passo:
- Salário mínimo vigente (com nota "atualizar em janeiro").
- INSS sócio (%) + teto de contribuição.
- INSS patronal (%) — com badge "aplicado apenas em Presumido/Real".
- Tabela IRPF editável (linhas dinâmicas: faixa / alíquota / parcela a deduzir) + dedução por dependente + limite PGBL.
- Toggle "Aplicar redução Lei 15.000/2025" + dois campos de faixa.

Botão **"Restaurar defaults 2026"** por seção, igual aos outros passos.

### A.3. Constantes versionadas por ano (futuro próximo, fora do MVP)

Estrutura sugerida `TAX_DEFAULTS_BY_YEAR[2026|2027]` para o app oferecer "carregar tabela do ano X". Manter como nota de roadmap — no MVP basta o override editável.

---

## B. Tipos — `src/engines/finance/types.ts`

```typescript
export interface SocioRetirada {
  id: string;
  nome: string;
  participacaoPct: number;        // valida cláusula desproporcional
  exerceFuncao: boolean;          // define piso de pró-labore
  proLaboreMensal: number;
  distribuicaoLucroMensal: number;
  dependentes?: number;
  previdenciaPrivadaMensal?: number;
}
// AppState.socios?: SocioRetirada[];
```

---

## C. Engine — `src/engines/finance/socios.ts`

Funções públicas (todas recebem `state` ou `payroll: PayrollOverride` resolvido — **nenhuma constante hardcoded no corpo**):

- `resolvePayroll(state)` → mescla `state.tax.payroll` com os DEFAULTs. Ponto único de leitura.
- `calcularRetiradaSocio(input, regimeTributario, payroll): RetiradaResult` — inclui INSS sócio com teto, INSS patronal (apenas se `regime !== 'simples'`), IRPF com tabela editável, dedução por dependente, PGBL até `irpfLimitePgblPct`, redução Lei 15.000/2025 quando ativa. Retorna também `custoEmpresa = proLabore + inssPatronal`.
- `limiteDistribuicaoIsenta(state): number` — Simples: lucro líquido contábil; Presumido sem ECD: `receita × basePresuncao − (IRPJ + CSLL + PIS + COFINS)`; Real: lucro líquido.
- `pisoProLabore(socio, payroll): number` — `socio.exerceFuncao ? payroll.salarioMinimo : 0`.
- `otimizarSplit(totalDesejado, regime, payroll, piso): Split[]` — analítico no Simples (ótimo = piso); busca ternária + verificação de breakpoints da tabela IRPF no Presumido/Real.
- `injectSociosCostLines(state, payroll): CostLine[]` — gera (1) linha `__socios_prolabore__` (administrativa) e (2) linha `__socios_inss_patronal__` quando aplicável. Idempotente por `id`.

Cobertura de testes (`__tests__/socios.test.ts`):
- INSS sócio com/sem teto.
- IRPF zerado na isenção, com dependentes, com PGBL no limite.
- Comportamento da redução Lei 15.000/2025 ligada/desligada.
- `limiteDistribuicaoIsenta` nos 3 regimes.
- Otimizador: Simples → piso; Presumido → 3 cenários conferidos à mão.
- Idempotência de `injectSociosCostLines`.
- Override de `payroll` muda o resultado conforme esperado (sem hardcode).

---

## D. `regime.ts` — Fator R correto + desambiguação de regex

No mesmo PR, separar:
- `PLR_EMPREGADO_RE` → continua entrando no Fator R.
- `DISTRIB_SOCIO_RE` → **nunca** entra.
- Somar `proLaboreMensal × 12` de `state.socios` (nunca distribuição).

Testes de regressão obrigatórios no `cross-formulajs.test.ts`.

---

## E. UI — card dedicado em `TaxTab.tsx`

**Novo `ProLaboreCard.tsx`** (componente próprio em `src/components/sim/tax/`), renderizado abaixo dos cards de regime/Fator R no `TaxTab.tsx`. Estrutura:

1. **Header**: título "Pró-labore × Distribuição de Lucros" + badge do regime atual + mini-explainer (1 linha) sobre o efeito do regime (Simples = sem 20% patronal; Presumido/Real = com).
2. **Tabela de sócios** (CRUD): nome, participação, exerce função, pró-labore, distribuição, dependentes, PGBL. Padrão visual igual às listas de `CostLine`.
3. **Linha por sócio**: bruto → INSS sócio → INSS patronal → IRPF → líquido pró-labore + distribuição → total líquido. Tooltip com a memória de cálculo (padrão `HelpHint.calc` já consolidado).
4. **Bloco "Otimizar split"**: split atual × split ótimo, ganho líquido mensal/anual, **nota de base previdenciária** ("base do INSS cai de X para Y — considerar previdência complementar").
5. **Alertas** (componente de alerta já usado em `crossValidation.ts`):
   - distribuição total > `limiteDistribuicaoIsenta(state)`,
   - split desproporcional sem cláusula no contrato social (informativo),
   - pró-labore < piso quando `exerceFuncao`.
6. **Badge cruzado**: "Pró-labore contribui com X% do Fator R atual (Y%)" — reaproveita o cálculo do card de Fator R existente.

---

## F. Card prescritivo — `prescriptive.ts`

Item novo `socios-split-subotimo`, severidade `info`, limiar mínimo R$ 100/mês de ganho, texto inclui aviso sobre base previdenciária.

---

## G. Ordem de implementação

1. `taxDefaults.ts` (constantes + tipo `PayrollOverride`) + passo "Folha" no `TaxSettingsDialog.tsx` — sem dependência de engine, validável visualmente.
2. `socios.ts` + testes (engine pura, lendo overrides).
3. Separação de regex + soma do pró-labore em `regime.ts` + testes de regressão.
4. `injectSociosCostLines` + linha de INSS patronal + teste de DRE com e sem sócios.
5. `ProLaboreCard.tsx` + integração em `TaxTab.tsx`.
6. Card prescritivo.

---

## H. Fora de escopo (registrar)

- PJ-do-sócio (pejotização) — exige modelo legal próprio.
- Tabelas por ano (`TAX_DEFAULTS_BY_YEAR`) — depois do MVP.
- Comparativo com a calculadora CLT vs PJ existente.
