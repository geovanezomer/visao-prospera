// ============================================================================
// Magic link SEM envio automático — para fluxos com e-mail próprio (teste
// grátis, pós-checkout), que montam o e-mail com o template do painel.
//
// O plugin magicLink do Better Auth gera o token e chama `sendMagicLink`.
// Aqui rodamos a geração dentro de um contexto (AsyncLocalStorage) que
// manda o plugin entregar a URL de volta em vez de enviar e-mail.
// ============================================================================
import { AsyncLocalStorage } from "node:async_hooks";

type Capture = { url: string | null };
const captureStore = new AsyncLocalStorage<Capture>();

/** Usado por auth.server.ts: true quando a URL foi capturada (não enviar e-mail). */
export function captureMagicLinkUrl(url: string): boolean {
  const c = captureStore.getStore();
  if (!c) return false;
  c.url = url;
  return true;
}

/**
 * Gera o link de acesso de um usuário JÁ EXISTENTE.
 * `callbackPath` é para onde ele vai após entrar (ex.: "/app").
 */
export async function generateMagicLink(email: string, callbackPath = "/app"): Promise<string> {
  const { auth } = await import("@/lib/auth.server");
  const capture: Capture = { url: null };
  await captureStore.run(capture, () =>
    auth().api.signInMagicLink({
      body: { email: email.trim().toLowerCase(), callbackURL: callbackPath },
      headers: new Headers(),
    }),
  );
  if (!capture.url) throw new Error("Falha ao gerar o link de acesso.");
  return capture.url;
}
