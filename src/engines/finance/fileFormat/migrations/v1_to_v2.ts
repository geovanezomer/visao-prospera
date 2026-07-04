// v1 → v2: pré-popula `state.capital.balanco` (Balanço Detalhado) a partir
// dos campos agregados legados de `CapitalStructure`.
//
// Não-quebrante: campos agregados (ativoTotal, etc.) são mantidos; o objeto
// `balanco` é inicializado com a melhor estimativa das rubricas para que a UI
// nova tenha algo a renderizar.
//
// Mapeamento (heurístico — usuário ajusta na UI da Fase 2):
//   disponibilidades        → ativoCirculante.caixaEquivalentes
//   contasReceber           → ativoCirculante.contasReceberClientes
//   estoques                → ativoCirculante.estoques
//   imobilizado             → ativoNaoCirculante.imobilizado.outrosImobilizados
//   fornecedores            → passivoCirculante.fornecedores
//   passivoCirculante (PC)  → distribuído: fornecedores já alocados,
//                             resíduo → outrosPassivosCirculantes
//   patrimonioLiquido       → patrimonioLiquido.capitalSocial (até DRE
//                             alimentar resultadoExercicio)
//
// Nota: `dividaOnerosa` e `dividaCurtoPrazoPct` foram REMOVIDOS do modelo —
// dívida agora é exclusivamente `debtContracts`. Arquivos antigos podem
// perder o split CP/LP; usuário deve recadastrar contratos no Card 2.
import type { Migration } from "./types";

const n = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);

export const v1_to_v2: Migration = {
  from: 1,
  to: 2,
  run: (raw: unknown) => {
    if (!raw || typeof raw !== "object") return raw;
    const file = raw as Record<string, unknown>;
    const state = (file.state as Record<string, unknown> | undefined) ?? {};
    const capital = (state.capital as Record<string, unknown> | undefined) ?? {};

    // Se já houver `balanco`, respeita (idempotente).
    if (!capital.balanco) {
      const disponibilidades = n(capital.disponibilidades);
      const contasReceber = n(capital.contasReceber);
      const estoques = n(capital.estoques);
      const ativoTotal = n(capital.ativoTotal);
      const fornecedores = n(capital.fornecedores);
      const passivoCirculanteTotal = n(capital.passivoCirculante);
      const patrimonioLiquido = n(capital.patrimonioLiquido);

      // Imobilizado = Ativo Total − AC conhecido (estimativa conservadora).
      const acConhecido = disponibilidades + contasReceber + estoques;
      const imobilizadoEstim = Math.max(0, ativoTotal - acConhecido);

      // Resíduo do PC informado, após alocar fornecedores.
      const outrosPC = Math.max(0, passivoCirculanteTotal - fornecedores);

      capital.balanco = {
        ativoCirculante: {
          caixaEquivalentes: disponibilidades,
          contasReceberClientes: contasReceber,
          estoques,
        },
        ativoNaoCirculante: {
          imobilizado: {
            outrosImobilizados: imobilizadoEstim,
          },
        },
        passivoCirculante: {
          fornecedores,
          outrosPassivosCirculantes: outrosPC,
        },
        patrimonioLiquido: {
          capitalSocial: patrimonioLiquido,
        },
      };

      // Descarte de campos legados removidos do schema (sem conversão).
      delete capital.dividaOnerosa;
      delete capital.dividaCurtoPrazoPct;

      state.capital = capital;
      file.state = state;
    }

    file.version = 2;
    return file;
  },
};

