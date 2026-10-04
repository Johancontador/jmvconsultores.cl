/**
 * Headers de seguridad centralizados (BLOQUE 1bis — P8.C/D/E).
 *
 * Reemplaza el middleware inline de index.js (comportamiento preservado) y
 * agrega: CSP incremental, CORP y HSTS condicional.
 *
 * CSP (P8.D — política incremental segura, deuda documentada):
 *  - El frontend aún usa handlers inline (5 onclick) y un <script> de boot
 *    inline → script-src necesita 'unsafe-inline'. Migración futura a
 *    event listeners + nonces para eliminarlo (deuda registrada).
 *  - Aun así la CSP BLOQUEA: scripts externos fuera del CDN con SRI
 *    (jsdelivr), object/embed, base-uri hijack, form-action externo y
 *    framing (frame-ancestors 'none', consistente con X-Frame-Options DENY).
 *  - Fuentes Google (styles+fonts) y CDN jsdelivr son los únicos orígenes
 *    externos permitidos, igual que lo que ya carga el frontend.
 *
 * HSTS (P8.C): SOLO detrás de HTTPS real — nginx fija X-Forwarded-Proto https
 * (trust proxy activo) y NODE_ENV=production. En desarrollo HTTP/self-signed
 * NO se envía (jamás bloquea un entorno de desarrollo).
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

function headersSeguridad(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', CSP)

  if (process.env.NODE_ENV === 'production' && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
}

module.exports = { headersSeguridad, CSP }
