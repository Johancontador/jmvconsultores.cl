const express = require('express')
const { iniciarProceso, obtenerEstado, reintentarCliente } = require('../services/proceso')

const router = express.Router()

router.post('/generar', (req, res) => {
  try {
    const { periodo } = req.body
    if (!periodo || !/^\d{6}$/.test(periodo)) {
      return res.status(400).json({ ok: false, error: 'Período inválido (formato YYYYMM)' })
    }

    const { procesoId, clientes } = iniciarProceso(periodo, req.user.id)

    res.status(202).json({
      ok: true,
      proceso_id: procesoId,
      clientes,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.get('/:proceso_id/estado', (req, res) => {
  try {
    const estado = obtenerEstado(req.params.proceso_id, req.user.id)
    if (!estado) {
      return res.status(404).json({ ok: false, error: 'Proceso no encontrado' })
    }
    res.json({ ok: true, ...estado })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/reintentar/:cliente_id', async (req, res) => {
  try {
    const { periodo } = req.body
    if (!periodo || !/^\d{6}$/.test(periodo)) {
      return res.status(400).json({ ok: false, error: 'Período inválido (formato YYYYMM)' })
    }

    const resultado = await reintentarCliente(Number(req.params.cliente_id), periodo, req.user.id)
    res.json({ ok: true, resultado })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
