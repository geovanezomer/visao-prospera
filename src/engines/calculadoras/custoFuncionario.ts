/**
 * Engine de cálculo do Custo Real de Funcionário CLT.
 *
 * Bases legais:
 *  - INSS Patronal 20%: art. 22, I, Lei 8.212/91
 *  - RAT 1/2/3%: art. 22, II, Lei 8.212/91 + Decreto 6.957/09 (FAP)
 *  - Terceiros (Sistema S) ~5,8%: SENAI/SESC/SEBRAE/INCRA/Salário-Educação
 *  - FGTS 8%: art. 15, Lei 8.036/90
 *  - Vale-Transporte: empresa custeia o excedente a 6% do salário (Lei 7.418/85, art. 4º)
 *  - Simples Nacional: INSS patronal + Terceiros embutidos no DAS (LC 123/06, Anexos I, II, III e V).
 *    Anexo IV NÃO tem INSS patronal embutido — esta calc trata como exceção opcional.
 *
 * Engine pura — sem dependência de UI/state. Inputs e outputs validados via Zod.
 */
import { z } from "zod";

// ============================================================================
// Tipos e constantes
// ============================================================================

/** Regime tributário da empresa contratante. */
export type RegimeEmpresa = "simples" | "presumido" | "real";

/** Grau de risco para RAT (1 leve, 2 médio, 3 grave). */
export type GrauRAT = 1 | 2 | 3;

/** Alíquotas patronais base sobre o salário bruto, no Regime Geral. */
export const ALIQUOTAS_GERAL = {
  inssPatronal: 0.2, // 20% INSS patronal
  terceiros: 0.058, // 5,8% Sistema S (default — varia por CNAE)
} as const;

/** Provisões mensais (1/12 avos), aplicadas sobre o salário bruto. */
export const PROVISOES = {
  decimo: 1 / 12, // 8,3333%
  fgtsSobreDecimo: 0.08 * (1 / 12), // 0,6667%
  ferias: (1 / 12) * (4 / 3), // 11,1111% (1/12 + 1/3 constitucional)
  fgtsSobreFerias: 0.08 * (1 / 12) * (4 / 3), // 0,8889%
} as const;

/** FGTS sobre folha. */
export const FGTS_ALIQUOTA = 0.08;

/** Percentual máximo descontado do empregado para custeio do VT. */
export const VT_DESCONTO_EMPREGADO = 0.06;

// ============================================================================
// Schemas Zod
// ============================================================================

export const custoFuncionarioInputSchema = z.object({
  salarioBruto: z.number().positive("Salário deve ser positivo"),
  regime: z.enum(["simples", "presumido", "real"]),
  /** Inclui INSS patronal no Simples? Falso por padrão (Anexos I, II, III, V). */
  simplesAnexoIV: z.boolean().default(false),
  grauRAT: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  /** Alíquota de Terceiros (Sistema S) — varia por CNAE. Default 5,8%. */
  aliquotaTerceiros: z.number().min(0).max(0.1).default(0.058),
  beneficios: z.object({
    vt: z.object({
      ativo: z.boolean().default(false),
      custoMensal: z.number().min(0).default(0),
    }),
    vr: z.number().min(0).default(0),
    planoSaude: z.number().min(0).default(0),
    outros: z.number().min(0).default(0),
  }),
});

export type CustoFuncionarioInput = z.infer<typeof custoFuncionarioInputSchema>;

// ============================================================================
// Tipos de saída
// ============================================================================

export interface LinhaCusto {
  rotulo: string;
  base: number;
  aliquota: number | null; // null para itens em valor fixo (benefícios)
  valor: number;
}

export interface CustoFuncionarioOutput {
  salarioBruto: number;
  regime: RegimeEmpresa;
  encargos: {
    itens: LinhaCusto[];
    total: number;
  };
  provisoes: {
    itens: LinhaCusto[];
    total: number;
  };
  beneficios: {
    itens: LinhaCusto[];
    total: number;
    /** Custo líquido do VT pela empresa (após desconto de 6% do empregado). */
    vtCustoEmpresa: number;
  };
  custoMensalTotal: number;
  custoAnualTotal: number;
  /** Quantas vezes o salário bruto representa o custo real (ex. 1,68×). */
  fatorMultiplicador: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Arredonda em centavos para evitar drift de ponto flutuante. */
const round2 = (n: number) => Math.round(n * 100) / 100;

// ============================================================================
// Cálculo principal
// ============================================================================

/**
 * Calcula o custo real mensal/anual de um funcionário CLT para a empresa.
 *
 * Fórmula resumida:
 *   custoMensal = salário
 *               + encargos patronais (INSS + RAT + Terceiros + FGTS)
 *               + provisões (13º + férias + FGTS sobre ambos)
 *               + benefícios líquidos
 */
export function calcularCustoFuncionario(
  inputBruto: CustoFuncionarioInput,
): CustoFuncionarioOutput {
  const input = custoFuncionarioInputSchema.parse(inputBruto);
  const { salarioBruto, regime, simplesAnexoIV, grauRAT, aliquotaTerceiros, beneficios } = input;

  const rat = grauRAT / 100; // 1% / 2% / 3%

  // ----- Encargos patronais -----
  // No Simples Nacional, INSS patronal e Terceiros são recolhidos via DAS
  // (exceto Anexo IV, onde INSS patronal é devido à parte).
  const ehSimples = regime === "simples";
  const incluiInssPatronal = !ehSimples || simplesAnexoIV;
  const incluiTerceiros = !ehSimples; // Terceiros sempre embutidos no DAS (todos anexos)

  const encargos: LinhaCusto[] = [];

  if (incluiInssPatronal) {
    encargos.push({
      rotulo: "INSS Patronal",
      base: salarioBruto,
      aliquota: ALIQUOTAS_GERAL.inssPatronal,
      valor: round2(salarioBruto * ALIQUOTAS_GERAL.inssPatronal),
    });
  }
  encargos.push({
    rotulo: `RAT — Acidente de Trabalho (${grauRAT}%)`,
    base: salarioBruto,
    aliquota: rat,
    valor: round2(salarioBruto * rat),
  });
  if (incluiTerceiros) {
    encargos.push({
      rotulo: "Terceiros (Sistema S)",
      base: salarioBruto,
      aliquota: aliquotaTerceiros,
      valor: round2(salarioBruto * aliquotaTerceiros),
    });
  }
  encargos.push({
    rotulo: "FGTS (8%)",
    base: salarioBruto,
    aliquota: FGTS_ALIQUOTA,
    valor: round2(salarioBruto * FGTS_ALIQUOTA),
  });

  const totalEncargos = round2(encargos.reduce((acc, l) => acc + l.valor, 0));

  // ----- Provisões mensais (1/12 avos) -----
  // Encargos patronais (INSS Patronal + RAT + Terceiros) também incidem sobre
  // 13º e férias (art. 22, I, Lei 8.212/91). Aplicamos a MESMA alíquota patronal
  // que incide sobre a folha, na base da provisão mensal correspondente.
  const aliqInssProv = incluiInssPatronal ? ALIQUOTAS_GERAL.inssPatronal : 0;
  const aliqTerceirosProv = incluiTerceiros ? aliquotaTerceiros : 0;
  const aliqPatronalSobreProv = aliqInssProv + rat + aliqTerceirosProv;

  const provisoes: LinhaCusto[] = [
    {
      rotulo: "13º Salário (1/12)",
      base: salarioBruto,
      aliquota: PROVISOES.decimo,
      valor: round2(salarioBruto * PROVISOES.decimo),
    },
    {
      rotulo: "FGTS sobre 13º",
      base: salarioBruto,
      aliquota: PROVISOES.fgtsSobreDecimo,
      valor: round2(salarioBruto * PROVISOES.fgtsSobreDecimo),
    },
    {
      rotulo: "Férias + 1/3 (1/12 × 4/3)",
      base: salarioBruto,
      aliquota: PROVISOES.ferias,
      valor: round2(salarioBruto * PROVISOES.ferias),
    },
    {
      rotulo: "FGTS sobre Férias",
      base: salarioBruto,
      aliquota: PROVISOES.fgtsSobreFerias,
      valor: round2(salarioBruto * PROVISOES.fgtsSobreFerias),
    },
  ];

  // Encargos patronais sobre 13º e férias — somente se houver alíquota aplicável
  if (aliqPatronalSobreProv > 0) {
    provisoes.push(
      {
        rotulo: "Encargos patronais sobre 13º (INSS + RAT + Terceiros)",
        base: salarioBruto,
        aliquota: PROVISOES.decimo * aliqPatronalSobreProv,
        valor: round2(salarioBruto * PROVISOES.decimo * aliqPatronalSobreProv),
      },
      {
        rotulo: "Encargos patronais sobre Férias (INSS + RAT + Terceiros)",
        base: salarioBruto,
        aliquota: PROVISOES.ferias * aliqPatronalSobreProv,
        valor: round2(salarioBruto * PROVISOES.ferias * aliqPatronalSobreProv),
      },
    );
  }

  const totalProvisoes = round2(provisoes.reduce((acc, l) => acc + l.valor, 0));

  // ----- Benefícios -----
  // VT: empresa custeia o excedente a 6% do salário (Lei 7.418/85)
  const vtCustoEmpresa = beneficios.vt.ativo
    ? round2(Math.max(0, beneficios.vt.custoMensal - VT_DESCONTO_EMPREGADO * salarioBruto))
    : 0;

  const itensBeneficios: LinhaCusto[] = [];
  if (beneficios.vt.ativo) {
    itensBeneficios.push({
      rotulo: "Vale-Transporte (excedente a 6% do salário)",
      base: beneficios.vt.custoMensal,
      aliquota: null,
      valor: vtCustoEmpresa,
    });
  }
  if (beneficios.vr > 0) {
    itensBeneficios.push({
      rotulo: "Vale-Refeição / Alimentação",
      base: beneficios.vr,
      aliquota: null,
      valor: round2(beneficios.vr),
    });
  }
  if (beneficios.planoSaude > 0) {
    itensBeneficios.push({
      rotulo: "Plano de Saúde",
      base: beneficios.planoSaude,
      aliquota: null,
      valor: round2(beneficios.planoSaude),
    });
  }
  if (beneficios.outros > 0) {
    itensBeneficios.push({
      rotulo: "Outros Benefícios",
      base: beneficios.outros,
      aliquota: null,
      valor: round2(beneficios.outros),
    });
  }

  const totalBeneficios = round2(itensBeneficios.reduce((acc, l) => acc + l.valor, 0));

  // ----- Totais -----
  const custoMensalTotal = round2(salarioBruto + totalEncargos + totalProvisoes + totalBeneficios);
  const custoAnualTotal = round2(custoMensalTotal * 12);
  const fatorMultiplicador = salarioBruto > 0 ? custoMensalTotal / salarioBruto : 0;

  return {
    salarioBruto: round2(salarioBruto),
    regime,
    encargos: { itens: encargos, total: totalEncargos },
    provisoes: { itens: provisoes, total: totalProvisoes },
    beneficios: { itens: itensBeneficios, total: totalBeneficios, vtCustoEmpresa },
    custoMensalTotal,
    custoAnualTotal,
    fatorMultiplicador,
  };
}

/** Label legível para o regime. */
export function labelRegime(r: RegimeEmpresa): string {
  return r === "simples"
    ? "Simples Nacional"
    : r === "presumido"
      ? "Lucro Presumido"
      : "Lucro Real";
}
