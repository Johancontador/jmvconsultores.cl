/**
 * sitio-social.js — único lugar donde se configuran las redes oficiales.
 *
 * Reglas:
 *  - Un perfil solo se muestra si tiene URL real en CONFIG. Nada de enlaces de
 *    ejemplo: una red sin URL queda oculta (y si no queda ninguna, se oculta el
 *    bloque completo).
 *  - El nombre accesible va en el aria-label del enlace, y el icono es texto
 *    (no una imagen decorativa) para que se lea con cualquier contraste.
 *  - Sin JS el bloque no se pinta: los enlaces del pie siguen funcionando.
 *
 * Para activar LinkedIn, por ejemplo:
 *   linkedin: 'https://www.linkedin.com/company/jmv-consultores'
 */
;(function redes() {
  'use strict'

  const CONFIG = {
    linkedin: '',   // pendiente: URL real del perfil o página de empresa
    instagram: '',  // pendiente: URL real del perfil
    facebook: '',   // pendiente: URL real de la página
  }

  const ETIQUETAS = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook' }
  const ICONOS = { linkedin: 'in', instagram: 'ig', facebook: 'fb' }

  const contenedores = document.querySelectorAll('[data-social]')
  if (!contenedores.length) return

  const activas = Object.keys(CONFIG).filter((red) => /^https:\/\/[^\s]+$/.test(CONFIG[red]))
  if (!activas.length) {
    // Sin perfiles configurados no se muestra un bloque vacío con títulos.
    contenedores.forEach((c) => { c.hidden = true })
    return
  }

  contenedores.forEach((cont) => {
    cont.innerHTML = activas.map((red) => {
      const url = CONFIG[red]
      return `<a href="${url}" target="_blank" rel="noopener me" aria-label="${ETIQUETAS[red]} de JMV Consultores (se abre en una pestaña nueva)">`
        + `<span aria-hidden="true">${ICONOS[red]}</span><span>${ETIQUETAS[red]}</span></a>`
    }).join('')
    cont.hidden = false
  })
})()
