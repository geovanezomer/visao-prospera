// ============================================================================
// Login — Better Auth, rodando dentro do próprio servidor e gravando no
// PostgreSQL da aplicação (tabelas user/session/account/verification).
//
// - Sessão em cookie httpOnly (antes: token no localStorage, exposto a XSS).
// - Login por e-mail ou por usuário (plugin username — ex.: "admin").
// - Papéis via plugin admin (`user.role`: "admin" | "user").
// - Magic link para o teste grátis e o pós-checkout.
// - Campos de trial/IA com `input: false`: o usuário nunca consegue gravá-los.
// ============================================================================
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, magicLink, username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db, schema } from "@/db/client.server";
import { sendMail } from "@/lib/mailer.server";

function appUrl(): string {
  return (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET ausente ou curto (mín. 32 caracteres).");
  }
  return betterAuth({
    appName: "FinnancePRO",
    baseURL: appUrl(),
    // Outros endereços aceitos no login além do APP_URL (ex.: IP da VPS e
    // domínio), separados por vírgula. Sem isso o login responde "Invalid origin".
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    secret,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "fp",
    },
    emailAndPassword: {
      enabled: true,
      // Cadastro público fechado: contas nascem pelo admin, pelo checkout ou
      // pelo teste grátis (todos no servidor). A tela /signup já dizia
      // "cadastro desativado", mas a API aceitava qualquer um.
      disableSignUp: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Redefinição de senha",
          html: `<p>Para criar uma nova senha, acesse: <a href="${url}">redefinir senha</a>.</p><p>Se não foi você, ignore este e-mail.</p>`,
          text: `Para criar uma nova senha, acesse: ${url}`,
        });
      },
    },
    user: {
      additionalFields: {
        aiEnabled: { type: "boolean", defaultValue: true, input: false },
        isTrial: { type: "boolean", defaultValue: false, input: false },
        trialExpiresAt: { type: "date", required: false, input: false },
        mustChangePassword: { type: "boolean", defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (u) => {
            // Funil de cadastro (antes: trigger handle_new_user no auth.users).
            await db()
              .insert(schema.signupEvents)
              .values({ userId: u.id, email: u.email })
              .catch(() => undefined);
          },
        },
      },
    },
    plugins: [
      username({ minUsernameLength: 3 }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      magicLink({
        expiresIn: 60 * 60,
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          // Fluxos com e-mail próprio (trial, checkout) só querem a URL.
          const { captureMagicLinkUrl } = await import("@/lib/magicLink.server");
          if (captureMagicLinkUrl(url)) return;
          await sendMail({
            to: email,
            subject: "Seu link de acesso",
            html: `<p>Clique para entrar: <a href="${url}">acessar</a>. O link vale por 1 hora.</p>`,
            text: `Acesse: ${url} (válido por 1 hora)`,
          });
        },
      }),
      // Precisa ser o último plugin: grava os cookies da resposta no TanStack Start.
      tanstackStartCookies(),
    ],
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

/** Instância do Better Auth (criada na primeira chamada). */
export function auth() {
  if (!_auth) _auth = createAuth();
  return _auth;
}

export type AuthSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>
>;

/** Sessão do request atual, ou null. */
export async function getSessionFromHeaders(headers: Headers): Promise<AuthSession | null> {
  return (await auth().api.getSession({ headers })) ?? null;
}
