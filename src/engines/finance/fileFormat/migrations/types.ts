// Contrato dos migrators. Cada migrator transforma a forma da versão
// `from` na forma da versão `to = from + 1`. APPEND-ONLY: nunca editar
// um migrator publicado — só adicionar o próximo.
export interface Migration {
  /** Versão de origem (o arquivo precisa estar nessa versão para aplicar). */
  from: number;
  /** Versão de destino (sempre `from + 1`). */
  to: number;
  /** Transforma o payload cru. Deve carimbar `version = to` no retorno. */
  run: (raw: unknown) => unknown;
}
