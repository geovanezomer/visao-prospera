import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { revokeOtherSessions } from "@/lib/session.functions";
import { readTrialFlags } from "@/lib/trialFlags";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  emailConfirmed: boolean;
  /** Acesso ao Consultor IA. Default = true; admin pode desativar via painel. */
  aiEnabled: boolean;
  /** Marca usuário como teste gratuito (auto-logout ao expirar). */
  isTrial: boolean;
  /** ISO timestamp do fim do trial; null quando não-trial. */
  trialExpiresAt: string | null;
};

export type AuthResult = { ok: true } | { ok: false; error: string };

type AuthCtx = {
  user: AuthUser | null;
  session: Session | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<AuthResult & { needsConfirmation?: boolean }>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function toAuthUser(u: User | null | undefined): AuthUser | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (typeof meta.display_name === "string" && meta.display_name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    (u.email ? u.email.split("@")[0] : "Usuário");
  return {
    id: u.id,
    email: u.email ?? "",
    displayName,
    emailConfirmed: Boolean(u.email_confirmed_at),
    aiEnabled: meta.ai_enabled !== false,
    ...readTrialFlags(u),
  };
}

function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed"))
    return "Confirme seu e-mail antes de entrar. Veja sua caixa de entrada.";
  if (m.includes("user already registered"))
    return "Este e-mail já está cadastrado. Faça login ou recupere sua senha.";
  if (m.includes("password should be at least"))
    return "A senha precisa ter pelo menos 8 caracteres.";
  if (m.includes("password is known to be weak") || m.includes("pwned"))
    return "Esta senha já vazou em incidentes públicos. Escolha outra.";
  if (m.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  return message;
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
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Guarda o access_token atual para deduplicar eventos do Supabase
  // (TOKEN_REFRESHED / INITIAL_SESSION disparados ao voltar de outra aba).
  // Sem isso, cada retorno de foco cria novos objetos user/session,
  // muda a identidade do contexto e força re-render em cascata — o
  // usuário percebe como "recarregar tudo" ao trocar de aba.
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const applySession = (newSession: Session | null) => {
      const token = newSession?.access_token ?? null;
      if (token === lastTokenRef.current) return; // sem mudança real → no-op
      lastTokenRef.current = token;
      const uid = newSession?.user?.id ?? null;
      void purgeLocalStateIfUserChanged(uid);
      setSession(newSession);
      setUser(toAuthUser(newSession?.user));
    };

    // Listener FIRST so we don't miss events.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      applySession(newSession);
    });

    // Then hydrate from existing session.
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
      setHydrated(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { ok: false, error: friendlyError(error.message) };
    // Sessão única: revoga outros dispositivos em background (não bloqueia o login).
    revokeOtherSessions().catch((e) => {
      console.warn("[auth] revokeOtherSessions falhou:", e);
    });
    return { ok: true };
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName: string) => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { display_name: displayName.trim() },
      },
    });
    if (error) return { ok: false as const, error: friendlyError(error.message) };
    const needsConfirmation = !data.session;
    return { ok: true as const, needsConfirmation };
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { ok: false, error: friendlyError(error.message) };
    return { ok: true };
  }, []);

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: friendlyError(error.message) };
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    // P4-09 / P4-04: limpa qualquer estado financeiro local (cenários,
    // configs por empresa, drafts), evitando vazamento cross-user em
    // máquinas compartilhadas.
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

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        hydrated,
        login,
        signup,
        requestPasswordReset,
        updatePassword,
        logout,
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
