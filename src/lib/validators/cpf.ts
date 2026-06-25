// ============================================================================
// Validação de CPF (algoritmo oficial Receita Federal).
// Aceita com ou sem máscara. Retorna apenas dígitos quando válido.
// ============================================================================

export function onlyDigits(s: string): string {
  return (s || "").replace(/\D+/g, "");
}

export function isValidCPF(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais

  const calc = (base: string, factor: number): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * (factor - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  if (d1 !== parseInt(cpf[9], 10)) return false;
  const d2 = calc(cpf.slice(0, 10), 11);
  return d2 === parseInt(cpf[10], 10);
}

export function formatCPF(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

// Telefone BR — aceita 10 (fixo) ou 11 (celular) dígitos.
export function isValidPhoneBR(input: string): boolean {
  const d = onlyDigits(input);
  return d.length === 10 || d.length === 11;
}

export function formatPhoneBR(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (_, a, b, c) =>
      [a && `(${a}`, a && a.length === 2 ? ") " : "", b, c && `-${c}`].filter(Boolean).join(""),
    );
  }
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) =>
    [`(${a}) `, b, c && `-${c}`].filter(Boolean).join(""),
  );
}
