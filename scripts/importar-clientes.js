#!/usr/bin/env node
/**
 * importar-clientes.js — alta masiva de clientes: empresa + usuario + mensaje.
 *
 * No hay base adjunta todavía: este script es el pipeline listo para recibirla.
 *
 * Uso:
 *   node scripts/importar-clientes.js --csv docs/plantilla-clientes.csv
 *   node scripts/importar-clientes.js --csv mi-base.csv --aplicar \
 *        --base-url=https://app.jmvconsultores.cl/sistema/ --pausa-ms=1500
 *
 * Columnas (encabezado obligatorio, orden libre):
 *   rut            obligatorio   RUT de la empresa (con DV)
 *   email          obligatorio   usuario del cliente (se normaliza a minúsculas)
 *   clave_sii      opcional      clave tributaria; obligatoria si la empresa NO existe
 *   razon_social   opcional      solo se usa para el mensaje/validación
 *   nombre_contacto opcional     nombre para saludar en el mensaje
 *   telefono       opcional
 *   tasa_ppm       opcional      decimal 0..1 (ej. 0.01)
 *
 * Reglas:
 *  - DRY-RUN por defecto: no escribe nada, valida y muestra el plan.
 *  - La empresa se crea SOLO con `empresas-sii.crearDesdeSii` (ficha oficial
 *    del SII). No se inventan razón social, régimen ni actividad.
 *  - Si la empresa ya existe, se vincula el usuario con rol admin_empresa.
 *    La clave SII NO se rota salvo que se pase --actualizar-clave.
 *  - El usuario nace con clave provisional y debe_cambiar_clave=1.
 *  - Con --aplicar se escriben DOS archivos en data/importacion-<ts>/:
 *      clientes.csv  (incluye la clave provisional: NO compartir el archivo)
 *      mensajes.md   (mensajes personalizados, listos para enviar)
 *  - F29/F22/juradas/boletas NO están conectados: los mensajes NO los prometen.
 */
'use strict'

const fs = require('fs')
const path = require('path')

// .env ANTES de backend/db: la bóveda descifra la clave SII con
// SECRETOS_MASTER_KEY; sin dotenv el script falla al leer empresas existentes.
require('dotenv').config()
process.env.DB_PATH = process.env.DB_PATH || './data/iva_mensual.db'
const db = require('../backend/db')
const { crearUsuarioTemporal } = require('../backend/core/usuarios-temporales')
const { crearDesdeSii } = require('../backend/core/empresas-sii')
const { validarRut, normalizarRut, asignarRol } = require('../backend/core/empresas')

const args = process.argv.slice(2)
const opt = (nombre, def = null) => {
  // Acepta --csv=archivo y --csv archivo (la forma con espacio es la que
  // usan los ejemplos de la documentación).
  const i = args.findIndex((a) => a === `--${nombre}` || a.startsWith(`--${nombre}=`))
  if (i < 0) return def
  const arg = args[i]
  if (arg.includes('=')) return arg.split('=').slice(1).join('=')
  return args[i + 1] !== undefined ? args[i + 1] : def
}
const aplicar = args.includes('--aplicar')
const actualizarClave = args.includes('--actualizar-clave')
const csvPath = opt('csv')
const baseUrl = opt('base-url', process.env.APP_BASE_URL || 'https://app.jmvconsultores.cl/sistema/')
const pausaMs = Math.max(0, Number(opt('pausa-ms', 1200)) || 0)

if (!csvPath) {
  console.error('Falta --csv=<archivo>. Ver el encabezado del script para las columnas.')
  process.exit(1)
}
if (!fs.existsSync(csvPath)) {
  console.error(`No existe el archivo: ${csvPath}`)
  process.exit(1)
}

/* ------------------------------ CSV ------------------------------ */
function parseCSV(texto) {
  const filas = []
  let fila = []
  let campo = ''
  let enComillas = false
  const s = texto.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (enComillas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++ } else enComillas = false
      } else campo += c
      continue
    }
    if (c === '"') { enComillas = true; continue }
    if (c === ',' || c === ';') { fila.push(campo); campo = ''; continue }
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue }
    if (c === '\r') continue
    campo += c
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila) }
  return filas.filter((f) => f.some((v) => String(v).trim() !== ''))
}

const filas = parseCSV(fs.readFileSync(csvPath, 'utf8'))
if (filas.length < 2) {
  console.error('El CSV no tiene datos (se espera encabezado + al menos una fila).')
  process.exit(1)
}
const header = filas[0].map((h) => String(h).trim().toLowerCase())
const req = ['rut', 'email']
for (const col of req) {
  if (!header.includes(col)) {
    console.error(`Falta la columna obligatoria '${col}'. Columnas: ${header.join(', ')}`)
    process.exit(1)
  }
}
const idx = (col) => header.indexOf(col)
const leer = (fila, col) => (idx(col) >= 0 ? String(fila[idx(col)] || '').trim() : '')

const emailValido = (v) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v)

const admin = db.prepare(`SELECT id, username FROM users WHERE is_admin = 1 AND activo = 1 ORDER BY id LIMIT 1`).get()
if (!admin) {
  console.error('No hay un super admin activo para ejecutar el alta (empresas.crear lo exige).')
  process.exit(1)
}

const ahora = new Date().toISOString().replace(/[:.]/g, '-')
const salidaDir = opt('salida', null)
const outDir = salidaDir
  ? path.resolve(salidaDir)
  : path.join(process.cwd(), 'data', `importacion-${ahora}`)

function mensaje({ nombre, empresa, email, clave, url }) {
  return `Hola ${nombre}:

Te quiero compartir un acceso exclusivo para clientes de JMV Consultores. Con este usuario y clave puedes entrar a:

${url}

Usuario: ${email}
Clave provisional: ${clave}

Dentro vas a poder:
• Consultar los antecedentes tributarios de ${empresa}: inicio de actividades, actividad económica, dirección, capital y régimen.
• Revisar tus libros de compras y ventas del SII, documento a documento.
• Ver tus ventas, compras, IVA estimado y PPM del período, con la evolución de los últimos meses.
• Revisar informes de gestión: margen, evolución mensual, principales clientes y proveedores, y alertas sobre tus datos.
• Consultar la cobertura de tus declaraciones mensuales y la opinión de Salud Tributaria de tu empresa.

Por seguridad, en tu primer ingreso el sistema te va a pedir cambiar la clave provisional.

Cuando entres, cuéntame si pudiste ingresar y si te resultó útil. Cualquier duda, quedo atento.

Saludos,
${process.env.NOMBRE_CONTADOR || 'JMV Consultores'}`
}

const resultados = []
let errores = 0

async function procesar() {
for (let n = 1; n < filas.length; n++) {
  const fila = filas[n]
  const rutRaw = leer(fila, 'rut')
  const email = leer(fila, 'email').toLowerCase()
  const clave = leer(fila, 'clave_sii')
  const razon = leer(fila, 'razon_social')
  const contacto = leer(fila, 'nombre_contacto')
  const nombre = contacto || razon || email.split('@')[0] || 'cliente'
  const tasa = leer(fila, 'tasa_ppm')

  const item = {
    fila: n + 1, rut: rutRaw, email, empresa: razon, usuario: null,
    clave_provisional: null, estado: 'error', detalle: '',
  }

  try {
    if (!validarRut(rutRaw)) throw new Error('RUT inválido (dígito verificador)')
    const rut = normalizarRut(rutRaw)
    item.rut = rut
    if (!emailValido(email)) throw new Error('email inválido')
    if (db.prepare(`SELECT 1 FROM users WHERE username = ? COLLATE NOCASE OR (email IS NOT NULL AND email = ? COLLATE NOCASE)`).get(email, email)) {
      throw new Error('ya existe un usuario con ese correo')
    }
    if (tasa && !(Number(tasa) >= 0 && Number(tasa) <= 1)) throw new Error('tasa_ppm inválida (0..1)')

    const existente = db.prepare(`SELECT id, nombre FROM empresas WHERE rut = ? AND activo = 1`).get(rut)
    if (!existente && !clave) throw new Error('la empresa no existe y falta clave_sii para crearla desde el SII')

    if (!aplicar) {
      item.estado = 'listo'
      item.detalle = existente ? `vincula empresa existente #${existente.id}` : 'crea empresa desde el SII + usuario'
      item.empresa = existente ? existente.nombre : (razon || '(razón social desde el SII)')
      resultados.push(item)
      continue
    }

    let empresaId
    if (existente) {
      empresaId = existente.id
      item.empresa = existente.nombre
      if (actualizarClave && clave) {
        // Se valida contra el SII ANTES de rotar: guardar una clave mala
        // dejaría la empresa sin sincronización y sin señal del error.
        const { obtenerSesion } = require('../backend/services/sii-session')
        try {
          await obtenerSesion(rut, clave)
        } catch (e) {
          throw new Error(`clave SII no validada contra el SII: ${e.message}`)
        }
        const { cifrar } = require('../backend/core/boveda')
        db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(cifrar(clave), empresaId)
        item.detalle = 'empresa existente · clave SII actualizada'
      } else {
        item.detalle = 'empresa existente'
      }
    } else {
      const r = await crearDesdeSii(db, {
        usuarioId: admin.id,
        rut,
        clave,
        tasaPpm: tasa ? Number(tasa) : 0.01,
      })
      empresaId = r.empresaId
      item.empresa = r.nombre
      item.detalle = 'empresa creada desde el SII'
    }

    const u = crearUsuarioTemporal(db, { adminId: admin.id, username: email })
    item.usuario = u.username
    item.clave_provisional = u.clave_provisional

    // asignarRol revalida super admin, rol, empresa y usuario, y deja
    // auditoría con empresa_id. No se escribe usuario_empresa a mano.
    asignarRol(db, {
      usuarioIdEjecutor: admin.id,
      usuarioIdObjetivo: u.usuarioId,
      empresaId,
      rol: 'admin_empresa',
      ip: null,
    })

    item.estado = 'creado'
    item.detalle = `${item.detalle} · usuario ${email} con rol admin_empresa`
    item.mensaje = mensaje({ nombre, empresa: item.empresa, email, clave: u.clave_provisional, url: baseUrl })
    resultados.push(item)

    if (pausaMs && n < filas.length - 1) await new Promise((r) => setTimeout(r, pausaMs))
  } catch (err) {
    item.detalle = err.message
    resultados.push(item)
    errores++
  }
}

/* ------------------------------ SALIDA ------------------------------ */
const anchos = { fila: 5, rut: 13, email: 34, empresa: 38, estado: 9 }
const pad = (v, n) => String(v ?? '').slice(0, n).padEnd(n)
console.log(pad('FILA', anchos.fila), pad('RUT', anchos.rut), pad('EMAIL', anchos.email), pad('EMPRESA', anchos.empresa), 'ESTADO')
for (const r of resultados) {
  console.log(pad(r.fila, anchos.fila), pad(r.rut, anchos.rut), pad(r.email, anchos.email), pad(r.empresa, anchos.empresa), r.estado, r.estado === 'error' ? `· ${r.detalle}` : '')
}

if (!aplicar) {
  console.log(`\nDRY-RUN: ${resultados.filter((r) => r.estado === 'listo').length} listo(s), ${errores} error(es). No se escribió nada.`)
  console.log('Para aplicar: agrega --aplicar (y revisa antes los errores).')
  db.close()
  process.exit(errores ? 1 : 0)
}

fs.mkdirSync(outDir, { recursive: true })
const csvOut = ['rut,empresa,email,usuario,clave_provisional,estado,detalle']
for (const r of resultados) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  csvOut.push([r.rut, r.empresa, r.email, r.usuario, r.clave_provisional, r.estado, r.detalle].map(esc).join(','))
}
fs.writeFileSync(path.join(outDir, 'clientes.csv'), csvOut.join('\n'), 'utf8')

const creados = resultados.filter((r) => r.estado === 'creado')
const md = [
  '# Mensajes de acceso — clientes',
  '',
  `Generado: ${new Date().toISOString()}`,
  `Link: ${baseUrl}`,
  '',
  '> Las claves son de uso único y el sistema obliga a cambiarlas en el primer ingreso.',
  '> Enviar por un canal privado. NO reenviar este archivo completo.',
  '',
  ...creados.map((r) => `## ${r.empresa} (${r.rut})\n\n\`\`\`\n${r.mensaje}\n\`\`\`\n`),
].join('\n')
fs.writeFileSync(path.join(outDir, 'mensajes.md'), md, 'utf8')

console.log(`\nAPLICADO: ${creados.length} creado(s), ${errores} error(es).`)
console.log(`  ${path.join(outDir, 'clientes.csv')}   (contiene claves: no compartir)`)
console.log(`  ${path.join(outDir, 'mensajes.md')}`)
if (errores) console.log('  Revisa las filas con estado error antes de reintentar (el script es idempotente por correo).')
db.close()
}

procesar().catch((err) => {
  console.error('ERROR:', err.message)
  try { db.close() } catch { /* ya cerrada */ }
  process.exit(1)
})
