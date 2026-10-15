'use strict'
/**
 * Contacto desde la landing pública (rediseño 2026-10).
 *
 * La landing tiene un form «Agendar consulta»; este endpoint lo recibe
 * SIN autenticación (es la puerta comercial) con tres defensas:
 *   1. rate limit persistente por IP (rate-limit-db, 5/hora)
 *   2. honeypot anti-bot (campo 'web' debe venir vacío)
 *   3. validación server-side de los 4 campos con longitudes acotadas
 * Se guarda en contactos_web con la IP para auditoría. No envía correo
 * (la lectura del lead es operativa por JMV desde la BD; si luego se
 * requiere email/notificación, se agrega aparte).
 */
const express = require('express')
const router = express.Router()
const rlDb = require('../core/rate-limit-db')

const LIMITE = 5
const VENTANA_MS = 60 * 60 * 1000 // 1 hora

const corta = (v, max) => String(v || '').trim().slice(0, max)

router.post('/', rlDb.middleware('contacto-web', {
  limite: LIMITE,
  ventanaMs: VENTANA_MS,
  mensaje: 'Demasiados mensajes desde esta conexión. Escríbenos por WhatsApp al +56 9 7575 2213.',
}), (req, res) => {
  const db = require('../db')

  // Honeypot: bots rellenan todos los campos (incluidos los invisibles).
  if (corta(req.body.web, 200)) {
    // Respuesta de éxito fingida: al bot no le contamos y no guardamos nada.
    return res.json({ ok: true, mensaje: 'Mensaje recibido.' })
  }

  const nombre = corta(req.body.nombre, 120)
  const empresa = corta(req.body.empresa, 160)
  const contacto = corta(req.body.contacto, 160)
  const mensaje = corta(req.body.mensaje, 2000)

  const faltantes = []
  if (!nombre) faltantes.push('Nombre')
  if (!empresa) faltantes.push('Empresa')
  if (!contacto) faltantes.push('Teléfono o email')
  if (!mensaje) faltantes.push('Mensaje')
  if (faltantes.length) {
    return res.status(400).json({ ok: false, error: 'Faltan campos: ' + faltantes.join(', ') })
  }

  db.prepare(`
    INSERT INTO contactos_web (nombre, empresa, contacto, mensaje, ip)
    VALUES (?, ?, ?, ?, ?)
  `).run(nombre, empresa, contacto, mensaje, req.ip || null)

  res.status(201).json({
    ok: true,
    mensaje: 'Mensaje recibido. Te contactamos al día hábil siguiente.',
  })
})

module.exports = router
