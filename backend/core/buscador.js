/**
 * BUSCADOR GLOBAL R2 — búsqueda por texto libre DENTRO de la empresa activa.
 *
 * Objetivo (HANDOFF §22): responder "¿dónde está la factura del proveedor X?"
 * en un solo lugar, sin recorrer vistas. Se busca en el mundo operativo
 * (documentos, asientos, DTEs emitidos), en las personas de la cuenta
 * corriente y en el plan de cuentas — CADA grupo devuelve solo si el rol del
 * usuario incluye el permiso de su vista (el mismo del menú, §RBAC).
 *
 * Estrategia de matching: 100% en JavaScript con normalización sin acentos
 * (mismo criterio que UITabla). SQLite LOWER() solo casea ASCII y LIKE no
 * ignora tildes ("camion" no matchea "Camión"), así que cada grupo hace un
 * pull acotado (los últimos N registros) y se filtra normalizado aquí.
 *
 * Reglas:
 *   - Aislamiento estricto por empresa_id en cada consulta.
 *   - Máximo 5 resultados por grupo: es un canal de navegación, no una lista.
 *   - El folio solo matchea exacto: "1023" no debe traer todo lo que
 *     contenga 1023.
 *   - Solo lectura: SELECT pura, nada muta; el gate de licencia no aplica a
 *     lecturas (§SAAS-ACCESO§5) — el router solo verifica RBAC.
 *   - Módulo puro: recibe la BD y los permisos por parámetro (testeable).
 *
 * Límite de cobertura: el pull por grupo es de PULL_POR_GRUPO registros
 * más recientes (los libros de un año típico caben sin problema).
 */

const LIMIT_POR_GRUPO = 5
const PULL_POR_GRUPO = 1000

/** 'Camión Eléctrico' → 'camion electrico' — igual que el de UITabla. */
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Todas las secuencias (multi-palabra) del query deben estar en el texto. */
function contiene(textoNormalizado, qNormalizado) {
  const terminos = qNormalizado.split(/\s+/).filter(Boolean)
  return terminos.every((t) => textoNormalizado.includes(t))
}

function rutCrudo(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '')
}

/**
 * Búsqueda dentro de una empresa. `permisos` es el Set de capacidades del
 * rol del usuario en ESA empresa. Devuelve { q, grupos } con cada grupo
 * { grupo, permiso, filas: [{ titulo, sub, hash }] }.
 */
function buscar(db, { empresaId, texto, permisos }) {
  const tiene = (p) => permisos instanceof Set && permisos.has(p)
  const q = normalizar(texto)
  if (q.length < 2 || !Number.isInteger(empresaId)) return { q, grupos: [] }

  const folioExacto = String(texto || '').trim()
  const qRut = rutCrudo(texto)
  const grupos = []

  // ---------- Documentos (permiso documentos:ver) ----------
  if (tiene('documentos:ver')) {
    const filas = db.prepare(`
      SELECT tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
             monto_total, estado, periodo_ingesta
      FROM documentos
      WHERE empresa_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(empresaId, PULL_POR_GRUPO)
      .filter((f) =>
        contiene(normalizar(f.razon_social), q) ||
        rutCrudo(f.rut_contraparte).includes(qRut) ||
        (folioExacto && String(f.folio) === folioExacto))
      .slice(0, LIMIT_POR_GRUPO)

    if (filas.length) {
      grupos.push({
        grupo: 'Documentos',
        permiso: 'documentos:ver',
        filas: filas.map((f) => ({
          titulo: `${f.tipo_flujo === 'compra' ? 'Compra' : 'Venta'} ${f.tipo_doc} ${f.folio || 'sin folio'} — ${f.razon_social || f.rut_contraparte}`,
          sub: `${f.estado} · ${f.periodo_ingesta} · ${f.monto_total ?? ''}`.trim(),
          hash: '#documentos',
        })),
      })
    }
  }

  // ---------- Asientos (permiso asientos:ver) ----------
  if (tiene('asientos:ver')) {
    const filas = db.prepare(`
      SELECT folio, periodo, tipo, glosa
      FROM asientos
      WHERE empresa_id = ? AND tipo != 'reversion' -- el gemelo auto-generado de la reversión no aporta al buscador
      ORDER BY id DESC
      LIMIT ?
    `).all(empresaId, PULL_POR_GRUPO)
      .filter((f) => contiene(normalizar(f.glosa), q) || (folioExacto && String(f.folio) === folioExacto))
      .slice(0, LIMIT_POR_GRUPO)

    if (filas.length) {
      grupos.push({
        grupo: 'Asientos',
        permiso: 'asientos:ver',
        filas: filas.map((f) => ({
          titulo: `Asiento ${f.folio} — ${f.glosa}`,
          sub: `${f.tipo} · ${f.periodo}`,
          hash: '#asientos',
        })),
      })
    }
  }

  // ---------- DTEs emitidos (permiso dte:ver) ----------
  if (tiene('dte:ver')) {
    const filas = db.prepare(`
      SELECT tipo_dte, folio, receptor_razon_social, receptor_rut, monto_total, estado
      FROM dte_emitidos
      WHERE empresa_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(empresaId, PULL_POR_GRUPO)
      .filter((f) =>
        contiene(normalizar(f.receptor_razon_social), q) ||
        rutCrudo(f.receptor_rut).includes(qRut) ||
        (folioExacto && String(f.folio) === folioExacto))
      .slice(0, LIMIT_POR_GRUPO)

    if (filas.length) {
      grupos.push({
        grupo: 'DTEs emitidos',
        permiso: 'dte:ver',
        filas: filas.map((f) => ({
          titulo: `DTE ${f.tipo_dte} ${f.folio} — ${f.receptor_razon_social || f.receptor_rut}`,
          sub: `${f.estado} · ${f.monto_total ?? ''}`.trim(),
          hash: '#dte',
        })),
      })
    }
  }

  // ---------- Personas de cuenta corriente (permiso reportes:ver) ----------
  if (tiene('reportes:ver')) {
    const porRut = new Map()
    db.prepare(`
      SELECT rut_contraparte, razon_social, tipo_flujo, monto_total
      FROM documentos
      WHERE empresa_id = ?
      ORDER BY id DESC
      LIMIT ?
    `    ).all(empresaId, PULL_POR_GRUPO).forEach((d) => {
      const rut = d.rut_contraparte
      if (!rut) return
      const p = porRut.get(rut) || { nombre: d.razon_social, n: 0, compras: 0, ventas: 0 }
      // Un mismo RUT puede traer razones distintas (boletas vs facturas, glosas):
      // para nombre de la persona manda la razón más informativa (la más larga).
      if (d.razon_social && String(d.razon_social).length > String(p.nombre || '').length) p.nombre = d.razon_social
      p.n++
      if (d.tipo_flujo === 'compra') p.compras += d.monto_total || 0
      else if (d.tipo_flujo === 'venta') p.ventas += d.monto_total || 0
      porRut.set(rut, p)
    })
    const filas = [...porRut.entries()]
      .map(([rut, p]) => ({ rut, ...p }))
      .filter((f) => contiene(normalizar(f.nombre), q) || rutCrudo(f.rut).includes(qRut))
      .sort((a, b) => (b.compras + b.ventas) - (a.compras + a.ventas))
      .slice(0, LIMIT_POR_GRUPO)

    if (filas.length) {
      grupos.push({
        grupo: 'Clientes y proveedores',
        permiso: 'reportes:ver',
        filas: filas.map((f) => ({
          titulo: f.nombre || f.rut,
          sub: `${f.n} documento(s) · compras ${f.compras} · ventas ${f.ventas}`,
          // La persona vive en la cuenta corriente de su flujo dominante.
          hash: f.compras >= f.ventas ? '#cproveedores' : '#cclientes',
        })),
      })
    }
  }

  // ---------- Cuentas del plan (permiso cuentas:ver) ----------
  if (tiene('cuentas:ver')) {
    const filas = db.prepare(`
      SELECT codigo, nombre, clase
      FROM cuentas
      WHERE empresa_id = ?
      ORDER BY codigo
      LIMIT ?
    `).all(empresaId, 2000)
      .filter((f) => contiene(normalizar(f.nombre), q) || String(f.codigo).includes(texto.trim()))
      .slice(0, LIMIT_POR_GRUPO)

    if (filas.length) {
      grupos.push({
        grupo: 'Cuentas del plan',
        permiso: 'cuentas:ver',
        filas: filas.map((f) => ({
          titulo: `${f.codigo} — ${f.nombre}`,
          sub: `clase ${f.clase}`,
          hash: '#asientos',
        })),
      })
    }
  }

  return { q, grupos }
}

module.exports = { buscar, LIMIT_POR_GRUPO, PULL_POR_GRUPO }
