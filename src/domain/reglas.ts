// Matriz de controles RC1–RC10 (sección 7.3 del PRD). Función pura: mismo paquete → mismo resultado.
import { normalizarNombre, type CentroCosto, type Maestros, type Proveedor } from "./maestros"
import type { Paquete } from "./paquete"

/** Parámetros de negocio en un solo lugar: cambiarlos no toca el servidor ni el agente. */
export const PARAMETROS = {
  toleranciaCotizacion: 0.02, // RC5: 2 %
  toleranciaAritmetica: 1, // RC10: ± 1 unidad monetaria
} as const

export type Hallazgo = { codigo: string; detalle: string; accion_sugerida?: string }

export type Derivados = {
  proveedor: { codigo_sap: string; nit: string; nombre: string } | null
  indicador_iva: { valor: string; fuente: "solicitud" | "maestro.proveedores" } | null
  condiciones_pago: { valor: string; fuente: "solicitud" | "maestro.proveedores" } | null
  informados: string[]
}

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

const fmt = (n: number) => n.toLocaleString("es-CO")
const soloFecha = (iso: string) => iso.slice(0, 10)

function buscarProveedor(p: Paquete, m: Maestros): Proveedor | undefined {
  const nit = p.solicitud.proveedor_nit
  if (nit) return m.proveedores.find((x) => x.nit === nit)
  const nombre = normalizarNombre(p.solicitud.proveedor_nombre)
  return m.proveedores.find((x) => normalizarNombre(x.nombre) === nombre)
}

function rc1Proveedor(p: Paquete, m: Maestros, b: Hallazgo[]): Proveedor | null {
  const prov = buscarProveedor(p, m)
  const id = p.solicitud.proveedor_nit ? `NIT ${p.solicitud.proveedor_nit}` : `nombre "${p.solicitud.proveedor_nombre}"`
  if (!prov) {
    b.push({
      codigo: "RC1",
      detalle: `El proveedor ${p.solicitud.proveedor_nombre} (${id}) no existe en el maestro de proveedores.`,
      accion_sugerida: "Solicitar a Compras la creación del proveedor en SAP (RUT, certificación bancaria) antes de reprocesar.",
    })
    return null
  }
  if (!prov.activo) {
    b.push({
      codigo: "RC1",
      detalle: `El proveedor ${prov.nombre} (código ${prov.codigo_sap}) está inactivo.`,
      accion_sugerida: "Solicitar a Compras la reactivación del proveedor o elegir otro proveedor.",
    })
    return null
  }
  return prov
}

function rc2rc3Aprobacion(p: Paquete, centro: CentroCosto | undefined, b: Hallazgo[]): void {
  const apr = p.aprobacion
  if (!apr) {
    b.push({ codigo: "RC2", detalle: "No hay correo de aprobación en el paquete.", accion_sugerida: "Pedir al solicitante el correo de aprobación del líder." })
    return
  }
  if (!apr.aprobado) {
    b.push({ codigo: "RC2", detalle: `El correo de ${apr.de} no contiene una aprobación explícita ("Aprobado").`, accion_sugerida: "Pedir al líder una aprobación explícita." })
    return
  }
  if (!centro) return // RC4 ya reporta el centro inexistente
  const aprobador = centro.aprobadores.find((a) => a.email.toLowerCase() === apr.de)
  const valor = p.solicitud.valor_total
  const conTope = centro.aprobadores.filter((a) => a.tope >= valor).map((a) => a.email)
  const sugerencia = conTope.length
    ? `Solicitar aprobación a: ${conTope.join(", ")}.`
    : `Ningún aprobador de ${centro.centro_costo} tiene tope ≥ ${fmt(valor)}; escalar a la dirección financiera.`
  if (!aprobador) {
    b.push({
      codigo: "RC2",
      detalle: `${apr.de} no es aprobador del centro de costo ${centro.centro_costo}. Aprobadores válidos: ${centro.aprobadores.map((a) => `${a.email} (tope ${fmt(a.tope)})`).join(", ")}.`,
      accion_sugerida: sugerencia,
    })
    return
  }
  if (valor > aprobador.tope) {
    b.push({
      codigo: "RC3",
      detalle: `Valor ${fmt(valor)} supera el tope de ${apr.de} (${fmt(aprobador.tope)}) en ${centro.centro_costo}.`,
      accion_sugerida: sugerencia,
    })
  }
}

function rc4Subarea(p: Paquete, centro: CentroCosto | undefined, b: Hallazgo[]): void {
  const s = p.solicitud
  if (!centro) {
    b.push({ codigo: "RC4", detalle: `El centro de costo ${s.centro_costo} no existe en el maestro.`, accion_sugerida: "Corregir el centro de costo en la solicitud." })
  } else if (!centro.subareas.includes(s.subarea)) {
    b.push({
      codigo: "RC4",
      detalle: `La subárea "${s.subarea}" no pertenece a ${s.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
      accion_sugerida: "Corregir la subárea en la solicitud.",
    })
  }
}

function rc5Cotizacion(p: Paquete, c: Hallazgo[]): void {
  const vt = p.solicitud.valor_total
  if (!p.cotizacion) {
    c.push({ codigo: "RC5", detalle: "No hay cotización en el paquete; no se puede contrastar el valor." })
    return
  }
  const dif = Math.abs(p.cotizacion.total - vt) / vt
  if (dif > PARAMETROS.toleranciaCotizacion) {
    c.push({
      codigo: "RC5",
      detalle: `Cotización (${fmt(p.cotizacion.total)}) difiere de la solicitud (${fmt(vt)}) en ${(dif * 100).toFixed(2)} % (tolerancia ${PARAMETROS.toleranciaCotizacion * 100} %). La OC se crearía por el valor de la solicitud.`,
    })
  }
}

function rc6rc7Derivados(p: Paquete, prov: Proveedor | null, c: Hallazgo[], d: Derivados): void {
  const s = p.solicitud
  if (s.indicador_iva) d.indicador_iva = { valor: s.indicador_iva, fuente: "solicitud" }
  else if (prov) {
    d.indicador_iva = { valor: prov.indicador_iva_default, fuente: "maestro.proveedores" }
    c.push({ codigo: "RC6", detalle: `La solicitud no informa indicador de IVA; se propone ${prov.indicador_iva_default} (default del proveedor).` })
    d.informados.push(`indicador_iva = ${prov.indicador_iva_default} derivado del maestro de proveedores`)
  }
  if (s.condiciones_pago) d.condiciones_pago = { valor: s.condiciones_pago, fuente: "solicitud" }
  else if (prov) {
    d.condiciones_pago = { valor: prov.condiciones_pago_default, fuente: "maestro.proveedores" }
    d.informados.push(`condiciones_pago = ${prov.condiciones_pago_default} derivado del maestro de proveedores (RC7)`)
  }
}

function rc8rc9Fechas(p: Paquete, c: Hallazgo[]): boolean {
  const fs = p.solicitud.fecha_solicitud
  let retroactiva = false
  if (p.factura && p.factura.fecha < fs) {
    retroactiva = true
    c.push({ codigo: "RC8", detalle: `OC retroactiva: la factura ${p.factura.numero} (${p.factura.fecha}) es anterior a la solicitud (${fs}). Quedará marcada en el log de control.` })
  }
  if (p.aprobacion && soloFecha(p.aprobacion.fecha) < fs) {
    c.push({ codigo: "RC9", detalle: `La aprobación (${soloFecha(p.aprobacion.fecha)}) es anterior a la fecha de solicitud (${fs}).` })
  }
  return retroactiva
}

function rc10Aritmetica(p: Paquete, b: Hallazgo[]): void {
  const s = p.solicitud
  const calculado = s.cantidad * s.valor_unitario
  if (Math.abs(calculado - s.valor_total) > PARAMETROS.toleranciaAritmetica) {
    b.push({
      codigo: "RC10",
      detalle: `cantidad × valor_unitario = ${fmt(calculado)} no coincide con valor_total ${fmt(s.valor_total)}.`,
      accion_sugerida: "Pedir al solicitante corregir el Excel de solicitud.",
    })
  }
}

export function validarPaquete(p: Paquete, m: Maestros): Validacion {
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const derivados: Derivados = { proveedor: null, indicador_iva: null, condiciones_pago: null, informados: [] }
  const centro = m.centros.find((x) => x.centro_costo === p.solicitud.centro_costo)

  const prov = rc1Proveedor(p, m, bloqueos)
  if (prov) derivados.proveedor = { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre }
  rc2rc3Aprobacion(p, centro, bloqueos)
  rc4Subarea(p, centro, bloqueos)
  rc10Aritmetica(p, bloqueos)
  rc5Cotizacion(p, confirmaciones)
  rc6rc7Derivados(p, prov, confirmaciones, derivados)
  const retroactiva = rc8rc9Fechas(p, confirmaciones)

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva }
}
