// Implementación para la API de mensajes de Anthropic (Claude).
import { LlmError, postJson, type LlmAdapter, type LlmHerramienta, type LlmMensaje, type LlmRespuesta } from "./adapter"

type Bloque = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string }
type AnMensaje = { role: "user" | "assistant"; content: Bloque[] }
type AnRespuesta = { content?: Bloque[]; usage?: { input_tokens?: number; output_tokens?: number } }

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  constructor(
    readonly modelo: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  private mapear(mensajes: LlmMensaje[]): { system: string; messages: AnMensaje[] } {
    let system = ""
    const messages: AnMensaje[] = []
    for (const m of mensajes) {
      if (m.rol === "system") system += m.contenido
      else if (m.rol === "user") messages.push({ role: "user", content: [{ type: "text", text: m.contenido }] })
      else if (m.rol === "assistant") {
        const content: Bloque[] = m.contenido ? [{ type: "text", text: m.contenido }] : []
        for (const t of m.toolCalls) content.push({ type: "tool_use", id: t.id, name: t.nombre, input: t.args })
        messages.push({ role: "assistant", content })
      } else if (m.rol === "tool") {
        const bloque: Bloque = { type: "tool_result", tool_use_id: m.toolCallId, content: m.contenido }
        const ultimo = messages[messages.length - 1]
        if (ultimo?.role === "user" && ultimo.content.every((b) => b.type === "tool_result")) ultimo.content.push(bloque)
        else messages.push({ role: "user", content: [bloque] })
      }
    }
    return { system, messages }
  }

  async enviar(mensajes: LlmMensaje[], herramientas: LlmHerramienta[]): Promise<LlmRespuesta> {
    const { system, messages } = this.mapear(mensajes)
    const body = { model: this.modelo, max_tokens: 2048, temperature: 0, system, messages, tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros })) }
    const r = (await postJson("https://api.anthropic.com/v1/messages", { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, body, this.timeoutMs)) as AnRespuesta
    if (!r.content) throw new LlmError("El modelo devolvió una respuesta vacía.")
    let texto = ""
    const toolCalls: LlmRespuesta["toolCalls"] = []
    for (const b of r.content) {
      if (b.type === "text") texto += b.text
      else if (b.type === "tool_use") toolCalls.push({ id: b.id, nombre: b.name, args: b.input })
    }
    return { texto, toolCalls, tokens: (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0) }
  }
}
