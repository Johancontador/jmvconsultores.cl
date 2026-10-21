/**
 * routes/salud.js — Consulta Salud Tributaria (montado en /api/contable).
 *
 * Lectura: SIEMPRE permitida con `salud:ver` (nunca se bloquea por licencia).
 * Sincronización: `salud:sincronizar`, exige licencia operativa (gate de
 * requirePermiso) porque escribe la ficha y el snapshot.
 *
 * Nada de lo que devuelve esta ruta se inventa: si una fuente no está
 * integrada, viaja como `no_integrado` en `capacidades_sii` / `declaraciones`.
 */
const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const { registrarAccion } = require('../core/auditoria')
const salud = require('../core/salud-tributaria')
const { leerFichaGuardada, consultarFichaSii } = require('../core/empresas-sii')

const router = express.Router()

const PERIODO_ACTUAL = () => {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Ventana máxima: 60 meses = 5 años, el techo de la Consulta Integral F29
// del SII (6 años hacia atrás, pero el año en curso va en meses).
function leerMeses(valor, defecto = 12) {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < 1) return defecto
  return Math.min(n, 60)
}

router.get('/salud-tributaria/capacidades', (req, res) => {
  res.json({ ok: true, capacidades_sii: salud.CAPACIDADES_SII })
})

router.get('/empresas/:empresaId/salud-tributaria', requirePermiso('salud:ver'), (req, res) => {
  try {
    const empresaId = req.empresaId
    const periodo = String(req.query.periodo || PERIODO_ACTUAL())
    if (!salud.periodoValido(periodo)) {
      return res.status(400).json({ ok: false, error: 'Período inválido (YYYYMM)' })
    }
    const meses = leerMeses(req.query.meses, 12)
    const emp = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)
    if (!emp) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' })

    const ficha = leerFichaGuardada(emp.rut)
    const informe = salud.construirInforme(db, { empresaId, periodo, meses, ficha })
    informe.ultimo_snapshot = salud.ultimoSnapshot(db, empresaId, periodo)
    res.json({ ok: true, informe })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/salud-tributaria/sincronizar', requirePermiso('salud:sincronizar'), async (req, res) => {
  const empresaId = req.empresaId
  const periodo = String(req.body.periodo || PERIODO_ACTUAL())
  if (!salud.periodoValido(periodo)) {
    return res.status(400).json({ ok: false, error: 'Período inválido (YYYYMM)' })
  }
  const meses = leerMeses(req.body.meses, 12)

  // 1) Ficha SII en vivo. Un fallo del SII NO borra lo que ya está guardado:
  // se informa la advertencia y el informe se arma con la ficha cacheada.
  let avisoFicha = null
  let ficha = null
  try {
    const r = await consultarFichaSii(db, { usuarioId: req.user.id, empresaId, ip: req.ip || null })
    ficha = r.datos
    registrarAccion(db, {
      empresaId, usuarioId: req.user.id,
      accion: 'salud.ficha_sincronizar', entidad: 'empresas', entidadId: String(empresaId),
      despues: {
        inicio_actividades: ficha.inicioActividades,
        regimen: ficha.regimen,
        alertas_sii: ficha.alertas.length,
      },
      ip: req.ip || null,
    })
  } catch (err) {
    avisoFicha = err.message
    const emp = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)
    ficha = emp ? leerFichaGuardada(emp.rut) : null
  }

  // 2) RCV opcional del período (reutiliza la ingesta existente; jamás llama
  // al SII por fuera de services/rcv.js).
  let ingestaJob = null
  let avisoRcv = null
  if (req.body.incluir_rcv) {
    try {
      const ingesta = require('../core/ingesta')
      ingestaJob = ingesta.iniciar(db, {
        empresaId,
        usuarioId: req.user.id,
        periodo,
        ip: req.ip || null,
      })
    } catch (err) {
      avisoRcv = err.message
    }
  }

  try {
    const informe = salud.construirInforme(db, { empresaId, periodo, meses, ficha })
    const snapshotId = salud.guardarSnapshot(db, {
      empresaId, periodo, usuarioId: req.user.id, informe,
    })
    registrarAccion(db, {
      empresaId, usuarioId: req.user.id,
      accion: 'salud.informe_generar', entidad: 'salud_tributaria_snapshots', entidadId: String(snapshotId),
      despues: { periodo, opinion: informe.opinion.nivel, score: informe.opinion.score },
      ip: req.ip || null,
    })
    res.json({
      ok: true,
      informe,
      snapshot_id: snapshotId,
      ficha: { sincronizada: !avisoFicha, advertencia: avisoFicha },
      rcv: ingestaJob ? { job_id: ingestaJob.jobId } : { iniciado: false, advertencia: avisoRcv },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, ficha: { sincronizada: false, advertencia: avisoFicha } })
  }
})

// Consulta de declaraciones OFICIALES al SII (F29 de 5 años, F22, juradas y
// boletas de honorarios). Es una acción larga: abre una sesión autenticada,
// recorre el portal y cierra sesión al terminar. Idempotente (UPSERT por
// empresa/tipo/período), por lo que repetirla no duplica datos.
router.post('/empresas/:empresaId/salud-tributaria/declaraciones', requirePermiso('salud:sincronizar'), async (req, res) => {
  const empresaId = req.empresaId
  const periodo = String(req.body.periodo || PERIODO_ACTUAL())
  if (!salud.periodoValido(periodo)) {
    return res.status(400).json({ ok: false, error: 'Período inválido (YYYYMM)' })
  }
  const anios = Math.min(Math.max(Number(req.body.anios) || 5, 1), 6)

  try {
    const declaraciones = require('../core/declaraciones-sii')
    const r = await declaraciones.sincronizar(db, {
      empresaId,
      usuarioId: req.user.id,
      periodo,
      anios,
      ip: req.ip || null,
    })
    registrarAccion(db, {
      empresaId, usuarioId: req.user.id,
      accion: 'salud.declaraciones_sincronizar', entidad: 'declaraciones_sii', entidadId: String(empresaId),
      despues: { periodo, anios, resultado: r.resultado },
      ip: req.ip || null,
    })
    // Se regenera el informe con las declaraciones recién leídas para que la
    // vista no tenga que hacer una segunda llamada.
    const emp = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)
    const ficha = emp ? leerFichaGuardada(emp.rut) : null
    const informe = salud.construirInforme(db, { empresaId, periodo, meses: 12 * anios, ficha })
    res.json({ ok: true, resultado: r.resultado, aviso: r.aviso || null, informe })
  } catch (err) {
    // 409 = tope de sesiones del SII (se resuelve cerrando sesiones, no
    // reintentando); 424 = al servidor le falta el navegador headless que lee
    // el portal (infraestructura, no credenciales); 502 = el SII falló.
    const code = err.codigo === 'SII_TOPE_SESIONES' ? 409
      : err.codigo === 'SII_SIN_NAVEGADOR' ? 424
        : 502
    res.status(code).json({ ok: false, codigo: err.codigo || null, error: err.message })
  }
})

module.exports = router
