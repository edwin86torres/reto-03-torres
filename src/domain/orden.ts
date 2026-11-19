// Construcción del payload de la OC (sección 7.4) y de la evidencia de aprobación (HU-4).
import { createHash } from "node:crypto"
import { z } from "zod"
import { fail, ok, type Resultado } from "./resultado"
import type { Aprobacion, Paquete } from "./paquete"
import type { Validacion } from "./reglas"

export const OrdenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().min(1),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string().length(64) }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int(),
        descripcion: z.string().max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string().min(1),
      }),
    )
    .min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

export type Trazabilidad = Record<string, string>

/** Contenido de la evidencia (sin el hash). Determinista: no incluye la hora de generación. */
export function contenidoEvidencia(a: Aprobacion): string {
  return [`De: ${a.de}`, `Para: ${a.para}`, `Fecha: ${a.fecha}`, `Asunto: ${a.asunto}`, "", a.texto, ""].join("\n")
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** Unidad SAP derivada de la descripción: horas → H, mensualidades → MES, resto → UN. */
function derivarUnidad(descripcion: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(descripcion)) return "H"
  if (/\bmensualidad|\bpor mes\b|\/mes\b/i.test(descripcion)) return "MES"
  return "UN"
}

export function construirOrden(p: Paquete, v: Validacion): Resultado<{ orden: OrdenCompra; trazabilidad: Trazabilidad }> {
  if (!v.apta) return fail(`No se construye la OC: tiene bloqueos (${v.bloqueos.map((b) => b.codigo).join(", ")}).`)
  const prov = v.derivados.proveedor
  const iva = v.derivados.indicador_iva
  const pago = v.derivados.condiciones_pago
  if (!prov || !iva || !pago || !p.aprobacion) return fail("Faltan datos derivados (proveedor, IVA, condiciones de pago o aprobación).")

  const s = p.solicitud
  const descripcion = s.descripcion.slice(0, 40).trim()
  const candidata = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.ref ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: prov,
    moneda: s.moneda,
    condiciones_pago: pago.valor,
    aprobador: {
      email: p.aprobacion.de,
      fecha_aprobacion: p.aprobacion.fecha,
      evidencia_sha256: sha256(contenidoEvidencia(p.aprobacion)),
    },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: s.cantidad,
        unidad: derivarUnidad(s.descripcion),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva.valor,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  }
  const r = OrdenCompraSchema.safeParse(candidata)
  if (!r.success) return fail(`El payload no cumple el esquema SAP: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)

  const trazabilidad: Trazabilidad = {
    "referencia.solicitud_id": "solicitud.solicitud_id",
    "referencia.correo_id": "correo.id",
    "referencia.cotizacion_ref": p.cotizacion ? "cotizacion (encabezado)" : "sin cotización",
    sociedad: "derivado (constante de la sociedad)",
    organizacion_compras: "derivado (constante de la organización)",
    proveedor: `maestro.proveedores (búsqueda por ${s.proveedor_nit ? "NIT" : "nombre normalizado"})`,
    moneda: "solicitud.moneda",
    condiciones_pago: pago.fuente === "solicitud" ? "solicitud.condiciones_pago" : "maestro.proveedores.condiciones_pago_default",
    "aprobador.email": "aprobacion.de",
    "aprobador.fecha_aprobacion": "aprobacion.fecha",
    "aprobador.evidencia_sha256": "derivado (sha256 de la evidencia de aprobación)",
    "posiciones[0].descripcion": s.descripcion.length > 40 ? "solicitud.descripcion (truncada a 40 caracteres)" : "solicitud.descripcion",
    "posiciones[0].cantidad": "solicitud.cantidad",
    "posiciones[0].unidad": "derivado (de solicitud.descripcion)",
    "posiciones[0].precio_unitario": "solicitud.valor_unitario",
    "posiciones[0].centro_costo": "solicitud.centro_costo",
    "posiciones[0].subarea": "solicitud.subarea",
    "posiciones[0].indicador_iva": iva.fuente === "solicitud" ? "solicitud.indicador_iva" : "maestro.proveedores.indicador_iva_default",
    excepciones: "derivado (confirmaciones de oc_validar)",
  }
  return ok({ orden: r.data, trazabilidad })
}

/** Campos que el modelo no puede alterar: si difieren del payload calculado, oc_crear rechaza. */
export function huellaControl(o: OrdenCompra): string {
  return JSON.stringify({
    sol: o.referencia.solicitud_id,
    prov: o.proveedor.codigo_sap,
    moneda: o.moneda,
    pago: o.condiciones_pago,
    aprobador: o.aprobador.email,
    pos: o.posiciones.map((x) => [x.cantidad, x.precio_unitario, x.centro_costo, x.subarea, x.indicador_iva]),
  })
}
