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

// F5-B — FALLO SEGURO DE CONFIGURACIÓN: en producción, arrancar sin clave
// maestra (o con una de formato inválido) cifraría las claves SII, los CAF y
// el certificado de firma con la clave de DESARROLLO, que es pública en el
// código. Se valida ANTES de abrir la base: el proceso muere con un mensaje
// accionable y sin imprimir ningún valor. En desarrollo/pruebas no cambia nada
// (sigue el fallback con advertencia).
try {
  require('./core/boveda').validarClaveMaestra()
} catch (err) {
  console.error('[FATAL] Configuración de seguridad inválida:', err.message)
  process.exit(1)
}

// La instancia se guarda: la reanudación de trabajos del arranque la necesita
// como parámetro (antes solo se requería el módulo por su efecto de migración).
let db

try {
  db = require('./db')
} catch (err) {
  console.error('No se pudo inicializar la base de datos:', err.message)
  console.error(err.stack)
  process.exit(1)
}

const { requireAuth } = require('./middleware/requireAuth')

const app = express()
const PORT = process.env.PORT || 3500

// F8-G: Express anuncia su versión en cada respuesta (`X-Powered-By: Express`).
// El escaneo de solo lectura de producción (doc 27, control A6) lo confirmó en
// el servidor real. No aporta nada al cliente y regala reconocimiento.
app.disable('x-powered-by')

// Límite de tamaño del JSON: las rutas de esta app reciben parámetros de
// consulta (cliente_id, rango), no payloads grandes — 100 KB es generoso y
// evita que un body gigante consuma memoria del servidor. EXCEPCIÓN (FASE 9.2):
// la cartola bancaria sube como archivo en base64 — solo esa ruta acepta más.
const jsonCartola = express.json({ limit: '8mb' })
app.use('/api/contable', (req, res, next) => {
  if (req.path.endsWith('/tesoreria/cartola-archivo')) return jsonCartola(req, res, next)
  next()
})
app.use(express.json({ limit: '100kb' }))

// Confiar en el proxy de nginx (docker-compose): req.ip refleja X-Forwarded-For
// y el rate-limit del login no trata a todo Internet como una sola IP.
app.set('trust proxy', 1)

// Headers de seguridad centralizados (BLOQUE 1bis P8): nosniff, XFO, CSP
// incremental, CORP y HSTS SOLO con HTTPS real (ver middleware para el
// detalle y la deuda documentada del 'unsafe-inline').
app.use(require('./middleware/seguridad-headers').headersSeguridad)

app.use('/api/auth', require('./routes/auth'))

// La raíz es la landing pública (marketing + login embebido). El resto de
// páginas se sirve por static; /index.html sigue siendo la pantalla de
// Clientes (referencia legacy del nav) — nadie enlaza "href=/" internamente.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/landing.html'))
})

// PANTALLAS HEREDADAS RETIRADAS: la capa vieja de UI se retiró (sus funciones
// viven en la SPA). La tabla y el motivo del 302 están en el módulo, y va ANTES
// de los estáticos para que un archivo viejo no tape el redirect.
require('./core/pantallas-heredadas').montarRedirects(app)

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
app.use('/api/contable', requireAuth, require('./routes/automatizacion'))
app.use('/api/contable', requireAuth, require('./routes/onboarding'))
app.use('/api/contable', requireAuth, require('./routes/salud'))
app.use('/api/contable', requireAuth, require('./routes/tesoreria'))
app.use('/api/contable', requireAuth, require('./routes/activos'))
app.use('/api/contable', requireAuth, require('./routes/niif'))
app.use('/api/contable', requireAuth, require('./routes/asientos-externos'))
// PLANIFICACIÓN TRIBUTARIA (T0-B): ficha tributaria — lectura con
// 'planificacion:ver', declaración explícita con 'planificacion:gestionar'.
app.use('/api/contable', requireAuth, require('./routes/planificacion'))
// SAAS-3: pagos de la suscripción. SIN requireAuth global — el webhook de la
// pasarela es público (validado por firma + re-consulta a la API); las demás
// rutas piden requireAuth + RBAC dentro de routes/pagos.js.
app.use('/api/pagos', require('./routes/pagos'))
// Contacto desde la landing pública (rediseño 2026-10): SIN requireAuth —
// es la puerta comercial; rate limit + honeypot dentro de routes/contacto.js.
app.use('/api/contacto', require('./routes/contacto'))
// BLOQUE 2: emisión de DTE para las empresas cliente (config del emisor, CAFs
// de folios, emisión 33/34/56/61, estado SII real, reintentos).
app.use('/api/dte', requireAuth, require('./routes/dte'))
// CRM (Fase B): pipeline/recordatorios/campañas/engagement — exclusivo despacho.
app.use('/api/crm', requireAuth, require('./routes/crm'))
// PORTAL (inteligencia comercial): capa read-only por cliente — el router
// trae SU PROPIO aislamiento por empresa (guard server-side en cada endpoint).
app.use('/api/portal', requireAuth, require('./routes/portal').construirRouter(require('./db')))
require('./routes/portal').ensureTablaReportes(require('./db'))

// F8-G: health con verificación real de la base (200 / 503). El healthcheck de
// docker-compose y la espera de ops/deploy.sh se apoyan en este endpoint: uno
// que responde `ok:true` sin probar nada convierte el deploy en una falsa señal.
app.get('/api/health', require('./middleware/health').crearHealth({
  db,
  version: require('../package.json').version,
}))

// 404 propio: la API responde JSON (quien la llama espera JSON), las páginas
// reciben 404.html con la identidad del sitio y accesos útiles. Va después de
// todas las rutas y antes del manejador de errores, con status 404 real.
app.use(require('./middleware/no-encontrado').noEncontrado)

// Manejador de errores de Express: cualquier error lanzado dentro de una ruta
// (síncrono o pasado a next(err)) responde JSON en vez de tumbar el proceso.
// F8-G: en producción el cliente recibe un mensaje genérico; el detalle queda
// en el log (antes se devolvía `err.message`, que filtraba SQL y rutas).
app.use(require('./middleware/errores').crearManejadorErrores())

app.listen(PORT, () => {
  console.log(`IVA Mensual corriendo en http://localhost:${PORT}`)

  // BLOQUE 2 (riesgos): reanudación de trabajos largos persistidos tras un
  // reinicio (ingesta histórica a mitad). Idempotente: sin pendientes no hace
  // nada. Con pendientes, re-ejecuta SOLO los períodos sin checkpoint.
  require('./core/onboarding').reanudarHistoricosPendientes().catch((err) => {
    console.error('[JOBS] reanudación falló (no fatalo):', err.message)
  })
  // BLOQUE 5 (riesgos): reanudación de la sincronización diaria pendiente del
  // día (crash a mitad). Idempotente; sin pendientes no hace nada.
  // Durante meses se llamó SIN la BD: la función espera `db` como primer
  // argumento, así que reventaba siempre en `jobsP.listar(db, …)` con
  // «Cannot read properties of undefined (reading 'prepare')» y el `.catch`
  // lo disfrazaba de aviso no fatal — la reanudación nunca ocurrió.
  require('./core/sync-diaria').reanudarSyncDiaria(db).catch((err) => {
    console.error('[JOBS] reanudación sync-diaria falló (no fatalo):', err.message)
  })
})
