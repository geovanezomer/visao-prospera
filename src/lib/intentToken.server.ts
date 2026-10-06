// ============================================================================
// HMAC para o parâmetro `i=` da URL de retorno do checkout.
//
// Sem assinatura, qualquer chave de 32 hex caracteres adivinhada permitiria
// consultar /intent-status e /resend-magic-link com dados de terceiros.
// Aqui anexamos uma assinatura curta (HMAC-SHA256 truncado a 16 bytes / 32
// hex chars) usando CHECKOUT_INTENT_HMAC_SECRET.
//
// Formato do token:   `<idempotencyKey>.<sig>`
//   ex.: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.5f0a...e2c1
//
// Verificação é constant-time para evitar timing-attack.
// ============================================================================

const ENC = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.CHECKOUT_INTENT_HMAC_SECRET;
  if (!secret) throw new Error("CHECKOUT_INTENT_HMAC_SECRET não configurado.");
  return crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Assina a idempotency key e devolve `<key>.<sig>` para usar na URL. */
export async function signIntentKey(idempotencyKey: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(idempotencyKey));
  // 16 bytes (32 hex) de assinatura — suficiente para impedir forja.
  const sigHex = toHex(sig).slice(0, 32);
  return `${idempotencyKey}.${sigHex}`;
}

// Comparação constant-time movida para `@/lib/timingSafe` (SSOT).
import { timingSafeEqual as timingSafeEqualHex } from "@/lib/timingSafe";

/**
 * Verifica `<key>.<sig>` e devolve a `idempotencyKey` se válido, ou null.
 * Aceita formato legado (somente a key sem `.sig`) apenas se LEGACY=true
 * for explicitamente habilitado via env — por padrão é false (estrito).
 */
export async function verifyIntentToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [k, sig] = parts;
  if (!/^[a-f0-9]{8,64}$/i.test(k) || !/^[a-f0-9]{32}$/i.test(sig)) return null;
  try {
    const expected = await signIntentKey(k);
    const expectedSig = expected.split(".")[1];
    return timingSafeEqualHex(sig.toLowerCase(), expectedSig.toLowerCase()) ? k : null;
  } catch {
    return null;
  }
}
