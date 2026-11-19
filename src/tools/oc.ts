// Herramientas del agente. Cada export se expone al modelo como oc_<export>.
// Regla de diseño: las herramientas recalculan todo desde fixtures/ y maestros; lo que envía el modelo
// (paquete, derivados, payload) nunca es fuente de verdad. Así el modelo no puede "arreglar" un monto.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { cargarMaestros } from "../domain/maestros"
import { contenidoEvidencia, construirOrden, huellaControl, sha256, type OrdenCompra } from "../domain/orden"
import { leerPaquete, type Paquete } from "../domain/paquete"
import { mensajeError } from "../domain/resultado"
import { validarPaquete, type Validacion } from "../domain/reglas"
import { SapMock } from "../sap/mock"
import { definirTool, respuestaError, respuestaOk, type ToolCtx } from "./base"

const caso = z.string().describe('Carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-001"')
const objetoOpcional = (d: string) => z.record(z.string(), z.unknown()).optional().describe(d)

type Contexto = { paquete: Paquete; validacion: Validacion }

async function contexto(root: string, c: string): Promise<{ ok: true; data: Contexto } | { ok: false; error: string }> {
  const p = await leerPaquete(root, c)
  if (!p.ok) return p
  const m = await cargarMaestros(root)
  if (!m.ok) return m
  return { ok: true, data: { paquete: p.data, validacion: validarPaquete(p.data, m.data) } }
}

async function escribirOut(root: string, c: string, archivo: string, contenido: string): Promise<string> {
  await mkdir(join(root, "out", c), { recursive: true })
  await writeFile(join(root, "out", c, archivo), contenido)
  return `out/${c}/${archivo}`
}

const CSV_HEADER = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`

async function registrarControl(root: string, fila: { solicitud_id: string; resultado: string; numero_oc: string; retroactiva: boolean; bloqueos: string[]; confirmaciones: string[] }): Promise<void> {
  const ruta = join(root, "out", "control.csv")
  await mkdir(join(root, "out"), { recursive: true })
  let existe = true
  try {
    await readFile(ruta)
  } catch {
    existe = false
  }
  const linea = [fila.solicitud_id, fila.resultado, fila.numero_oc, String(fila.retroactiva), fila.bloqueos.join("|"), fila.confirmaciones.join("|"), new Date().toISOString()].map(csv).join(",")
  await appendFile(ruta, `${existe ? "" : CSV_HEADER}${linea}\n`)
}

export const leer_paquete = definirTool({
  description: "Lee y normaliza el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe).",
  args: { caso },
  async execute({ caso: c }, ctx: ToolCtx) {
    try {
      const p = await leerPaquete(ctx.directory, c)
      return p.ok ? respuestaOk(p.data) : respuestaError(p.error)
    } catch (e) {
      return respuestaError(`Error inesperado leyendo el paquete: ${mensajeError(e)}`)
    }
  },
})

export const validar = definirTool({
  description: "Aplica los controles RC1–RC10 al paquete y devuelve si es apta, los bloqueos, las confirmaciones requeridas, los valores derivados y si es retroactiva.",
  args: {
    caso,
    paquete: objetoOpcional("Opcional. El servidor relee el paquete desde los archivos; no es necesario enviarlo."),
  },
  async execute({ caso: c }, ctx: ToolCtx) {
    try {
      const r = await contexto(ctx.directory, c)
      return r.ok ? respuestaOk(r.data.validacion) : respuestaError(r.error)
    } catch (e) {
      return respuestaError(`Error inesperado validando: ${mensajeError(e)}`)
    }
  },
})

export const construir_payload = definirTool({
  description: "Construye la orden de compra tal como quedaría en SAP (validada con zod) y guarda su trazabilidad campo a campo.",
  args: {
    caso,
    paquete: objetoOpcional("Opcional. El servidor lo recalcula."),
    derivados: objetoOpcional("Opcional. El servidor los recalcula desde los maestros."),
  },
  async execute({ caso: c }, ctx: ToolCtx) {
    try {
      const r = await contexto(ctx.directory, c)
      if (!r.ok) return respuestaError(r.error)
      const o = construirOrden(r.data.paquete, r.data.validacion)
      if (!o.ok) return respuestaError(o.error)
      const ruta = await escribirOut(ctx.directory, c, "trazabilidad.json", JSON.stringify(o.data.trazabilidad, null, 2))
      return respuestaOk({ orden: o.data.orden, ruta_trazabilidad: ruta })
    } catch (e) {
      return respuestaError(`Error inesperado construyendo el payload: ${mensajeError(e)}`)
    }
  },
})

async function escribirEvidencia(root: string, c: string, p: Paquete): Promise<{ ruta: string; sha256: string } | null> {
  if (!p.aprobacion) return null
  const contenido = contenidoEvidencia(p.aprobacion)
  const hash = sha256(contenido)
  const ruta = await escribirOut(root, c, "aprobacion.txt", `${contenido}\nSHA256: ${hash}\n`)
  return { ruta, sha256: hash }
}

export const generar_evidencia = definirTool({
  description: "Genera la evidencia de aprobación (out/<caso>/aprobacion.txt) con encabezados, cuerpo y sha256 del contenido.",
  args: { caso },
  async execute({ caso: c }, ctx: ToolCtx) {
    try {
      const p = await leerPaquete(ctx.directory, c)
      if (!p.ok) return respuestaError(p.error)
      const ev = await escribirEvidencia(ctx.directory, c, p.data)
      return ev ? respuestaOk(ev) : respuestaError("No hay correo de aprobación: pídalo al solicitante.")
    } catch (e) {
      return respuestaError(`Error inesperado generando la evidencia: ${mensajeError(e)}`)
    }
  },
})

export const crear = definirTool({
  description: "Crea la orden de compra en SAP (simulado); solo si es apta y, si hay confirmaciones pendientes, con confirmado=true tras confirmación explícita del usuario.",
  args: {
    caso,
    payload: objetoOpcional("Opcional. Si se envía, debe coincidir con el construido por oc_construir_payload; si difiere en montos, proveedor, centro o aprobador, se rechaza."),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente en su último mensaje"),
  },
  async execute({ caso: c, payload, confirmado }, ctx: ToolCtx) {
    try {
      const r = await contexto(ctx.directory, c)
      if (!r.ok) return respuestaError(r.error)
      const { paquete, validacion: v } = r.data
      const sap = new SapMock(ctx.directory)
      const base = { solicitud_id: paquete.solicitud.solicitud_id, retroactiva: v.retroactiva, bloqueos: v.bloqueos.map((b) => b.codigo), confirmaciones: v.confirmaciones.map((x) => x.codigo) }

      const existente = await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id)
      if (existente) {
        await registrarControl(ctx.directory, { ...base, resultado: "existente", numero_oc: existente.numero_oc })
        return respuestaOk({ numero_oc: existente.numero_oc, fecha: null, idempotente: true, mensaje: "La OC ya existía para esta solicitud; no se creó otra." })
      }
      if (!v.apta) {
        await registrarControl(ctx.directory, { ...base, resultado: "bloqueada", numero_oc: "" })
        return respuestaError(`OC bloqueada: ${v.bloqueos.map((b) => `${b.codigo} ${b.detalle} Acción: ${b.accion_sugerida ?? "revisar"}`).join(" | ")}`)
      }
      if (v.confirmaciones.length > 0 && !(confirmado === true && ctx.confirmacionHumana === true)) {
        await registrarControl(ctx.directory, { ...base, resultado: "pendiente_confirmacion", numero_oc: "" })
        const motivo = confirmado === true ? "confirmado=true no es válido porque el último mensaje del usuario no contiene una confirmación explícita. " : ""
        return respuestaError(`requiere confirmación explícita: ${motivo}${v.confirmaciones.map((x) => `${x.codigo} ${x.detalle}`).join(" | ")}`)
      }

      const o = construirOrden(paquete, v)
      if (!o.ok) return respuestaError(o.error)
      if (payload) {
        const enviado = construirOrdenDesdeObjeto(payload)
        if (enviado && huellaControl(enviado) !== huellaControl(o.data.orden)) {
          await registrarControl(ctx.directory, { ...base, resultado: "rechazada_payload_alterado", numero_oc: "" })
          return respuestaError("El payload recibido difiere del calculado por las herramientas (montos, proveedor, centro, IVA o aprobador). Se rechaza por integridad.")
        }
      }
      const confirmador = v.confirmaciones.length ? `analista (sesión ${ctx.sessionId})` : null
      const orden: OrdenCompra = { ...o.data.orden, excepciones: o.data.orden.excepciones.map((x) => ({ ...x, confirmado_por: confirmador })) }
      const evidencia = await escribirEvidencia(ctx.directory, c, paquete)
      await escribirOut(ctx.directory, c, "trazabilidad.json", JSON.stringify(o.data.trazabilidad, null, 2))
      const creada = await sap.crearOrden(orden)
      await registrarControl(ctx.directory, { ...base, resultado: "creada", numero_oc: creada.numero_oc })
      return respuestaOk({ ...creada, idempotente: false, retroactiva: v.retroactiva, evidencia: evidencia?.ruta ?? null })
    } catch (e) {
      return respuestaError(`Error inesperado creando la OC: ${mensajeError(e)}`)
    }
  },
})

/** Interpreta un payload enviado por el modelo; si no tiene forma de OC se ignora (el servidor usa el suyo). */
function construirOrdenDesdeObjeto(obj: Record<string, unknown>): OrdenCompra | null {
  const candidato = "orden" in obj && typeof obj.orden === "object" ? obj.orden : obj
  const r = z
    .object({
      referencia: z.object({ solicitud_id: z.string() }).loose(),
      proveedor: z.object({ codigo_sap: z.string() }).loose(),
      moneda: z.string(),
      condiciones_pago: z.string(),
      aprobador: z.object({ email: z.string() }).loose(),
      posiciones: z.array(z.object({ cantidad: z.number(), precio_unitario: z.number(), centro_costo: z.string(), subarea: z.string(), indicador_iva: z.string() }).loose()),
    })
    .loose()
    .safeParse(candidato)
  return r.success ? (r.data as unknown as OrdenCompra) : null
}
