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
  const u = new URL(url.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new OdooError("URL do Odoo inválida.");
  return u.origin;
}

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
    res = await fetch(`${normalizeOdooUrl(cfg.url)}/json/2/${model}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `bearer ${cfg.apiKey}`,
        "X-Odoo-Database": cfg.database,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "tempo esgotado" : String(e);
    throw new OdooError(`Não foi possível falar com o Odoo (${msg}).`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
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
    throw new OdooError(friendly(message, res.status), res.status);
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

/** Versão do servidor (endpoint público do Odoo). */
export async function odooServerVersion(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${normalizeOdooUrl(url)}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service: "common", method: "version", args: [] },
      }),
    });
    const j = (await res.json()) as { result?: { server_version?: string } };
    return j.result?.server_version ?? null;
  } catch {
    return null;
  }
}
