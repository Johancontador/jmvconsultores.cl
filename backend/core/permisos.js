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
  'tesoreria:ver': 'Ver cuentas bancarias, libro banco y conciliación bancaria',
  'tesoreria:operar': 'Registrar pagos, cobros y transferencias con asiento contable',
  'bancos:conciliar': 'Importar cartolas y conciliar banco ↔ libro',
  'activos:ver': 'Ver activos fijos, su plan de depreciación y las depreciaciones registradas',
  'activos:operar': 'Registrar activos fijos, ejecutar la depreciación mensual y registrar ventas/bajas',
  'config:editar': 'Editar configuración de la empresa',
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
    'reportes:ver', 'config:editar',
    // Fase 6: el contador opera tesorería completa (puede delegarla al rol TESORERÍA)
    'tesoreria:ver', 'tesoreria:operar', 'bancos:conciliar',
    // Fase 7: activos fijos y depreciación mensual
    'activos:ver', 'activos:operar',
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
    // Fase 7: el dueño ve sus activos y depreciaciones, sin operarlos
    'activos:ver',
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
    // Fase 6: el auditor ve el libro banco pero no opera ni concilia
    'tesoreria:ver',
    // Fase 7: el auditor ve activos fijos pero no opera
    'activos:ver',
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
