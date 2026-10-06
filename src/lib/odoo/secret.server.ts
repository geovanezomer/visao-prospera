// ============================================================================
// Cofre da chave de API do Odoo: AES-256-GCM.
//
// A chave de cifra vem de ODOO_SECRET_KEY, ou é derivada de BETTER_AUTH_SECRET
// (SHA-256 com rótulo próprio). Trocar a chave mestra exige cadastrar a chave
// do Odoo de novo no painel. O valor cifrado nunca sai do servidor.
// ============================================================================
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function masterKey(): Buffer {
  const raw = process.env.ODOO_SECRET_KEY || process.env.BETTER_AUTH_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("Defina ODOO_SECRET_KEY ou BETTER_AUTH_SECRET (mín. 32 caracteres).");
  }
  return createHash("sha256").update(`financepro:odoo:${raw}`).digest();
}

/** Formato: v1.<iv>.<tag>.<cifra> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, enc]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, enc] = token.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Chave do Odoo em formato inválido.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(enc, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Não foi possível decifrar a chave do Odoo (chave mestra alterada?). Cadastre-a de novo.",
    );
  }
}

/** Exibição segura: só os 4 últimos caracteres. */
export function maskSecret(plain: string): string {
  return plain.length <= 4 ? "••••" : `••••••••${plain.slice(-4)}`;
}
