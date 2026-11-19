// Carga y validación de los maestros (proveedores, centros de costo, IVA, condiciones de pago).
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { fail, mensajeError, ok, type Resultado } from "./resultado"

const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
const CentroSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
const CodigoSchema = z.object({ codigo: z.string(), descripcion: z.string() }).loose()

export type Proveedor = z.infer<typeof ProveedorSchema>
export type CentroCosto = z.infer<typeof CentroSchema>
export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: z.infer<typeof CodigoSchema>[]
  condicionesPago: z.infer<typeof CodigoSchema>[]
}

async function cargar<T>(root: string, archivo: string, schema: z.ZodType<T>): Promise<T[]> {
  const texto = await readFile(join(root, "fixtures", "reto-03", "maestros", archivo), "utf8")
  return z.array(schema).parse(JSON.parse(texto))
}

export async function cargarMaestros(root: string): Promise<Resultado<Maestros>> {
  try {
    const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
      cargar(root, "proveedores.json", ProveedorSchema),
      cargar(root, "centros-costo.json", CentroSchema),
      cargar(root, "indicadores-iva.json", CodigoSchema),
      cargar(root, "condiciones-pago.json", CodigoSchema),
    ])
    return ok({ proveedores, centros, indicadoresIva, condicionesPago })
  } catch (e) {
    return fail(`No se pudieron cargar los maestros: ${mensajeError(e)}`)
  }
}

/** Nombre comparable: sin tildes, minúsculas, sin puntuación ni espacios. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}
