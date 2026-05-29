import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthUser = { username: string; displayName: string; role: "admin" | "cliente" };

const USERS: Record<string, { password: string; user: AuthUser }> = {
  adminfinancepro: {
    password: "admin7184#",
    user: { username: "adminfinancepro", displayName: "Admin", role: "admin" },
  },
  clientefinancepro: {
    password: "cliente7184#",
    user: { username: "clientefinancepro", displayName: "Cliente", role: "cliente" },
  },
};

const STORAGE_KEY = "gzfp:auth:user";

type AuthCtx = {
  user: AuthUser | null;
  hydrated: boolean;
  login: (username: string, password: string) => { ok: true } | { ok: false; error: string };
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  const login = useCallback((username: string, password: string) => {
    const u = USERS[username.trim().toLowerCase()];
    if (!u || u.password !== password) {
      return { ok: false as const, error: "Usuário ou senha inválidos." };
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(u.user)); } catch {}
    setUser(u.user);
    return { ok: true as const };
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, hydrated, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

export function getCurrentUsername(): string {
  if (typeof window === "undefined") return "guest";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "guest";
    return (JSON.parse(raw) as AuthUser).username || "guest";
  } catch {
    return "guest";
  }
}
