/**
 * Sistema de notificaciones único. Crea su propio elemento en el DOM si la
 * página no trae ya un <div id="toast">, así páginas nuevas no necesitan
 * recordar agregarlo a mano.
 */
function _toastEl() {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    el.className = 'toast'
    el.hidden = true
    document.body.appendChild(el)
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
