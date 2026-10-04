const express = require('express')
const db = require('../db')
const { cifrar, esCifrado } = require('../core/boveda')

const router = express.Router()

function validarRut(rut) {
  const clean = rut.replace(/[.\-]/g, '')
  if (clean.length < 8 || clean.length > 9) return false
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1).toUpperCase()

  let suma = 0
  let multiplo = 2
  for (let i = body.length - 1; i >= 0; i--) {
    suma += parseInt(body[i], 10) * multiplo
    multiplo = multiplo < 7 ? multiplo + 1 : 2
  }
  const dvEsperado = 11 - (suma % 11)
  const dvCalc = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado)
  return dv === dvCalc
}

function validarTasaPPM(tasa) {
  const n = Number(tasa)
  return Number.isFinite(n) && n >= 0 && n <= 1
}

function sanitizarTelefono(tel) {
  if (!tel) return ''
  return String(tel).replace(/\D/g, '')
}

function normalizarRut(rut) {
  const clean = rut.replace(/[.\-\s]/g, '').toUpperCase()
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  return `${body}-${dv}`
}

function toCliente(row) {
  return {
    id: row.id,
    rut: row.rut,
    nombre: row.nombre,
    tasa_ppm: row.tasa_ppm,
    telefono: row.telefono,
    exento: row.exento,
    activo: row.activo,
  }
}

router.get('/', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, rut, nombre, tasa_ppm, telefono, exento, activo
         FROM clientes WHERE activo = 1 AND user_id = ? ORDER BY nombre`
      )
      .all(req.user.id)
    res.json(rows.map(toCliente))
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/', (req, res) => {
  try {
    const { rut, nombre, clave_sii, tasa_ppm, telefono, exento } = req.body

    if (!rut || !nombre || !clave_sii || tasa_ppm === undefined || !telefono) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios' })
    }

    if (!validarRut(rut)) {
      return res.status(400).json({ ok: false, error: 'RUT inválido' })
    }
    if (!validarTasaPPM(tasa_ppm)) {
      return res.status(400).json({ ok: false, error: 'Tasa PPM inválida (debe ser decimal entre 0 y 1, ej: 0.015)' })
    }

    const telefonoSanitizado = sanitizarTelefono(telefono)
    if (!telefonoSanitizado || telefonoSanitizado.length < 8) {
      return res.status(400).json({ ok: false, error: 'Teléfono inválido (mínimo 8 dígitos)' })
    }

    const rutNorm = normalizarRut(rut)
    const existe = db
      .prepare('SELECT id FROM clientes WHERE rut = ? AND activo = 1 AND user_id = ?')
      .get(rutNorm, req.user.id)
    if (existe) {
      return res.status(409).json({ ok: false, error: 'Ya existe un cliente con ese RUT' })
    }

    // BLOQUE 1 (seguridad): la clave SII NUNCA se persiste en texto plano —
    // siempre a la bóveda (v1: AES-256-GCM). Si ya viniera cifrada, no se re-cifra.
    const claveAlmacenar = esCifrado(String(clave_sii)) ? String(clave_sii) : cifrar(String(clave_sii))

    const result = db
      .prepare(
        `INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, exento, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(rutNorm, nombre.trim(), claveAlmacenar, Number(tasa_ppm), telefonoSanitizado, exento ? 1 : 0, req.user.id)

    res.status(201).json({ ok: true, id: result.lastInsertRowid })
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ ok: false, error: 'Ya existe un cliente con ese RUT' })
    }
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const cliente = db
      .prepare('SELECT id FROM clientes WHERE id = ? AND activo = 1 AND user_id = ?')
      .get(id, req.user.id)
    if (!cliente) {
      return res.status(404).json({ ok: false, error: 'Cliente no encontrado' })
    }

    const { rut, nombre, clave_sii, tasa_ppm, telefono, exento } = req.body
    const campos = []
    const valores = []

    if (rut !== undefined) {
      if (!validarRut(rut)) {
        return res.status(400).json({ ok: false, error: 'RUT inválido' })
      }
      const rutNorm = normalizarRut(rut)
      const duplicado = db
        .prepare('SELECT id FROM clientes WHERE rut = ? AND activo = 1 AND id != ? AND user_id = ?')
        .get(rutNorm, id, req.user.id)
      if (duplicado) {
        return res.status(409).json({ ok: false, error: 'Ya existe un cliente con ese RUT' })
      }
      campos.push('rut = ?')
      valores.push(rutNorm)
    }
    if (nombre !== undefined) {
      campos.push('nombre = ?')
      valores.push(nombre.trim())
    }
    if (clave_sii !== undefined) {
      // BLOQUE 1 (seguridad): cifrar siempre en la bóveda (si ya viene v1:, no se re-cifra).
      campos.push('clave_sii = ?')
      valores.push(esCifrado(String(clave_sii)) ? String(clave_sii) : cifrar(String(clave_sii)))
    }
    if (tasa_ppm !== undefined) {
          if (!validarTasaPPM(tasa_ppm)) {
            return res.status(400).json({ ok: false, error: 'Tasa PPM inválida (debe ser decimal entre 0 y 1, ej: 0.015)' })
          }
          campos.push('tasa_ppm = ?')
          valores.push(Number(tasa_ppm))
        }
        if (telefono !== undefined) {
          const telefonoSanitizado = sanitizarTelefono(telefono)
          if (!telefonoSanitizado || telefonoSanitizado.length < 8) {
            return res.status(400).json({ ok: false, error: 'Teléfono inválido (mínimo 8 dígitos)' })
          }
          campos.push('telefono = ?')
          valores.push(telefonoSanitizado)
        }
    if (exento !== undefined) {
      campos.push('exento = ?')
      valores.push(exento ? 1 : 0)
    }

    if (campos.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay campos para actualizar' })
    }

    valores.push(id)
    db.prepare(`UPDATE clientes SET ${campos.join(', ')} WHERE id = ?`).run(...valores)

    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ ok: false, error: 'Ya existe un cliente con ese RUT' })
    }
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const result = db
      .prepare('UPDATE clientes SET activo = 0 WHERE id = ? AND activo = 1 AND user_id = ?')
      .run(id, req.user.id)

    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: 'Cliente no encontrado' })
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
