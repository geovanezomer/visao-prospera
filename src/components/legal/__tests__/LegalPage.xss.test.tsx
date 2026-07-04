// ============================================================================
// Sanitização de HTML legal — defesa contra XSS armazenado. Cobre o pipeline
// usado por LegalPage (render) e LegalTab (save), e o template MINUTA usado
// como fallback quando o banco está vazio.
// ============================================================================
import { describe, it, expect } from "vitest";
import { sanitizeLegalHtml } from "@/lib/security/sanitizeHtml";
import {
  DEFAULT_PRIVACY_TEMPLATE,
  DEFAULT_TERMS_TEMPLATE,
  fillPlaceholders,
} from "@/components/legal/defaultLegalContent";

describe("sanitizeLegalHtml", () => {
  it("remove <script> e handlers on* de HTML do admin", () => {
    const dirty = `<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)">`;
    const clean = sanitizeLegalHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).toContain("<p>ok</p>");
  });

  it("remove <iframe>, <style> e <form>", () => {
    const dirty = `<iframe src="x"></iframe><style>body{}</style><form action="x"><input></form><p>ok</p>`;
    const clean = sanitizeLegalHtml(dirty);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/<style/i);
    expect(clean).not.toMatch(/<form/i);
    expect(clean).toContain("<p>ok</p>");
  });
});

describe("template MINUTA LGPD (fallback)", () => {
  it("privacy contém banner MINUTA e seções obrigatórias", () => {
    const html = sanitizeLegalHtml(fillPlaceholders(DEFAULT_PRIVACY_TEMPLATE, {}));
    expect(html).toContain("MINUTA");
    expect(html).toMatch(/Controlador/i);
    expect(html).toMatch(/Encarregado/i);
    expect(html).toMatch(/art\.\s*18/i);
    expect(html).toMatch(/LGPD/);
  });

  it("terms contém banner MINUTA e cláusulas obrigatórias", () => {
    const html = sanitizeLegalHtml(fillPlaceholders(DEFAULT_TERMS_TEMPLATE, {}));
    expect(html).toContain("MINUTA");
    expect(html).toMatch(/Objeto/i);
    expect(html).toMatch(/apoio à decisão/i);
    expect(html).toMatch(/Foro/i);
  });

  it("fillPlaceholders substitui valores e preserva placeholders sem valor", () => {
    const out = fillPlaceholders("{{RAZAO_SOCIAL}} — {{CNPJ}}", { RAZAO_SOCIAL: "Acme LTDA" });
    expect(out).toBe("Acme LTDA — {{CNPJ}}");
  });
});
