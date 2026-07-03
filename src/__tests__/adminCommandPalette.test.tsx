// ============================================================================
// Testes do AdminCommandPalette:
//   • Atalho ⌘K abre / fecha
//   • Navegação por abas dispara navigate({ search: { tab } })
//   • Busca com debounce chama listAdminUsers UMA vez por pausa de digitação
// ============================================================================
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const listAdminUsersMock = vi.fn(async () => ({ users: [], total: 0, page: 1, perPage: 5 }));
const resendMagicLinkMock = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/admin/admin.functions", () => ({
  listAdminUsers: (args: unknown) => listAdminUsersMock(args as never),
  resendMagicLink: (args: unknown) => resendMagicLinkMock(args as never),
}));

vi.mock("@/lib/admin/export.functions", () => ({
  exportUsersCsv: vi.fn(async () => ({ csv: "id\n", rows: 0 })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Sob teste ──────────────────────────────────────────────────────────────

import { AdminCommandPalette, useAdminCommandShortcut } from "@/components/admin/AdminCommandPalette";
import { useState } from "react";

function Harness() {
  const [open, setOpen] = useState(false);
  useAdminCommandShortcut(() => setOpen((v) => !v));
  return (
    <>
      <button data-testid="open-btn" onClick={() => setOpen(true)}>open</button>
      <AdminCommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  navigateMock.mockClear();
  listAdminUsersMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("AdminCommandPalette", () => {
  test("⌘K abre e fecha o palette", async () => {
    render(<Harness />);
    expect(screen.queryByPlaceholderText(/Buscar aba/i)).toBeNull();

    // Abre
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(await screen.findByPlaceholderText(/Buscar aba/i)).toBeInTheDocument();

    // Fecha (segundo toque no atalho — Esc é gerenciado pelo cmdk/Dialog)
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Buscar aba/i)).toBeNull(),
    );
  });

  test("navegação por aba chama navigate com { tab }", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("open-btn"));
    const item = await screen.findByText("Ir para Webhooks");
    fireEvent.click(item);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const call = navigateMock.mock.calls[0][0] as { search: { tab: string } };
    expect(call.search.tab).toBe("webhooks");
  });

  test("busca chama listAdminUsers uma vez por pausa de digitação (debounce)", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("open-btn"));
    const input = await screen.findByPlaceholderText(/Buscar aba/i);

    // Simula digitação rápida — cmdk usa onValueChange, propagado por change.
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.change(input, { target: { value: "abcd" } });

    // Antes do debounce estourar, ninguém chamou o backend.
    expect(listAdminUsersMock).not.toHaveBeenCalled();

    // Avança 300ms e valida uma única chamada com o último valor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(listAdminUsersMock).toHaveBeenCalledTimes(1);
    const arg = listAdminUsersMock.mock.calls[0][0] as { data: { search: string; perPage: number } };
    expect(arg.data.search).toBe("abcd");
    expect(arg.data.perPage).toBe(5);
  });
});
