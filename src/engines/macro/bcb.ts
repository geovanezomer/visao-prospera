// API SGS do Banco Central — séries macro públicas, sem chave.
// Doc: https://dadosabertos.bcb.gov.br/dataset/

const SERIES = {
  selic: 432, // Meta Selic % a.a.
  selicDiaria: 11, // Selic diária
  cdi: 12, // CDI
  ipca: 433, // IPCA mensal %
  ipca12m: 13522, // IPCA acumulado 12m
  igpm: 189, // IGP-M mensal
  cambioUsd: 1, // USD/BRL compra
  cambioEur: 21619,
} as const;

export type SerieKey = keyof typeof SERIES;

interface BcbPoint {
  data: string;
  valor: string;
}
export interface MacroSerie {
  key: SerieKey;
  code: number;
  label: string;
  data: { date: string; value: number }[];
  latest: { date: string; value: number } | null;
  fetchedAt: number;
}

const LABELS: Record<SerieKey, string> = {
  selic: "Meta Selic (% a.a.)",
  selicDiaria: "Selic diária (% a.a.)",
  cdi: "CDI (% a.a.)",
  ipca: "IPCA mensal (%)",
  ipca12m: "IPCA acumulado 12m (%)",
  igpm: "IGP-M mensal (%)",
  cambioUsd: "Câmbio USD/BRL (compra)",
  cambioEur: "Câmbio EUR/BRL (compra)",
};

const CACHE_KEY = "gz-finance-macro-cache";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

function loadCache(): Record<string, MacroSerie> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveCache(c: Record<string, MacroSerie>) {
  try {
    saveKeySync(CACHE_KEY, c);
  } catch {
    // localStorage cheio ou indisponível (modo privado) — cache fica só em memória nesta sessão
  }
}

export async function fetchSerie(key: SerieKey, lastN = 12): Promise<MacroSerie> {
  const cache = loadCache();
  const cKey = `${key}-${lastN}`;
  const cached = cache[cKey];
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  const code = SERIES[key];
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${lastN}?formato=json`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`BCB ${code}: HTTP ${res.status}`);
  const arr: BcbPoint[] = await res.json();
  const data = arr
    .map((p) => ({
      date: p.data,
      value: parseFloat(p.valor.replace(",", ".")),
    }))
    .filter((p) => Number.isFinite(p.value));
  const serie: MacroSerie = {
    key,
    code,
    label: LABELS[key],
    data,
    latest: data[data.length - 1] ?? null,
    fetchedAt: Date.now(),
  };
  cache[cKey] = serie;
  saveCache(cache);
  return serie;
}

export async function getMacroSnapshot(): Promise<string> {
  const keys: SerieKey[] = ["selic", "cdi", "ipca12m", "igpm", "cambioUsd"];
  const results = await Promise.allSettled(keys.map((k) => fetchSerie(k, 1)));
  const lines: string[] = ["## Indicadores Macroeconômicos (BCB)"];
  results.forEach((r, i) => {
    const k = keys[i];
    if (r.status === "fulfilled" && r.value.latest) {
      lines.push(`- **${r.value.label}** — ${r.value.latest.value} (em ${r.value.latest.date})`);
    } else {
      lines.push(`- **${LABELS[k]}** — indisponível`);
    }
  });
  return lines.join("\n");
}

export async function getSerieFormatted(key: SerieKey, lastN = 12): Promise<string> {
  try {
    const s = await fetchSerie(key, lastN);
    if (!s.data.length) return `Sem dados para ${LABELS[key]}.`;
    const rows = s.data.map((p) => `| ${p.date} | ${p.value} |`).join("\n");
    return `### ${s.label}\n\n| Data | Valor |\n| --- | --- |\n${rows}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Erro ao buscar ${LABELS[key]}: ${msg}`;
  }
}

export const MACRO_SERIES_KEYS = Object.keys(SERIES) as SerieKey[];
