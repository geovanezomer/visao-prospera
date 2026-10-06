// ============================================================================
// Confiabilidade dos dados (a "luz de saúde" do cockpit).
//
// Conferências objetivas sobre o retrato do Odoo e a entidade aberta. Cada
// item diz o que foi verificado, o resultado e o que fazer. Puro — roda no
// navegador sobre o retrato já carregado.
// ============================================================================
import type { OdooEntity, OdooEntityData } from "./toAppState";
import { closedMonthOf } from "./toAppState";
import type { BsBucket, OdooSnapshot } from "./types";
import { BS_IS_ASSET } from "./mapping";

export type TrustLevel = "ok" | "warn" | "error";

export type TrustCheck = {
  id: string;
  level: TrustLevel;
  title: string;
  detail: string;
};

export type TrustReport = { level: TrustLevel; checks: TrustCheck[] };

const TOL = 1; // R$ 1 de tolerância de arredondamento
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function bsDiff(b: Record<BsBucket, number>): number {
  let ativo = 0;
  let passivoPl = 0;
  for (const [k, v] of Object.entries(b) as [BsBucket, number][]) {
    if (BS_IS_ASSET[k]) ativo += v;
    else passivoPl += v;
  }
  return ativo - passivoPl;
}

export function computeTrust(
  snapshot: OdooSnapshot,
  entity: OdooEntity,
  data: OdooEntityData,
  sync: { lastError: string | null; now?: number },
): TrustReport {
  const checks: TrustCheck[] = [];
  const now = sync.now ?? Date.now();
  const companies = snapshot.companies.filter((c) => entity.companyIds.includes(c.id));

  // 1) Sincronização: idade e erro.
  const ageH = (now - new Date(snapshot.syncedAt).getTime()) / 3_600_000;
  if (sync.lastError) {
    checks.push({
      id: "sync-error",
      level: "error",
      title: "Última sincronização falhou",
      detail: `Os números são do retrato de ${new Date(snapshot.syncedAt).toLocaleString("pt-BR")}. Erro: ${sync.lastError}`,
    });
  } else {
    checks.push({
      id: "sync-age",
      level: ageH > 24 ? "error" : ageH > 2 ? "warn" : "ok",
      title: "Atualização dos dados",
      detail:
        ageH < 1
          ? `Sincronizado há ${Math.max(1, Math.round(ageH * 60))} min.`
          : `Sincronizado há ${Math.round(ageH)} h${ageH > 2 ? " — o agendador horário pode estar parado." : "."}`,
    });
  }

  // 2) Balancete de cada empresa: débitos = créditos (soma dos saldos = 0).
  const unbalanced = companies
    .map((c) => {
      const comp = snapshot.perCompany[String(c.id)];
      const total = (comp?.accounts ?? []).reduce(
        (s, a) => s + a.opening + a.monthly.reduce((x, y) => x + y, 0),
        0,
      );
      return { c, total };
    })
    .filter((x) => Math.abs(x.total) > TOL);
  checks.push({
    id: "trial-balance",
    level: unbalanced.length ? "error" : "ok",
    title: "Balancete (débitos = créditos)",
    detail: unbalanced.length
      ? `Diferença em ${unbalanced.map((x) => `${x.c.name} (${brl(x.total)})`).join(", ")} — contas fora do retrato ou lançamento corrompido.`
      : `Zerado em ${companies.length} empresa(s).`,
  });

  // 3) Balanço fecha (abertura e fechamento), já com eliminações.
  const dOpen = bsDiff(data.actuals.opening);
  const dClose = bsDiff(data.actuals.closing);
  const bsOk = Math.abs(dOpen) <= TOL && Math.abs(dClose) <= TOL;
  checks.push({
    id: "bs-closes",
    level: bsOk ? "ok" : "error",
    title: "Ativo = Passivo + PL",
    detail: bsOk
      ? "Fecha na abertura e no fechamento da janela."
      : `Diferença de ${brl(dOpen)} na abertura e ${brl(dClose)} no fechamento — há conta classificada como "ignorar" com saldo, ou eliminação de um lado só.`,
  });

  // 4) Eliminações entre empresas: os dois lados precisam existir.
  if (entity.companyIds.length > 1) {
    const ids = new Set(entity.companyIds);
    let net = 0;
    for (const cid of entity.companyIds) {
      for (const l of snapshot.perCompany[String(cid)]?.intercompany.lines ?? []) {
        if (!ids.has(l.counterpartCompanyId)) continue;
        net += l.opening + l.monthly.reduce((x, y) => x + y, 0);
      }
    }
    checks.push({
      id: "eliminations",
      level: Math.abs(net) > TOL ? "warn" : "ok",
      title: "Operações entre empresas do grupo",
      detail:
        Math.abs(net) > TOL
          ? `Eliminações não se compensam (${brl(net)}): uma empresa lançou a operação e a outra não, ou usou outro parceiro.`
          : "Eliminadas com os dois lados lançados.",
    });
  }

  // 5) Contas sem classificação útil, com saldo.
  const ignored: string[] = [];
  const noCode: string[] = [];
  for (const cid of entity.companyIds) {
    for (const a of snapshot.perCompany[String(cid)]?.accounts ?? []) {
      const bal = Math.abs(a.opening) + a.monthly.reduce((x, y) => x + Math.abs(y), 0);
      if (bal <= TOL) continue;
      if (a.cls.kind === "ignore") ignored.push(`${a.code} ${a.name}`);
      if (a.code.startsWith("#")) noCode.push(a.name);
    }
  }
  checks.push({
    id: "classification",
    level: ignored.length ? "error" : noCode.length ? "warn" : "ok",
    title: "Classificação das contas",
    detail: ignored.length
      ? `${ignored.length} conta(s) com saldo marcadas como "ignorar": ${ignored.slice(0, 3).join("; ")}${ignored.length > 3 ? "…" : ""}. Ajuste em Administração › Odoo.`
      : noCode.length
        ? `${noCode.length} conta(s) sem código no Odoo (classificadas pelo tipo): ${noCode.slice(0, 3).join("; ")}.`
        : "Todas as contas com saldo estão classificadas.",
  });

  // 6) Lançamentos de encerramento: excluídos na sincronização; avisa se ainda
  //    houver indício (receita negativa no mês) — ex.: encerramento por outro critério.
  const excluded = companies.reduce(
    (s, c) => s + (snapshot.perCompany[String(c.id)]?.closingMovesExcluded ?? 0),
    0,
  );
  const rb = data.actuals.pl.receita_bruta;
  const monthsNeg = data.months.filter(
    (_, i) => (rb[rb.length - data.months.length + i] ?? 0) < -TOL,
  );
  checks.push({
    id: "closing-entries",
    level: monthsNeg.length ? "warn" : "ok",
    title: "Lançamentos de encerramento",
    detail: monthsNeg.length
      ? `Receita negativa em ${monthsNeg.join(", ")}: provável lançamento de encerramento não reconhecido automaticamente. Use uma conta de "apuração do resultado" ou reclassifique.`
      : excluded > 0
        ? `${excluded} lançamento(s) de encerramento/apuração do resultado desconsiderado(s) — a DRE mensal mostra a operação real.`
        : "Nenhum lançamento de encerramento no período.",
  });

  // 7) Rascunhos (não entram nos números).
  const drafts = companies.map((c) => snapshot.perCompany[String(c.id)]?.draftCount);
  const unknown = drafts.some((d) => d === undefined || d < 0);
  const nDrafts = drafts.reduce<number>((s, d) => s + (d && d > 0 ? d : 0), 0);
  checks.push({
    id: "drafts",
    level: nDrafts > 0 ? "warn" : unknown ? "warn" : "ok",
    title: "Lançamentos em rascunho",
    detail:
      nDrafts > 0
        ? `${nDrafts} lançamento(s) em rascunho na janela não estão nos números. Poste-os no Odoo e sincronize.`
        : unknown
          ? "Não verificado (sincronize de novo ou dê ao usuário de integração acesso de leitura a lançamentos)."
          : "Nenhum rascunho na janela.",
  });

  // 8) Meses abertos na janela.
  const root = entity.rootId ? snapshot.companies.find((c) => c.id === entity.rootId) : null;
  const locks = (root ? [root] : companies).map((c) => closedMonthOf(c.lockDate));
  const closed = locks.every(Boolean) ? locks.sort()[0] : null;
  const end = data.months[data.months.length - 1];
  checks.push({
    id: "open-months",
    level: !closed || (end && end > closed) ? "warn" : "ok",
    title: "Período fechado no Odoo",
    detail: !closed
      ? "Sem data de bloqueio no Odoo: lançamentos retroativos podem mudar estes números."
      : end && end > closed
        ? `A janela vai até ${end}, mas o Odoo está fechado só até ${closed} — os meses seguintes ainda podem mudar.`
        : `Todos os meses da janela estão bloqueados no Odoo (até ${closed}).`,
  });

  // 9) Moeda: convertida pelas cotações do Odoo (aviso) ou somada sem conversão (erro).
  const foreign = companies.filter((c) => c.currency && c.currency !== "BRL");
  if (foreign.length) {
    const conv = snapshot.fx?.converted ?? {};
    const semCotacao = foreign.filter((c) => !conv[String(c.id)]);
    const convertidas = foreign.filter((c) => conv[String(c.id)]);
    if (semCotacao.length)
      checks.push({
        id: "currency",
        level: "error",
        title: "Moeda",
        detail: `${semCotacao.map((c) => `${c.name} (${c.currency})`).join(", ")} não está em BRL e o Odoo não tem cotação para a janela — valores somados sem conversão. Cadastre as cotações no Odoo e sincronize.`,
      });
    else
      checks.push({
        id: "currency",
        level: "warn",
        title: "Moeda",
        detail: `${convertidas.map((c) => `${c.name} (${c.currency})`).join(", ")} convertida(s) para reais pelas cotações do Odoo: resultado pela média do mês, balanço pelo fim do mês e a variação cambial em "Ajuste acumulado de conversão" no PL (CPC 02).`,
      });
  }

  const level: TrustLevel = checks.some((c) => c.level === "error")
    ? "error"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return { level, checks };
}
