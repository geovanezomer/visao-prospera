// ============================================================================
// assertAdmin — checagem de papel no servidor.
//
// Lê o papel direto do banco (não confia só no que veio na sessão), para que
// rebaixar um admin tenha efeito imediato.
//
// Uso (dentro de qualquer server fn admin*, após o middleware requireAuth):
//   await assertAdmin(context);
// ============================================================================

type AdminCtx = { userId: string };

export async function assertAdmin(context: AdminCtx): Promise<void> {
  const { isAdminUser } = await import("@/lib/users.server");
  if (!(await isAdminUser(context.userId))) {
    throw new Error("Acesso negado.");
  }
}
