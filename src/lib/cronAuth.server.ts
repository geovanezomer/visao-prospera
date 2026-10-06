// ============================================================================
// Autenticação dos endpoints de cron (/api/public/hooks/*).
//
// Exige `Authorization: Bearer <CRON_SECRET>`. CRON_SECRET é um segredo
// dedicado, só do servidor e do agendador (pg_cron via Vault, ou crontab do
// VPS). Antes usávamos a chave publishable do Supabase, que vai no bundle do
// navegador — qualquer visitante podia disparar a limpeza de trials.
//
// Falha fechada: sem CRON_SECRET configurado, todos os chamados são negados.
// ============================================================================
import { timingSafeEqual } from "@/lib/timingSafe";

/** Retorna uma Response de erro quando o chamado não é autorizado; null se ok. */
export function rejectUnlessCron(request: Request): Response | null {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected.length < 32) {
    console.error("[cron] CRON_SECRET ausente ou curto (mín. 32 caracteres) — chamado negado.");
    return new Response("Cron not configured", { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!timingSafeEqual(token, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
