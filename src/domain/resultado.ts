// Tipo de resultado común: las funciones de dominio nunca lanzan hacia el agente.
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export const ok = <T>(data: T): Resultado<T> => ({ ok: true, data })
export const fail = <T = never>(error: string): Resultado<T> => ({ ok: false, error })

export function mensajeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
