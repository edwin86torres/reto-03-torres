// API HTTP (sección 6.4) + estáticos del front. Un comando: bun run dev
import { join } from "node:path"
import { ejecutarTurno, type Sesion } from "./agent/loop"
import { crearAdaptador } from "./llm"

const root = join(import.meta.dir, "..")
const env = process.env
const { adapter, config } = crearAdaptador(env)
const limites = {
  maxIteraciones: Number(env.MAX_ITERACIONES ?? 25),
  maxTokensSesion: Number(env.MAX_TOKENS_SESION ?? 200000),
}
const MAX_TOKENS_GLOBAL = Number(env.MAX_TOKENS_GLOBAL ?? 3000000) // tope diario para que nadie gaste la clave sin límite
const ACCESS_KEY = env.ACCESS_KEY ?? "" // opcional: protege el link
const MAX_SESIONES = 200
const SESION_RE = /^[a-zA-Z0-9-]{8,64}$/

const sesiones = new Map<string, Sesion>()
let tokensGlobales = 0
let diaGlobal = new Date().toISOString().slice(0, 10)
const ocupadas = new Set<string>()

const SEGURIDAD: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: SEGURIDAD })

function obtenerSesion(id: string): Sesion {
  let s = sesiones.get(id)
  if (!s) {
    if (sesiones.size >= MAX_SESIONES) {
      const masVieja = sesiones.keys().next().value
      if (masVieja) sesiones.delete(masVieja)
    }
    s = { id, mensajes: [], turnos: [], tokens: 0, esperandoConfirmacion: false }
    sesiones.set(id, s)
  }
  return s
}

function autorizado(req: Request): boolean {
  return !ACCESS_KEY || req.headers.get("x-access-key") === ACCESS_KEY
}

async function chat(req: Request): Promise<Response> {
  if (!autorizado(req)) return json({ error: "Clave de acceso inválida" }, 401)
  let body: { sessionId?: unknown; message?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: "Cuerpo JSON inválido" }, 400)
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!SESION_RE.test(sessionId)) return json({ error: "sessionId inválido" }, 400)
  if (!message || message.length > 4000) return json({ error: "El mensaje debe tener entre 1 y 4000 caracteres" }, 400)
  if (!adapter) return json({ reply: "⚠️ El servidor no tiene configurada la clave del modelo (LLM_API_KEY). Las herramientas funcionan con `bun run demo.ts`.", toolCalls: [], needsConfirmation: false })

  const hoy = new Date().toISOString().slice(0, 10)
  if (hoy !== diaGlobal) {
    diaGlobal = hoy
    tokensGlobales = 0
  }
  if (tokensGlobales >= MAX_TOKENS_GLOBAL) return json({ reply: "⚠️ Se alcanzó el tope diario de uso del modelo en este servidor.", toolCalls: [], needsConfirmation: false })
  if (ocupadas.has(sessionId)) return json({ error: "La sesión ya está procesando un mensaje" }, 409)

  ocupadas.add(sessionId)
  try {
    const s = obtenerSesion(sessionId)
    const antes = s.tokens
    const turno = await ejecutarTurno(root, s, message, adapter, limites)
    tokensGlobales += s.tokens - antes
    return json({ reply: turno.texto, toolCalls: turno.toolCalls, needsConfirmation: turno.needsConfirmation })
  } catch {
    return json({ reply: "⚠️ Error inesperado en el servidor. La sesión sigue activa; intente de nuevo.", toolCalls: [], needsConfirmation: false })
  } finally {
    ocupadas.delete(sessionId)
  }
}

const server = Bun.serve({
  port: Number(env.PORT ?? 3000),
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/api/health") return json({ ok: true, provider: config.proveedor, model: config.modelo, llm_configurado: config.configurado })
    if (url.pathname === "/api/chat" && req.method === "POST") return chat(req)
    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (m && req.method === "GET") {
      if (!autorizado(req)) return json({ error: "Clave de acceso inválida" }, 401)
      const s = sesiones.get(m[1] ?? "")
      return s ? json({ id: s.id, turnos: s.turnos, tokens: s.tokens }) : json({ error: "Sesión no encontrada" }, 404)
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return new Response(Bun.file(join(root, "web", "index.html")), { headers: { ...SEGURIDAD, "content-type": "text/html; charset=utf-8" } })
    if (url.pathname === "/app.js") return new Response(Bun.file(join(root, "web", "app.js")), { headers: { ...SEGURIDAD, "content-type": "text/javascript; charset=utf-8" } })
    return json({ error: "No encontrado" }, 404)
  },
})

console.log(`Agente OC SAP en http://localhost:${server.port} · proveedor=${config.proveedor} modelo=${config.modelo} clave=${config.configurado ? "configurada" : "NO configurada"}`)
