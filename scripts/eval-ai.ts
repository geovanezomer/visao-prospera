#!/usr/bin/env bun
/**
 * Nível B do golden set — end-to-end com LLM real.
 * Requer AI_EVAL_BASEURL, AI_EVAL_MODEL (e opcionalmente AI_EVAL_APIKEY).
 * Uso: bun run eval:ai
 *
 * Não roda no CI. Ferramenta de dev para validar mudanças em system prompt,
 * REGRAS, modos ou descriptions das tools.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOLDEN_SET } from "../src/engines/ai/__evals__/goldenSet";
import { runLiveCase, type LiveCaseResult } from "../src/engines/ai/__evals__/runner";
import { PROMPT_VERSION } from "../src/engines/ai/diagnosticoPrompt";

const baseUrl = process.env.AI_EVAL_BASEURL;
const model = process.env.AI_EVAL_MODEL;
const apiKey = process.env.AI_EVAL_APIKEY;

if (!baseUrl || !model) {
  console.error("[eval:ai] Defina AI_EVAL_BASEURL e AI_EVAL_MODEL.");
  process.exit(1);
}

const REPORTS_DIR = ".eval-reports";
mkdirSync(REPORTS_DIR, { recursive: true });

async function main() {
  const results: LiveCaseResult[] = [];
  console.log(`[eval:ai] ${GOLDEN_SET.length} casos · modelo=${model} · prompt=${PROMPT_VERSION}`);

  for (const c of GOLDEN_SET) {
    process.stdout.write(`  ▸ ${c.id} ... `);
    const r = await runLiveCase(c, { baseUrl, apiKey, model });
    results.push(r);
    console.log(`${r.ok ? "OK" : "FAIL"} · score ${r.score}`);
    if (!r.ok && r.errorMsg) console.log(`     erro: ${r.errorMsg}`);
  }

  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const avgScore = Math.round(results.reduce((a, r) => a + r.score, 0) / total);

  // Diff vs último relatório da mesma PROMPT_VERSION.
  let diffLine = "";
  try {
    const prior = readdirSync(REPORTS_DIR)
      .filter((f) => f.startsWith(`${PROMPT_VERSION}-`) && f.endsWith(".json"))
      .sort()
      .pop();
    if (prior) {
      const previous = JSON.parse(readFileSync(join(REPORTS_DIR, prior), "utf8")) as {
        avgScore: number;
      };
      const delta = avgScore - previous.avgScore;
      diffLine = ` (Δ ${delta >= 0 ? "+" : ""}${delta} vs ${prior})`;
    }
  } catch {
    /* ignore */
  }

  const report = {
    promptVersion: PROMPT_VERSION,
    model,
    baseUrl,
    ts: new Date().toISOString(),
    total,
    passed,
    avgScore,
    results,
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(REPORTS_DIR, `${PROMPT_VERSION}-${ts}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));

  console.log(`\n[eval:ai] ${passed}/${total} · score médio ${avgScore}${diffLine}`);
  console.log(`[eval:ai] Relatório: ${file}`);
  process.exit(passed === total ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
