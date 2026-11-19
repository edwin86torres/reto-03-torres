// Implementación para APIs compatibles con OpenAI Chat Completions: Google Gemini, OpenAI, Groq, etc.
import { LlmError, postJson, type LlmAdapter, type LlmHerramienta, type LlmMensaje, type LlmRespuesta, type LlmToolCall } from "./adapter"

type OaToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }
type OaRespuesta = {
  choices?: { message?: { content?: string | null; tool_calls?: OaToolCall[] } }[]
  usage?: { total_tokens?: number }
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  constructor(
    readonly proveedor: string,
    readonly modelo: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  private mapear(m: LlmMensaje): Record<string, unknown> {
    if (m.rol === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.contenido }
    if (m.rol === "assistant") {
      const base: Record<string, unknown> = { role: "assistant", content: m.contenido || null }
      if (m.toolCalls.length) base.tool_calls = m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.nombre, arguments: JSON.stringify(t.args) } }))
      return base
    }
    return { role: m.rol, content: m.contenido }
  }

  async enviar(mensajes: LlmMensaje[], herramientas: LlmHerramienta[]): Promise<LlmRespuesta> {
    const body = {
      model: this.modelo,
      temperature: 0,
      messages: mensajes.map((m) => this.mapear(m)),
      tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } })),
    }
    const r = (await postJson(`${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, body, this.timeoutMs)) as OaRespuesta
    const msg = r.choices?.[0]?.message
    if (!msg) throw new LlmError("El modelo devolvió una respuesta vacía.")
    const toolCalls: LlmToolCall[] = (msg.tool_calls ?? []).map((t, i) => ({ id: t.id || `call_${i}`, nombre: t.function.name, args: parsearArgs(t.function.arguments) }))
    return { texto: msg.content ?? "", toolCalls, tokens: r.usage?.total_tokens ?? 0 }
  }
}

function parsearArgs(texto: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(texto || "{}")
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
