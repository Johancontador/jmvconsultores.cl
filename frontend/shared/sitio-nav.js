/**
 * sitio-nav.js — menú móvil del sitio público (compartido por todas las páginas).
 *
 * Por qué un archivo y no el bloque inline que tenía la landing: a ≤980 px el
 * CSS oculta `.pv-nav` y `.pv-bar__cta`, así que la ÚNICA navegación es el
 * burger. Al multiplicar páginas, copiar el bloque inline garantizaba que una
 * quedara sin menú (o con una versión vieja del comportamiento).
 *
 * Accesibilidad: aria-expanded refleja el estado real, la etiqueta cambia,
 * Escape cierra y devuelve el foco, y al navegar se cierra solo. Sin JS el
 * drawer queda cerrado y el contenido se lee igual (mejora progresiva).
 */
;(function menuMovil() {
  'use strict'
  const burger = document.getElementById('pv-burger')
  const drawer = document.getElementById('pv-drawer')
  if (!burger || !drawer) return

  const icono = burger.querySelector('span')

  function cerrar(devolverFoco) {
    drawer.dataset.open = 'false'
    burger.setAttribute('aria-expanded', 'false')
    burger.setAttribute('aria-label', 'Abrir menú')
    if (icono) icono.textContent = '☰'
    if (devolverFoco) burger.focus()
  }

  burger.addEventListener('click', () => {
    const abrir = burger.getAttribute('aria-expanded') !== 'true'
    if (!abrir) return cerrar(true)
    drawer.dataset.open = 'true'
    burger.setAttribute('aria-expanded', 'true')
    burger.setAttribute('aria-label', 'Cerrar menú')
    if (icono) icono.textContent = '✕'
    const primero = drawer.querySelector('a')
    if (primero) primero.focus()
  })

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('a')) cerrar(false)
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') cerrar(true)
  })

  // Si el viewport crece hasta mostrar la nav horizontal, el drawer debe quedar
  // cerrado: si no, al volver a móvil aparecería abierto sin que nadie lo pida.
  const escritorio = window.matchMedia('(min-width: 981px)')
  const alCambiar = (m) => { if (m.matches) cerrar(false) }
  if (escritorio.addEventListener) escritorio.addEventListener('change', alCambiar)
  else if (escritorio.addListener) escritorio.addListener(alCambiar)
})()

// Año del pie: se calcula en el cliente para no quedar congelado en el año en
// que se escribió la página. El HTML trae el año actual como respaldo (sin JS
// no aparece un espacio vacío).
;(function anio() {
  const hoy = String(new Date().getFullYear())
  document.querySelectorAll('[data-anio]').forEach((el) => { el.textContent = hoy })
})()
