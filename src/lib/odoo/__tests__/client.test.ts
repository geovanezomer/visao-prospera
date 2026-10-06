import { afterEach, describe, expect, it } from "vitest";
import { assertSafeOdooUrl } from "../client.server";

describe("assertSafeOdooUrl — destino da chave de API", () => {
  afterEach(() => {
    delete process.env.ODOO_ALLOWED_HOSTS;
  });

  it("bloqueia metadados de nuvem e endereço 0.0.0.0", async () => {
    await expect(assertSafeOdooUrl("http://169.254.169.254")).rejects.toThrow(/não permitido/);
    await expect(assertSafeOdooUrl("https://0.0.0.0")).rejects.toThrow(/não permitido/);
  });

  it("http só em rede local; pela internet exige https", async () => {
    await expect(assertSafeOdooUrl("http://127.0.0.1:8069")).resolves.toBe("http://127.0.0.1:8069");
    await expect(assertSafeOdooUrl("http://192.168.0.10:8069")).resolves.toBeTruthy();
    await expect(assertSafeOdooUrl("http://8.8.8.8")).rejects.toThrow(/https/);
    await expect(assertSafeOdooUrl("https://8.8.8.8")).resolves.toBe("https://8.8.8.8");
  });

  it("respeita ODOO_ALLOWED_HOSTS", async () => {
    process.env.ODOO_ALLOWED_HOSTS = "erp.cliente.com.br";
    await expect(assertSafeOdooUrl("https://8.8.8.8")).rejects.toThrow(/lista permitida/);
  });

  it("rejeita URL malformada ou protocolo estranho", async () => {
    await expect(assertSafeOdooUrl("ftp://x")).rejects.toThrow(/inválida/);
    await expect(assertSafeOdooUrl("não é url")).rejects.toThrow(/inválida/);
  });
});

describe("versão do Odoo", () => {
  it("lê a versão principal nos formatos comuns", async () => {
    const { odooMajorVersion } = await import("../client.server");
    expect(odooMajorVersion("20.0")).toBe(20);
    expect(odooMajorVersion("19.0+e")).toBe(19);
    expect(odooMajorVersion("saas~19.2")).toBe(19);
    expect(odooMajorVersion(null)).toBeNull();
    expect(odooMajorVersion("desconhecida")).toBeNull();
  });

  it("aceita 19 ou superior e recusa versões antigas", async () => {
    const { assertSupportedOdooVersion } = await import("../client.server");
    expect(() => assertSupportedOdooVersion("20.0")).not.toThrow();
    expect(() => assertSupportedOdooVersion("19.0")).not.toThrow();
    expect(() => assertSupportedOdooVersion(null)).not.toThrow();
    expect(() => assertSupportedOdooVersion("17.0")).toThrow(/não é suportado/);
    expect(() => assertSupportedOdooVersion("saas~18.4")).toThrow(/Odoo 19 ou superior/);
  });
});
