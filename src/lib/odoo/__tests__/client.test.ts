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
