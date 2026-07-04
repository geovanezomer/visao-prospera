// ============================================================================
// LegalPage XSS — garante que HTML editado pelo admin é sanitizado antes de
// renderizar (defesa contra XSS armazenado) e que o fallback MINUTA aparece
// quando o banco está vazio.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock rotas do TanStack para não puxar o roteador inteiro.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...p }: { children: React.ReactNode; [k: string]: unknown }) =>
    <a {...(p as Record<string, unknown>)}>{children}</a>,
}));
vi.mock("@/hooks/useBranding", () => ({
  useBranding: () => ({ branding: { systemName: "TestApp" } }),
}));
vi.mock("@/components/BrandHeader", () => ({ BrandHeader: () => <div /> }));

const legalMock = vi.hoisted(() => ({ termsHtml: "", privacyHtml: "" }));
vi.mock("@/hooks/useLegal", () => ({
  useLegal: () => ({ isLoading: false, isReady: true, legal: legalMock }),
}));

import { LegalPage } from "@/components/legal/LegalPage";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("LegalPage — sanitização XSS", () => {
  it("remove <script> e handlers on* do HTML do admin", () => {
    legalMock.termsHtml = `<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)">`;
    legalMock.privacyHtml = "";
    const { container } = wrap(<LegalPage kind="terms" />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror=/i);
    expect(html).toContain("<p>ok</p>");
  });

  it("cai no template MINUTA LGPD quando o HTML do banco está vazio", () => {
    legalMock.termsHtml = "";
    legalMock.privacyHtml = "";
    const { container } = wrap(<LegalPage kind="privacy" />);
    expect(container.innerHTML).toContain("MINUTA");
    expect(container.innerHTML).toContain("Política de Privacidade");
  });
});
