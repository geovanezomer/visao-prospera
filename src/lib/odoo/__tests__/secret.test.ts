import { beforeAll, describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, maskSecret } from "../secret.server";

beforeAll(() => {
  process.env.ODOO_SECRET_KEY = "k".repeat(40);
});

describe("cofre da chave do Odoo", () => {
  it("cifra e decifra (v2 com AAD); IV novo a cada vez", () => {
    const a = encryptSecret("minha-chave");
    const b = encryptSecret("minha-chave");
    expect(a.startsWith("v2.")).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("minha-chave");
  });

  it("ainda lê o formato v1 (sem AAD)", () => {
    const key = createHash("sha256")
      .update(`financepro:odoo:${"k".repeat(40)}`)
      .digest();
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update("antiga", "utf8"), c.final()]);
    const token = ["v1", iv, c.getAuthTag(), enc]
      .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
      .join(".");
    expect(decryptSecret(token)).toBe("antiga");
  });

  it("recusa texto adulterado e mostra só o final", () => {
    const t = encryptSecret("abc123xyz");
    const parts = t.split(".");
    parts[3] = Buffer.from("x").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    expect(maskSecret("abc123xyz")).toBe("••••••••3xyz");
  });
});
