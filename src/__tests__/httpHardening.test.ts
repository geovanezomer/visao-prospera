import { afterEach, describe, expect, test } from "vitest";
import { clientIp } from "@/lib/rateLimit.server";
import { isTrackedPath } from "@/lib/analyticsConsent";
import { SECURITY_HEADERS, withSecurityHeaders } from "@/server";

const req = (headers: Record<string, string>) => new Request("https://x/", { headers });

afterEach(() => {
  delete process.env.TRUST_PROXY_HEADER;
});

describe("clientIp", () => {
  test("sem proxy confiável, ignora headers enviados pelo cliente", () => {
    const r = req({ "x-forwarded-for": "1.1.1.1", "cf-connecting-ip": "2.2.2.2" });
    expect(clientIp(r)).toBe("unknown");
  });

  test("x-forwarded-for confiável usa a entrada mais à direita (a do proxy)", () => {
    process.env.TRUST_PROXY_HEADER = "x-forwarded-for";
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  test("cf-connecting-ip confiável", () => {
    process.env.TRUST_PROXY_HEADER = "cf-connecting-ip";
    expect(clientIp(req({ "cf-connecting-ip": "3.3.3.3", "x-forwarded-for": "6.6.6.6" }))).toBe(
      "3.3.3.3",
    );
  });
});

describe("isTrackedPath", () => {
  test.each(["/", "/landing", "/landing/", "/privacidade", "/checkout/sucesso"])(
    "%s permite rastreamento",
    (p) => expect(isTrackedPath(p)).toBe(true),
  );
  test.each(["/app", "/login", "/signup", "/admin", "/reset-password", "/shared/abc"])(
    "%s nunca recebe scripts de terceiros",
    (p) => expect(isTrackedPath(p)).toBe(false),
  );
});

describe("withSecurityHeaders", () => {
  test("adiciona todos os headers", () => {
    const res = withSecurityHeaders(new Response("ok"));
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
  });

  test("funciona com headers imutáveis (Response.redirect)", () => {
    const res = withSecurityHeaders(Response.redirect("https://x/login", 302));
    expect(res.status).toBe(302);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("não sobrescreve header já definido pela rota", () => {
    const res = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("buildBrandingCss", () => {
  test("aceita hex e funções de cor", async () => {
    const { buildBrandingCss } = await import("@/lib/brandingCss");
    expect(buildBrandingCss({ primary: "#1a2b3c" })).toContain("--primary:#1a2b3c");
    expect(buildBrandingCss({ primary: "oklch(0.7 0.15 250)" })).toContain("oklch(0.7 0.15 250)");
  });

  test("rejeita valor que fecharia o <style>", async () => {
    const { buildBrandingCss } = await import("@/lib/brandingCss");
    expect(buildBrandingCss({ primary: "red}</style><script>alert(1)</script>" })).toBeNull();
    const css = buildBrandingCss({ primary: "#000000", accent: "x;}</style>" });
    expect(css).not.toContain("</style>");
    expect(css).toContain("--accent:#000000");
  });
});
