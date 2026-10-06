import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guarda de SSOT visual: garante que IndicatorsCard (Simulador) e
// IndicatorsTab (página Indicadores) consumam EXATAMENTE o mesmo
// componente IndicatorsGrid, sem reimplementar cards, labels, fórmulas
// ou cálculos derivados.
//
// Como NÃO usamos React Testing Library neste projeto (engine-first,
// sem jsdom configurado), validamos a contratação estrutural via
// análise estática do código-fonte. Qualquer reintrodução de lógica
// duplicada faz o teste falhar antes do build.

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const CARD = "src/components/sim/indicators/IndicatorsCard.tsx";
const TAB = "src/components/sim/indicators/IndicatorsTab.tsx";
const GRID = "src/components/sim/indicators/IndicatorsGrid.tsx";

describe("SSOT visual de Indicadores (Card ↔ Tab ↔ Grid)", () => {
  const card = read(CARD);
  const tab = read(TAB);
  const grid = read(GRID);

  it("IndicatorsCard é wrapper fino que delega para IndicatorsGrid", () => {
    expect(card).toMatch(/import\s*\{\s*IndicatorsGrid\s*\}\s*from\s*["']\.\/IndicatorsGrid["']/);
    expect(card).toMatch(/<IndicatorsGrid\s+state=\{state\}\s*\/>/);
    // Não pode redeclarar o sub-componente de card.
    expect(card).not.toMatch(/function\s+Ind\s*\(/);
    // Não pode importar leverageDisplay (uso confinado ao Grid).
    expect(card).not.toMatch(/leverageDisplay/);
    // Não pode recalcular indicadores localmente.
    expect(card).not.toMatch(/useFinanceModel/);
  });

  it("IndicatorsTab usa IndicatorsGrid e não duplica os cards", () => {
    expect(tab).toMatch(/import\s*\{\s*IndicatorsGrid\s*\}\s*from\s*["']\.\/IndicatorsGrid["']/);
    expect(tab.match(/<IndicatorsGrid\s+state=\{state\}\s*\/>/g)?.length).toBe(1);
    // Sub-componente Ind vive APENAS no Grid.
    expect(tab).not.toMatch(/function\s+Ind\s*\(/);
    // Nenhum cálculo de alavancagem aqui (SSOT no Grid).
    expect(tab).not.toMatch(/leverageDisplay/);
    // Sem reuso de fmtTimes (era só da seção movida).
    expect(tab).not.toMatch(/\bfmtTimes\b/);
  });

  it("Card e Tab renderizam o MESMO conjunto de labels (vindo do Grid)", () => {
    // Conjunto canônico de labels = todos os `label="..."` presentes no Grid.
    const gridLabels = new Set([...grid.matchAll(/label="([^"]+)"/g)].map((m) => m[1]));
    expect(gridLabels.size).toBeGreaterThanOrEqual(30); // sanity: temos ~33 cards
    // Nenhum label de indicador pode ser declarado fora do Grid (no Card
    // ou no Tab) — isso pegaria qualquer "cópia esquecida".
    const cardLabels = [...card.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    const tabLabels = [...tab.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    for (const lbl of gridLabels) {
      expect(cardLabels, `Label "${lbl}" duplicado em IndicatorsCard`).not.toContain(lbl);
      expect(tabLabels, `Label "${lbl}" duplicado em IndicatorsTab`).not.toContain(lbl);
    }
  });

  it("Formatação BRL/% no Grid usa SEMPRE fmtBRL/fmtPct (nunca toLocaleString/toFixed em valor monetário)", () => {
    expect(grid).toMatch(/from\s+["']@\/engines\/finance\/format["']/);
    // Não pode haver toLocaleString("pt-BR"... , {currency: "BRL"}) inline.
    expect(grid).not.toMatch(/toLocaleString\([^)]*BRL/);
    // Não pode haver template `R$ ${...}` montado à mão.
    expect(grid).not.toMatch(/`R\$\s*\$\{/);
    // Não pode haver `% sufixo` literal — fmtPct cuida disso.
    expect(grid).not.toMatch(/\.toFixed\(\d+\)\s*\+\s*"%"/);
  });

  it("Valores numéricos no Grid usam a classe `mono` (JetBrains Mono)", () => {
    // O componente <Ind> aplica a classe `mono` na div do valor.
    expect(grid).toMatch(/className=\{?`?[^`"]*\bmono\b/);
  });
});
