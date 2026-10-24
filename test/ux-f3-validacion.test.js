'use strict'
/**
 * F3 — VALIDACIÓN VISUAL/FUNCIONAL EN NAVEGADOR (2026-10-24).
 *
 * Regresiones de los defectos REPRODUCIDOS en Chrome real con una BD ficticia
 * (scripts/validacion-pre-produccion/capturas-f3.js). Cada caso fija el
 * contrato observable que fallaba en pantalla:
 *
 *  F3-1  Marca JMV: el sidebar y el login embebido pintaban logo-light.svg
 *        (wordmark BLANCO) sobre fondo claro; en el tema por defecto la marca
 *        era invisible. Ahora hay variante por `data-theme`.
 *  F3-2  Centro de Reportes: las descripciones de «Próximamente» iban dentro de
 *        `.chip` (white-space: nowrap) y se derramaban sobre la tarjeta vecina.
 *  F3-3  Tesorería: «Ingresos/Egresos del mes» se calculaban con el mes del
 *        calendario del servidor, no con el período del header (decía $0 con un
 *        cobro del período visible en la misma tabla).
 *  F3-4  Salud Tributaria: la nota de alerta crítica afirmaba «El índice es
 *        favorable» incluso con el índice en «Crítica» (34/100).
 *  F3-5  Activos fijos: el selector de cuenta preseleccionaba CAJA (primera
 *        cuenta 1.x del plan) para un alta de activo.
 *  F3-6  Tablas: RUT y fecha se partían en el guion (dígito verificador y día
 *        sueltos en otra línea).
 *  F3-7  Móvil: el dock (z-index 130) tapaba el panel de secciones abierto
 *        (z-index 120) y sus últimas entradas no se podían pulsar.
 *  F3-8  Integraciones: el chip decía «Conectado» con la clave SII vacía.
 *  F3-9  Centro de Aplicaciones: el badge de «área restringida» no se explicaba
 *        ni para ratón ni para lector de pantalla.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const FRONT = path.resolve(__dirname, '../frontend')
const leer = (f) => fs.readFileSync(path.join(FRONT, f), 'utf8')

const app = leer('sistema/app.js')
const css = leer('sistema/sistema.css')
const conta = leer('sistema/views-conta.js')
const fiscal = leer('sistema/views-fiscal.js')
const tesoView = leer('sistema/views-teso.js')
const activosView = leer('sistema/views-activos.js')
const centroView = leer('sistema/views-centro.js')

// F3-1 -----------------------------------------------------------------------
test('F3-1: la marca del shell/login usa la variante de logo que corresponde al tema', () => {
  assert.match(app, /function logoMarcaHTML\(\)[\s\S]*?logo-para-claro[\s\S]*?logo-para-oscuro/, 'helper con las dos variantes')
  assert.match(app, /logo-para-claro" src="\/assets\/logo-ink\.svg"/, 'ink es la variante para fondo claro')
  assert.match(app, /logo-para-oscuro" src="\/assets\/logo-light\.svg"/, 'light es la variante para fondo oscuro')
  // El sidebar y el login embebido dejan de fijar la variante blanca a mano:
  // logo-light aparece UNA sola vez, dentro del helper.
  assert.strictEqual((app.match(/src="\/assets\/logo-light\.svg"/g) || []).length, 1, 'logo-light solo vive en logoMarcaHTML')
  assert.ok((app.match(/\$\{logoMarcaHTML\(\)\}/g) || []).length >= 4, 'sidebar + login + onboarding + cambio de clave')
  assert.match(css, /\.logo-para-oscuro \{ display: none; \}/, 'la variante oscura arranca oculta (tema claro)')
  assert.match(css, /html\[data-theme='dark'\] \.logo-para-claro \{ display: none; \}/, 'en oscuro se oculta la tinta')
  assert.match(css, /html\[data-theme='dark'\] \.logo-para-oscuro \{ display: inline-block; \}/, 'en oscuro se muestra la clara')
  // El wordmark de logo-light.svg es blanco: sin el swap sería invisible.
  assert.match(fs.readFileSync(path.join(FRONT, 'assets/logo-light.svg'), 'utf8'), /fill="#ffffff"/, 'logo-light tiene wordmark blanco')
})

// F3-2 -----------------------------------------------------------------------
test('F3-2: las funciones «Próximamente» describen con texto envolvente, no con un chip nowrap', () => {
  assert.ok(!/rep-card-off"><b>\$\{esc\(it\.label\)\}<\/b><span class="chip neutral">/.test(conta), 'sin `.chip` en las tarjetas no disponibles')
  assert.ok((conta.match(/class="rep-desc"/g) || []).length >= 2, 'las dos ramas (grupo y Próximamente) usan rep-desc')
  assert.match(css, /\.rep-card \.rep-desc \{ white-space: normal;/, 'la descripción envuelve')
  // Control: el chip global sigue siendo nowrap (el problema era usarlo en prosa).
  assert.match(css, /\.chip \{[\s\S]*?white-space: nowrap;/, 'el chip sigue siendo de una línea')
})

// F3-3 -----------------------------------------------------------------------
test('F3-3: Tesorería calcula los KPI con el período del header, no con el mes del servidor', () => {
  const core = fs.readFileSync(path.resolve(__dirname, '../backend/core/tesoreria.js'), 'utf8')
  assert.match(core, /function resumen\(db, empresaId, \{ periodo = null \} = \{\}\)/, 'el core acepta período')
  assert.match(core, /\^\\d\{4\}\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(p\)/, 'valida AAAAMM antes de usarlo')
  assert.match(core, /periodo: mesActual\.replace\('-', ''\)/, 'declara a qué mes corresponden los totales')
  const route = fs.readFileSync(path.resolve(__dirname, '../backend/routes/tesoreria.js'), 'utf8')
  assert.match(route, /req\.query\.periodo/, 'la ruta lee el período')
  assert.match(route, /Período inválido \(YYYYMM\)/, 'un período inválido no cae al mes en curso')
  assert.match(route, /teso\.resumen\(db, req\.empresaId, \{ periodo \}\)/, 'lo pasa al core')
  assert.match(tesoView, /tesoreria\/resumen\?periodo=\$\{periodoGlobal\(\)\}/, 'la vista manda el período global')
  assert.match(tesoView, /Ingresos del período/, 'el rótulo ya no promete «del mes»')
})

// F3-4 -----------------------------------------------------------------------
test('F3-4: la nota de alerta crítica no afirma que el índice es favorable cuando es Crítica', () => {
  const core = fs.readFileSync(path.resolve(__dirname, '../backend/core/salud-tributaria.js'), 'utf8')
  assert.match(core, /const indiceBueno = clasificacion\.clave === 'SOLIDA' \|\| clasificacion\.clave === 'FAVORABLE'/, 'la nota depende de la clasificación real')
  assert.match(core, /const notaAlerta = indiceBueno \? notaAlertaConIndiceBueno : notaAlertaCritica/, 'se elige el texto correcto')
  assert.match(core, /nota: notaAlerta \}/, 'la nota efectiva se adjunta a la clasificación')
  assert.ok(!/notaAlertaCritica = 'El índice es favorable/.test(core), 'el texto «favorable» no se usa para cualquier caso')
})

// F3-5 -----------------------------------------------------------------------
test('F3-5: el alta de activo no preselecciona una cuenta (antes preseleccionaba Caja)', () => {
  assert.match(activosView, /<option value="" selected>Selecciona la cuenta del activo…<\/option>/, 'placeholder sin valor')
  assert.match(activosView, /if \(!document\.getElementById\('a-cuenta'\)\.value\)/, 'valida antes de enviar')
  const sinPlaceholder = activosView.slice(activosView.indexOf('id="a-cuenta"'), activosView.indexOf('</select>', activosView.indexOf('id="a-cuenta"')))
  assert.match(sinPlaceholder, /option value="" selected/, 'el primer option es el vacío, no una cuenta')
})

// F3-6 -----------------------------------------------------------------------
test('F3-6: RUT y fecha no se parten en el guion dentro de las tablas', () => {
  assert.match(fiscal, /<td class="mono sub rut">/, 'el RUT de Libros lleva clase rut')
  assert.match(fiscal, /<td class="sub fecha">/, 'la fecha de Libros lleva clase fecha')
  assert.match(css, /\.sys \.doc-rut-cel, \.tbl \.rut \{ white-space: nowrap; \}/, 'rut nowrap')
  assert.match(css, /\.tbl \.fecha \{ white-space: nowrap; \}/, 'fecha nowrap')
})

// F3-7 -----------------------------------------------------------------------
test('F3-7: en móvil el dock no tapa el panel de secciones abierto', () => {
  assert.match(css, /@media \(max-width: 960px\) \{ body\.menu-movil \.sys-dock \{ display: none; \} \}/, 'el dock se oculta con el menú abierto')
  assert.match(app, /document\.body\.classList\.toggle\('menu-movil', abierto\)/, 'el estado del panel existe en body')
  // El apilado que causaba el problema sigue documentado: panel 120 < dock 130.
  assert.match(css, /\.sys-side \{[\s\S]*?z-index: 120;/, 'panel en 120')
  assert.match(css, /\.sys-dock \{[\s\S]*?z-index: 130;/, 'dock en 130')
})

// F3-8 -----------------------------------------------------------------------
test('F3-8: Integraciones no declara «Conectado» sin clave SII', () => {
  const bloque = fiscal.slice(fiscal.indexOf("VIEWS.integraciones = {"), fiscal.indexOf('VIEWS.', fiscal.indexOf("VIEWS.integraciones = {") + 10))
  assert.match(bloque, /empresa\?\.clave_sii_configurada[\s\S]*?Conectado[\s\S]*?Sin clave SII/, 'chip condicionado a la clave configurada')
  assert.ok(!/<span class="chip contabilizado">Conectado<\/span>\s*\n\s*<\/div>/.test(bloque.replace(/\$\{[^}]*\}/g, '')), 'no queda un «Conectado» incondicional')
})

// F3-10 ----------------------------------------------------------------------
test('F3-10: el ítem activo del sidebar se anuncia con aria-current (no solo con clase)', () => {
  const nav = app.slice(app.indexOf("document.querySelectorAll('#sys-nav a')"), app.indexOf("document.querySelectorAll('#sys-dock"))
  assert.match(nav, /if \(activo\) a\.setAttribute\('aria-current', 'page'\)/, 'el enlace activo declara la página actual')
  assert.match(nav, /else a\.removeAttribute\('aria-current'\)/, 'y el resto no la conserva')
  // Contrato F0 intacto: las 6 vistas fuera de menú no marcan ningún item.
  assert.match(app, /const activos = new Set\(\[route\.key\]\)/, 'sin inventar un padre activo')
})

// F3-9 -----------------------------------------------------------------------
test('F3-9: el Centro de Aplicaciones explica el badge de área restringida', () => {
  assert.match(centroView, /ios-badge" title="Área restringida/, 'el badge tiene title para ratón')
  assert.match(centroView, /aria-label="Área restringida/, 'y aria-label para lectores de pantalla')
})
