/**
 * login-auth.js — Lógica ÚNICA del inicio de sesión en las páginas públicas.
 * La usan `landing.html` (panel embebido #acceso) y `login.html`:
 *   - sondeo de sesión activa con /api/auth/estado (siempre 200: sin ruido 401)
 *   - submit → POST /api/auth/login (misma API del sistema, sin duplicar)
 *   - al éxito → redirige al Sistema Contable (/sistema/)
 * Las páginas pasan SUS elementos: nada de esta pieza toca su DOM salvo
 * lo declarado. Backend valida SIEMPRE: esto es presentación.
 *
 * Requiere: window.apiPost (shared/api.js).
 */
function montarLoginPublico({ form, errorEl, btn, textoBoton = 'Entrar al sistema →', destino = '/sistema/', alExito }) {
  if (!form || !btn) return null

  // Sesión ya activa: mostrar el acceso directo de inmediato (login.html
  // redirige; en la landing solo avisa). Sin ruido 401 en consola.
  fetch('/api/auth/estado').then((r) => r.json()).then((d) => {
    if (d.autenticado && window.location.pathname !== '/') {
      window.location.href = destino // login.html: entrar directo
    } else if (d.autenticado && alExito) {
      alExito('sesion-activa')
    }
  }).catch(() => {})

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (errorEl) errorEl.textContent = ''
    const usuario = form.querySelector('[data-user]')
    const clave = form.querySelector('[data-pass]')
    if (!usuario.value.trim() || !clave.value) {
      if (errorEl) errorEl.textContent = 'Ingresa tu usuario y contraseña.'
      return
    }
    btn.disabled = true
    btn.textContent = 'Verificando…'
    try {
      await apiPost('/api/auth/login', {
        username: usuario.value.trim(),
        password: clave.value,
      })
      if (alExito) alExito('ok')
      btn.textContent = 'Bienvenido — cargando…'
      setTimeout(() => { window.location.href = destino }, 500)
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || 'No se pudo iniciar sesión'
      btn.disabled = false
      btn.textContent = textoBoton
    }
  })

  // Botón de mostrar/ocultar contraseña si la página lo trae.
  const toggle = form.querySelector('[data-pass-toggle]')
  if (toggle && clave) {
    toggle.addEventListener('click', () => {
      const ver = clave.type === 'password'
      clave.type = ver ? 'text' : 'password'
      toggle.textContent = ver ? 'Ocultar' : 'Mostrar'
      toggle.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña')
    })
  }
  return true
}
