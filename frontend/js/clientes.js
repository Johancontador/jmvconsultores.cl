const API = '/api/clientes'

let clientes = []
let editandoId = null

const $list = document.getElementById('client-list')
const $count = document.getElementById('clientes-count')
const $modal = document.getElementById('modal-overlay')
const $modalTitle = document.getElementById('modal-title')
const $form = document.getElementById('form-cliente')
const $inputRut = document.getElementById('input-rut')
const $inputNombre = document.getElementById('input-nombre')
const $inputClave = document.getElementById('input-clave')
const $inputPpm = document.getElementById('input-ppm')
const $inputTelefono = document.getElementById('input-telefono')
const $inputExento = document.getElementById('input-exento')
const $errorRut = document.getElementById('error-rut')

// fmt, showToast, formatRut, formatTelefono, formatPpm, escapeHtml, validarRut
// vienen de shared/format.js y shared/toast.js (cargados antes que este script).

async function cargarClientes() {
  try {
    const res = await fetch(API)
    if (!res.ok) throw new Error('Error al cargar clientes')
    clientes = await res.json()
    renderLista()
  } catch (err) {
    $count.textContent = 'Error al cargar clientes'
    showToast(err.message, 'error')
  }
}

function renderLista() {
  const n = clientes.length
  $count.textContent = n === 1 ? '1 cliente activo' : `${n} clientes activos`

  if (n === 0) {
    $list.innerHTML = `
      <div class="empty-state">
        <p>No hay clientes registrados.</p>
        <button type="button" class="btn btn-primary" id="btn-agregar-empty">+ Agregar primer cliente</button>
      </div>`
    document.getElementById('btn-agregar-empty').addEventListener('click', abrirModalAgregar)
    return
  }

  $list.innerHTML = clientes.map(c => `
    <article class="client-card" data-id="${c.id}">
      <div class="client-card-top">
        <div class="client-card-main">
          <div class="client-rut">${formatRut(c.rut)}</div>
          <div class="client-nombre">${escapeHtml(c.nombre)}</div>
        </div>
        <div class="client-card-actions">
          <button type="button" class="btn-icon btn-editar" data-id="${c.id}" aria-label="Editar">✏️</button>
          <button type="button" class="btn-icon btn-icon-danger btn-eliminar" data-id="${c.id}" aria-label="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="client-meta">
        <span>Tasa PPM: ${formatPpm(c.tasa_ppm)}</span>
        <span class="client-meta-sep">•</span>
        <span>${formatTelefono(c.telefono)}</span>
        <span class="client-meta-sep">•</span>
        ${c.exento
          ? '<span class="badge badge-exento">EXENTO</span>'
          : '<span class="badge-iva">IVA</span>'}
      </div>
    </article>
  `).join('')

  $list.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', () => abrirModalEditar(Number(btn.dataset.id)))
  })
  $list.querySelectorAll('.btn-eliminar').forEach(btn => {
    btn.addEventListener('click', () => eliminarCliente(Number(btn.dataset.id)))
  })
}

function abrirModalAgregar() {
  editandoId = null
  $modalTitle.textContent = 'Agregar cliente'
  $form.reset()
  $inputClave.required = true
  $inputClave.placeholder = '••••••••'
  $errorRut.hidden = true
  $inputRut.classList.remove('error')
  $modal.classList.add('open')
  $inputRut.focus()
}

function abrirModalEditar(id) {
  const cliente = clientes.find(c => c.id === id)
  if (!cliente) return

  editandoId = id
  $modalTitle.textContent = 'Editar cliente'
  $inputRut.value = cliente.rut
  $inputNombre.value = cliente.nombre
  $inputClave.value = ''
  $inputClave.required = false
  $inputClave.placeholder = 'Dejar vacío para no cambiar'
  $inputPpm.value = cliente.tasa_ppm
  $inputTelefono.value = cliente.telefono
  $inputExento.checked = cliente.exento === 1
  $errorRut.hidden = true
  $inputRut.classList.remove('error')
  $modal.classList.add('open')
  $inputNombre.focus()
}

function cerrarModal() {
  $modal.classList.remove('open')
  editandoId = null
  $form.reset()
  $inputClave.type = 'password'
}

async function guardarCliente(e) {
  e.preventDefault()

  const rut = $inputRut.value.trim()
  if (!validarRut(rut)) {
    $errorRut.textContent = 'RUT inválido'
    $errorRut.hidden = false
    $inputRut.classList.add('error')
    return
  }
  $errorRut.hidden = true
  $inputRut.classList.remove('error')

  const body = {
    rut,
    nombre: $inputNombre.value.trim(),
    tasa_ppm: parseFloat($inputPpm.value),
    telefono: $inputTelefono.value.trim(),
    exento: $inputExento.checked,
  }

  if (editandoId) {
    if ($inputClave.value) body.clave_sii = $inputClave.value
  } else {
    body.clave_sii = $inputClave.value
  }

  try {
    const url = editandoId ? `${API}/${editandoId}` : API
    const method = editandoId ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al guardar')

    showToast(editandoId ? 'Cliente actualizado' : 'Cliente creado')
    cerrarModal()
    await cargarClientes()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function eliminarCliente(id) {
  const cliente = clientes.find(c => c.id === id)
  if (!cliente) return

  const ok = confirm(`¿Eliminar ${cliente.nombre}?`)
  if (!ok) return

  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al eliminar')

    showToast('Cliente eliminado')
    await cargarClientes()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

document.getElementById('btn-agregar').addEventListener('click', abrirModalAgregar)
document.getElementById('btn-cerrar-modal').addEventListener('click', cerrarModal)
document.getElementById('btn-cancelar').addEventListener('click', cerrarModal)
$form.addEventListener('submit', guardarCliente)

$modal.addEventListener('click', e => {
  if (e.target === $modal) cerrarModal()
})

document.getElementById('btn-toggle-clave').addEventListener('click', () => {
  const isPassword = $inputClave.type === 'password'
  $inputClave.type = isPassword ? 'text' : 'password'
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $modal.classList.contains('open')) cerrarModal()
})

cargarClientes()
