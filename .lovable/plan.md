## Contexto — não são duplicatas, mas ficam lado a lado

Depois de mapear o código, os dois campos têm **naturezas diferentes**, e é importante deixar isso claro antes de mexer:

| Campo | Onde vive hoje | Natureza | Usado por |
|---|---|---|---|
| `capital.abertura.lucrosAcumulados` | Card 3 do Capital | **Contábil (PL)** — resultado retido dos exercícios anteriores. Pode ser negativo. É o "plug" do Balanço de Abertura. | `deriveAbertura`, Balanço Patrimonial |
| `tax.prejuizoFiscalAcumuladoAbertura` | Dialog Config Tributária → aba Federais | **Fiscal (parte B do e-Lalur)** — saldo compensável até 30 %/tri no IRPJ/CSLL. Só existe no Lucro Real. | `calcReal` (Lei 9.065/95 art. 42) |

Ou seja: um afeta o **Balanço**, o outro afeta o **imposto do Real**. Não podem ser fundidos numericamente — se somarmos, quebramos tanto o fechamento do balanço quanto os testes de `tax-overrides.test.ts` e a compensação trimestral em `calcReal`.

O que o usuário pediu (e faz sentido) é **unificar a experiência**: os dois campos "de abertura" moram no mesmo lugar (Capital), e o fiscal só aparece quando o regime é Lucro Real. O nome da chave no `AppState` **permanece** para não quebrar cálculos, testes e snapshots.

---

## Plano

### 1. Mover a UI do prejuízo fiscal para o Capital (sem renomear a chave)

Em `src/components/sim/capital/AberturaCard.tsx`, dentro do Card 3 "Outras informações de abertura":

- Adicionar um bloco condicional `state.tax.regime === "real"` com **um único** `SimpleField`:
  - **Label:** "Prejuízo fiscal acumulado (abertura) — Lucro Real"
  - **Hint:** "Saldo da parte B do e-Lalur registrado na ECF. Diferente de 'Lucros/prejuízos acumulados' (que é contábil, do PL): este é fiscal e compensa até 30 % do lucro tributável de cada trimestre (Lei 9.065/95 art. 42). Base negativa de CSLL usa o mesmo saldo."
  - Lê/escreve em `state.tax.prejuizoFiscalAcumuladoAbertura` via `setTax` do contexto (sem mudar a shape do estado).
  - Clamp `Math.max(0, v)` no onChange, igual ao dialog atual.
- Adicionar um `Callout`/info curto no topo do card explicando a diferença entre "lucros acumulados (contábil / PL)" e "prejuízo fiscal (tributário)" — evita a confusão que originou o pedido.

### 2. Remover a `Section` "Prejuízo fiscal acumulado — Lucro Real" do dialog

Em `src/components/sim/tax/TaxSettingsDialog.tsx` (linhas 459-469):

- Excluir a `Section` inteira.
- Adicionar uma nota discreta acima do `Section` seguinte (ou no fim do `StepFederais` quando `regime==="real"`) do tipo: *"O prejuízo fiscal acumulado de abertura foi movido para **Capital → Saldos de Abertura**."* com link/botão que navega para a aba Capital. Zero mudança em cálculo.

### 3. Preservar a SSOT — nada muda no engine

- `tax.prejuizoFiscalAcumuladoAbertura` continua sendo a **única** fonte lida por `calcReal` (`src/engines/finance/tax/real.ts`).
- `capital.abertura.lucrosAcumulados` continua sendo a **única** fonte lida por `deriveAbertura`.
- **Não** somar, **não** derivar um do outro, **não** renomear.
- Snapshot da IA (`engines/ai/snapshot.ts` e `tools/finance.ts`) já consome as duas chaves — sem mudança.

### 4. Testes / não-regressão

- `src/engines/finance/__tests__/tax-overrides.test.ts` (bloco "prejuizoFiscalAcumuladoAbertura") continua passando: lê a mesma chave.
- `src/engines/finance/__tests__/aberturaDerivada.test.ts` inalterado.
- Rodar `bunx vitest run` no fim para confirmar zero regressão.
- Verificação visual: alternar regime no dialog Simples → Presumido → Real e confirmar que o campo aparece/desaparece no Capital.

### 5. Ordem de execução (uma única passada de edições)

1. Editar `AberturaCard.tsx` (adicionar campo condicional + callout de diferenciação).
2. Editar `TaxSettingsDialog.tsx` (remover Section, adicionar nota de "movido para Capital").
3. Rodar testes.

---

## Detalhes técnicos

- **Sem migração de dados**: chave `tax.prejuizoFiscalAcumuladoAbertura` permanece no `TaxConfig`. Estados salvos em Zustand/localStorage continuam válidos.
- **Sem mudança em `defaults.ts`**: já é `0`.
- **Import novo em AberturaCard**: precisa de acesso ao `setTax` do `useFinance()` (já exportado no contexto — confirmar; se não, adicionar setter helper).
- **Condicional**: `state.tax.regime === "real"` — mesma comparação usada em `calcReal` e em `compareRegimes`, então o gate é consistente com o motor.
- **Copy visível** deixa explícito que os dois campos coexistem por razões contábeis/fiscais legítimas — evita que a próxima revisão volte a tratá-los como duplicata.

Aprovando, aplico as duas edições e rodo os testes.
