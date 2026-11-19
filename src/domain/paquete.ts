// Lectura y normalización del paquete de un caso (sección 7.1 y 7.2 del PRD).
// Solo lee de fixtures/ (solo lectura). Nunca lanza: devuelve Resultado.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { fail, ok, type Resultado } from "./resultado"

/** Solo nombres de carpeta simples: evita path traversal (../) desde argumentos del modelo. */
export const CASO_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string(),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number({ error: "cantidad debe ser numérica" }).positive(),
  valor_unitario: z.number({ error: "valor_unitario debe ser numérico" }).nonnegative(),
  valor_total: z.number({ error: "valor_total debe ser numérico" }).positive(),
  moneda: z.string().min(3),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().regex(FECHA_RE, "fecha_solicitud debe ser YYYY-MM-DD"),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

const CorreoSchema = z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() })
const AprobacionSchema = z.object({
  de: z.string(),
  para: z.string().optional(),
  fecha: z.string(),
  asunto: z.string().optional(),
  cuerpo: z.string(),
})

export type Cotizacion = {
  ref: string | null
  fecha: string | null
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}
export type Aprobacion = { de: string; para: string; fecha: string; asunto: string; aprobado: boolean; texto: string }
export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  caso: string
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  faltantes: string[]
}

/** "900.555.111-2" → "900555111" (sin puntos ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  return nit.replace(/[^\d-]/g, "").split("-")[0] ?? ""
}

/** "11.400.000" (formato colombiano) → 11400000 */
function parsearMonto(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", "."))
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function parsearCotizacion(texto: string): Resultado<Cotizacion> {
  const total = texto.match(/TOTAL[^:\n]*:\s*([A-Z]{3})\s*([\d.,]+)/)
  if (!total?.[1] || !total[2]) return fail("La cotización no tiene una línea TOTAL legible")
  const monto = parsearMonto(total[2])
  if (!Number.isFinite(monto)) return fail("El total de la cotización no es numérico")
  const fecha = texto.match(/Fecha:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
  const dias = texto.match(/Validez[^:\n]*:\s*(\d+)\s*d/i)?.[1]
  const nit = texto.match(/NIT:\s*([\d.\-]+)/)?.[1]
  return ok({
    ref: texto.match(/COTIZACI[ÓO]N\s+(\S+)/)?.[1] ?? null,
    fecha,
    proveedor: texto.match(/Proveedor:\s*(.+)/)?.[1]?.trim() ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total: monto,
    moneda: total[1],
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  })
}

export function parsearFactura(texto: string): Resultado<Factura> {
  const fecha = texto.match(/Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
  const total = texto.match(/TOTAL:\s*[A-Z]{3}\s*([\d.,]+)/)?.[1]
  if (!fecha || !total) return fail("La factura no tiene fecha de emisión o total legibles")
  return ok({ numero: texto.match(/No\.\s*(\S+)/)?.[1] ?? "sin-numero", fecha, total: parsearMonto(total) })
}

/** "Aprobado" explícito y sin negación ("No aprobado"). */
export function contieneAprobado(cuerpo: string): boolean {
  return /\baprobado\b/i.test(cuerpo) && !/\bno\s+(est[aá]\s+)?aprobado\b/i.test(cuerpo)
}

async function leerTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch {
    return null
  }
}

function parsearJson<T>(texto: string, schema: z.ZodType<T>, nombre: string): Resultado<T> {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return fail(`${nombre} no es un JSON válido (archivo malformado)`)
  }
  const r = schema.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
    return fail(`${nombre} no cumple el formato esperado: ${detalle}`)
  }
  return ok(r.data)
}

export function dirCaso(root: string, caso: string): string {
  return join(root, "fixtures", "reto-03", "solicitudes", caso)
}

export async function leerPaquete(root: string, caso: string): Promise<Resultado<Paquete>> {
  if (!CASO_RE.test(caso)) return fail(`Nombre de caso inválido: "${caso}". Use, por ejemplo, "sol-001".`)
  const dir = dirCaso(root, caso)
  const [correoTxt, solTxt, cotTxt, aprTxt, facTxt] = await Promise.all([
    leerTexto(join(dir, "correo.json")),
    leerTexto(join(dir, "solicitud.json")),
    leerTexto(join(dir, "cotizacion.txt")),
    leerTexto(join(dir, "aprobacion.json")),
    leerTexto(join(dir, "factura.txt")),
  ])
  if (correoTxt === null && solTxt === null) return fail(`El caso "${caso}" no existe en fixtures/reto-03/solicitudes/`)
  if (solTxt === null) return fail("Paquete incompleto: falta solicitud.xlsx (solicitud.json). Pídasela al solicitante.")

  const sol = parsearJson(solTxt, SolicitudSchema, "solicitud.json")
  if (!sol.ok) return fail(`${sol.error}. Pida al solicitante corregir el Excel de solicitud.`)

  const faltantes: string[] = []
  let correo = { id: `${caso}-correo`, de: "", asunto: "", fecha: "" }
  if (correoTxt === null) faltantes.push("correo")
  else {
    const c = parsearJson(correoTxt, CorreoSchema, "correo.json")
    if (c.ok) correo = c.data
    else faltantes.push(`correo (${c.error})`)
  }

  let cotizacion: Cotizacion | null = null
  if (cotTxt === null) faltantes.push("cotizacion")
  else {
    const c = parsearCotizacion(cotTxt)
    if (c.ok) cotizacion = c.data
    else faltantes.push(`cotizacion (${c.error})`)
  }

  let aprobacion: Aprobacion | null = null
  if (aprTxt === null) faltantes.push("aprobacion")
  else {
    const a = parsearJson(aprTxt, AprobacionSchema, "aprobacion.json")
    if (a.ok)
      aprobacion = {
        de: a.data.de.toLowerCase(),
        para: a.data.para ?? "",
        fecha: a.data.fecha,
        asunto: a.data.asunto ?? "",
        aprobado: contieneAprobado(a.data.cuerpo),
        texto: a.data.cuerpo,
      }
    else faltantes.push(`aprobacion (${a.error})`)
  }

  let factura: Factura | null = null
  if (facTxt !== null) {
    const f = parsearFactura(facTxt)
    if (f.ok) factura = f.data
    else faltantes.push(`factura (${f.error})`)
  }

  return ok({ caso, correo, solicitud: sol.data, cotizacion, aprobacion, factura, faltantes })
}
