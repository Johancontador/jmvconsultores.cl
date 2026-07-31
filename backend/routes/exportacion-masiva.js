const express = require('express')
const fs = require('fs')
const { iniciarExportacion, obtenerEstado, obtenerArchivo } = require('../services/exportacion-masiva')

const router = express.Router()

router.post('/generar', (req, res) => {
  try {
    const { anio_inicio, anio_fin, mes_inicio, mes_fin } = req.body
    const inicio = Number(anio_inicio)
    const fin = Number(anio_fin)
    const mesDesde = mes_inicio ? Number(mes_inicio) : 1
    const mesHasta = mes_fin ? Number(mes_fin) : 12

    if (!inicio || !fin || inicio < 2020 || fin > 2030 || inicio > fin) {
      return res.status(400).json({ ok: false, error: 'Rango de años inválido' })
    }
    if (mesDesde < 1 || mesDesde > 12 || mesHasta < 1 || mesHasta > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido (1-12)' })
    }

    const { exportId } = iniciarExportacion(req.user.id, {
      anioInicio: inicio, anioFin: fin, mesInicio: mesDesde, mesFin: mesHasta,
    })

    res.status(202).json({ ok: true, export_id: exportId })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.get('/:export_id/estado', (req, res) => {
  try {
    const estado = obtenerEstado(req.params.export_id, req.user.id)
    if (!estado) return res.status(404).json({ ok: false, error: 'Exportación no encontrada' })
    res.json({ ok: true, ...estado })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.get('/:export_id/descargar', (req, res) => {
  try {
    const zipPath = obtenerArchivo(req.params.export_id, req.user.id)
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado o exportación aún no completada' })
    }
    res.download(zipPath, 'reportes-clientes.zip')
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
