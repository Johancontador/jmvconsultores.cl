'use strict'
/**
 * test/sitio-publico.test.js — regresión del sitio público (landing/login/registro).
 *
 * Por qué: las tres páginas son la puerta comercial y de acceso, y no tenían
 * ninguna prueba. Un cambio de diseño puede romper sin ruido: perder el
 * anti-caché, dejar de llamar al endpoint real de contacto, cambiar ids del
 * formulario de acceso (rompe login-auth.js) o referenciar un asset inexistente.
 *
 * T1 — Identidad compartida: las 3 cargan /css/sitio.css y NO /css/app.css.
 * T2 — Autenticación intacta: la lógica compartida (login-auth.js) se monta
 *      con los ids/atributos que necesita, en landing y login.
 * T3 — Registro intacto: honeypot + endpoint real + validación en vivo.
 * T4 — Contacto real (no simulado) en la landing.
 * T5 — Anti-caché: TODA referencia .css/.js de las 3 páginas lleva ?v=<sha1>
 *      del contenido del archivo al que apunta.
 * T6 — Sin referencias locales rotas (href/src que apunten a archivos)
 *      y sin salto de documento: los anchors #seccion existen en la página.
 */
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('fs')
const path = require('path')

const FRONT = path.resolve(__dirname, '../frontend')
const PAGINAS = ['landing.html', 'login.html', 'registro.html']
const leer = (p) => fs.readFileSync(path.join(FRONT, p), 'utf8')

const atributos = (html) => [...html.matchAll(/(href|src)="([^"]+)"/g)].map((m) => ({ attr: m[1], url: m[2] }))

/* ------------------------------- T1 identidad ------------------------------- */
test('T1: las 3 páginas públicas comparten el CSS del sitio y no cargan el de la app', () => {
  for (const p of PAGINAS) {
    const html = leer(p)
    assert.match(html, /href="\/css\/sitio\.css\?v=[a-f0-9]{8}"/, `${p} carga sitio.css versionado`)
    assert.ok(!html.includes('/css/app.css'), `${p} NO carga el design system de la app (aislamiento)`)
    assert.match(html, /class="pv( |")/, `${p} usa el sistema visual público`)
    assert.match(html, /href="https:\/\/fonts\.googleapis\.com[^"]*"/, `${p} carga la tipografía compartida`)
  }
  // Mismo logo de fondo claro en las tres (identidad de marca consistente)
  for (const p of PAGINAS) {
    assert.ok(leer(p).includes('/assets/logo-ink.svg'), `${p} usa el logo del sitio`)
  }
})

/* --------------------------- T2 autenticación ------------------------------ */
test('T2: login real preservado — login-auth.js se monta con los atributos que espera', () => {
  const login = leer('login.html')
  assert.match(login, /src="\/shared\/login-auth\.js\?v=[a-f0-9]{8}"/, 'carga la lógica compartida')
  assert.ok(login.includes('montarLoginPublico({'), 'la monta')
  for (const id of ['login-form', 'login-error', 'btn-login']) {
    assert.ok(login.includes(`id="${id}"`), `el formulario conserva #${id}`)
  }
  assert.ok(login.includes('data-user') && login.includes('data-pass'), 'conserva data-user/data-pass')
  assert.ok(login.includes('data-pass-toggle'), 'conserva el botón mostrar/ocultar contraseña')
  assert.match(login, /destino: '\/sistema\/'/, 'destino correcto tras autenticarse')

  const landing = leer('landing.html')
  assert.ok(landing.includes('montarLoginPublico({'), 'la landing también monta el acceso embebido')
  assert.ok(landing.includes('id="lp-form"') && landing.includes('id="lp-btn"'), 'ids del panel de acceso')
  // Ni una credencial viaja por URL ni se simula el login
  assert.ok(!/password=/.test(login), 'la contraseña jamás va por query string')
})

/* ------------------------------ T3 registro ------------------------------- */
test('T3: registro conserva el flujo real (endpoint, honeypot y validación en vivo)', () => {
  const html = leer('registro.html')
  assert.ok(html.includes("apiPost('/api/auth/registro'"), 'envía al endpoint real')
  assert.ok(html.includes('/api/auth/registro/disponible'), 'consulta disponibilidad en vivo')
  assert.match(html, /id="f-web"[^>]*tabindex="-1"/, 'honeypot presente y fuera del tab-order')
  assert.match(html, /web: \$\('f-web'\)\.value/, 'el honeypot viaja en el cuerpo (el server lo evalúa)')
  for (const id of ['form-registro', 'f-usuario', 'f-clave', 'f-rut', 'f-nombre', 'f-clavesii', 'btn-enviar', 'reg-error', 'root']) {
    assert.ok(html.includes(`id="${id}"`), `conserva #${id}`)
  }
  assert.ok(!html.includes('field-ok') && !html.includes('field-bad'), 'sin clases del CSS retirado')
})

/* ------------------------------ T4 contacto ------------------------------- */
test('T4: el formulario de contacto de la landing llama al backend real y no simula éxito', () => {
  const html = leer('landing.html')
  assert.ok(html.includes("fetch('/api/contacto'"), 'POST a /api/contacto')
  for (const id of ['lp-contacto-form', 'lp-form-ok', 'lp-form-err', 'c-nombre', 'c-empresa', 'c-cel', 'c-msg', 'c-env']) {
    assert.ok(html.includes(`id="${id}"`), `conserva #${id}`)
  }
  assert.ok(html.includes("wa.me/56975752213"), 'fallback honesto por WhatsApp')
  assert.ok(!/setTimeout\([^)]*'.*enviado/i.test(html), 'no se finge un envío exitoso con timers')
  assert.ok(html.includes('c-consent'), 'consentimiento de datos presente')
})

/* ------------------------------ T5 anti-caché ----------------------------- */
test('T5: toda referencia .css/.js de las páginas públicas lleva el sha1 del archivo', () => {
  let revisadas = 0
  for (const p of PAGINAS) {
    for (const { url } of atributos(leer(p))) {
      if (!/\.(css|js)(\?|$)/.test(url) || !url.startsWith('/')) continue
      const [ruta, query] = url.split('?')
      const archivo = path.join(FRONT, ruta.replace(/^\//, '').replace(/\//g, path.sep))
      assert.ok(fs.existsSync(archivo), `${p}: ${ruta} existe`)
      const sha = crypto.createHash('sha1').update(fs.readFileSync(archivo)).digest('hex').slice(0, 8)
      assert.strictEqual(query, `v=${sha}`, `${p}: ${ruta} versionado por contenido (nginx cachea 4 h)`)
      revisadas++
    }
  }
  assert.ok(revisadas >= 5, `se revisaron ${revisadas} referencias`)
})

/* --------------------------- T6 referencias locales ----------------------- */
test('T6: sin assets ni anclas rotas en las páginas públicas', () => {
  for (const p of PAGINAS) {
    const html = leer(p)
    const anclas = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
    for (const { url } of atributos(html)) {
      if (url.startsWith('#')) {
        const destino = url.slice(1)
        assert.ok(anclas.has(destino), `${p}: el ancla #${destino} existe en la página`)
      } else if (url.startsWith('/') && !url.startsWith('//')) {
        const ruta = url.split('?')[0]
        const archivo = path.join(FRONT, ruta.replace(/^\//, '').replace(/\//g, path.sep))
        assert.ok(fs.existsSync(archivo), `${p}: ${ruta} existe en el servidor de estáticos`)
      }
    }
  }
})
