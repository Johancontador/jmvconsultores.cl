/**
 * py.mjs — busca un Python usable y ejecuta el script indicado.
 *
 * En Linux/VPS el binario es `python3`; en Windows suele ser `python` y
 * `python3` es un alias del stub de la Microsoft Store que no ejecuta nada.
 * Los scripts de npm pasan por aquí para funcionar en ambos entornos.
 *
 *   node deploy/py.mjs deploy/serve.py
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const candidatos = [process.env.PYTHON, 'python3', 'python'].filter(Boolean)
const argumentos = process.argv.slice(2)

if (argumentos.length === 0) {
  console.error('uso: node deploy/py.mjs <script.py> [args...]')
  process.exit(2)
}

let elegido = null
for (const cmd of candidatos) {
  const prueba = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
  if (prueba.status === 0) { elegido = cmd; break }
}

if (!elegido) {
  console.error('No se encontró Python. Define la variable PYTHON con su ruta completa.')
  process.exit(1)
}

const r = spawnSync(elegido, argumentos, { stdio: 'inherit' })
process.exit(r.status ?? 1)
