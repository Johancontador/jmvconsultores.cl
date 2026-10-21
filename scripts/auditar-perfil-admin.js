#!/usr/bin/env node
/**
 * auditar-perfil-admin.js — auditoría y ajuste del perfil de administrador.
 *
 * Uso:
 *   node scripts/auditar-perfil-admin.js                 # solo audita (dry-run)
 *   node scripts/auditar-perfil-admin.js --aplicar --email=johan.morales.vasquez@gmail.com
 *   node scripts/auditar-perfil-admin.js --aplicar --dedupe
 *
 * Qué corrige (solo con --aplicar):
 *  - users.email del admin (si se pasa --email).
 *  - Asignaciones usuario_empresa REDUNDANTES: un super admin (is_admin=1) ya
 *    ve todas las empresas por rol global (empresas.asignacionesDeUsuario y
 *    centro-apps). Tener una fila por empresa no agrega acceso, confunde la
 *    auditoría y hace que una empresa nueva no aparezca hasta asignarla.
 *
 * SIEMPRE: copia de seguridad de la BD antes de escribir.
 */
'use strict'

const fs = require('fs')
const path = require('path')

require('dotenv').config()
process.env.DB_PATH = process.env.DB_PATH || './data/iva_mensual.db'
const db = require('../backend/db')
const { registrarAccion } = require('../backend/core/auditoria')

const args = process.argv.slice(2)
const aplicar = args.includes('--aplicar')
const dedupe = args.includes('--dedupe') || aplicar
const emailArg = (args.find((a) => a.startsWith('--email=')) || '').split('=')[1] || null

function emailValido(v) {
  return typeof v === 'string' && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v)
}

function backup() {
  const origen = path.resolve(process.env.DB_PATH)
  const dir = path.join(path.dirname(origen), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const destino = path.join(dir, `iva_mensual-pre-perfil-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  fs.copyFileSync(origen, destino)
  return destino
}

const admins = db.prepare(`SELECT id, username, email, is_admin, activo, creado_en FROM users WHERE is_admin = 1 ORDER BY id`).all()
if (!admins.length) {
  console.error('No hay usuarios is_admin=1. Nada que auditar.')
  process.exit(1)
}

console.log('=== PERFIL(ES) DE ADMINISTRADOR ===')
for (const a of admins) {
  const asig = db.prepare(`
    SELECT ue.empresa_id, ue.activo, r.codigo AS rol, e.nombre
    FROM usuario_empresa ue
    JOIN roles r ON r.id = ue.rol_id
    JOIN empresas e ON e.id = ue.empresa_id
    WHERE ue.usuario_id = ?
    ORDER BY e.nombre
  `).all(a.id)
  const totalEmpresas = db.prepare(`SELECT COUNT(*) c FROM empresas WHERE activo = 1`).get().c
  const redundantes = asig.filter((x) => x.rol === 'super_admin' && x.activo)
  const inactivas = asig.filter((x) => !x.activo)

  console.log(`\n#${a.id} ${a.username} · email=${a.email || '(sin email)'} · activo=${a.activo} · creado ${a.creado_en}`)
  console.log(`  Acceso efectivo: ${a.activo ? 'TODAS las empresas activas' : 'NINGUNO (inactivo)'} (${totalEmpresas} activas por rol global)`)
  console.log(`  Asignaciones explícitas: ${asig.length} (${redundantes.length} redundantes super_admin, ${inactivas.length} inactivas)`)
  if (redundantes.length) {
    console.log('  Redundantes (no otorgan acceso adicional):')
    for (const r of redundantes) console.log(`   - empresa ${r.empresa_id} ${r.nombre}`)
  }
  if (!emailValido(a.email) && !(emailArg && a.id === admins[0].id)) {
    console.log('  ⚠ email del perfil ausente o inválido: el login solo funciona por username.')
  }
}

// Correo propuesto para el admin principal (id más bajo).
const principal = admins[0]
const emailObjetivo = emailArg || (emailValido(principal.email) ? null : null)
if (emailArg && !emailValido(emailArg)) {
  console.error(`\nERROR: --email inválido: ${emailArg}`)
  process.exit(1)
}
if (emailArg) {
  const choque = db.prepare(`SELECT id, username FROM users WHERE lower(email) = lower(?) AND id <> ?`).get(emailArg, principal.id)
  if (choque) {
    console.error(`\nERROR: el correo ${emailArg} ya está asignado al usuario ${choque.username} (#${choque.id}).`)
    process.exit(1)
  }
}

console.log('\n=== DIAGNÓSTICO ===')
console.log(`- Login por correo: ${emailValido(principal.email) || emailArg ? 'habilitado' : 'no habilitado (email vacío)'} (routes/auth.js acepta username o email).`)
console.log('- Las filas super_admin por empresa son redundantes: el rol es global (is_admin).')
console.log('- No se toca ninguna clave, sesión ni empresa. Solo email y asignaciones redundantes.')

if (!aplicar) {
  console.log('\nModo auditoría (sin cambios). Para aplicar:')
  console.log(`  node scripts/auditar-perfil-admin.js --aplicar --dedupe${emailArg ? ` --email=${emailArg}` : ''}`)
  db.close()
  process.exit(0)
}

const respaldo = backup()
console.log(`\nRespaldo: ${respaldo}`)

const tx = db.transaction(() => {
  let emails = 0
  let borradas = 0
  if (emailArg) {
    db.prepare(`UPDATE users SET email = ? WHERE id = ?`).run(emailArg, principal.id)
    emails = 1
    registrarAccion(db, {
      empresaId: null, usuarioId: principal.id,
      accion: 'perfil.email_actualizar', entidad: 'users', entidadId: String(principal.id),
      antes: { email: principal.email || null }, despues: { email: emailArg }, ip: null,
    })
  }
  if (dedupe) {
    for (const a of admins) {
      const r = db.prepare(`
        DELETE FROM usuario_empresa
        WHERE usuario_id = ? AND activo = 1
          AND rol_id = (SELECT id FROM roles WHERE codigo = 'super_admin')
      `).run(a.id)
      borradas += r.changes
    }
    if (borradas) {
      registrarAccion(db, {
        empresaId: null, usuarioId: principal.id,
        accion: 'perfil.asignaciones_redundantes_eliminar', entidad: 'usuario_empresa',
        entidadId: String(principal.id), despues: { filas_eliminadas: borradas }, ip: null,
      })
    }
  }
  return { emails, borradas }
})

const r = tx()
console.log('\n=== APLICADO ===')
console.log(`  email actualizado: ${r.emails}`)
console.log(`  asignaciones redundantes eliminadas: ${r.borradas}`)
const despues = db.prepare(`SELECT id, username, email, is_admin, activo FROM users WHERE id = ?`).get(principal.id)
console.log('  perfil final:', JSON.stringify(despues))
db.close()
