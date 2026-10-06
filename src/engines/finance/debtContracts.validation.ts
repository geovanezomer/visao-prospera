// Validação de contratos de dívida antes da projeção de caixa.
// Garante campos obrigatórios, coerência de prazos/datas e captação.
import { z } from "zod";
import type { DebtContract } from "./types";

export const debtContractSchema = z
  .object({
    id: z.string().min(1, "id obrigatório"),
    credor: z.string().min(1, "credor obrigatório"),
    saldoDevedor: z.number().finite().min(0, "saldoDevedor deve ser ≥ 0"),
    taxaAA: z.number().finite().min(0, "taxaAA deve ser ≥ 0"),
    sistema: z.enum(["price", "sac"]),
    prazoMeses: z.number().int().positive("prazoMeses deve ser > 0"),
    mesCaptacao: z.number().int().min(1).max(12).optional(),
    valorCaptado: z.number().finite().min(0).optional(),
  })
  .passthrough()
  .refine((c) => !(c.valorCaptado && c.valorCaptado > 0) || !!c.mesCaptacao, {
    message: "valorCaptado exige mesCaptacao (1..12)",
    path: ["mesCaptacao"],
  });

export interface DebtContractIssue {
  id: string;
  field: string;
  message: string;
}

/** Valida lista de contratos; retorna issues (vazio = ok). Não lança. */
export function validateDebtContracts(contracts: DebtContract[] | undefined): DebtContractIssue[] {
  const issues: DebtContractIssue[] = [];
  if (!contracts?.length) return issues;
  const seen = new Set<string>();
  for (const c of contracts) {
    const r = debtContractSchema.safeParse(c);
    if (!r.success) {
      for (const e of r.error.issues) {
        issues.push({ id: c?.id ?? "?", field: e.path.join("."), message: e.message });
      }
    }
    if (c?.id) {
      if (seen.has(c.id)) issues.push({ id: c.id, field: "id", message: "id duplicado" });
      seen.add(c.id);
    }
  }
  return issues;
}

/** Variante estrita que lança em caso de inconsistência. */
export function assertDebtContracts(contracts: DebtContract[] | undefined): void {
  const issues = validateDebtContracts(contracts);
  if (issues.length) {
    throw new Error(
      `debtContracts inválidos:\n` +
        issues.map((i) => `- [${i.id}] ${i.field}: ${i.message}`).join("\n"),
    );
  }
}
