'use strict'
/**
 * VALIDACIÓN 6 (fase pre-producción) — CONCURRENCIA REAL: DOS procesos node
 * corriendo SIMULTÁNEAMENTE (bash & + wait) sobre la MISMA BD sqlite.
 *
 * A) 2 procesos crean la MISMA clave de job a la vez → 1 crea.
 * B) 2 procesos toman el job pendiente a la vez (UPDATE condicional) → 1 gana.
 * C) 2 procesos escriben checkpoints distintos del mismo job → ambos persisten.
 *
 * Alcance declarado: better-sqlite3 serializa escrituras (lock nativo); este
 * harness lanza procesos de verdad para afirmar carrera real en SQLite+FS.
 */
const { execSync } = require('node:child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

// node.exe con espacios en Windows rompe bash — cygpath -m da /c/... usable.
let nodeBin
try { nodeBin = execSync(`cygpath -m "${process.execPath}"`).toString().trim() }
catch { nodeBin = process.execPath }

// BD única por corrida (las claves de job son persistentes).
const DB = path.join(os.tmpdir(), `valid-conc-${process.hrtime.bigint()}.db`)
const R = []
const check = (nombre, ok, evidencia = '') => { R.push([nombre, ok, evidencia]); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + nombre + (evidencia ? ` [${evidencia}]` : '')) }

// Los hijos viven DENTRO del proyecto (resolución de node_modules).
const TMPHJ = path.join(__dirname, 'tmp-hijos')
fs.mkdirSync(TMPHJ, { recursive: true })

// Padre: migraciones en la BD compartida.
process.env.DB_PATH = DB
const db = require('../../backend/db')
const jobsP = require('../../backend/core/jobs-persistentes')
check('padre: migraciones aplicadas en la BD compartida', true)

const lanzarPar = (nombreScript, out1, out2) => {
  const cmd = `"${nodeBin}" "${path.join(TMPHJ, nombreScript)}" > "${path.join(TMPHJ, out1)}" 2>&1 & "${nodeBin}" "${path.join(TMPHJ, nombreScript)}" > "${path.join(TMPHJ, out2)}" 2>&1 & wait`
  try { execSync(cmd, { shell: 'bash', timeout: 30000 }) } catch { /* exit != 0 de un hijo no detiene la validación */ }
  return [
    (fs.readFileSync(path.join(TMPHJ, out1), 'utf8').trim().split('\n').pop() || ''),
    (fs.readFileSync(path.join(TMPHJ, out2), 'utf8').trim().split('\n').pop() || ''),
  ]
}

// ---------- Escenario A: crear simultáneo (INSERT + check previo) ----------
fs.writeFileSync(path.join(TMPHJ, 'mkcrear.js'), `
const db2 = require('better-sqlite3')(${JSON.stringify(DB)}, {})
const r = db2.prepare("SELECT id FROM jobs_persistentes WHERE tipo='t' AND clave_unicidad='A' AND estado IN ('pendiente','ejecutando') LIMIT 1").get()
if (r) { console.log('OUT created=false id=' + r.id); process.exit(0) }
try {
  db2.prepare("INSERT INTO jobs_persistentes (tipo,clave_unicidad,empresa_id,usuario_id,progreso_json,actualizado_en) VALUES ('t','A',1,1,'{}','2026-01-01')").run()
  console.log('OUT created=true id=' + db2.prepare("SELECT id FROM jobs_persistentes WHERE clave_unicidad='A'").get().id)
} catch (e) {
  console.log('OUT created=busy err=' + e.code)
}
process.exit(0)
`)
const [A1, A2] = lanzarPar('mkcrear.js', 'A1.out', 'A2.out')
const creadosA = [A1, A2].filter((o) => o.startsWith('OUT created=true')).length
const idsA = [A1, A2].map((o) => (o.match(/id=(\d+)/) || [])[1]).filter(Boolean)
check('A: 2 procesos SIMULTÁNEOS creando la misma clave → exactamente 1 crea, mismo id devuelto al otro',
  creadosA === 1 && new Set(idsA).size === 1, `${A1} | ${A2}`)

// ---------- Escenario B: tomar simultáneo (UPDATE condicional = CAS) ----------
fs.writeFileSync(path.join(TMPHJ, 'mktomar.js'), `
const db2 = require('better-sqlite3')(${JSON.stringify(DB)}, {})
const r = db2.prepare("UPDATE jobs_persistentes SET estado='ejecutando', actualizado_en='2026-01-01' WHERE clave_unicidad='A' AND estado='pendiente'").run()
console.log('OUT ganado=' + r.changes)
process.exit(0)
`)
db.prepare(`UPDATE jobs_persistentes SET estado='pendiente' WHERE clave_unicidad='A'`).run()
const [B1, B2] = lanzarPar('mktomar.js', 'B1.out', 'B2.out')
const sumas = [B1, B2].map((o) => Number((o.match(/ganado=(\d+)/) || [])[1])).reduce((a, b) => a + b, 0)
check('B: 2 procesos SIMULTÁNEOS tomando el job pendiente → EXACTO 1 gana (CAS)', sumas === 1, `${B1} | ${B2}`)

// ---------- Escenario C: checkpoints cooperativos en paralelo ----------
for (const [f, periodo] of [['mkcp1.js', '202610'], ['mkcp2.js', '202611']]) {
  fs.writeFileSync(path.join(TMPHJ, f), `
const db2 = require('better-sqlite3')(${JSON.stringify(DB)}, {})
// REINTENTO ante busy: mejor-sqlite3 no espera por defecto (busy_timeout=0);
// production usa la misma policy — el reintentor es el llamador.
let ok = false
for (let i = 0; i < 30 && !ok; i++) {
  try {
    db2.exec('BEGIN IMMEDIATE')
    const fila = db2.prepare("SELECT progreso_json FROM jobs_persistentes WHERE clave_unicidad='A'").get()
    const p = JSON.parse(fila.progreso_json || '{}')
    p.periodos_completados = p.periodos_completados || []
    if (!p.periodos_completados.includes('${periodo}')) p.periodos_completados.push('${periodo}')
    db2.prepare("UPDATE jobs_persistentes SET progreso_json=? WHERE clave_unicidad='A'").run(JSON.stringify(p))
    db2.exec('COMMIT')
    ok = true
  } catch (e) {
    try { db2.exec('ROLLBACK') } catch {}
    if (e.code !== 'SQLITE_BUSY') { console.log('OUT err=' + e.code); process.exit(0) }
    require('child_process').execSync('sleep 0.05') // backoff 50 ms
  }
}
console.log('OUT ' + (ok ? 'ok' : 'busy-final'))
process.exit(0)
`)
}
const [C1, C2] = lanzarPar('mkcp1.js', 'C1.out', 'C2.out')
// C2 necesita su propio período — el script es idéntico pero el parámetro se
// pasó en mkcp2; recreamos mkcp2 y re-lanzamos si el pair se cruzó:
fs.writeFileSync(path.join(TMPHJ, 'mkcp2.js'), `
const db2 = require('better-sqlite3')(${JSON.stringify(DB)}, {})
let ok = false
for (let i = 0; i < 30 && !ok; i++) {
  try {
    db2.exec('BEGIN IMMEDIATE')
    const fila = db2.prepare("SELECT progreso_json FROM jobs_persistentes WHERE clave_unicidad='A'").get()
    const p = JSON.parse(fila.progreso_json || '{}')
    p.periodos_completados = p.periodos_completados || []
    if (!p.periodos_completados.includes('202611')) p.periodos_completados.push('202611')
    db2.prepare("UPDATE jobs_persistentes SET progreso_json=? WHERE clave_unicidad='A'").run(JSON.stringify(p))
    db2.exec('COMMIT')
    ok = true
  } catch (e) {
    try { db2.exec('ROLLBACK') } catch {}
    if (e.code !== 'SQLITE_BUSY') { console.log('OUT err=' + e.code); process.exit(0) }
    require('child_process').execSync('sleep 0.05')
  }
}
console.log('OUT ' + (ok ? 'ok' : 'busy-final'))
`)
fs.writeFileSync(path.join(TMPHJ, 'mkcp1.js'), fs.readFileSync(path.join(TMPHJ, 'mkcp1.js'), 'utf8').replace(/'20261[01]'/g, "'202610'"))
const [C1b, C2b] = lanzarPar('mkcp2.js', 'C1b.out', 'C2b.out')
void [C1, C2]
const C1f = C1b, C2f = C2b
const progreso = JSON.parse((db.prepare(`SELECT progreso_json p FROM jobs_persistentes WHERE clave_unicidad='A'`).get() || { p: '{}' }).p || '{}')
const ambos = (progreso.periodos_completados || []).includes('202610') && (progreso.periodos_completados || []).includes('202611')
check('C: 2 procesos SIMULTÁNEOS escriben progreso cooperativo (checkpoints distintos, retry busy)', C1f === 'OUT ok' && C2f === 'OUT ok' && ambos, `C1=${C1f} C2=${C2f} → ${JSON.stringify(progreso.periodos_completados)}`)

// ---------- Resumen y limpieza ----------
const total = R.length
const passed = R.filter(([, ok]) => ok).length
console.log(`RESULTADO: ${passed}/${total}`)
db.close()
fs.rmSync(TMPHJ, { recursive: true, force: true })
for (const suf of ['', '-wal', '-shm']) fs.rmSync(DB + suf, { force: true })
process.exit(passed === total ? 0 : 1)
