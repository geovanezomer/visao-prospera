import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  emailConfirmed: boolean;
  /** "admin" | "user". A checagem que vale é a do servidor (assertAdmin). */
  role: string;
  /** Acesso ao Consultor IA. Default = true; admin pode desativar via painel. */
  aiEnabled: boolean;
  /** Marca usuário como teste gratuito (auto-logout ao expirar). */
  isTrial: boolean;
  /** ISO timestamp do fim do trial; null quando não-trial. */
  trialExpiresAt: string | null;
  /** Senha provisória (ex.: admin/admin do primeiro acesso) — troca exigida. */
  mustChangePassword: boolean;
};

export type AuthSessionInfo = { id: string; expiresAt: string };

export type AuthResult = { ok: true } | { ok: false; error: string };

type AuthCtx = {
  user: AuthUser | null;
  session: AuthSessionInfo | null;
  hydrated: boolean;
  /** `identifier` aceita e-mail ou nome de usuário (ex.: "admin"). */
  login: (identifier: string, password: string) => Promise<AuthResult>;
  signup: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<AuthResult & { needsConfirmation?: boolean }>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  /** Conclui a redefinição com o token do link enviado por e-mail. */
  resetPassword: (token: string, newPassword: string) => Promise<AuthResult>;
  /** Troca de senha logado (exige a atual); limpa `mustChangePassword`. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  role?: string | null;
  aiEnabled?: boolean | null;
  isTrial?: boolean | null;
  trialExpiresAt?: Date | string | null;
  mustChangePassword?: boolean | null;
};

function toAuthUser(u: SessionUser | null | undefined): AuthUser | null {
  if (!u) return null;
  const exp = u.trialExpiresAt ? new Date(u.trialExpiresAt) : null;
  return {
    id: u.id,
    email: u.email ?? "",
    displayName: u.name || (u.email ? u.email.split("@")[0] : "Usuário"),
    emailConfirmed: Boolean(u.emailVerified),
    role: u.role ?? "user",
    aiEnabled: u.aiEnabled !== false,
    isTrial: u.isTrial === true,
    trialExpiresAt: exp && !Number.isNaN(exp.getTime()) ? exp.toISOString() : null,
    mustChangePassword: u.mustChangePassword === true,
  };
}

function friendlyError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid") && (m.includes("password") || m.includes("email") || m.includes("username")))
    return "Usuário, e-mail ou senha inválidos.";
  if (m.includes("already exists") || m.includes("already registered"))
    return "Este e-mail já está cadastrado. Faça login ou recupere sua senha.";
  if (m.includes("too short")) return "A senha precisa ter pelo menos 8 caracteres.";
  if (m.includes("banned")) return "Acesso suspenso. Fale com o administrador.";
  if (m.includes("too many") || m.includes("rate")) return "Muitas tentativas. Aguarde alguns minutos.";
  return message || "Não foi possível concluir. Tente novamente.";
}

const LAST_USER_KEY = "gz-finance-last-user-id";

/**
 * P4-04: Purga storage local quando o userId ativo é diferente do
 * último registrado. Evita vazamento cross-user em browser compartilhado
 * (usuário A fecha a aba sem deslogar; usuário B entra e herdaria dados).
 */
async function purgeLocalStateIfUserChanged(currentUserId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const last = window.localStorage.getItem(LAST_USER_KEY);
    if (currentUserId && last === currentUserId) return; // mesmo usuário, nada a fazer
    if (!currentUserId && !last) return; // ambos vazios

    // Remove tudo do escopo da aplicação (preserva chaves de terceiros).
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || k === LAST_USER_KEY) continue;
      if (
        k.startsWith("gz-finance-") ||
        k.startsWith("finnance-") ||
        k.startsWith("finnance:") ||
        k.includes("::")
      ) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) window.localStorage.removeItem(k);
    window.sessionStorage.clear();

    if ("indexedDB" in window && typeof window.indexedDB.databases === "function") {
      try {
        const dbs = await window.indexedDB.databases();
        for (const db of dbs) {
          if (db.name && /finnance|finance|gz-/i.test(db.name)) {
            window.indexedDB.deleteDatabase(db.name);
          }
        }
      } catch {
        /* navegadores sem .databases() — ignora */
      }
    }

    if (currentUserId) {
      window.localStorage.setItem(LAST_USER_KEY, currentUserId);
    } else {
      window.localStorage.removeItem(LAST_USER_KEY);
    }
  } catch {
    /* best-effort: não bloqueia auth */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, refetch } = authClient.useSession();
  const user = useMemo(() => toAuthUser(data?.user as SessionUser | undefined), [data?.user]);
  const session = useMemo<AuthSessionInfo | null>(
    () =>
      data?.session
        ? { id: data.session.id, expiresAt: new Date(data.session.expiresAt).toISOString() }
        : null,
    [data?.session],
  );
  const hydrated = !isPending;

  useEffect(() => {
    if (hydrated) void purgeLocalStateIfUserChanged(user?.id ?? null);
  }, [hydrated, user?.id]);

  const login = useCallback(async (identifier: string, password: string): Promise<AuthResult> => {
    const id = identifier.trim();
    const res = id.includes("@")
      ? await authClient.signIn.email({ email: id.toLowerCase(), password })
      : await authClient.signIn.username({ username: id.toLowerCase(), password });
    if (res.error) return { ok: false, error: friendlyError(res.error.message) };
    // Uma sessão ativa por usuário: derruba as de outros dispositivos.
    authClient.revokeOtherSessions().catch((e) => console.warn("[auth] revokeOtherSessions:", e));
    return { ok: true };
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await authClient.signUp.email({
      email: email.trim().toLowerCase(),
      password,
      name: displayName.trim() || email.split("@")[0],
    });
    if (res.error) return { ok: false as const, error: friendlyError(res.error.message) };
    return { ok: true as const, needsConfirmation: false };
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    const res = await authClient.requestPasswordReset({
      email: email.trim().toLowerCase(),
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (res.error) return { ok: false, error: friendlyError(res.error.message) };
    return { ok: true };
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    const res = await authClient.resetPassword({ token, newPassword });
    if (res.error) return { ok: false as const, error: friendlyError(res.error.message) };
    return { ok: true as const };
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
      const { changeOwnPassword } = await import("@/lib/account.functions");
      try {
        await changeOwnPassword({ data: { currentPassword, newPassword } });
      } catch (e) {
        return { ok: false, error: friendlyError(e instanceof Error ? e.message : String(e)) };
      }
      await refetch();
      return { ok: true };
    },
    [refetch],
  );

  const logout = useCallback(async () => {
    await authClient.signOut();
    try {
      if (typeof window !== "undefined") {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (!k) continue;
          if (
            k === LAST_USER_KEY ||
            k.startsWith("gz-finance-") ||
            k.startsWith("finnance-") ||
            k.startsWith("finnance:") ||
            k.includes("::")
          ) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) window.localStorage.removeItem(k);
        window.sessionStorage.clear();

        if ("indexedDB" in window && typeof window.indexedDB.databases === "function") {
          try {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
              if (db.name && /finnance|finance|gz-/i.test(db.name)) {
                window.indexedDB.deleteDatabase(db.name);
              }
            }
          } catch {
            /* navegadores sem .databases() (Firefox antigo) — ignora */
          }
        }
      }
    } catch {
      /* limpeza best-effort: não bloqueia o logout */
    }
  }, []);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        hydrated,
        login,
        signup,
        requestPasswordReset,
        resetPassword,
        changePassword,
        logout,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

// Provider + hook no mesmo módulo é o padrão de contexto; fast refresh recarrega o arquivo inteiro.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
