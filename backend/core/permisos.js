/**
 * RBAC — roles y capacidades nombradas.
 *
 * Principio (ACCOUNTING_DOMAIN/ARCHITECTURE): los módulos y rutas exigen
 * CAPACIDADES (p. ej. 'asientos:crear'), nunca nombres de rol. Agregar un rol
 * nuevo = insertar una fila en la tabla roles + su mapa aquí o en BD futura.
 *
 * Módulo puro: sin acceso a BD. La asignación usuario↔empresa↔rol vive en
 * usuario_empresa; el super_admin se reconoce además por users.is_admin.
 */

const CATALOGO_CAPACIDADES = {
  'empresas:ver': 'Ver empresas a las que tiene acceso',
  'empresas:crear': 'Crear empresas nuevas',
  'empresas:editar': 'Editar datos de una empresa',
  'usuarios:admin': 'Gestionar usuarios y asignaciones empresa/rol',
  'periodos:ver': 'Ver períodos contables',
  'periodos:cerrar': 'Cerrar un período contable',
  'periodos:reabrir': 'Reabrir un período cerrado (evento excepcional auditado)',
  'auditoria:ver': 'Consultar la bitácora de auditoría',
  'cuentas:ver': 'Ver plan de cuentas y centros de costo',
  'cuentas:editar': 'Crear/editar cuentas y centros de costo',
  'documentos:ver': 'Ver la bandeja de documentos',
  'documentos:ingestar': 'Ingestar documentos del SII hacia la bandeja',
  'documentos:clasificar': 'Clasificar documentos contablemente',
  'asientos:ver': 'Consultar asientos, diario y mayor',
  'asientos:crear': 'Registrar asientos contables',
  'asientos:revertir': 'Revertir asientos registrados',
  'reglas:ver': 'Ver reglas contables',
  'reglas:editar': 'Crear/editar reglas contables',
  'propuestas:ver': 'Ver propuestas de asiento',
  'propuestas:generar': 'Generar propuestas de asiento desde documentos',
  'propuestas:confirmar': 'Confirmar propuestas (contabilizar documentos)',
  'automatizacion:ejecutar': 'Ejecutar el pipeline de contabilización automática del período (clasificar → proponer → contabilizar en lote)',
  'conciliacion:ver': 'Ver conciliación SII ↔ contable',
  'conciliacion:ejecutar': 'Ejecutar la conciliación de un período',
  'onboarding:ejecutar': 'Consultar el SII y confirmar la ficha tributaria + ingesta del histórico (onboarding autónomo)',
  'reportes:ver': 'Ver reportes financieros',
  // SALUD TRIBUTARIA: informe de antecedentes + opinión automatizada. La
  // lectura NUNCA se bloquea por licencia; sincronizar (que llama al SII y
  // escribe la ficha/snapshot) sí exige licencia operativa.
  'salud:ver': 'Ver el informe de Salud Tributaria de la empresa',
  'salud:sincronizar': 'Sincronizar la ficha SII y generar el informe de Salud Tributaria',
  // CRM COMERCIAL: exclusivo del despacho. No es una capacidad de la empresa
  // cliente sino del equipo JMV — el dueño (admin_empresa), el auditor o
  // tesorería JAMÁS lo ven en el menú ni pueden abrir #crm. La API revalida con
  // guardCrm (rol contador/super_admin) en cada ruta: esto es la mitad de UX.
  'crm:ver': 'Ver el CRM comercial del despacho (exclusivo contador y super admin)',
  'tesoreria:ver': 'Ver cuentas bancarias, libro banco y conciliación bancaria',
  'tesoreria:operar': 'Registrar pagos, cobros y transferencias con asiento contable',
  'bancos:conciliar': 'Importar cartolas y conciliar banco ↔ libro',
  'activos:ver': 'Ver activos fijos, su plan de depreciación y las depreciaciones registradas',
  'activos:operar': 'Registrar activos fijos, ejecutar la depreciación mensual y registrar ventas/bajas',
  'config:editar': 'Editar configuración de la empresa',
  // SAAS-3: pagos y facturación de la suscripción (SAAS-ACCESO §5.3)
  'licencias:ver': 'Ver la suscripción, su estado y el historial de pagos de la empresa',
  'licencias:pagar': 'Contratar o renovar el plan de la empresa (checkout de la pasarela)',
  'facturacion:emitir': 'Emitir la factura electrónica (DTE) de los pagos de la suscripción',
  // BLOQUE 2: emisión de DTE para las empresas cliente (factura 33/34, NC 61, ND 56)
  'dte:ver': 'Ver la configuración de emisión, los CAFs de folios y los DTEs emitidos de la empresa',
  'dte:emitir': 'Emitir DTEs, reintentar envíos rechazados y consultar su estado real en el SII',
  'dte:configurar': 'Configurar el emisor tributario de la empresa: certificado de firma, CAFs de folios, resolución SII y ambiente',
  // PLANIFICACIÓN TRIBUTARIA (T0-B): ficha tributaria. Lectura para todos los
  // roles con acceso a la empresa (el auditor y el dueño CONSULTAN); gestionar
  // (incorporar/actualizar la declaración tributaria) solo contador/super_admin.
  'planificacion:ver': 'Ver la ficha tributaria y su historial en Planificación',
  'planificacion:gestionar': 'Incorporar o actualizar la ficha tributaria (declaración explícita, jamás automática)',
}

const TODAS_LAS_CAPACIDADES = Object.keys(CATALOGO_CAPACIDADES)

// Capacidades por rol. super_admin = todas. Los roles de solo lectura
// (auditor) no incluyen ninguna capacidad de escritura.
const PERMISOS_POR_ROL = {
  super_admin: TODAS_LAS_CAPACIDADES,

  contador: [
    'empresas:ver', 'empresas:editar',
    'periodos:ver', 'periodos:cerrar', 'periodos:reabrir',
    'auditoria:ver',
    'cuentas:ver', 'cuentas:editar',
    'documentos:ver', 'documentos:ingestar', 'documentos:clasificar',
    'asientos:ver', 'asientos:crear', 'asientos:revertir',
    'reglas:ver', 'reglas:editar',
    'propuestas:ver', 'propuestas:generar', 'propuestas:confirmar',
    'automatizacion:ejecutar',
    'conciliacion:ver', 'conciliacion:ejecutar',
    'onboarding:ejecutar',
    'reportes:ver', 'crm:ver', 'config:editar',
    'salud:ver', 'salud:sincronizar',
    // Fase 6: el contador opera tesorería completa (puede delegarla al rol TESORERÍA)
    'tesoreria:ver', 'tesoreria:operar', 'bancos:conciliar',
    // Fase 7: activos fijos y depreciación mensual
    'activos:ver', 'activos:operar',
    // SAAS-3: JMV (contador del despacho) ve pagos y emite la factura de la suscripción
    'licencias:ver', 'facturacion:emitir',
    // BLOQUE 2: el contador emite y configura la emisión de DTEs de sus clientes
    'dte:ver', 'dte:emitir', 'dte:configurar',
    // Planificación: el contador declara y mantiene la ficha tributaria
    'planificacion:ver', 'planificacion:gestionar',
  ],

  admin_empresa: [
    'empresas:ver', 'empresas:editar',
    'periodos:ver',
    'auditoria:ver',
    'cuentas:ver',
    'documentos:ver', 'documentos:ingestar',  // SAAS-2: ingesta del histórico sin JMV (gate de licencia igual aplica)
    'asientos:ver',
    'reglas:ver',
    'propuestas:ver',
    'conciliacion:ver',
    'onboarding:ejecutar',
    'reportes:ver', 'config:editar',
    // Salud Tributaria: el dueño consulta sus antecedentes y puede refrescar
    // su propia ficha SII (la credencial ya está en la bóveda de su empresa).
    'salud:ver', 'salud:sincronizar',
    // Fase 7: el dueño ve sus activos y depreciaciones, sin operarlos
    'activos:ver',
    // SAAS-3: el dueño ve y PAGA su suscripción — el pago jamás queda bloqueado
    // por el estado de la propia licencia (si no, una empresa SUSPENDIDA no
    // podría reactivarse sola); el gate de licencia no aplica a este módulo.
    'licencias:ver', 'licencias:pagar',
    // BLOQUE 2: el dueño configura SU emisor (su certificado es suyo) y emite
    'dte:ver', 'dte:emitir', 'dte:configurar',
    // Planificación: el dueño consulta su ficha, no la declara (la declaración
    // tributaria es del contador del despacho, hallazgo de la Fase T0/T1)
    'planificacion:ver',
  ],

  auditor: [
    'empresas:ver',
    'periodos:ver',
    'auditoria:ver',
    'cuentas:ver',
    'documentos:ver',
    'asientos:ver',
    'reglas:ver',
    'propuestas:ver',
    'conciliacion:ver',
    'reportes:ver',
    // Salud Tributaria: el auditor lee, nunca sincroniza.
    'salud:ver',
    // Fase 6: el auditor ve el libro banco pero no opera ni concilia
    'tesoreria:ver',
    // Fase 7: el auditor ve activos fijos pero no opera
    'activos:ver',
    // SAAS-3: el auditor consulta suscripción y pagos, no paga ni factura
    'licencias:ver',
    // BLOQUE 2: el auditor ve los DTEs emitidos, no emite ni configura
    'dte:ver',
    // Planificación: el auditor lee ficha e historial, jamás declara
    'planificacion:ver',
  ],

  tesoreria: [
    'empresas:ver',
    'periodos:ver',
    'cuentas:ver',
    'documentos:ver',
    'asientos:ver',
    'propuestas:ver',
    'conciliacion:ver',
    'reportes:ver',
    'tesoreria:ver', 'tesoreria:operar', 'bancos:conciliar',
    'licencias:ver',
    // BLOQUE 2: tesorería consulta los DTEs emitidos, no emite ni configura
    'dte:ver',
    // Planificación: lectura de la ficha (el rol opera caja, no declara impuestos)
    'planificacion:ver',
  ],
}

function esRolValido(codigo) {
  return Object.prototype.hasOwnProperty.call(PERMISOS_POR_ROL, codigo)
}

function permisosDeRol(codigo) {
  const lista = PERMISOS_POR_ROL[codigo]
  if (!lista) return new Set()
  return new Set(lista)
}

function tienePermiso(permisos, capacidad) {
  return permisos instanceof Set && permisos.has(capacidad)
}

function esCapacidadValida(capacidad) {
  return TODAS_LAS_CAPACIDADES.includes(capacidad)
}

module.exports = {
  CATALOGO_CAPACIDADES,
  TODAS_LAS_CAPACIDADES,
  PERMISOS_POR_ROL,
  esRolValido,
  permisosDeRol,
  tienePermiso,
  esCapacidadValida,
}
