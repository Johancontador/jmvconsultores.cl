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

// Límite de tamaño del JSON: las rutas de esta app reciben parámetros de
// consulta (cliente_id, rango), no payloads grandes — 100 KB es generoso y
// evita que un body gigante consuma memoria del servidor.
app.use(express.json({ limit: '100kb' }))

// Confiar en el proxy de nginx (docker-compose): req.ip refleja X-Forwarded-For
// y el rate-limit del login no trata a todo Internet como una sola IP.
app.set('trust proxy', 1)

// Headers de seguridad básicos (defensa en profundidad — no hay ningún dato
// de terceros embebido ni se necesita CSP elaborada, solo cerrar los vectores
// obvios: clickjacking, MIME-sniffing, filtración de referrer entre sitios).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

app.use('/api/auth', require('./routes/auth'))

// La raíz es la landing pública (marketing + login embebido). El resto de
// páginas se sirve por static; /index.html sigue siendo la pantalla de
// Clientes (referencia legacy del nav) — nadie enlaza "href=/" internamente.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/landing.html'))
})

app.use(express.static(path.join(__dirname, '../frontend')))

app.use('/api/clientes', requireAuth, require('./routes/clientes'))
app.use('/api/informe', requireAuth, require('./routes/informe'))
app.use('/api/proceso', requireAuth, require('./routes/proceso'))
app.use('/api/exportacion-masiva', requireAuth, require('./routes/exportacion-masiva'))
app.use('/api/sii', requireAuth, require('./routes/sii'))
app.use('/api/contable', requireAuth, require('./routes/contable'))
app.use('/api/contable', requireAuth, require('./routes/documentos'))
app.use('/api/contable', requireAuth, require('./routes/propuestas'))
app.use('/api/contable', requireAuth, require('./routes/reportes'))

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
