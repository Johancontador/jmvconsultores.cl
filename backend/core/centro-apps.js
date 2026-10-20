/**
 * Centro de Aplicaciones — TRES AXIOMAS (solicitud 2026-10-15):
 *  §1 CERO MÓDULOS FICTICIOS: cada app del catálogo referencia secciones que YA
 *     existen en el menú del SPA (frontend/sistema/app.js, MENU) con sus anchors
 *     y permisos intactos. El catálogo nunca inventa rutas: el test de
 *     coherencia (test/centro-apps.test.js) lee el MENU real y compara.
 *  §2 CUATRO CONCEPTOS SEPARADOS:
 *      usuario autenticado  → requireAuth (sesión; /api/auth/centro)
 *      empresa autorizada   → usuario_empresa (asignación activa; rolEnEmpresa)
 *      permiso de acceso    → capacidades RBAC del rol EN ESA empresa
 *      módulo habilitado comercialmente → licencias (gate de escritura)
 *     La UI muestra solo lo que corresponde; el Backend revalida TODO en cada
 *     solicitud data (requireAuth + requirePermiso + licencias.exigirVigente).
 *  §3 SESIÓN COHERENTE: el Centro no cambia empresa ni sesión; el cambio de
 *     empresa sigue siendo el selector del shell (S.cache se limpia igual).
 *
 * Módulo puro: recibe la BD como parámetro (testeable) y NUNCA muta.
 */

const { CATALOGO_CAPACIDADES } = require('./permisos')

/**
 * APPS del Centro. Cada sección = { nombre del grupo del MENU, anchor/ruta
 * existente, capacidad RBAC que habilita esa sección }. Una app es VISIBLE si
 * el usuario tiene ALGUNA capacidad de sus secciones en la empresa activa; una
 * sección es ENTRABLE si la capacidad específica está.
 *
 * Mapeo (MENU real 2026-10 → Centro):
 *   Documentos y libros + Facturación + Contabilidad → Contabilidad e IVA
 *   Informes y control          → Inteligencia de Negocios
 *   Gestión comercial           → Gestión Comercial
 *   Tesorería y cobranza        → Finanzas (fuentes reales: bancos, cartola,
 *                                  conciliación bancaria — módulo implementado)
 *   Portal de cliente           → Portal (superficie del dueño; read-only)
 *   Inicio + Administración     → Administración (área RESTRINGIDA: solo con
 *                                  capacidades de moderación/consulta admin)
 *   Alertas y Calculadora de IVA quedan como accesos rápidos del shell, no
 *   como apps del Centro (alcance mínimo).
 */
const CATALOGO_APPS = [
  {
    key: 'contabilidad-iva',
    titulo: 'Contabilidad e IVA',
    descripcion: 'Bandeja SII, libros de compra y venta, IVA determinado, emisión de DTE y el ciclo contable hasta el asiento.',
    icono: 'libro',
    orden: 1,
    secciones: [
      { grupo: 'Documentos y libros', ruta: 'documentos', capacidad: 'documentos:ver' },
      { grupo: 'Facturación', ruta: 'dte', capacidad: 'dte:ver' },
      { grupo: 'Contabilidad', ruta: 'asientos', capacidad: 'asientos:ver' },
    ],
  },
  {
    key: 'inteligencia-negocios',
    titulo: 'Inteligencia de Negocios',
    descripcion: 'Centro de Reportes, balances, estados financieros y NIIF sobre los datos contables consolidados.',
    icono: 'grafico',
    orden: 2,
    secciones: [
      { grupo: 'Informes y control', ruta: 'reportes', capacidad: 'reportes:ver' },
    ],
  },
  // CRM COMERCIAL (rediseño 2026-10-15): módulo completo del despacho con el
  // MISMO gate que su API real (guardCrm en routes/crm.js): solo contador y
  // super admin — el dueño cliente JAMÁS ve esta tarjeta (y ni con URL entra:
  // el backend devuelve 403).
  {
    key: 'crm-comercial',
    titulo: 'CRM Comercial',
    descripcion: 'Oportunidades con embudo kanban, fichas comerciales, contactos, prospectos, actividades y proyección comercial ponderada del portafolio.',
    icono: 'pipeline',
    orden: 3,
    roles: ['contador'], // + super admin (is_admin) — igual que guardCrm
    secciones: [
      { grupo: 'Gestión comercial', ruta: 'crm', capacidad: 'crm:ver' },
    ],
  },
  {
    key: 'gestion-comercial',
    titulo: 'Gestión Comercial',
    descripcion: 'Cuenta corriente de clientes y proveedores, y cobranza con seguimiento de mora.',
    icono: 'usuarios',
    orden: 4,
    secciones: [
      { grupo: 'Gestión comercial', ruta: 'cclientes', capacidad: 'reportes:ver' },
      { grupo: 'Tesorería y cobranza', ruta: 'cobranza', capacidad: 'tesoreria:ver' },
    ],
  },
  {
    key: 'finanzas-tesoreria',
    titulo: 'Finanzas (Tesorería)',
    descripcion: 'Bancos, libro banco, cartolas y conciliación bancaria contra el libro contable. Fuentes reales: cuentas bancarias registradas e importes de cartola.',
    icono: 'banco',
    orden: 5,
    secciones: [
      { grupo: 'Tesorería y cobranza', ruta: 'tesoreria', capacidad: 'tesoreria:ver' },
    ],
  },
  {
    key: 'portal-cliente',
    titulo: 'Portal de cliente',
    descripcion: 'Superficie comercial de solo lectura para el dueño de la empresa: dashboard, ventas, cartera y productos. La experiencia externa usa este módulo y no el sistema operativo.',
    icono: 'portal',
    orden: 6,
    modoExterno: true, // experiencia externa ≠ interna: otro menú, otros permisos
    secciones: [
      { grupo: 'Portal de cliente', ruta: 'portal-inicio', capacidad: 'empresas:ver' },
    ],
  },
  {
    key: 'administracion',
    titulo: 'Administración',
    descripcion: 'Área restringida: usuarios, auditoría, integraciones, suscripción y configuración de la empresa. Visible solo para roles autorizados.',
    icono: 'escudo',
    orden: 7,
    restringida: true,
    secciones: [
      { grupo: 'Administración', ruta: 'admin', capacidad: 'periodos:ver' },
      { grupo: 'Administración', ruta: 'auditoria', capacidad: 'auditoria:ver' },
      { grupo: 'Administración', ruta: 'integraciones', capacidad: 'empresas:ver' },
      { grupo: 'Administración', ruta: 'suscripcion', capacidad: 'empresas:ver' },
    ],
  },
]

function validarCatalogo() {
  const claves = new Set()
  for (const app of CATALOGO_APPS) {
    if (claves.has(app.key)) throw new Error(`app duplicada: ${app.key}`)
    claves.add(app.key)
    for (const s of app.secciones) {
      if (!CATALOGO_CAPACIDADES[s.capacidad]) {
        throw new Error(`capacidad no definida: ${app.key} → ${s.capacidad}`)
      }
    }
  }
  return true
}

/**
 * Centro para UN usuario EN UNA empresa (rodando el requisito: la misma
 * persona puede ver más módulos en una empresa que en otra).
 */
function centroParaUsuario(db, usuarioId, empresaId = null) {
  validarCatalogo()

  const filas = db.prepare(`
    SELECT ue.empresa_id, e.rut, e.nombre, r.codigo AS rol
    FROM usuario_empresa ue
    JOIN empresas e ON e.id = ue.empresa_id AND e.activo = 1
    JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.activo = 1
    ORDER BY e.nombre
  `).all(usuarioId)
  if (!filas.length) return { empresas: [], empresa_activa: null, apps: [] }

  const usuario = db.prepare(`SELECT is_admin FROM users WHERE id = ?`).get(usuarioId)

  const activa = empresaId != null
    ? filas.find((f) => Number(f.empresa_id) === Number(empresaId))
    : filas[0]
  // Aislamiento estricto: pedida empresa SIN asignación activa → error, jamás
    // datos de otra empresa (ni por URL conocida con ?empresa=<id> ajena).
  if (!activa) throw new Error('No tiene acceso a esta empresa')

  const permisosDb = db.prepare(`
    SELECT r.codigo AS rol FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.empresa_id = ? AND ue.activo = 1
  `)
  const capacidadesDe = (eid) => {
    const fila = permisosDb.get(usuarioId, eid)
    if (!fila) return new Set()
    if (usuario && usuario.is_admin) return new Set(Object.keys(CATALOGO_CAPACIDADES))
    const rbac = require('./permisos')
    return rbac.permisosDeRol(fila.rol)
  }

  // Licencia de la empresa ACTIVA (módulo habilitado comercialmente, §2).
  let licencia = null
  try {
    const licencias = require('./licencias')
    const st = licencias.estadoParaUI(db, activa.empresa_id)
    if (st.suscripcion) {
      licencia = {
        estado: st.estado, dias_restantes: st.dias_restantes, plan: st.plan,
        ok: st.ok === true, en_gracia: !!st.en_gracia, mensaje: st.mensaje || null,
      }
    }
  } catch { licencia = null } // sin licencia registrada aún: ninguna app pierde visibilidad (la gate real vive en cada ruta)

  const permisos = capacidadesDe(activa.empresa_id)
  const esSuperAdmin = !!(usuario && usuario.is_admin)

  const apps = []
  for (const app of CATALOGO_APPS) {
    // RESTRICCIÓN POR ROL (gate del guard real, no inventado): una app puede
    // limitarse a roles concretos en la empresa activa (p. ej. CRM solo
    // contador/super admin). El super admin pasa siempre.
    if (app.roles && !esSuperAdmin && !app.roles.includes(activa.rol)) continue
    const secciones = app.secciones
      .filter((s) => permisos.has(s.capacidad))
      .map((s) => ({ grupo: s.grupo, ruta: s.ruta, capacidad: s.capacidad }))
    if (!secciones.length) continue // permiso de acceso: la app no aparece ni con URL conocida
    apps.push({
      key: app.key,
      titulo: app.titulo,
      descripcion: app.descripcion,
      icono: app.icono,
      orden: app.orden,
      restringida: !!app.restringida,
      modoExterno: !!app.modoExterno,
      secciones,
      habilitado_comercial: licencia ? (licencia.ok || licencia.en_gracia) : true,
    })
  }

  return {
    empresas: filas.map((f) => ({ id: f.empresa_id, rut: f.rut, nombre: f.nombre, rol: f.rol })),
    empresa_activa: { id: activa.empresa_id, rut: activa.rut, nombre: activa.nombre, rol: activa.rol },
    licencia,
    apps,
  }
}

module.exports = { CATALOGO_APPS, centroParaUsuario, validarCatalogo }
