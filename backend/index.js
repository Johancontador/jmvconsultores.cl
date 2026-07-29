require('dotenv').config()
const express = require('express')
const path = require('path')

// Salvavidas: un error no capturado en una tarea en segundo plano (proceso
// mensual, informe, etc.) no debe tumbar el servidor completo — solo se loggea.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Excepción no capturada:', err.message)
  console.error(err.stack)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Promesa rechazada sin capturar:', reason)
})

try {
  require('./db')
} catch (err) {
  console.error('No se pudo inicializar la base de datos:', err.message)
  console.error(err.stack)
  process.exit(1)
}

const { requireAuth } = require('./middleware/requireAuth')

const app = express()
const PORT = process.env.PORT || 3500

app.use(express.json())
app.use('/api/auth', require('./routes/auth'))
app.use(express.static(path.join(__dirname, '../frontend')))

app.use('/api/clientes', requireAuth, require('./routes/clientes'))
app.use('/api/informe', requireAuth, require('./routes/informe'))
app.use('/api/proceso', requireAuth, require('./routes/proceso'))
app.use('/api/sii', requireAuth, require('./routes/sii'))

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'IVA Mensual API running' })
})

// Manejador de errores de Express: cualquier error lanzado dentro de una ruta
// (síncrono o pasado a next(err)) responde JSON en vez de tumbar el proceso.
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message)
  res.status(500).json({ ok: false, error: err.message || 'Error interno' })
})

app.listen(PORT, () => {
  console.log(`IVA Mensual corriendo en http://localhost:${PORT}`)
})
