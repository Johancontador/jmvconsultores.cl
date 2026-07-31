/**
 * Orquesta qué vista se pinta en #panel-central (dashboard o un reporte de
 * reportes.js) sin recargar la página, y qué hace el botón "Conectar" del
 * header según la vista activa.
 */
const ShellRouter = (() => {
  let vistaActiva = 'dashboard' // 'dashboard' | tipo de CATALOGO

  function _mostrarContenedor(nombre) {
    document.getElementById('vista-dashboard').hidden = nombre !== 'dashboard'
    document.getElementById('vista-reporte').hidden = nombre !== 'reporte'
  }

  function mostrarDashboard() {
    vistaActiva = 'dashboard'
    _mostrarContenedor('dashboard')
    window.LayoutSidebar.render(null)
    _actualizarVisibilidadHeader(null)
    window.DashboardBI.mostrar()
  }

  // "IVA por Cliente" (fuente: proceso) no depende del cliente/rango del
  // header — usa su propio selector de Mes/Año y botón "Generar". Antes se
  // dejaban visibles el selector de cliente, "Conectar" y la barra de
  // filtro global (Mes inicio/Año inicio/Mes fin/Año fin) del header al
  // mismo tiempo que los controles propios del reporte — tres selectores de
  // período en pantalla sin relación entre sí, confuso. Se ocultan los que
  // no aplican.
  function _actualizarVisibilidadHeader(tipo) {
    const reporte = window.ReportesEngine.CATALOGO[tipo]
    const esProceso = reporte && reporte.fuente === 'proceso'
    const $topbarCliente = document.querySelector('.topbar-cliente')
    const $topbarConectar = document.getElementById('topbar-btn-conectar')
    const $topbarBadge = document.getElementById('topbar-badge')
    const $filtroGlobal = document.querySelector('.filtro-global-bar')
    if ($topbarCliente) $topbarCliente.hidden = esProceso
    if ($topbarConectar) $topbarConectar.hidden = esProceso
    if ($topbarBadge) $topbarBadge.hidden = esProceso
    if ($filtroGlobal) $filtroGlobal.hidden = esProceso
  }

  function mostrarReporte(tipo) {
    if (!window.ReportesEngine.CATALOGO[tipo]) return
    vistaActiva = tipo
    _mostrarContenedor('reporte')
    window.LayoutSidebar.render(tipo)
    _actualizarVisibilidadHeader(tipo)
    window.ReportesEngine.mostrarReporte(tipo)
  }

  function _onConectar() {
    if (vistaActiva === 'dashboard') {
      window.DashboardBI.conectar()
      return
    }
    const reporte = window.ReportesEngine.CATALOGO[vistaActiva]
    if (reporte && reporte.fuente === 'proceso') {
      showToast('Este reporte no depende de un cliente activo — usa el botón "Generar" del propio reporte', 'info')
      return
    }
    const clienteId = window.ShellState.getClienteId()
    if (!clienteId) { showToast('Selecciona un cliente primero', 'error'); return }
    window.ReportesEngine.ejecutarInformeReal(clienteId, window.ShellState.getRango())
  }

  function init() {
    window.addEventListener('shell:conectar', _onConectar)
    window.ShellState.onCambio(() => {
      if (vistaActiva === 'dashboard') window.DashboardBI.mostrar()
      else {
        const reporte = window.ReportesEngine.CATALOGO[vistaActiva]
        if (reporte && reporte.fuente !== 'proceso') window.ReportesEngine.mostrarReporte(vistaActiva)
      }
    })

    const tipoPendiente = sessionStorage.getItem('iva_tipo_pendiente')
    if (tipoPendiente) {
      sessionStorage.removeItem('iva_tipo_pendiente')
      if (tipoPendiente === '') mostrarDashboard()
      else mostrarReporte(tipoPendiente)
      return
    }
    mostrarDashboard()
  }

  return { mostrarDashboard, mostrarReporte, init }
})()

window.ShellRouter = ShellRouter
