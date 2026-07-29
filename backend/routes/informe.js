const express = require('express')
const { iniciarInforme, obtenerEstado, generarPeriodos, guardarInformeEnBD, cargarInformeDeBD, listarInformesDeBD, eliminarInformeDeBD, informes } = require('../services/informe')
const { generarPeriodos: genPeriodos, agruparPorAnio, calcularResumenGlobal } = require('../services/calculos')

const router = express.Router()

router.post('/generar', (req, res) => {
  try {
    const { cliente_id, anio_inicio, anio_fin, modo, mes_inicio, mes_fin } = req.body

    if (!cliente_id || !anio_inicio || !anio_fin) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros obligatorios' })
    }

    const inicio = Number(anio_inicio)
    const fin = Number(anio_fin)
    const mesDesde = mes_inicio ? Number(mes_inicio) : 1
    const mesHasta = mes_fin ? Number(mes_fin) : 12

    if (inicio < 2020 || fin > 2030 || inicio > fin) {
      return res.status(400).json({ ok: false, error: 'Rango de años inválido' })
    }
    if (mesDesde < 1 || mesDesde > 12 || mesHasta < 1 || mesHasta > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido (1-12)' })
    }
    if (inicio === fin && mesDesde > mesHasta) {
      return res.status(400).json({ ok: false, error: 'El mes de inicio debe ser menor o igual al de fin dentro del mismo año' })
    }

    const modoInforme = modo === 'detalle' ? 'detalle' : 'resumen'
    const { informeId, consultasEstimadas, totalMeses } = iniciarInforme(
      Number(cliente_id),
      inicio,
      fin,
      modoInforme,
      mesDesde,
      mesHasta,
      req.user.id
    )

    res.status(202).json({
      ok: true,
      informe_id: informeId,
      consultas_estimadas: consultasEstimadas,
      total_meses: totalMeses,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.get('/estimacion', (req, res) => {
  try {
    const inicio = Number(req.query.anio_inicio)
    const fin = Number(req.query.anio_fin)
    const mesDesde = req.query.mes_inicio ? Number(req.query.mes_inicio) : 1
    const mesHasta = req.query.mes_fin ? Number(req.query.mes_fin) : 12
    if (!inicio || !fin) {
      return res.status(400).json({ ok: false, error: 'Parámetros inválidos' })
    }
    const periodos = generarPeriodos(inicio, fin, mesDesde, mesHasta)
    res.json({
      ok: true,
      total_meses: periodos.length,
      consultas_estimadas: periodos.length * 2,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.get('/:informe_id/estado', (req, res) => {
  try {
    // Primero intenta desde memoria (procesando)
    let estado = obtenerEstado(req.params.informe_id, req.user.id)

    // Si no está en memoria, intenta cargar de BD (completados)
    if (!estado) {
      estado = cargarInformeDeBD(req.params.informe_id, req.user.id)
    }

    if (!estado) {
      return res.status(404).json({ ok: false, error: 'Informe no encontrado' })
    }

    // Si está completado y no estaba en memoria, guardamos en memoria para próximos polls
        if (estado.estado === 'completado' && !informes.has(req.params.informe_id)) {
          const okMeses = estado.meses.filter(m => m.estado === 'ok')
          estado.por_anio = agruparPorAnio(okMeses)
          estado.resumen = calcularResumenGlobal(okMeses)
          informes.set(req.params.informe_id, estado)
        }

    res.json({ ok: true, ...estado })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Listar informes del usuario
router.get('/', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const offset = Number(req.query.offset) || 0
    const informes = listarInformesDeBD(req.user.id, limit, offset)
    // Parse resumen_json for display
    const data = informes.map(i => ({
      id: i.id,
      cliente_nombre: i.cliente_nombre,
      cliente_rut: i.cliente_rut,
      anio_inicio: i.anio_inicio,
      anio_fin: i.anio_fin,
      mes_inicio: i.mes_inicio,
      mes_fin: i.mes_fin,
      modo: i.modo,
      estado: i.estado,
      total_meses: i.total_meses,
      consultas_estimadas: i.consultas_estimadas,
      resumen: i.resumen_json ? JSON.parse(i.resumen_json) : null,
      creado_en: i.created_at,
    }))
    res.json({ ok: true, informes: data })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Cargar informe completado de BD (para recargar página)
router.post('/:informe_id/cargar', (req, res) => {
  try {
    const estado = cargarInformeDeBD(req.params.informe_id, req.user.id)
    if (!estado) {
      return res.status(404).json({ ok: false, error: 'Informe no encontrado' })
    }
    // Reconstruir por_anio y resumen
    const { agruparPorAnio, calcularResumenGlobal } = require('../services/calculos')
    const okMeses = estado.meses.filter(m => m.estado === 'ok')
    estado.por_anio = agruparPorAnio(okMeses)
    estado.resumen = calcularResumenGlobal(okMeses)
    informes.set(req.params.informe_id, estado)
    res.json({ ok: true, ...estado })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Eliminar informe
router.delete('/:informe_id', (req, res) => {
  try {
    const result = eliminarInformeDeBD(req.params.informe_id, req.user.id)
    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: 'Informe no encontrado' })
    }
    // También limpiar de memoria si estaba ahí
    informes.delete(req.params.informe_id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
