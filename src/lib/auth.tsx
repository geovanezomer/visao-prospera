import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  emailConfirmed: boolean;
  /** Acesso ao Consultor IA. Default = true; admin pode desativar via painel. */
  aiEnabled: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Listener FIRST so we don't miss events.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(toAuthUser(newSession?.user));
    });

    // Then hydrate from existing session.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(toAuthUser(data.session?.user));
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

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
