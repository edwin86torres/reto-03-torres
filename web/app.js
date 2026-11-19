// Front de chat. Todo el texto se inserta con textContent (sin innerHTML) para evitar XSS.
const chat = document.getElementById("chat")
const form = document.getElementById("form")
const input = document.getElementById("input")
const boton = document.getElementById("enviar")
const estado = document.getElementById("estado")
const sessionId = crypto.randomUUID()
const accessKey = new URLSearchParams(location.search).get("key") || ""

const ejemplos = [
  'Procesa la solicitud "sol-001" y crea la OC si todo está en orden.',
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.',
  "Valida sol-002 y sol-003 y dime por qué no se pueden crear.",
]

function el(tag, clase, texto) {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto !== undefined) n.textContent = texto
  return n
}

function agregarMensaje(texto, clase) {
  const n = el("div", `msg ${clase || ""}`, texto)
  chat.appendChild(n)
  n.scrollIntoView({ behavior: "smooth", block: "end" })
  return n
}

function agregarTool(contenedor, t) {
  const d = el("details", "tool")
  const s = el("summary")
  s.appendChild(el("span", t.ok ? "t-ok" : "t-err", t.ok ? "✔ " : "✖ "))
  s.appendChild(document.createTextNode(`${t.nombre} → ${t.resumen}`))
  d.appendChild(s)
  d.appendChild(el("pre", "", `argumentos: ${JSON.stringify(t.args, null, 2)}`))
  contenedor.appendChild(d)
}

async function enviar(texto) {
  agregarMensaje(texto, "user")
  const pensando = agregarMensaje("Pensando y consultando herramientas…", "thinking")
  boton.disabled = true
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-key": accessKey },
      body: JSON.stringify({ sessionId, message: texto }),
    })
    const data = await res.json()
    pensando.remove()
    const n = el("div", `msg ${data.needsConfirmation ? "confirm" : ""}`)
    if (data.needsConfirmation) n.appendChild(el("div", "badge", "⚠ El agente necesita tu confirmación explícita"))
    for (const t of data.toolCalls || []) agregarTool(n, t)
    n.appendChild(document.createTextNode(data.reply || data.error || "Sin respuesta"))
    chat.appendChild(n)
    n.scrollIntoView({ behavior: "smooth", block: "end" })
  } catch {
    pensando.remove()
    agregarMensaje("⚠️ No fue posible contactar el servidor. Intenta de nuevo.", "confirm")
  } finally {
    boton.disabled = false
    input.focus()
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault()
  const texto = input.value.trim()
  if (!texto) return
  input.value = ""
  enviar(texto)
})
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    form.requestSubmit()
  }
})

const chips = document.getElementById("chips")
for (const ej of ejemplos) {
  const b = el("button", "chip", ej.length > 60 ? `${ej.slice(0, 57)}…` : ej)
  b.type = "button"
  b.title = ej
  b.addEventListener("click", () => enviar(ej))
  chips.appendChild(b)
}

fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    estado.textContent = `${h.provider} · ${h.model}${h.llm_configurado ? "" : " · sin clave"}`
  })
  .catch(() => {
    estado.textContent = "servidor no disponible"
  })
