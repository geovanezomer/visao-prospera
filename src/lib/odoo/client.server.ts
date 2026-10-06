// ============================================================================
// Cliente da API externa do Odoo (JSON-2, Odoo 19/20).
//
//   POST {url}/json/2/{model}/{method}
//   Authorization: bearer <chave de API com escopo "rpc">
//   X-Odoo-Database: <banco>
//
// Somente leitura por desenho: o conector só chama métodos de consulta
// (ALLOWED_METHODS). Recomenda-se um usuário Odoo dedicado com o perfil
// "Contabilidade – somente leitura" — o Odoo então recusa qualquer escrita.
// ============================================================================

export type OdooConnectionConfig = { url: string; database: string; apiKey: string };

const ALLOWED_METHODS = new Set([
  "search_read",
  "read",
  "search_count",
  "fields_get",
  "formatted_read_group",
]);

export class OdooError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OdooError";
  }
}

export function normalizeOdooUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new OdooError("URL do Odoo inválida.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new OdooError("URL do Odoo inválida.");
  return u.origin;
}

/** Corpo máximo aceito de uma resposta do Odoo (protege a memória do servidor). */
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_MESSAGE = 300;

const strip = (ip: string) => ip.toLowerCase().replace(/^::ffff:/, "");
function isPrivateIp(ip: string): boolean {
  const v = strip(ip);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
    const [a, b] = v.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return v === "::1" || /^f[cd]/.test(v);
}
/** Link-local (metadados de nuvem em 169.254.169.254), "qualquer endereço" e multicast. */
function isForbiddenIp(ip: string): boolean {
  const v = strip(ip);
  return (
    /^169\.254\./.test(v) ||
    v === "0.0.0.0" ||
    v === "::" ||
    /^fe[89ab]/.test(v) ||
    /^2(2[4-9]|3\d)\./.test(v) ||
    /^ff/.test(v)
  );
}

/**
 * Valida o destino antes de enviar a chave:
 * - nunca endereços de metadados/link-local;
 * - http (sem TLS) só em rede local (laboratório, Odoo na mesma máquina/LAN);
 *   pela internet a chave só trafega por https;
 * - ODOO_ALLOWED_HOSTS (lista separada por vírgula), se definida, restringe os hosts.
 */
export async function assertSafeOdooUrl(url: string): Promise<string> {
  const origin = normalizeOdooUrl(url);
  const u = new URL(origin);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allow = (process.env.ODOO_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length && !allow.includes(host)) {
    throw new OdooError("Host do Odoo fora da lista permitida (ODOO_ALLOWED_HOSTS).");
  }
  const { lookup } = await import("node:dns/promises");
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new OdooError("Não foi possível resolver o endereço do Odoo.");
  }
  if (!addrs.length || addrs.some((a) => isForbiddenIp(a.address))) {
    throw new OdooError("Endereço do Odoo não permitido.");
  }
  if (u.protocol === "http:" && !addrs.every((a) => isPrivateIp(a.address))) {
    throw new OdooError(
      "Use https:// — a chave de API não pode trafegar sem criptografia pela internet.",
    );
  }
  return origin;
}

/** Lê o corpo com limite de tamanho. */
async function readCapped(res: Response): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new OdooError("Resposta do Odoo grande demais.");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new OdooError("Resposta do Odoo grande demais.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const clip = (m: string) => (m.length > MAX_MESSAGE ? `${m.slice(0, MAX_MESSAGE)}…` : m);

export async function odooCall<T = unknown>(
  cfg: OdooConnectionConfig,
  model: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<T> {
  if (!ALLOWED_METHODS.has(method)) throw new OdooError(`Método não permitido: ${method}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${await assertSafeOdooUrl(cfg.url)}/json/2/${model}/${method}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `bearer ${cfg.apiKey}`,
        "X-Odoo-Database": cfg.database,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof OdooError) throw e;
    const msg = e instanceof Error && e.name === "AbortError" ? "tempo esgotado" : "falha de rede";
    throw new OdooError(`Não foi possível falar com o Odoo (${msg}).`);
  }
  let text: string;
  try {
    text = await readCapped(res);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não-JSON (proxy, página de erro) */
  }
  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      (res.status === 401 ? "Chave de API inválida ou sem escopo 'rpc'." : `HTTP ${res.status}`);
    throw new OdooError(clip(friendly(String(message), res.status)), res.status);
  }
  return body as T;
}

function friendly(message: string, status: number): string {
  if (status === 401 || /invalid apikey/i.test(message))
    return "Chave de API recusada. No Odoo 20 a chave precisa ter o escopo 'rpc'.";
  if (status === 404)
    return "Endpoint JSON-2 não encontrado — confira a URL (Odoo 19 ou superior).";
  if (/database/i.test(message) && /not found|does not exist/i.test(message))
    return "Banco de dados não encontrado no Odoo.";
  return message;
}

/** Versão mínima suportada: a API JSON-2 (/json/2) existe a partir do Odoo 19. */
export const ODOO_MIN_MAJOR = 19;

/** Versão principal a partir do texto do servidor ("20.0", "19.0+e", "saas~19.2"). */
export function odooMajorVersion(v: string | null | undefined): number | null {
  const m = /(\d+)(?:\.\d+)?/.exec(v ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Recusa versões anteriores ao Odoo 19 com mensagem clara. Versão desconhecida
 * passa: a chamada JSON-2 seguinte falha com erro próprio se não houver a API.
 */
export function assertSupportedOdooVersion(v: string | null | undefined): void {
  const major = odooMajorVersion(v);
  if (major !== null && major < ODOO_MIN_MAJOR)
    throw new Error(
      `Odoo ${v} não é suportado. O FinnancePRO conecta ao Odoo ${ODOO_MIN_MAJOR} ou superior (API JSON-2).`,
    );
}

/** Versão do servidor (endpoint público do Odoo). */
export async function odooServerVersion(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${await assertSafeOdooUrl(url)}/jsonrpc`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service: "common", method: "version", args: [] },
      }),
    });
    const j = JSON.parse(await readCapped(res)) as { result?: { server_version?: string } };
    const v = j.result?.server_version;
    return typeof v === "string" ? clip(v) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
