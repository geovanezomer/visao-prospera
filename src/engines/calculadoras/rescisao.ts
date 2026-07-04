/**
 * Engine de cálculo de Rescisão Trabalhista CLT.
 *
 * Bases legais:
 *  - CLT arts. 477, 478, 479, 482 (justa causa), 484-A (acordo), 487-491 (aviso prévio).
 *  - Lei 12.506/2011: aviso prévio proporcional (30 + 3 dias/ano completo, máx 90).
 *  - Lei 8.036/90 art. 18: multa FGTS de 40% (sem justa) ou 20% (acordo art. 484-A).
 *  - CF art. 7º, XVII: férias + 1/3 constitucional.
 *  - Tabelas INSS e IRRF versionadas em ./tabelas.ts (SSOT anual — MPS/MF).
 *  - Isenções consolidadas: aviso prévio indenizado e férias indenizadas + 1/3 NÃO sofrem
 *    incidência de INSS nem IRRF (REsp 1.230.957, STJ; Tema 985 STF).
 *
 * Engine pura — sem dependência de UI.
 */
import { z } from "zod";

// ============================================================================
// Tipos
// ============================================================================

export type MotivoRescisao =
  | "sem_justa_causa"
  | "justa_causa"
  | "pedido_demissao"
  | "acordo_484a"
  | "rescisao_indireta"
  | "termino_experiencia";

export const motivosLabel: Record<MotivoRescisao, string> = {
  sem_justa_causa: "Demissão sem justa causa",
  justa_causa: "Demissão por justa causa",
  pedido_demissao: "Pedido de demissão",
  acordo_484a: "Acordo (art. 484-A)",
  rescisao_indireta: "Rescisão indireta",
  termino_experiencia: "Término de contrato de experiência",
};

export const motivoDescricao: Record<MotivoRescisao, string> = {
  sem_justa_causa:
    "O empregador demite sem motivo disciplinar. Trabalhador tem direito a todas as verbas: saldo, férias proporcionais + 1/3, 13º proporcional, aviso prévio indenizado, multa de 40% do FGTS e saque integral.",
  justa_causa:
    "Demissão motivada por falta grave (art. 482 CLT). Trabalhador recebe apenas saldo de salário e férias vencidas (se houver). Sem 13º proporcional, sem aviso, sem multa, sem saque FGTS.",
  pedido_demissao:
    "Trabalhador solicita o desligamento. Recebe saldo, 13º proporcional, férias proporcionais + 1/3 e vencidas. Sem aviso indenizado, sem multa FGTS e sem saque (a menos que cumpra aviso).",
  acordo_484a:
    "Distrato comum entre empresa e empregado. Aviso prévio e multa FGTS pela metade (20%). Saque de 80% do FGTS. Demais verbas integrais.",
  rescisao_indireta:
    "‘Justa causa do empregador’ — falta grave do empregador (art. 483). Mesmas verbas da demissão sem justa causa.",
  termino_experiencia:
    "Fim do contrato de experiência no prazo. Sem aviso prévio e sem multa de 40%, mas com saque do FGTS. Demais verbas proporcionais.",
};

// ============================================================================
// Tabelas INSS / IRRF — versionadas em ./tabelas.ts (SSOT anual)
// ============================================================================

import { getTabelas, ANO_VIGENTE } from "./tabelas";

/** Faixas IRRF mensais (após dedução simplificada opcional). Vigente desde mai/2024. */
const IRRF_FAIXAS = [
  { ate: 2428.8, aliquota: 0.0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
] as const;

/**
 * Calcula INSS progressivo (cap no teto), usando as faixas do ano informado.
 * Padrão: ano vigente (SSOT em ./tabelas.ts).
 */
export function calcularINSS(base: number, ano: number = ANO_VIGENTE): number {
  if (base <= 0) return 0;
  const faixas = getTabelas(ano).inssFaixas;
  const restante = Math.min(base, faixas[faixas.length - 1].ate);
  let anterior = 0;
  let total = 0;
  for (const f of faixas) {
    const faixa = Math.max(0, Math.min(restante, f.ate) - anterior);
    total += faixa * f.aliquota;
    anterior = f.ate;
    if (restante <= f.ate) break;
  }
  return Math.round(total * 100) / 100;
}

/** Dedução por dependente (IRRF). */
const DEP_DEDUCAO = 189.59;
/**
 * Desconto simplificado mensal (Lei 14.848/2024, art. 5º) — R$ 607,20.
 * Substitui todas as deduções legais (INSS + dependentes + pensão etc.) quando
 * for MAIS vantajoso ao contribuinte. `calcularIRRF` escolhe automaticamente.
 */
const DESCONTO_SIMPLIFICADO = 607.2;

/**
 * Redutor do IRRF mensal — Lei nº 15.270/2025 (vigência 01/01/2026).
 *
 * A tabela progressiva NÃO mudou; após apurar o imposto pela tabela, aplica-se
 * um REDUTOR em função do rendimento tributável bruto do mês:
 *   • ≤ R$ 5.000,00 → redutor = imposto (IR final = 0)
 *   • R$ 5.000,01 a R$ 7.350,00 → redutor = 978,62 − 0,133145 × rendimento
 *   • > R$ 7.350,00 → sem redutor
 * O redutor é limitado ao imposto apurado (nunca gera IR negativo).
 */
export function redutorLei15270(rendimentoBrutoMensal: number, irApurado: number): number {
  if (irApurado <= 0) return 0;
  if (rendimentoBrutoMensal <= 5000) return irApurado;
  if (rendimentoBrutoMensal <= 7350) {
    const r = 978.62 - 0.133145 * rendimentoBrutoMensal;
    return Math.min(Math.max(r, 0), irApurado);
  }
  return 0;
}

/** Aplica a tabela progressiva do IRRF a uma base já líquida de deduções. */
function irrfTabela(base: number): number {
  if (base <= 0) return 0;
  for (const f of IRRF_FAIXAS) {
    if (base <= f.ate) {
      return Math.max(0, base * f.aliquota - f.deduzir);
    }
  }
  return 0;
}

/**
 * Calcula IRRF mensal com dedução tradicional × simplificado (escolhe o menor),
 * aplicando em seguida o redutor da Lei 15.270/2025 sobre o rendimento bruto.
 *
 * `pensao` (Lei 9.250/95 art. 4º, II): dedução legal aplicada APENAS no ramo
 * tradicional. O desconto simplificado da Lei 14.848/24 substitui todas as
 * deduções — pensão inclusive — logo NÃO entra na base simplificada. E o
 * redutor da Lei 15.270/25 se refere ao *rendimento tributável bruto do mês*,
 * de modo que `baseComINSS` (bruto, antes de dedução de pensão) é o valor
 * correto a passar ao redutor.
 */
export function calcularIRRF(
  baseComINSS: number,
  inss: number,
  dependentes: number,
  pensao: number = 0,
): number {
  const baseTrad = Math.max(0, baseComINSS - inss - dependentes * DEP_DEDUCAO - pensao);
  const baseSimp = Math.max(0, baseComINSS - DESCONTO_SIMPLIFICADO);
  const irTrad = irrfTabela(baseTrad);
  const irSimp = irrfTabela(baseSimp);
  const irApurado = Math.min(irTrad, irSimp);
  const redutor = redutorLei15270(baseComINSS, irApurado);
  const irFinal = Math.max(0, irApurado - redutor);
  return Math.round(irFinal * 100) / 100;
}

// ============================================================================
// Schema de entrada
// ============================================================================

export const rescisaoInputSchema = z.object({
  motivo: z.enum([
    "sem_justa_causa",
    "justa_causa",
    "pedido_demissao",
    "acordo_484a",
    "rescisao_indireta",
    "termino_experiencia",
  ]),
  salarioBruto: z.number().min(0),
  diasTrabalhadosMes: z.number().int().min(0).max(31).default(0),
  mesesFeriasProporcionais: z.number().int().min(0).max(12).default(0),
  mesesDecimoProporcional: z.number().int().min(0).max(12).default(0),
  anosNaEmpresa: z.number().min(0).default(0),
  saldoFGTS: z.number().min(0).default(0),
  possuiFeriasVencidas: z.boolean().default(false),
  dependentesIR: z.number().int().min(0).default(0),
  /** Aviso prévio trabalhado (verba já paga pela folha) ou indenizado. */
  avisoPrevio: z.enum(["indenizado", "trabalhado", "dispensado"]).default("indenizado"),
  /**
   * Dias restantes do contrato de experiência (apenas para motivo
   * "termino_experiencia" rescindido ANTES do prazo).
   * Se 0, considera-se término no prazo (sem indenização art. 479/480).
   */
  diasRestantesExperiencia: z.number().int().min(0).default(0),
  /**
   * Quem rompeu o contrato de experiência antes do prazo:
   *  - "empregador": indenização do art. 479 CLT (empregador paga 50% do que faltava)
   *  - "empregado": indenização do art. 480 CLT (empregado paga 50%, exibido como desconto)
   */
  rupturaExperienciaPor: z.enum(["empregador", "empregado"]).default("empregador"),
});

export type RescisaoInput = z.infer<typeof rescisaoInputSchema>;

// ============================================================================
// Saída
// ============================================================================

export interface VerbaRescisoria {
  rotulo: string;
  valor: number;
  base?: string;
  incideINSS: boolean;
  incideIRRF: boolean;
}

export interface RescisaoOutput {
  motivo: MotivoRescisao;
  diasAvisoPrevio: number;
  verbas: VerbaRescisoria[];
  totalBruto: number;
  inss: number;
  irrf: number;
  totalLiquido: number;
  saqueFGTS: number;
  multaFGTS: number;
}

// ============================================================================
// Regras por motivo
// ============================================================================

interface RegrasMotivo {
  saldoSalario: boolean;
  decimoProporcional: boolean;
  feriasProporcionais: boolean;
  feriasVencidas: boolean;
  /** 0 = sem; 1 = integral; 0.5 = metade (acordo 484-A) */
  avisoFator: number;
  /** 0 = sem; 0.20 = acordo; 0.40 = sem justa causa */
  multaFGTSPct: number;
  /** 0 = não saca; 0.80 = acordo; 1 = saque integral */
  saqueFGTSPct: number;
}

const REGRAS: Record<MotivoRescisao, RegrasMotivo> = {
  sem_justa_causa: {
    saldoSalario: true,
    decimoProporcional: true,
    feriasProporcionais: true,
    feriasVencidas: true,
    avisoFator: 1,
    multaFGTSPct: 0.4,
    saqueFGTSPct: 1,
  },
  rescisao_indireta: {
    saldoSalario: true,
    decimoProporcional: true,
    feriasProporcionais: true,
    feriasVencidas: true,
    avisoFator: 1,
    multaFGTSPct: 0.4,
    saqueFGTSPct: 1,
  },
  acordo_484a: {
    saldoSalario: true,
    decimoProporcional: true,
    feriasProporcionais: true,
    feriasVencidas: true,
    avisoFator: 0.5,
    multaFGTSPct: 0.2,
    saqueFGTSPct: 0.8,
  },
  pedido_demissao: {
    saldoSalario: true,
    decimoProporcional: true,
    feriasProporcionais: true,
    feriasVencidas: true,
    avisoFator: 0,
    multaFGTSPct: 0,
    saqueFGTSPct: 0,
  },
  justa_causa: {
    saldoSalario: true,
    decimoProporcional: false,
    feriasProporcionais: false,
    feriasVencidas: true,
    avisoFator: 0,
    multaFGTSPct: 0,
    saqueFGTSPct: 0,
  },
  termino_experiencia: {
    saldoSalario: true,
    decimoProporcional: true,
    feriasProporcionais: true,
    feriasVencidas: true,
    avisoFator: 0,
    multaFGTSPct: 0,
    saqueFGTSPct: 1,
  },
};

import { round2 } from "./utils";

/** Aviso prévio proporcional (Lei 12.506/2011): 30 + 3 dias por ano completo (máx 90). */
export function diasAvisoProporcional(anos: number): number {
  const adicional = Math.floor(Math.max(0, anos)) * 3;
  return Math.min(90, 30 + adicional);
}

// ============================================================================
// Cálculo principal
// ============================================================================

export function calcularRescisao(inputBruto: RescisaoInput): RescisaoOutput {
  const i = rescisaoInputSchema.parse(inputBruto);
  const regras = REGRAS[i.motivo];
  const salarioDia = i.salarioBruto / 30;

  const verbas: VerbaRescisoria[] = [];

  // --- Saldo de salário (incide INSS e IRRF) ---
  if (regras.saldoSalario && i.diasTrabalhadosMes > 0) {
    const v = round2(salarioDia * i.diasTrabalhadosMes);
    verbas.push({
      rotulo: `Saldo de salário (${i.diasTrabalhadosMes} dias)`,
      valor: v,
      base: `R$ ${i.salarioBruto.toFixed(2)} ÷ 30 × ${i.diasTrabalhadosMes}`,
      incideINSS: true,
      incideIRRF: true,
    });
  }

  // --- Aviso prévio ---
  const diasAviso = regras.avisoFator > 0 ? diasAvisoProporcional(i.anosNaEmpresa) : 0;
  const valorAviso = round2(salarioDia * diasAviso * regras.avisoFator);
  if (valorAviso > 0) {
    // Aviso indenizado: sem INSS/IRRF. Trabalhado: incide normalmente.
    const indenizado = i.avisoPrevio !== "trabalhado";
    verbas.push({
      rotulo: `Aviso prévio ${indenizado ? "indenizado" : "trabalhado"} (${diasAviso} dias${regras.avisoFator < 1 ? " × 50%" : ""})`,
      valor: valorAviso,
      base: `${diasAviso} dias × R$ ${salarioDia.toFixed(2)}`,
      incideINSS: !indenizado,
      incideIRRF: !indenizado,
    });
  }

  // --- 13º proporcional ---
  if (regras.decimoProporcional && i.mesesDecimoProporcional > 0) {
    const v = round2((i.salarioBruto / 12) * i.mesesDecimoProporcional);
    verbas.push({
      rotulo: `13º proporcional (${i.mesesDecimoProporcional}/12)`,
      valor: v,
      base: `${i.mesesDecimoProporcional}/12 × R$ ${i.salarioBruto.toFixed(2)}`,
      incideINSS: true,
      incideIRRF: true,
    });
  }

  // --- Férias proporcionais + 1/3 (indenizadas — isentas) ---
  if (regras.feriasProporcionais && i.mesesFeriasProporcionais > 0) {
    const ferias = round2((i.salarioBruto / 12) * i.mesesFeriasProporcionais);
    const tercoFerias = round2(ferias / 3);
    verbas.push({
      rotulo: `Férias proporcionais (${i.mesesFeriasProporcionais}/12)`,
      valor: ferias,
      base: `${i.mesesFeriasProporcionais}/12 × R$ ${i.salarioBruto.toFixed(2)}`,
      incideINSS: false,
      incideIRRF: false,
    });
    verbas.push({
      rotulo: "1/3 sobre férias proporcionais",
      valor: tercoFerias,
      incideINSS: false,
      incideIRRF: false,
    });
  }

  // --- Férias vencidas + 1/3 ---
  if (regras.feriasVencidas && i.possuiFeriasVencidas) {
    const fv = round2(i.salarioBruto);
    const t3 = round2(fv / 3);
    verbas.push({ rotulo: "Férias vencidas", valor: fv, incideINSS: false, incideIRRF: false });
    verbas.push({
      rotulo: "1/3 sobre férias vencidas",
      valor: t3,
      incideINSS: false,
      incideIRRF: false,
    });
  }

  // --- Multa FGTS (isenta de INSS/IRRF) ---
  // Paga pelo empregador DIRETAMENTE na conta vinculada do FGTS via Caixa
  // — não compõe a folha de rescisão. Por isso é retornada apart no campo
  // `multaFGTS` (e exibida em mini-card), simétrica ao `saqueFGTS`.
  const multaFGTS = round2(i.saldoFGTS * regras.multaFGTSPct);

  // --- Indenização do contrato de experiência rompido antes do prazo (CLT arts. 479/480) ---
  // Empregador rompe antes: paga ao empregado 50% do que faltaria (art. 479).
  // Empregado rompe antes: pode ser descontado em 50% do que faltaria (art. 480) — exibido como verba negativa.
  if (i.motivo === "termino_experiencia" && i.diasRestantesExperiencia > 0) {
    const valorRestante = round2(salarioDia * i.diasRestantesExperiencia);
    if (i.rupturaExperienciaPor === "empregador") {
      const indenizacao = round2(valorRestante * 0.5);
      verbas.push({
        rotulo: `Indenização art. 479 CLT (${i.diasRestantesExperiencia} dias × 50%)`,
        valor: indenizacao,
        base: `50% × ${i.diasRestantesExperiencia} dias × R$ ${salarioDia.toFixed(2)}`,
        incideINSS: false,
        incideIRRF: false,
      });
    } else {
      // Desconto do empregado — lançado como valor negativo
      const desconto = round2(-valorRestante * 0.5);
      verbas.push({
        rotulo: `Indenização art. 480 CLT (desconto — ${i.diasRestantesExperiencia} dias × 50%)`,
        valor: desconto,
        base: `–50% × ${i.diasRestantesExperiencia} dias × R$ ${salarioDia.toFixed(2)}`,
        incideINSS: false,
        incideIRRF: false,
      });
    }
  }

  // --- Totais e impostos ---
  const totalBruto = round2(verbas.reduce((a, v) => a + v.valor, 0));

  // INSS calculado sobre verbas com incidência (saldo + aviso trabalhado).
  // 13º proporcional gera INSS/IRRF em cálculo SEPARADO (não soma com saldo).
  const baseSaldoEAviso = verbas
    .filter((v) => v.incideINSS && !v.rotulo.startsWith("13º"))
    .reduce((a, v) => a + v.valor, 0);
  const decimo = verbas.find((v) => v.rotulo.startsWith("13º"))?.valor ?? 0;

  const inssSaldo = calcularINSS(baseSaldoEAviso);
  const inssDecimo = calcularINSS(decimo);
  const inss = round2(inssSaldo + inssDecimo);

  const irrfSaldo = calcularIRRF(baseSaldoEAviso, inssSaldo, i.dependentesIR);
  const irrfDecimo = calcularIRRF(decimo, inssDecimo, 0); // dependentes só uma vez (na folha)
  const irrf = round2(irrfSaldo + irrfDecimo);

  const totalLiquido = round2(totalBruto - inss - irrf);
  const saqueFGTS = round2(i.saldoFGTS * regras.saqueFGTSPct);

  return {
    motivo: i.motivo,
    diasAvisoPrevio: diasAviso,
    verbas,
    totalBruto,
    inss,
    irrf,
    totalLiquido,
    saqueFGTS,
    multaFGTS,
  };
}
