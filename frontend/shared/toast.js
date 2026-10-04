/**
 * Sistema de notificaciones único. Crea su propio elemento en el DOM si la
 * página no trae ya un <div id="toast">, así páginas nuevas no necesitan
 * recordar agregarlo a mano.
 */
function _toastEl() {
  let el = document.getElementById('toast')
  if (!el) {
    // El estilo .toast de app.css lo posiciona DENTRO de .toast-container
    // (fixed, esquina inferior derecha): sin el contenedor queda static al
    // final del body — infla el scrollWidth de la página y en páginas largas
    // el aviso aparece bajo el pliegue (bug hallado por /qa 2026-10-04).
    const cont = document.createElement('div')
    cont.className = 'toast-container'
    el = document.createElement('div')
    el.id = 'toast'
    el.className = 'toast'
    el.hidden = true
    cont.appendChild(el)
    document.body.appendChild(cont)
  }
  return el
}

function showToast(msg, type = 'success') {
  const el = _toastEl()
  el.textContent = msg
  el.className = `toast toast-${type} show`
  el.hidden = false
  clearTimeout(el._timer)
  el._timer = setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => { el.hidden = true }, 200)
  }, 4000)
}
