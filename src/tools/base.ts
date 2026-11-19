// Contrato de herramientas (sección 6.2): { description, args (zod), execute(args, ctx) → string JSON }.
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

export type ToolCtx = {
  directory: string
  sessionId: string
  /** true solo si el ÚLTIMO mensaje del usuario confirmó explícitamente una acción pedida por el agente. Lo fija el servidor, nunca el modelo. */
  confirmacionHumana?: boolean
}

export type ToolDef<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: ToolCtx): Promise<string>
}

export const definirTool = <S extends z.ZodRawShape>(t: ToolDef<S>): ToolDef<S> => t

export const respuestaOk = (data: unknown): string => JSON.stringify({ ok: true, data })
export const respuestaError = (error: string): string => JSON.stringify({ ok: false, error })

/** Línea en out/log.jsonl: { ts, herramienta, caso, ok, resumen }. Nunca incluye claves ni el payload completo. */
export async function registrarLog(root: string, entrada: { herramienta: string; caso: string; ok: boolean; resumen: string }): Promise<void> {
  try {
    await mkdir(join(root, "out"), { recursive: true })
    await appendFile(join(root, "out", "log.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`)
  } catch {
    // el log nunca debe romper la herramienta
  }
}
