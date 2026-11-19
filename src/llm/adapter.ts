// Interfaz propia del proveedor LLM: enviar(mensajes, herramientas) → respuesta.
// Cambiar de proveedor no toca el ciclo del agente.
export type LlmToolCall = { id: string; nombre: string; args: Record<string, unknown> }

export type LlmMensaje =
  | { rol: "system" | "user"; contenido: string }
  | { rol: "assistant"; contenido: string; toolCalls: LlmToolCall[] }
  | { rol: "tool"; contenido: string; toolCallId: string; nombre: string }

export type LlmHerramienta = { nombre: string; descripcion: string; parametros: Record<string, unknown> }

export type LlmRespuesta = { texto: string; toolCalls: LlmToolCall[]; tokens: number }

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: LlmMensaje[], herramientas: LlmHerramienta[]): Promise<LlmRespuesta>
}

export class LlmError extends Error {}

/** Lanza LlmError con mensaje claro; nunca incluye la clave ni la respuesta cruda completa. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError"
    throw new LlmError(timeout ? `El modelo no respondió en ${timeoutMs / 1000} s. Intente de nuevo.` : "No fue posible conectar con el proveedor del modelo.")
  }
  if (!res.ok) {
    const detalle = (await res.text()).slice(0, 200)
    if (res.status === 401 || res.status === 403) throw new LlmError("La clave del modelo no es válida o no tiene permisos (revise LLM_API_KEY en el servidor).")
    if (res.status === 429) throw new LlmError("El proveedor del modelo limitó las solicitudes (cuota). Espere unos segundos e intente de nuevo.")
    throw new LlmError(`El proveedor del modelo respondió ${res.status}: ${detalle}`)
  }
  return res.json()
}
