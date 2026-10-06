// Comparação constant-time entre duas strings de mesmo tamanho.
// Usada para verificar tokens/secrets de webhooks sem vazar tempo
// de comparação (timing attack).
//
// Aceita qualquer string (hex, base64, opaco). Para strings de tamanhos
// diferentes retorna `false` imediatamente — vazar o tamanho é aceitável
// e necessário para o early-return.
export function timingSafeEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
