# Reto 03 — Agente conversacional "Órdenes de Compra SAP"

Agente que lee el paquete de una solicitud de compra, lo valida contra los maestros (RC1–RC10), construye la OC tal como quedaría en SAP, genera la evidencia de aprobación con SHA-256 y crea la OC en un SAP simulado. Las excepciones requieren confirmación humana explícita.

- **Link de prueba:** `<pegar aquí la URL de Render>`
- **Clave de acceso:** no aplica (link público). Si se define `ACCESS_KEY`, abrir como `https://<host>/?key=<valor>`.

## Requisitos

- [Bun](https://bun.sh) 1.1+ (o Docker).
- Una clave de un proveedor de modelo. Por defecto **Google Gemini** (`gemini-2.5-flash`, tiene capa gratuita: https://aistudio.google.com).

## Levantar en local (un comando)

```bash
cp .env.example .env      # y pon tu LLM_API_KEY
bun install && bun run dev
# abre http://localhost:3000
```

Con Docker: `docker build -t oc-sap . && docker run -p 3000:3000 --env-file .env oc-sap`

## Verificación sin modelo

```bash
bun install && bun run demo.ts
```

Procesa los 6 casos llamando directamente a las herramientas, muestra la idempotencia (`sol-001` dos veces) y una confirmación explícita (`sol-004`). No necesita clave. Genera `out/sap/ordenes.jsonl`, `out/control.csv`, `out/log.jsonl` y `out/<caso>/{aprobacion.txt, trazabilidad.json}`.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `LLM_PROVIDER` | No | `gemini` (defecto), `anthropic`, `openai`, `groq` |
| `LLM_API_KEY` | Sí, para el chat | Clave del proveedor. Solo en el servidor. |
| `LLM_MODEL` / `LLM_BASE_URL` | No | Modelo y URL base alternativos |
| `LLM_TIMEOUT_MS` | No | Timeout al proveedor (defecto 45000) |
| `MAX_ITERACIONES` | No | Tope herramienta→modelo por turno (defecto 25) |
| `MAX_TOKENS_SESION` | No | Tope de tokens por sesión (defecto 200000) |
| `MAX_TOKENS_GLOBAL` | No | Tope diario de tokens del servidor (defecto 3000000) |
| `ACCESS_KEY` | No | Protege el link con una clave |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, llm_configurado }` (nunca la clave) |

## Despliegue en Render (sin instalar nada)

1. Sube este repositorio a GitHub.
2. En render.com: **New → Web Service** → elige el repositorio → Runtime **Docker** → plan **Free**.
3. En **Environment** agrega `LLM_API_KEY` (y `LLM_PROVIDER=gemini`).
4. Despliega y copia la URL `https://<nombre>.onrender.com` en este README.

## Estructura

```
agent/prompt.md                 comportamiento (system prompt)
src/knowledge/ordenes-compra.md conocimiento del proceso
src/tools/oc.ts                 herramientas (oc_<export>), contrato zod
src/domain/                     lectura del paquete, maestros, reglas RC1–RC10, payload
src/sap/{adapter,mock}.ts       interfaz SapAdapter + SAP simulado en out/sap/
src/llm/                        adaptador propio + Gemini/OpenAI/Groq y Anthropic
src/agent/loop.ts               ciclo del agente, topes y confirmación humana
src/server.ts                   API HTTP + front estático
web/                            chat (HTML + JS sin dependencias)
demo.ts                         verificación sin modelo
modulo/                         bonus: agente empaquetado (bun run modulo lo regenera)
```
