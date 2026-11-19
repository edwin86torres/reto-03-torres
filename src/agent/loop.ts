// Ciclo del agente: prompt → modelo → herramientas → respuesta, con tope de iteraciones y de tokens.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { LlmError, type LlmAdapter, type LlmMensaje } from "../llm/adapter"
import { herramientas, buscarHerramienta, resumir } from "../tools/registry"
import { respuestaError } from "../tools/base"

export type ToolCallVisible = { nombre: string; args: Record<string, unknown>; ok: boolean; resumen: string }
export type Turno = { rol: "user" | "assistant"; texto: string; toolCalls: ToolCallVisible[]; needsConfirmation: boolean; ts: string }

export type Sesion = {
  id: string
  mensajes: LlmMensaje[] // historial para el modelo
  turnos: Turno[] // historial visible
  tokens: number
  esperandoConfirmacion: boolean
}

export type Limites = { maxIteraciones: number; maxTokensSesion: number }

/** Confirmación explícita del usuario: afirmativa y sin negación. */
export function esConfirmacion(texto: string): boolean {
  const t = texto.toLowerCase()
  if (/\b(no|nunca|cancela|cancelar|espera|todav[ií]a no)\b/.test(t)) return false
  return /\b(confirmo|confirmado|confirmada|s[ií]|procede|proceder|adelante|cr[eé]ala|cr[eé]alas|autorizo|aprobado|ok|dale)\b/.test(t)
}

let promptCache: string | null = null
export async function systemPrompt(root: string): Promise<string> {
  if (promptCache) return promptCache
  const [comportamiento, conocimiento] = await Promise.all([
    readFile(join(root, "agent", "prompt.md"), "utf8"),
    readFile(join(root, "src", "knowledge", "ordenes-compra.md"), "utf8"),
  ])
  promptCache = `${comportamiento}\n\n---\n# Conocimiento del proceso\n\n${conocimiento}`
  return promptCache
}

function pideConfirmacion(salida: string): boolean {
  return salida.includes("requiere confirmación explícita") || /"confirmaciones":\[\{/.test(salida)
}

export async function ejecutarTurno(root: string, sesion: Sesion, texto: string, llm: LlmAdapter, limites: Limites): Promise<Turno> {
  const confirmacionHumana = sesion.esperandoConfirmacion && esConfirmacion(texto)
  sesion.turnos.push({ rol: "user", texto, toolCalls: [], needsConfirmation: false, ts: new Date().toISOString() })
  sesion.mensajes.push({ rol: "user", contenido: texto })

  const visibles: ToolCallVisible[] = []
  let respuesta = ""
  let necesitaConfirmacion = false
  let creada = false
  const defs = herramientas.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, parametros: h.parametros }))
  const system = await systemPrompt(root)

  for (let i = 0; i < limites.maxIteraciones; i++) {
    if (sesion.tokens >= limites.maxTokensSesion) {
      respuesta = "Se alcanzó el tope de tokens de esta sesión. Abra una sesión nueva para continuar."
      break
    }
    let r
    try {
      r = await llm.enviar([{ rol: "system", contenido: system }, ...sesion.mensajes], defs)
    } catch (e) {
      respuesta = e instanceof LlmError ? `⚠️ ${e.message}` : "⚠️ Error inesperado al consultar el modelo. La sesión sigue activa; intente de nuevo."
      break
    }
    sesion.tokens += r.tokens
    sesion.mensajes.push({ rol: "assistant", contenido: r.texto, toolCalls: r.toolCalls })
    if (r.toolCalls.length === 0) {
      respuesta = r.texto
      break
    }
    for (const tc of r.toolCalls) {
      const h = buscarHerramienta(tc.nombre)
      const salida = h
        ? await h.ejecutar(tc.args, { directory: root, sessionId: sesion.id, confirmacionHumana })
        : respuestaError(`La herramienta ${tc.nombre} no existe.`)
      const ok = salida.startsWith('{"ok":true')
      if (tc.nombre === "oc_crear" && ok) creada = true
      if (pideConfirmacion(salida)) necesitaConfirmacion = true
      visibles.push({ nombre: tc.nombre, args: tc.args, ok, resumen: resumir(salida) })
      sesion.mensajes.push({ rol: "tool", contenido: salida, toolCallId: tc.id, nombre: tc.nombre })
    }
    if (i === limites.maxIteraciones - 1) {
      respuesta = `Alcancé el tope de ${limites.maxIteraciones} iteraciones en este turno. Resultado parcial: ${visibles.map((v) => `${v.nombre}: ${v.resumen}`).join(" · ")}. Pídame continuar para terminar lo pendiente.`
    }
  }

  const needsConfirmation = necesitaConfirmacion && !creada
  sesion.esperandoConfirmacion = needsConfirmation
  const turno: Turno = { rol: "assistant", texto: respuesta || "(sin respuesta)", toolCalls: visibles, needsConfirmation, ts: new Date().toISOString() }
  sesion.turnos.push(turno)
  return turno
}
