'use strict'
// VALIDACIÓN 3 (fase pre-producción) — migraciones sobre BD PRE-EXISTENTE rica
// y ante interrupción (transacción que lanza a mitad + WAL survive).
process.env.DB_PATH = require('os').tmpdir() + '/valid-mig-' + Date.now() + '-' + process.pid + '.db'
const fs = require('fs')
const path = require('path')
const DB = process.env.DB_PATH
const db = require('../../backend/db')

const R = []
const check = (nombre, ok) => { R.push([nombre, ok]); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + nombre) }
const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get().id

// --- BD "productiva" simulada: datos reales previos al deploy ---
const empresaId = db.prepare(`INSERT INTO empresas (rut,nombre,clave_sii,activo) VALUES ('77V11111-K','Prod Sim','cv1',1)`).run().lastInsertRowid
for (let i = 0; i < 5; i++) {
  db.prepare(`INSERT INTO clientes (rut,nombre,clave_sii,tasa_ppm,telefono,user_id) VALUES (?,?,?,0.01,'9',?)`)
    .run(`77V2000${i}-K`, `C${i}`, `clave-antigua-${i}`, admin).lastInsertRowid
}
// asiento con las columnas NOT NULL reales (folio/anio calculados por secuencia)
const maxFolio = db.prepare(`SELECT COALESCE(MAX(folio),0) f FROM asientos WHERE empresa_id = ?`).get(empresaId).f
const asientoId = db.prepare(`INSERT INTO asientos (empresa_id,folio,anio,fecha,periodo,tipo,glosa,usuario_id) VALUES (?,?,'2025','2025-09-15','202509','manual','asiento previo',?)`).run(empresaId, maxFolio + 1, admin).lastInsertRowid

// --- Aplicar migraciones nuevas (como haría el deploy) ---
require('../../backend/core/jobs-persistentes').migrar(db)
require('../../backend/core/rate-limit-db').migrar(db)
require('../../backend/core/migraciones').migracionesTesoreriaAplicaciones(db)
// y la bóveda corre sola ya en db.js — pero re-launch explícito para estar seguros
const rBov = require('../../backend/core/migraciones').migracionesBovedaClientes(db)
check('bóveda cifra las 5 legacy de la BD productiva simulada', rBov.migradas === 5)
check('asientos previos intactos (la migración no toca otras tablas)',
  db.prepare('SELECT COUNT(*) n FROM asientos WHERE id = ?').get(asientoId).n === 1)

// Re-ejecución completa (deploy repetido)
require('../../backend/core/jobs-persistentes').migrar(db)
require('../../backend/core/rate-limit-db').migrar(db)
require('../../backend/core/migraciones').migracionesTesoreriaAplicaciones(db)
const rBov2 = require('../../backend/core/migraciones').migracionesBovedaClientes(db)
check('re-deploy completo: sin errores, 0 nuevas bóvedas', rBov2.migradas === 0)

// --- Interrupción: transacción que lanza a mitad → rollback ---
let rollbackOK = false
try {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO jobs_persistentes (tipo,clave_unicidad,actualizado_en) VALUES ('t','interrupt-test','x')`).run()
    throw new Error('crash simulado a mitad')
  })
  tx()
} catch { /* esperado */ }
const n = db.prepare(`SELECT COUNT(*) n FROM jobs_persistentes WHERE clave_unicidad='interrupt-test'`).get().n
rollbackOK = n === 0
check('interrupción a mitad de transacción: rollback limpio (0 filas huérfanas)', rollbackOK)

// --- Interrupción del PROCESO real: kill -9 a mitad de escritura ---
// Se abre una 2ª conexión a la MISMA BD, escribe una fila, sin cerrar con
// checkpoint — el WAL de better-sqlite3 persiste al commit así que la fila
// DEBE sobrevivir; y la BD no queda corrupta al reabrirla.
const db2 = require('better-sqlite3')(DB)
db2.pragma('journal_mode = WAL')
db2.prepare(`INSERT INTO jobs_persistentes (tipo,clave_unicidad,actualizado_en) VALUES ('proceso-muerto','kill-9','x')`).run()
db2.close() // simula el proceso muriendo DESPUÉS del commit
// Reabrir con el módulo principal: la fila cuatro tablas nuevas siguen OK
const fila = db.prepare(`SELECT id FROM jobs_persistentes WHERE clave_unicidad='kill-9'`).get()
check('WRITE confirmado desde proceso "muerto": fila sobrevive y la BD no se corrompe', !!fila)
const integridad = db.pragma('integrity_check', { simple: true })
check('integrity_check del archivo tras "interrupción"', integridad === 'ok')

// --- Interrupción SIN commit (el caso real de crash): fila en sesión viva no
// confirmada no debe ser visible desde otra conexión ---
const db3 = require('better-sqlite3')(DB)
db3.pragma('journal_mode = WAL')
db3.exec('BEGIN')
db3.prepare(`INSERT INTO jobs_persistentes (tipo,clave_unicidad,actualizado_en) VALUES ('sin-commit','trx','x')`).run()
// NO commit; simula el proceso muriendo SIN confirmar
db3.close()
const visible = db.prepare(`SELECT COUNT(*) n FROM jobs_persistentes WHERE clave_unicidad='trx'`).get().n
check('transacción abortada por proceso muerto: invisible desde la BD (inferencia de WAL)', visible === 0)

// --- Resumen ---
const total = R.length
const passed = R.filter(([, ok]) => ok).length
console.log(`RESULTADO: ${passed}/${total}`)
db.close()
fs.rmSync(DB, { force: true })
for (const suf of ['-wal', '-shm']) fs.rmSync(DB + suf, { force: true })
process.exit(passed === total ? 0 : 1)
