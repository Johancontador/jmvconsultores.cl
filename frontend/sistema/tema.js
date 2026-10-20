/**
 * SISTEMA CONTABLE JMV — tema (claro/oscuro).
 *
 * Estados: 'light' (por defecto), 'dark', guardados en localStorage bajo
 * 'jmv_tema'. Antes el defecto seguía al sistema operativo y en equipos con
 * tema oscuro la app arrancaba oscura (AUDITORIA-UX-UI §7 / D1: el brief pide
 * claro). Aplica data-theme en <html>; todo el CSS usa variables, así que el
 * cambio es instantáneo y global. La preferencia guardada del usuario manda.
 */
(function () {
  const KEY = 'jmv_tema'
  const DEFECTO = 'light'

  function resolver() {
    const guardado = localStorage.getItem(KEY)
    if (guardado === 'light' || guardado === 'dark') return guardado
    return DEFECTO
  }

  function aplicar() {
    document.documentElement.setAttribute('data-theme', resolver())
  }

  /** HTML del botón toggle (el icono lo pinta CSS según data-theme). */
  function botonHTML() {
    return '<button id="sys-tema" class="tema-toggle" title="Cambiar tema claro/oscuro" aria-label="Cambiar tema"></button>'
  }

  function conectar() {
    const btn = document.getElementById('sys-tema')
    if (!btn) return
    btn.addEventListener('click', () => {
      const actual = document.documentElement.getAttribute('data-theme') || resolver()
      const nuevo = actual === 'dark' ? 'light' : 'dark'
      localStorage.setItem(KEY, nuevo)
      aplicar()
      // Avisar a las vistas por si quieren repintar algo dependiente del tema.
      window.dispatchEvent(new CustomEvent('jmv:tema', { detail: { tema: nuevo } }))
    })
  }

  // Aplicar antes del primer paint para evitar flash. Ya no se escucha
  // `prefers-color-scheme`: el defecto es explícito (claro) y solo cambia con
  // la elección del usuario, no cuando el SO cambia de tema a media sesión.
  aplicar()

  window.Tema = { resolver, aplicar, botonHTML, conectar }
})()
