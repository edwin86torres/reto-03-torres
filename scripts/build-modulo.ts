// Genera modulo/ desde las MISMAS fuentes que usa la app (sin copias divergentes):
// agent/prompt.md → modulo/agent.md · src/knowledge → modulo/skill/.../SKILL.md · tools re-exporta src/tools/oc.ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const prompt = await readFile(join(root, "agent", "prompt.md"), "utf8")
const conocimiento = await readFile(join(root, "src", "knowledge", "ordenes-compra.md"), "utf8")

await mkdir(join(root, "modulo", "tools"), { recursive: true })
await mkdir(join(root, "modulo", "skill", "ordenes-compra"), { recursive: true })

await writeFile(
  join(root, "modulo", "agent.md"),
  `---\ndescription: Prepara, valida (RC1–RC10) y crea órdenes de compra en SAP con confirmación humana para excepciones.\nmode: primary\npermission:\n  edit: deny\n  bash: deny\n---\n\n${prompt}`,
)
await writeFile(
  join(root, "modulo", "skill", "ordenes-compra", "SKILL.md"),
  `---\nname: ordenes-compra\ndescription: Conocimiento del proceso de órdenes de compra de Periferia — maestros, matriz de controles RC1–RC10, OC retroactivas y evidencias.\n---\n\n${conocimiento}`,
)
await writeFile(
  join(root, "modulo", "tools", "oc.ts"),
  `// Mismas herramientas que usa la aplicación: re-export, no copia.\nexport * from "../../src/tools/oc"\n`,
)
console.log("modulo/ generado desde agent/prompt.md, src/knowledge/ y src/tools/oc.ts")
