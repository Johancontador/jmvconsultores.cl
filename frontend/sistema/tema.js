/**
 * SISTEMA CONTABLE JMV — tema (claro/oscuro/sistema).
 *
 * Tres estados: null (sigue al sistema operativo), 'light', 'dark'.
 * Persistido en localStorage bajo 'jmv_tema'. Aplica data-theme en <html>;
 * todo el CSS usa variables, así que el cambio es instantáneo y global.
 */
(function () {
  const KEY = 'jmv_tema'

  function resolver() {
    const guardado = localStorage.getItem(KEY)
    if (guardado === 'light' || guardado === 'dark') return guardado
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
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

  // Aplicar antes del primer paint para evitar flash.
  aplicar()
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!localStorage.getItem(KEY)) aplicar()
  })

  window.Tema = { resolver, aplicar, botonHTML, conectar }
})()
