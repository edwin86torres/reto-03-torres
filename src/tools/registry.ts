// Registro de herramientas: nombre visible = <archivo>_<export>. Valida argumentos con zod antes de ejecutar.
import { z } from "zod"
import { mensajeError } from "../domain/resultado"
import { registrarLog, respuestaError, type ToolCtx, type ToolDef } from "./base"
import * as oc from "./oc"

export type HerramientaRegistrada = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
  ejecutar(input: unknown, ctx: ToolCtx): Promise<string>
}

/** JSON Schema compatible con OpenAI, Gemini y Anthropic (sin claves que algunos proveedores rechazan). */
function limpiarSchema(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(limpiarSchema)
  if (nodo && typeof nodo === "object") {
    const salida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(nodo)) {
      if (k === "$schema" || k === "additionalProperties" || k === "propertyNames") continue
      salida[k] = limpiarSchema(v)
    }
    return salida
  }
  return nodo
}

function registrar<S extends z.ZodRawShape>(nombre: string, def: ToolDef<S>): HerramientaRegistrada {
  const schema = z.object(def.args)
  return {
    nombre,
    descripcion: def.description,
    parametros: limpiarSchema(z.toJSONSchema(schema)) as Record<string, unknown>,
    async ejecutar(input, ctx) {
      const args = schema.safeParse(input ?? {})
      const caso = typeof (input as { caso?: unknown })?.caso === "string" ? String((input as { caso: string }).caso) : ""
      let salida: string
      if (!args.success) {
        salida = respuestaError(`Argumentos inválidos: ${args.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
      } else {
        try {
          salida = await def.execute(args.data, ctx)
        } catch (e) {
          salida = respuestaError(`Error inesperado: ${mensajeError(e)}`)
        }
      }
      await registrarLog(ctx.directory, { herramienta: nombre, caso, ok: salida.startsWith('{"ok":true'), resumen: resumir(salida) })
      return salida
    },
  }
}

export function resumir(salida: string): string {
  try {
    const r = JSON.parse(salida) as { ok: boolean; data?: Record<string, unknown>; error?: string }
    if (!r.ok) return `error: ${r.error ?? ""}`.slice(0, 300)
    const d = r.data ?? {}
    if ("numero_oc" in d) return `OC ${String(d.numero_oc)}${d.idempotente ? " (ya existía)" : ""}`
    if ("apta" in d) {
      const b = (d.bloqueos as { codigo: string }[]).map((x) => x.codigo)
      const c = (d.confirmaciones as { codigo: string }[]).map((x) => x.codigo)
      return `apta=${String(d.apta)} bloqueos=[${b.join(",")}] confirmaciones=[${c.join(",")}] retroactiva=${String(d.retroactiva)}`
    }
    if ("orden" in d) return `payload construido · trazabilidad en ${String(d.ruta_trazabilidad)}`
    if ("sha256" in d) return `evidencia ${String(d.ruta)} sha256=${String(d.sha256).slice(0, 12)}…`
    if ("solicitud" in d) return `paquete leído · faltantes=[${(d.faltantes as string[]).join(",")}]`
    return "ok"
  } catch {
    return salida.slice(0, 200)
  }
}

export const herramientas: HerramientaRegistrada[] = Object.entries(oc).map(([exp, def]) => registrar(`oc_${exp}`, def as ToolDef<z.ZodRawShape>))

export function buscarHerramienta(nombre: string): HerramientaRegistrada | undefined {
  return herramientas.find((h) => h.nombre === nombre)
}
