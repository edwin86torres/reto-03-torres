// Verificación sin modelo (sección 6.6): procesa los 6 casos llamando directamente a las herramientas.
// Uso: bun install && bun run demo.ts
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { buscarHerramienta } from "./src/tools/registry"
import type { ToolCtx } from "./src/tools/base"

const root = import.meta.dir
type Resp = { ok: boolean; data?: Record<string, unknown>; error?: string }

async function llamar(nombre: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<Resp> {
  const h = buscarHerramienta(nombre)
  if (!h) return { ok: false, error: `herramienta ${nombre} no existe` }
  return JSON.parse(await h.ejecutar(args, ctx)) as Resp
}

const codigos = (x: unknown) => ((x as { codigo: string }[] | undefined) ?? []).map((h) => h.codigo).join(", ") || "—"

async function procesar(caso: string, ctx: ToolCtx, confirmado = false): Promise<void> {
  const v = await llamar("oc_validar", { caso }, ctx)
  if (!v.ok || !v.data) {
    console.log(`  ${caso}: error de validación → ${v.error}`)
    return
  }
  const d = v.data
  if (d.apta) {
    await llamar("oc_construir_payload", { caso }, ctx)
    await llamar("oc_generar_evidencia", { caso }, ctx)
  }
  const c = await llamar("oc_crear", { caso, confirmado }, ctx)
  const resultado = c.ok ? `OC ${String(c.data?.numero_oc)}${c.data?.idempotente ? " (idempotente: ya existía)" : ""}` : `sin OC → ${c.error}`
  console.log(`\n▶ ${caso}${confirmado ? " (con confirmación explícita)" : ""}`)
  console.log(`  apta: ${String(d.apta)} | retroactiva: ${String(d.retroactiva)}`)
  console.log(`  bloqueos: ${codigos(d.bloqueos)} | confirmaciones: ${codigos(d.confirmaciones)}`)
  console.log(`  resultado: ${resultado.slice(0, 260)}`)
}

async function main(): Promise<void> {
  await rm(join(root, "out"), { recursive: true, force: true })
  const ctx: ToolCtx = { directory: root, sessionId: "demo", confirmacionHumana: false }
  const casos = (await readdir(join(root, "fixtures", "reto-03", "solicitudes"))).sort()

  console.log("═══ Primera pasada: sin confirmaciones ═══")
  for (const caso of casos) await procesar(caso, ctx)

  console.log("\n═══ Idempotencia: sol-001 por segunda vez ═══")
  await procesar("sol-001", ctx)

  console.log("\n═══ Confirmación explícita del usuario para sol-004 ═══")
  await procesar("sol-004", { ...ctx, confirmacionHumana: true }, true)

  console.log("\n═══ Caso inexistente (manejo de errores) ═══")
  const e = await llamar("oc_leer_paquete", { caso: "sol-999" }, ctx)
  console.log(`  sol-999 → ${e.error}`)

  console.log("\nArchivos: out/sap/ordenes.jsonl · out/control.csv · out/log.jsonl · out/<caso>/{aprobacion.txt,trazabilidad.json}")
}

await main()
