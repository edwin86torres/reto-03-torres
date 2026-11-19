// Fábrica del adaptador según variables de entorno. La clave solo se lee aquí y nunca se expone.
import type { LlmAdapter } from "./adapter"
import { AnthropicAdapter } from "./anthropic"
import { OpenAiCompatibleAdapter } from "./openai-compatible"

const PRESETS: Record<string, { baseUrl: string; modelo: string }> = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelo: "gemini-2.5-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", modelo: "gpt-4.1-mini" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", modelo: "llama-3.3-70b-versatile" },
}

export type ConfigLlm = { proveedor: string; modelo: string; configurado: boolean }

export function crearAdaptador(env: Record<string, string | undefined>): { adapter: LlmAdapter | null; config: ConfigLlm } {
  const proveedor = (env.LLM_PROVIDER ?? "gemini").toLowerCase()
  const clave = env.LLM_API_KEY ?? ""
  const timeout = Number(env.LLM_TIMEOUT_MS ?? 45000)
  if (proveedor === "anthropic") {
    const modelo = env.LLM_MODEL || "claude-haiku-4-5"
    return { adapter: clave ? new AnthropicAdapter(modelo, clave, timeout) : null, config: { proveedor, modelo, configurado: !!clave } }
  }
  const preset = PRESETS[proveedor] ?? PRESETS.gemini!
  const modelo = env.LLM_MODEL || preset.modelo
  const baseUrl = env.LLM_BASE_URL || preset.baseUrl
  return { adapter: clave ? new OpenAiCompatibleAdapter(proveedor, modelo, baseUrl, clave, timeout) : null, config: { proveedor, modelo, configurado: !!clave } }
}
