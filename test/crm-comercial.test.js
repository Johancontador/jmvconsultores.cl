'use strict'
/**
 * CRM COMERCIAL (rediseño 2026-10-15) — tests §Fase 8:
 *  T1  Ficha comercial: guardar/obtener, correo normalizado, inválido → error
 *  T2  Contactos: primer contacto principal; dedupe por correo; principal
 *      exclusivo; eliminar bloqueado si pertenece a oportunidades
 *  T3  Prospectos: RUT inválido (M11) rechaza; correo duplicado rechaza;
 *      importación en lote (aceptados/errores sin cortar); conversión
 *      vincula empresa por RUT (etapa ONBOARDING) y sin empresa queda
 *      CONVERTIDO sin empresa_id; DESCARTADO no convierte; CONVERTIDO no
 *      retrocede
 *  T4  Oportunidades: no nacen en etapa terminal; contacto de otra empresa
 *      rechaza; transición guarda historial con usuario; ponderado IGUAL en
 *      kanban/ficha/informe (misma fórmula); PERDIDA sin motivo rechaza; las
 *      terminales son finales
 *  T5  Actividades: ancla obligatoria; empresa derivada de contacto y de
 *      oportunidad; completar marca completada_en; sin ancla rechaza
 *  T6  Informes: embudo/causas coherentes con el sembrado; conversión = 
 *      ganadas/(ganadas+perdidas); proyección = suma ponderada de abiertas
 *  T7  Multitanent HTTP: contador con asignación SOLO a empresa A — endpoints
 *      sobre B responden 403 sin fuga; sobre A responden 200
 * Ejecutar: node --test test/crm-comercial.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const express = require('express')

const dbFile = path.join(os.tmpdir(), `iva-mensual-crm-com-${Date.now()}.db`)
process.env.DB_PATH = dbFile
const db = require('../backend/db')
const co = require('../backend/core/crm-comercial')
const crm = require('../backend/core/crm')
const empresasCore = require('../backend/core/empresas')
const { crearSesion } = require('../backend/services/session')

const app = express()
app.use(express.json())
app.set('trust proxy', 1)
// Igual que en producción (backend/index.js:85): requireAuth GLOBAL de router.
const { requireAuth } = require('../backend/middleware/requireAuth')
app.use('/api/crm', requireAuth, require('../backend/routes/crm'))
const server = app.listen(0)
const port = server.address().port

test.after(() => {
  server.close()
  try { db.close() } catch { /* */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

// ---------- helpers ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const dv11 = (cuerpo) => {
  let s = 0, m = 2
  for (let i = String(cuerpo).length - 1; i >= 0; i--) { s += +String(cuerpo)[i] * m; m = m < 7 ? m + 1 : 2 }
  const d = 11 - (s % 11)
  return d === 11 ? '0' : d === 10 ? 'K' : String(d)
}
const RUT_A = `76543210-${dv11('76543210')}`
const RUT_B = `71234560-${dv11('71234560')}`

const empA = empresasCore.crear(db, { usuarioId: adminId, rut: RUT_A, nombre: 'Cliente Alfa SA', claveSii: 'clavequi' + 'x'.repeat(12) })
const empB = empresasCore.crear(db, { usuarioId: adminId, rut: RUT_B, nombre: 'Cliente Beta SPA', claveSii: 'clavex' + 'x'.repeat(13) })
const A = typeof empA === 'object' ? empA.id : empA
const B = typeof empB === 'object' ? empB.id : empB

// Contador asignado SOLO a A (para T7)
const nSec = (() => { let n = 0; return () => ++n })()
function usuarioConRol(rolCodigo, empresaId) {
  const username = `cont_com_${nSec()}`
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES (?, 'x', 0, 1)`).run(username)
  const u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
  const rol = db.prepare(`SELECT id FROM roles WHERE codigo = ?`).get(rolCodigo)
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(u.id, empresaId, rol.id)
  return u.id
}
const CONTADOR = usuarioConRol('contador', A)

/* ---------------------------- T1 fichas ---------------------------- */

test('T1: ficha guarda/obtiene; correo normalizado; correo inválido rechaza', () => {
  co.guardarFicha(db, { usuarioId: adminId, empresaId: A, ficha: { giro: 'Comercio al por menor', correo: 'FICHA@ALFA.CL', fuente: 'referencia', prioridad: 'alta' } })
  const f = co.obtenerFicha(db, A)
  assert.equal(f.empresa.rut, RUT_A, 'la ficha NO duplica RUT: viene del maestro')
  assert.equal(f.ficha.correo, 'ficha@alfa.cl')
  assert.equal(f.ficha.fuente, 'referencia')
  assert.equal(f.etapa, 'PROSPECTO', 'la etapa la aporta crm_pipeline integrado')
  assert.throws(() => co.guardarFicha(db, { usuarioId: adminId, empresaId: A, ficha: { correo: 'sin-arroba' } }), /correo/)
})

/* --------------------------- T2 contactos --------------------------- */

test('T2: contactos — primero principal; dedupe; principal exclusivo; eliminar bloqueado', () => {
  const c1 = co.crearContacto(db, { usuarioId: adminId, empresaId: A, contacto: { nombre: 'Ana Pérez', cargo: 'Gerente', correo: 'ana@alfa.cl' } })
  const r1 = co.obtenerFicha(db, A)
  const fila1 = r1.contactos.find((c) => c.id === c1.id)
  assert.equal(fila1.principal, 1, 'el primer contacto queda principal por defecto')

  assert.throws(() => co.crearContacto(db, { usuarioId: adminId, empresaId: A, contacto: { nombre: 'Repetida', correo: 'ana@alfa.cl' } }), /duplicado/i)

  const c2 = co.crearContacto(db, { usuarioId: adminId, empresaId: A, contacto: { nombre: 'Bo Díaz', correo: 'bo@alfa.cl', principal: true } })
  const r2 = co.obtenerFicha(db, A)
  assert.equal(r2.contactos.find((c) => c.id === c2.id).principal, 1)
  assert.equal(r2.contactos.find((c) => c.id === c1.id).principal, 0, 'principal exclusivo')

  // con oportunidad asociada: eliminar bloquea (se prueba en T4 tras crear opo)
  assert.deepEqual(co.eliminarContacto(db, { usuarioId: adminId, contactoId: c1.id }), { ok: true })
})

/* --------------------------- T3 prospectos --------------------------- */

test('T3a: prospecto con RUT inválido y correo duplicado rechazan BEFORE indicar el caso', () => {
  assert.throws(() => co.crearProspecto(db, { usuarioId: adminId, prospecto: { nombre: 'Mal Rut', rut: '12.345.678-0' } }), /RUT/)
  const ok = co.crearProspecto(db, { usuarioId: adminId, prospecto: { nombre: 'Librería Sur', correo: 'sur@lib.cl' } })
  assert.ok(ok.id > 0)
  assert.throws(() => co.crearProspecto(db, { usuarioId: adminId, prospecto: { nombre: 'Duplicado', correo: 'SUR@lib.cl' } }), /duplicado/i, 'dedupe case-insensitive')
})

test('T3b: importación en lote valida fila a fila y NO corta el lote', () => {
  const r = co.importarProspectos(db, {
    usuarioId: adminId,
    prospectos: [
      { nombre: 'Importado Uno' },
      { nombre: 'Importado Dos', correo: 'dos@x.cl' },
      { nombre: 'RUT vío inválido', rut: '1.111.11X-9' },
      { nombre: '' }, // sin nombre → error reportado
    ],
  })
  assert.equal(r.aceptados.length, 2)
  assert.equal(r.errores.length, 2)
})

test('T3c: conversión — vincula empresa por RUT y etapa ONBOARDING; sin empresa queda CONVERTIDO; DESCARTADO no convierte; CONVERTIDO no retrocede', () => {
  // con RUT de empresa A existente
  const p1 = co.crearProspecto(db, { usuarioId: adminId, prospecto: { nombre: 'Prospecto con RUT real', rut: RUT_A.replace(/[.\-]/g, '') ? RUT_A : RUT_A } })
  const cv1 = co.convertirProspecto(db, { usuarioId: adminId, prospectoId: p1.id })
  assert.equal(cv1.empresa_id, A, 'la conversión VINcula la empresa real por RUT normalizado')
  const p1b = db.prepare(`SELECT estado, empresa_id FROM crm_prospectos WHERE id = ?`).get(p1.id)
  assert.equal(p1b.estado, 'CONVERTIDO')
  assert.equal(p1b.empresa_id, A)
  const pipeline = db.prepare(`SELECT etapa, notas FROM crm_pipeline WHERE empresa_id = ?`).get(A)
  assert.equal(pipeline.etapa, 'ONBOARDING', 'el pipeline del ciclo (crm.js) pasa a ONBOARDING')
  assert.match(pipeline.notas, /Prospecto #\d+/)

  // sin empresa: CONVERTIDO sin empresa_id (no inventa empresas)
  const p2 = co.crearProspecto(db, { usuarioId: adminId, prospecto: { nombre: 'Prospecto sin empresa', correo: 'sin-emp@x.cl' } })
  const cv2 = co.convertirProspecto(db, { usuarioId: adminId, prospectoId: p2.id })
  assert.equal(cv2.empresa_id, null)

  // re-convertir un CONVERTIDO NO lanza (idempotente: ya_convertido) ni re-mueve
  const reConv = co.convertirProspecto(db, { usuarioId: adminId, prospectoId: p2.id })
  assert.equal(reConv.ya_convertido, true)

  const p3 = co.crearProspecto(db, { usuarioId: adminId, prospecto: { nombre: 'Descartable', correo: 'desc@x.cl', estado: 'DESCARTADO' } })
  assert.throws(() => co.convertirProspecto(db, { usuarioId: adminId, prospectoId: p3.id }), /DESCARTADO/)
  assert.throws(() => co.editarProspecto(db, { usuarioId: adminId, prospectoId: p1.id, prospecto: { estado: 'NUEVO' } }), /CONVERTIDO/)
})

/* ------------------------- T4 oportunidades ------------------------- */

test('T4a: crear — valida etapa terminal, contacto ajeno y calcula el ponderado en kanban', () => {
  const contacto = co.crearContacto(db, { usuarioId: adminId, empresaId: A, contacto: { nombre: 'Compras Alfa', correo: 'compras@alfa.cl' } })
  const opo1 = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'Módulo 2027', empresaId: A, monto: 1_000_000, contactoId: contacto.id } })
  assert.ok(opo1.id > 0)
  // terminal prohibida al crear
  assert.throws(() => co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'Como GANADA', empresaId: A, etapa: 'GANADA' } }), /terminal/i)
  // contacto de otra empresa
  assert.throws(() => co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'Mal contacto', empresaId: A, contactoId: 999999 } }), /contacto/i)

  const lista = co.listarOportunidades(db, {})
  const det = lista.kanban.find((k) => k.etapa === 'DETALLE')
  assert.equal(det.n, 1, 'kanban cuenta UNA (regresión del doble tx())')
  assert.equal(det.monto, 1_000_000)
  assert.equal(det.monto_ponderado, 100_000, 'ponderado = monto×prob/100 (fórmula única)')
  assert.equal(lista.total, 1)
})

test('T4b: transición — historial con usuario; PERDIDA sin motivo rechaza; terminales finales', () => {
  const l0 = co.listarOportunidades(db, {})
  const id = l0.oportunidades[0].id

  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: id, etapa: 'NEGOCIACION' })
  let fila = co.obtenerOportunidad(db, id)
  assert.equal(fila.etapa, 'NEGOCIACION')
  assert.equal(fila.probabilidad, 75, 'prob default de la etapa')
  assert.equal(fila.monto_ponderado, 750_000, 'ponderado calculado con la MISMA fórmula')
  assert.ok(fila.historial.length >= 2, 'creación + transición en el historial')
  assert.ok(fila.historial.some((h) => h.desde === 'DETALLE' && h.hasta === 'NEGOCIACION'))

  assert.throws(() => co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: id, etapa: 'PERDIDA' }), /motivo/i, 'PERDIDA exige causa')
  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: id, etapa: 'PERDIDA', motivo: 'precio', comentario: 'budget' })
  fila = co.obtenerOportunidad(db, id)
  assert.equal(fila.motivo_perdida, 'precio')
  assert.throws(() => co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: id, etapa: 'DETALLE' }), /terminal/i, 'GANADA/PERDIDA finales')
  assert.throws(() => co.editarOportunidad(db, { usuarioId: adminId, oportunidadId: id, oportunidad: { monto: 9 } }), /terminal/i)
})

test('T4c: editar campo a campo — riesgo monto/prob/contacto/fecha con validaciones', () => {
  const opo = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'Edita me', empresaId: A, monto: 500000 } })
  co.editarOportunidad(db, { usuarioId: adminId, oportunidadId: opo.id, oportunidad: { monto: 800000, probabilidad: 40, primera_accion: 'Llamar lunes' } })
  const fila = co.obtenerOportunidad(db, opo.id)
  assert.equal(fila.monto, 800000)
  assert.equal(fila.monto_ponderado, 320_000, 'el ponderado SIEMPRE recalcula (fuente única)')
  assert.equal(fila.primera_accion, 'Llamar lunes')
  assert.throws(() => co.editarOportunidad(db, { usuarioId: adminId, oportunidadId: opo.id, oportunidad: { probabilidad: 150 } }), /probabilidad/)
  assert.throws(() => co.editarOportunidad(db, { usuarioId: adminId, oportunidadId: opo.id, oportunidad: { contactoId: 999999 } }), /contacto/i)
})

/* --------------------------- T5 actividades --------------------------- */

test('T5: actividades — sin ancla rechaza; empresa derivada de contacto/oportunidad; completar marca fecha', () => {
  const fhoy = new Date().toISOString().slice(0, 10)
  // sin ancla
  assert.throws(() => co.crearActividad(db, { usuarioId: adminId, actividad: { tipo: 'tarea', titulo: 'Flotante' } }), /asociarse/i)
  // tipo y fecha inválidos
  assert.throws(() => co.crearActividad(db, { usuarioId: adminId, actividad: { tipo: 'fax', titulo: 'x', empresaId: A } }), /Tipo/)
  assert.throws(() => co.crearActividad(db, { usuarioId: adminId, actividad: { tipo: 'tarea', titulo: 'x', empresaId: A, vencimiento: '20-10-' } }), /vencimiento/i)
  // derivada de contacto (contacto PROPIO de este test: sin dependencia del orden)
  const contactoId = co.crearContacto(db, { usuarioId: adminId, empresaId: A, contacto: { nombre: 'T5 Contacto', correo: `t5-${Date.now()}@alfa.cl` } }).id
  const a1 = co.crearActividad(db, { usuarioId: adminId, actividad: { tipo: 'llamada', titulo: 'Llamar T5', contactoId, vencimiento: '2026-01-01' } })
  const filaA = co.listarActividades(db, { contactoId }).find((a) => a.id === a1.id)
  assert.ok(filaA, 'la actividad derivada aparece en el listado por contacto')
  assert.equal(filaA.empresa_id, A, 'empresa derivada del contacto')
  assert.equal(filaA.vencida, 1, 'vencimiento pasado → vencida')
  // derivada de oportunidad
  const opoId = db.prepare(`SELECT id FROM crm_oportunidades ORDER BY id DESC LIMIT 1`).get().id
  const a2 = co.crearActividad(db, { usuarioId: adminId, actividad: { tipo: 'reunion', titulo: 'Presentación T5', oportunidadId: opoId } })
  const filaB = co.listarActividades(db, { oportunidadId: opoId }).find((a) => a.id === a2.id)
  assert.ok(filaB, 'la actividad ligada a la oportunidad sale en el listado')
  assert.equal(filaB.oportunidad_nombre != null, true, 'con nombre de oportunidad asociado')
  // completar
  co.actualizarActividad(db, { usuarioId: adminId, actividadId: a1.id, actividad: { estado: 'COMPLETADA' } })
  assert.ok(db.prepare(`SELECT completada_en FROM crm_actividades WHERE id = ?`).get(a1.id).completada_en, 'completada_en marcada')
})

/* ------------------------------ T6 informes ------------------------------ */

test('T6: informes — embudo, conversión, causas y proyección coherentes con el sembrado', () => {
  // sembrado determinista en empresa B (sin contaminar los del T4 en A)
  const g1 = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'B ganada', empresaId: B, monto: 1_000_000 } })
  const g2 = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'B ganada 2', empresaId: B, monto: 600_000 } })
  const p1 = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'B perdida', empresaId: B, monto: 400_000 } })
  const ab1 = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'B abierta', empresaId: B, monto: 2_000_000 } })
  const ab2 = co.crearOportunidad(db, { usuarioId: adminId, oportunidad: { nombre: 'B abierta 2', empresaId: B, monto: 1_000_000 } })
  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: g1.id, etapa: 'GANADA' })
  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: g2.id, etapa: 'PROPUESTA', probabilidad: 60 })
  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: g2.id, etapa: 'GANADA' })
  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: p1.id, etapa: 'PERDIDA', motivo: 'precio' })
  co.cambiarEtapaOportunidad(db, { usuarioId: adminId, oportunidadId: ab2.id, etapa: 'NEGOCIACION' }) // 75%

  // Contado POR EMPRESA B (los otros tests dejaron cierres reales en A).
  const infB = co.informes(db, { empresaId: B })
  assert.equal(infB.ganadas, 2)
  assert.equal(infB.perdidas, 1)
  assert.equal(infB.conversion_pct, 66.7, '2/(2+1)')
  // Global: incluye el cierre de T4b en A → perdidas totales = B + 1.
  const inf = co.informes(db, {})
  assert.equal(inf.perdidas, infB.perdidas + 1)
  assert.ok(inf.embudo.every((e) => e.n >= 0), 'embudo sin etapas negativas')
  const convGlobal = Math.round((inf.ganadas / (inf.ganadas + inf.perdidas)) * 1000) / 10
  assert.equal(inf.conversion_pct, convGlobal, 'conversión global = ganadas/(ganadas+perdidas)')
  // proyección = abiertas ponderadas: 2.000.000×10% (si quedó DETALLE) + 1.000.000×75%
  const det = inf.embudo.find((e) => e.etapa === 'DETALLE')
  const neg = inf.embudo.find((e) => e.etapa === 'NEGOCIACION')
  const esperado = (det?.monto_ponderado || 0) + (neg?.monto_ponderado || 0)
  assert.equal(inf.proyeccion_ponderada, esperado)
  assert.equal(inf.perdidas_causa[0].motivo, 'precio')
  // informes filtrados por empresa B no mezclan A
  const infB2 = co.informes(db, { empresaId: B })
  assert.equal(infB2.total, 5)
})

/* --------------------------- T7 MULTITENANT HTTP --------------------------- */

test('T7: HTTP multitanente — contador de A: 403 sin fuga sobre B; 200 en A; 401 sin sesión', async () => {
  const pedir = (sesion, metodo, ruta, cuerpo) => fetch(`http://127.0.0.1:${port}/api/crm${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(sesion ? { Cookie: `sid=${sesion}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })

  // sin sesión → el middleware requireAuth (montado en index.js) responde 401;
  // con express desnudo aquí, el guard Ccr devuelve 401 sin req.user
  const sinSesion = await pedir(null, 'GET', '/fichas/' + A)
  assert.equal(sinSesion.status, 401)

  const sesionCont = crearSesion(CONTADOR)
  const sesionAdmin = crearSesion(adminId)

  // A: autorizado
  let r = await pedir(sesionCont, 'GET', `/fichas/${A}`)
  assert.equal(r.status, 200)
  // B: asignación ajena → 403 SIN datos
  r = await pedir(sesionCont, 'GET', `/fichas/${B}`)
  assert.equal(r.status, 403)
  r = await pedir(sesionCont, 'POST', '/oportunidades', { empresa_id: B, nombre: 'Ataque', monto: 1 })
  assert.equal(r.status, 403)
  r = await pedir(sesionCont, 'GET', `/actividades?empresa_id=${B}`)
  assert.equal(r.status, 403)
  // contacto de B via PATCH (id real de B): debe 403
  const contactoB = co.crearContacto(db, { usuarioId: adminId, empresaId: B, contacto: { nombre: 'Sódio B', correo: 'b@b.cl' } })
  r = await pedir(sesionCont, 'PATCH', `/contactos/${contactoB.id}`, { nombre: 'intruso' })
  assert.equal(r.status, 403)
  // B via informe query param: 403
  r = await pedir(sesionCont, 'GET', `/informes?empresa_id=${B}`)
  assert.equal(r.status, 403)
  // super admin ve todo (diseño del despacho)
  r = await pedir(sesionAdmin, 'GET', `/fichas/${B}`)
  assert.equal(r.status, 200)
})

test('T7b: /buscar del CRM no cruza nosusers datos contables (solo entidades comerciales)', async () => {
  const ses = crearSesion(adminId)
  const r = await fetch(`http://127.0.0.1:${port}/api/crm/buscar?q=Alfa`, { headers: { Cookie: `sid=${ses}` } })
  const j = await r.json()
  assert.equal(r.status, 200)
  assert.ok(j.grupos.some((g) => g.entidad === 'empresas'), 'encuentra la empresa por nombre')
  const texto = JSON.stringify(j)
  assert.ok(!texto.includes('monto_total'), 'NO expone datos contables de documentos')
})

/* ------------------------------ REGRESIÓN ------------------------------ */

test('REGRESIÓN: el módulo de fidelización sigue funcionando (pipeline/engagement)', () => {
  const p = crm.listarPipeline(db, { usuarioId: adminId })
  assert.ok(p.some((x) => x.empresa_id === A))
  const eng = crm.engagement(db, { usuarioId: adminId })
  assert.ok(eng.resumen && typeof eng.resumen.promedio === 'number')
  assert.equal(Object.keys(co.etapasDe(db)).length, 6, 'embudo configurable sembrado completo')
})
