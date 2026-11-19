// SAP simulado sobre archivos en out/sap/. Numeración secuencial desde 4500000001.
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { OrdenCompra, SapAdapter } from "./adapter"

type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

const PRIMER_NUMERO = 4500000001

export class SapMock implements SapAdapter {
  private readonly archivo: string

  constructor(private readonly root: string) {
    this.archivo = join(root, "out", "sap", "ordenes.jsonl")
  }

  private async leer(): Promise<Registro[]> {
    try {
      const texto = await readFile(this.archivo, "utf8")
      return texto.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Registro)
    } catch {
      return []
    }
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const texto = await readFile(join(this.root, "fixtures", "reto-03", "maestros", "proveedores.json"), "utf8")
    const lista = JSON.parse(texto) as { nit: string; codigo_sap: string; activo: boolean }[]
    const p = lista.find((x) => x.nit === nit)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const r = (await this.leer()).find((x) => x.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const existentes = await this.leer()
    const numero_oc = String(PRIMER_NUMERO + existentes.length)
    const fecha = new Date().toISOString().slice(0, 10)
    await mkdir(join(this.root, "out", "sap"), { recursive: true })
    const registro: Registro = { numero_oc, fecha, solicitud_id: orden.referencia.solicitud_id, orden }
    await appendFile(this.archivo, `${JSON.stringify(registro)}\n`)
    return { numero_oc, fecha }
  }
}
