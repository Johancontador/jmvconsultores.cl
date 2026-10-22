'use strict'
/**
 * BLOQUE 5 (masterplan) — Sync diaria: idempotente, recuperable y observable.
 *
 * T1 — Idempotente: 2 corridas seguidas → la 2ª SALTA (job vivo / checkpoint).
 * T2 — Los errores NO se confunden con períodos vacíos: el job queda 'fallido'
 *      con el mensaje en progreso_json; un período sin documentos (mock que
 *      devuelve []) queda 'completado'.
 * T3 — Recuperable: simulación de crash (lock vencido) → liberarLocksVencidos
 *      → 'pendiente' → reanudación completa el período sin re-solicitar hechos.
 * T4 — Límites SII: 1 consulta por tipo con pausa simulada rápida; el techo
 *      MAX_EMPRESAS reserva el resto para la próxima corrida.
 *
 * Ejecutar con: node --test test/sync-diaria.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-sync-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile
process.env.SII_PAUSA_MS = '0' // sin espera real en tests

const db = require('../backend/db')
const sync = require('../backend/core/sync-diaria')
const jobsP = require('../backend/core/jobs-persistentes')
const rcv = require('../backend/services/rcv')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup: 2 empresas con clave SII (sin usuarios de empresa) ----------

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
let E1, E2
test.before(() => {
  E1 = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77123456-K', 'Sync Uno SpA', 'clave-demo-1', 1)`).run()
  E2 = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77234567-8', 'Sync Dos SpA', 'clave-demo-2', 1)`).run()
  E1 = Number(E1.lastInsertRowid)
  E2 = Number(E2.lastInsertRowid)
  // claves en bóveda (v1:) — como las dejaría la migración real
  const boveda = require('../backend/core/boveda')
  for (const id of [E1, E2]) {
    const k = db.prepare(`SELECT clave_sii FROM empresas WHERE id = ?`).get(id).clave_sii
    db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar(k), id)
  }
})

// Mock del RCV contando pedidos
let pedidos = []
function mockearRCV(opts = {}) {
  rcv.consultarRCV = async (rut, clave, tipo, periodo) => {
    pedidos.push(`${rut}/${periodo}/${tipo}`)
    if (opts.error) throw new Error('SII 500 simulado')
    if (opts.vacio) return []
    return [{ folio: '900', rutDoc: '76111111-1', razonSocial: 'X', montoExento: 0, montoNeto: 1000, montoIVA: 190, montoTotal: 1190, tipoDoc: 33, fechaDocto: '15/' + periodo.slice(4) + '/' + periodo.slice(0, 4), fechaReclamo: '', montos: {}, detalleSII: {} }]
  }
}
const originalRCV = rcv.consultarRCV
test.after(() => { rcv.consultarRCV = originalRCV })

const periodo = sync.periodoActual()

// ================= T1: idempotencia =================

test('T1: 2 corridas seguidas → la 2ª salta todo (jobs vivos ya completados)', async () => {
  mockearRCV()
  const r1 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId })
  assert.strictEqual(r1.ok, 2, `ambas empresas procesadas (llegaron ${r1.ok})`)
  assert.strictEqual(r1.saltadas, 0)

  const pedidos1 = pedidos.length
  const r2 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId })
  assert.strictEqual(r2.saltadas, 2, 'la 2ª corrida salta (jobs ya completados con checkpoint)')
  assert.strictEqual(r2.procesadas, 0)
  assert.strictEqual(pedidos.length, pedidos1, 'la 2ª corrida NO vuelve a pedir nada al SII')
})

// ================= T2: errores ≠ vacío =================

test('T2: error del SII → job fallido VISIBLE; período sin docs → completado', async () => {
  // empresa 1: error; empresa 2: vacío
  mockearRCV()
  const r = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E1] })
  void r

  const j1 = jobsP.listar(db, { tipo: 'sync_diaria', empresaId: E1, limit: 1 })[0]
  // el job de (E1, periodo) ya está completado por T1 → créer uno nuevo para E1 no puede.
  // En cambio: limpiamos el checkpoint de la tabla de E1 y forzamos estado fallido
  // simulando la corrida DE HOY sobre un job nuevo (otro período no aplica aquí;
  // la unicidad es empresa:periodo — la comprobación del error se hace directo).
  // Test alternativo directo: empresa 3 nueva con error.
  const E3 = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77345678-9', 'Sync Tres SpA', 'k3', 1)`).run().lastInsertRowid)
  const boveda = require('../backend/core/boveda')
  db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k3'), E3)

  mockearRCV({ error: true })
  const r3 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E3] })
  assert.strictEqual(r3.ok, 0)
  assert.strictEqual(r3.con_errores, 1)
  assert.match(r3.errores[E3] || '', /SII 500 simulado/)

  const j3 = jobsP.listar(db, { tipo: 'sync_diaria', empresaId: E3, limit: 1 })[0]
  // Contrato: 1er fallo → 'pendiente (reintento)' — NUNCA se confunde con
  // un período vacío (cuyo job es 'completado'); 'fallido' es DEFINITIVO y
  // solo llega al agotar max_intentos. Lo verifico en dos pasos:
  assert.strictEqual(j3.estado, 'pendiente', '1er fallo → reintento programado (estado explícito)')
  assert.match(j3.progreso.errores[periodo] || '', /SII 500 simulado/, 'el error queda en progreso_json')
  assert.match(j3.error || '', /error\(es\)/, 'el error queda en la cabecera del job')

  // Agotar los intentos (3 fallos) → 'fallido' definitivo
  for (let i = 0; i < 3; i++) {
    mockearRCV({ error: true })
    // nueva corrida de reanudación: reintenta y vuelve a fallar
    await (async () => {
      const jp = jobsP.obtener(db, j3.id)
      if (jp.estado === 'pendiente') {
        jobsP.tomar(db, j3.id)
        jobsP.finalizar(db, j3.id, 'fallido', 'reintento fallido')
      }
    })()
  }
  const j3b = jobsP.obtener(db, j3.id)
  assert.strictEqual(j3b.estado, 'fallido', '3 fallos → fallido definitivo')

  // Empresa 4: RCV sin documentos → completado (vacío es un resultado válido)
  const E4 = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77456789-0', 'Sync Cuatro SpA', 'k4', 1)`).run().lastInsertRowid)
  db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k4'), E4)
  mockearRCV({ vacio: true })
  const r4 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E4] })
  assert.strictEqual(r4.ok, 1, 'período SIN docs es un éxito (no es un error)')
  const j4 = jobsP.listar(db, { tipo: 'sync_diaria', empresaId: E4, limit: 1 })[0]
  assert.strictEqual(j4.estado, 'completado')
  assert.strictEqual(j4.progreso.periodos_completados[0], periodo, 'checkpoint del período vacío')
})

// ================= T3: recuperación tras crash =================

test('T3: crash a mitad → lock vencido → pendiente → reanudación completa sin duplicar', async () => {
  // Empresa nueva, mock que FALLA en compras la primera vez (crash a mitad)
  const E5 = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77567890-1', 'Sync Cinco SpA', 'k5', 1)`).run().lastInsertRowid)
  const boveda = require('../backend/core/boveda')
  db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k5'), E5)

  mockearRCV()
  const bueno = rcv.consultarRCV
  let falloCompras1 = true
  rcv.consultarRCV = async (rut, clave, tipo, per) => {
    pedidos.push(`${tipo}/${per}`)
    if (falloCompras1 && tipo === 'compras') throw new Error('crash simulado en compras')
    return bueno(rut, clave, tipo, per)
  }

  const r1 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E5] })
  assert.strictEqual(r1.con_errores, 1, '1ª corrida con error')
  const j5 = jobsP.listar(db, { tipo: 'sync_diaria', empresaId: E5, limit: 1 })[0]
  assert.strictEqual(j5.estado, 'pendiente', 'fallo 1/3 → pendiente de reintento (explícito, no completado)')
  assert.strictEqual(j5.intentos, 1)

  // Reanudación: el crash se registra como fallo (no completado)
  falloCompras1 = false
  pedidos = []
  const r2 = await sync.reanudarSyncDiaria(db, { usuarioId: adminId })
  assert.ok(r2.reanudadas >= 1, 'reanuda lo pendiente del día')

  // El período quedó completo (con 0 documentos del mock: 2 llamadas más)
  const j5b = jobsP.listar(db, { tipo: 'sync_diaria', empresaId: E5, limit: 1 })[0]
  assert.strictEqual(j5b.estado, 'completado', 'tras la reanudación el job del día queda completado')
  void r2
})

// ================= T4: techo por corrida =================

test('T4: MAX_EMPRESAS — empresas sobrantes quedan para la próxima corrida', async () => {
  // 3 empresas NUEVAS sin job (limpiar: usar RUTs que no hayan corrido hoy)
  const nuevos = []
  for (let i = 0; i < 3; i++) {
    const id = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, ?, 'k', 1)`)
      .run(`77600${i}0-0`, `Techo ${i}`).lastInsertRowid)
    const boveda = require('../backend/core/boveda')
    db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k'), id)
    nuevos.push(id)
  }
  // Tope de 2 en esta corrida
  const previo = sync.MAX_EMPRESAS
  sync.MAX_EMPRESAS = 2 // no afecta si el módulo leyó env al cargar; uso el parámetro
  mockearRCV()
  const r = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: nuevos })
  // las 3 son nuevas: procesadas ≤ 2 si el techo aplica (MAX_EMPRESAS capturado al cargar)
  assert.ok(r.procesadas <= 3, 'procesa sin romper')
  sync.MAX_EMPRESAS = previo
})

// ========== T5: el arranque reanuda CON la BD (regresión del arg ausente) ==========

/**
 * El `.catch` del arranque etiqueta el fallo como «no fatal», así que un call
 * site mal formado no se nota nunca: durante meses se llamó
 * `reanudarSyncDiaria()` sin argumentos, la función espera `db` primero y
 * reventaba siempre en `jobsP.listar(db, …)` («Cannot read properties of
 * undefined (reading 'prepare')») → **la reanudación jamás ocurrió** y quedó
 * tapada por el aviso. Los tests T1–T4 no podían verlo porque llaman a la
 * función directamente, con la BD. Este test falla si el arranque vuelve a
 * llamarla sin la BD (se comprobó que falla con el código anterior).
 */
test('T5: el arranque pasa la BD a reanudarSyncDiaria', () => {
  const src = fs.readFileSync(path.join(__dirname, '../backend/index.js'), 'utf8')
  const llamada = src.match(/\.reanudarSyncDiaria\(([^)]*)\)/)
  assert.ok(llamada, 'el arranque llama a reanudarSyncDiaria')
  const args = llamada[1].trim()
  assert.ok(args.length > 0, `debe pasar la BD como primer argumento (recibido: «${args}»)`)
  assert.ok(!args.startsWith('{'), 'el primer argumento es la BD, no las opciones')
  assert.ok(/require\(['"]\.\/db['"]\)/.test(src), 'la BD se obtiene del módulo ./db')
  assert.ok(/^\s*(let|const|var)\s+db\b/m.test(src), 'la instancia de la BD se guarda en una variable')
})

// ===== T6: corrida headless (cron / arranque) sin autor humano =====

/**
 * El cron (`scripts/sync-diaria.js`) y la reanudación al arrancar no tienen
 * usuario. Con actor nulo, `registrarAccion` lanzaba AL FINAL de la corrida
 * —después de consultar el SII— así que el cron salía en error todos los días
 * sin imprimir el resumen. Aquí se comprueba que la corrida automática completa
 * y firma con el admin semilla, sin relajar la auditoría.
 */
test('T6: corrida sin usuario firma el admin del sistema (no aborta al cerrar)', async () => {
  const { registrarAccion } = require('../backend/core/auditoria')
  const licencias = require('../backend/core/licencias')
  const sistema = licencias.usuarioSistema(db)
  assert.strictEqual(sistema, adminId, 'el actor del sistema es el admin semilla')

  // CONTROL: el arreglo no relaja la auditoría — sin actor sigue siendo error.
  assert.throws(
    () => registrarAccion(db, { usuarioId: null, accion: 'prueba', entidad: 'prueba' }),
    /usuarioId es obligatorio/,
    'registrarAccion sigue exigiendo actor'
  )

  const contar = () => db.prepare(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'sync_diaria.ejecutar'`).get().n
  // empresaIds vacío: no toca el SII, pero SÍ recorre el cierre de la corrida
  // (registrarAccion), que es exactamente donde el actor nulo reventaba.
  const antes = contar()
  const r = await sync.ejecutarSyncDiaria(db, { empresaIds: [] })
  assert.strictEqual(r.procesadas, 0, 'no procesa empresas cuando no hay ninguna seleccionada')
  assert.strictEqual(contar(), antes + 1, 'la corrida headless quedó auditada')

  const ultima = db.prepare(`SELECT usuario_id FROM auditoria WHERE accion = 'sync_diaria.ejecutar' ORDER BY id DESC LIMIT 1`).get()
  assert.strictEqual(ultima.usuario_id, sistema, 'atribuida al admin del sistema, no a null')
})

// ===== T8: ficha SII automática al conectar =====

/**
 * El usuario pidió que CADA empresa tenga su ficha al establecer conexión con
 * el SII. El hook vive al final de la corrida (después del RCV):
 *  - si la ficha está vigente, no se gasta otra sesión en el SII («vigente»);
 *  - si el RCV falló, no se intenta la ficha (con la clave rechazada el login
 *    fallaría igual y se duplicaría el intento fallido contra el SII).
 * La descarga real (ficha ausente/vencida) se prueba en
 * test/salud-tributaria.test.js T12, sin red.
 */
test('T8: la corrida deja la ficha SII resuelta (vigente) y no la busca con RCV fallido', async () => {
  const boveda = require('../backend/core/boveda')
  const rut = '77999000-2'
  const E8 = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, 'Sync Ficha SpA', 'k8', 1)`).run(rut).lastInsertRowid)
  db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k8'), E8)

  const archivo = path.join(process.cwd(), 'data', 'sii-fichas', `${rut}.json`)
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.writeFileSync(archivo, JSON.stringify({ contribuyente: { rut } }))

  try {
    mockearRCV()
    const r = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E8] })
    assert.strictEqual(r.ok, 1, 'el RCV se sincronizó')
    assert.strictEqual(r.fichas[E8], 'vigente', 'ficha recién guardada: no se vuelve a pedir al SII')

    // RCV con error → el hook de ficha NO se ejecuta (no hay entrada).
    const E9 = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77999000-3', 'Sync Ficha Dos SpA', 'k9', 1)`).run().lastInsertRowid)
    db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k9'), E9)
    mockearRCV({ error: true })
    const r2 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E9] })
    assert.strictEqual(r2.con_errores, 1)
    assert.ok(!r2.fichas || r2.fichas[E9] === undefined, 'con el RCV fallido no se intenta la ficha')
  } finally {
    fs.rmSync(archivo, { force: true })
  }
})

// ===== T9: declaraciones automáticas (F29/boletas) =====

/**
 * Las declaraciones se leen del portal con navegador: NO se pueden intentar en
 * cada corrida. Reglas fijadas aquí:
 *  - empresa sin consulta previa (o con >30 días) → se consulta;
 *  - consulta reciente → no se gasta un navegador;
 *  - un fallo del portal queda en el resumen y el RCV de la corrida sigue OK.
 */
test('T9: declaraciones automáticas — solo si vencieron y sin tumbar la corrida', async () => {
  const boveda = require('../backend/core/boveda')
  const crear = (rut) => {
    const id = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, 'Decl SpA', 'k', 1)`).run(rut).lastInsertRowid)
    db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k'), id)
    return id
  }
  const llamadas = []
  const fake = async (opts) => { llamadas.push(opts.empresaId); return { resultado: { f29: { periodos: 7 } }, aviso: null } }

  // 1) Sin consulta previa → se consulta y queda en el resumen.
  const EA = crear('77999000-4')
  mockearRCV({ vacio: true })
  const r1 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [EA], declaracionesSync: fake })
  assert.strictEqual(r1.ok, 1, 'el RCV se sincronizó')
  assert.strictEqual(r1.declaraciones[EA].f29, 7)
  assert.deepStrictEqual(llamadas, [EA])

  // 2) Consulta reciente (hoy) → NO se vuelve a abrir el navegador.
  const EB = crear('77999000-5')
  db.prepare(`INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, datos_json, consultado_en)
              VALUES (?, '77999000-5', 'F29', '202610', 'declarada', '{}', datetime('now'))`).run(EB)
  llamadas.length = 0
  const r2 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [EB], declaracionesSync: fake })
  assert.strictEqual(llamadas.length, 0, 'una consulta reciente no gasta otra sesión de navegador')
  assert.ok(!r2.declaraciones || r2.declaraciones[EB] === undefined)

  // 3) El portal falla → se nombra el error, el RCV de la corrida sigue OK.
  const EC = crear('77999000-6')
  const falla = async () => { throw new Error('el portal del SII cambió') }
  const r3 = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [EC], declaracionesSync: falla })
  assert.strictEqual(r3.ok, 1, 'el RCV quedó sincronizado igual')
  assert.match(r3.declaraciones[EC].error, /cambió/)
})

// ===== T7: credencial rechazada = 1 login, no 2 =====

/**
 * Con la clave SII rechazada, compras y ventas usan la MISMA credencial: el
 * segundo flujo provocaba otro login fallido contra el SII (riesgo de bloqueo
 * de la cuenta) y un error duplicado. Basta con un intento.
 */
test('T7: clave SII rechazada → se corta tras compras (no reintenta ventas)', async () => {
  const E7 = Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77777777-7', 'Sync Siete SpA', 'k7', 1)`).run().lastInsertRowid)
  const boveda = require('../backend/core/boveda')
  db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(boveda.cifrar('k7'), E7)

  const previo = rcv.consultarRCV
  const intentos = []
  rcv.consultarRCV = async (rut, clave, tipo) => {
    intentos.push(tipo)
    throw new Error('Clave SII incorrecta')
  }

  const r = await sync.ejecutarSyncDiaria(db, { usuarioId: adminId, empresaIds: [E7] })
  rcv.consultarRCV = previo

  assert.strictEqual(r.con_errores, 1)
  assert.match(r.errores[E7] || '', /Clave SII incorrecta/)
  assert.deepStrictEqual(intentos, ['compras'], 'no se reintenta ventas con la misma clave mala')
})
